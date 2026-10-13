import tempfile
import threading
import unittest
import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from market_store import MarketStore


def bar(t, close):
    return {"t": t, "o": close, "h": close, "l": close,
            "c": close, "v": 10.0, "confirmed": True}


class MarketStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "market.sqlite3"
        self.store = MarketStore(self.path)

    def tearDown(self):
        self.temp.cleanup()

    def test_candles_survive_restart_and_merge_newer_values(self):
        key = MarketStore.key("okx", "candles", "BTC", "1m")
        self.store.get_or_refresh(key, 0, lambda: [bar(1000, 1), bar(2000, 2)],
                                  symbol="BTC", tf="1m")
        self.store.get_or_refresh(key, 0, lambda: [bar(2000, 3), bar(3000, 4)],
                                  symbol="BTC", tf="1m")
        restarted = MarketStore(self.path)
        self.assertEqual([row["c"] for row in restarted.recent_candles("BTC", "1m")],
                         [1, 3, 4])
        self.assertEqual([row["t"] for row in restarted.recent_candles("BTC", "1m", before=3000)],
                         [1000, 2000])
        self.assertEqual(restarted.recent_candles("ETH", "1m"), [])

    def test_fresh_response_avoids_fetch_and_stale_response_is_marked(self):
        key = MarketStore.key("info", "swap", "BTC")
        self.store.write(key, {"symbol": "BTC"})
        value, stale = MarketStore(self.path).get_or_refresh(
            key, 3600, lambda: self.fail("fresh data should not be fetched"))
        self.assertEqual(value, {"symbol": "BTC"})
        self.assertFalse(stale)
        value, stale = self.store.get_or_refresh(
            key, 0, lambda: (_ for _ in ()).throw(TimeoutError()))
        self.assertEqual(value, {"symbol": "BTC"})
        self.assertTrue(stale)

    def test_concurrent_refresh_uses_one_fetch(self):
        key = MarketStore.key("okx", "candles", "ETH", "1m")
        started = threading.Event()
        release = threading.Event()
        count = 0

        def fetch():
            nonlocal count
            count += 1
            started.set()
            release.wait(2)
            return [bar(1000, 1)]

        with ThreadPoolExecutor(max_workers=6) as pool:
            futures = [pool.submit(self.store.get_or_refresh, key, 60, fetch)
                       for _ in range(6)]
            self.assertTrue(started.wait(1))
            release.set()
            self.assertTrue(all(future.result(timeout=2)[0] == [bar(1000, 1)]
                                for future in futures))
        self.assertEqual(count, 1)

    def test_logo_roundtrip_category_and_replacement(self):
        image = b"\x89PNG\r\n\x1a\n" + b"a" * 60
        self.store.save_logo("BTC", "1", image, "verified", remote_url="https://example.test/btc.png")
        record = MarketStore(self.path).logo("BTC", "1")
        self.assertEqual(record["image"], image)
        self.assertEqual(record["mime"], "image/png")
        self.assertEqual(record["source"], "verified")
        self.assertIsNone(self.store.logo("BTC", "3"))
        updated = b"\xff\xd8\xff" + b"b" * 60
        self.store.save_logo("BTC", "1", updated, "new source")
        self.assertEqual(self.store.logo("BTC")["image"], updated)
        with self.assertRaises(ValueError):
            self.store.save_logo("BTC", "1", b"not an image", "bad")

    def test_background_returns_stale_immediately_and_refreshes_once(self):
        key = MarketStore.key("okx", "candles", "BTC", "1m")
        self.store.write(key, [bar(1000, 1)], symbol="BTC", tf="1m", fetched_at=0)
        started, release = threading.Event(), threading.Event()
        calls = []
        def fetch():
            calls.append(1)
            started.set()
            release.wait(2)
            return [bar(2000, 2)]
        begin = time.monotonic()
        for _ in range(6):
            value, stale = self.store.get_or_refresh(key, 60, fetch, symbol="BTC", tf="1m", background=True)
            self.assertEqual(value, [bar(1000, 1)])
            self.assertTrue(stale)
        self.assertLess(time.monotonic() - begin, 0.5)
        self.assertTrue(started.wait(1))
        release.set()
        self.wait_background()
        self.assertEqual(len(calls), 1)
        self.assertEqual(self.store.read(key)[0], [bar(2000, 2)])
        self.assertEqual(len(self.store.recent_candles("BTC", "1m")), 2)

    def wait_background(self):
        until = time.monotonic() + 3
        while self.store._pending and time.monotonic() < until:
            time.sleep(0.01)
        self.assertFalse(self.store._pending)

    def test_failed_background_preserves_data_and_throttles_retries(self):
        key = MarketStore.key("okx", "candles", "ETH", "1d")
        self.store.write(key, [bar(1000, 1)], fetched_at=0)
        calls = []
        def fetch():
            calls.append(1)
            raise TimeoutError()
        self.store.get_or_refresh(key, 60, fetch, background=True)
        self.wait_background()
        value, stale = self.store.get_or_refresh(key, 60, fetch, background=True)
        self.assertEqual(value, [bar(1000, 1)])
        self.assertTrue(stale)
        self.assertEqual(len(calls), 1)

    def test_background_concurrency_is_bounded(self):
        release = threading.Event()
        calls = []
        def fetch():
            calls.append(1)
            release.wait(2)
            return [bar(2000, 2)]
        for i in range(12):
            key = MarketStore.key("test", i)
            self.store.write(key, [bar(1000, 1)], fetched_at=0)
            self.store.get_or_refresh(key, 60, fetch, background=True)
        self.assertEqual(len(self.store._pending), 4)
        release.set()
        self.wait_background()
        self.assertEqual(len(calls), 4)

    def test_legacy_import_does_not_overwrite_database_logo(self):
        directory = Path(self.temp.name) / "old_logos"
        directory.mkdir()
        image = b"\x89PNG\r\n\x1a\n" + b"a" * 60
        (directory / "ETH.png").write_bytes(image)
        (directory / "ETH.json").write_text(json.dumps({
            "category": "1", "extension": "png", "source": "legacy", "savedAt": 100}))
        self.store.import_legacy_logos(directory)
        self.assertEqual(self.store.logo("ETH", "1")["image"], image)
        current = b"\xff\xd8\xff" + b"b" * 60
        self.store.save_logo("ETH", "1", current, "current")
        self.store.import_legacy_logos(directory)
        self.assertEqual(self.store.logo("ETH", "1")["image"], current)

    def test_search_and_daily_hot_survive_restart_without_touching_profiles(self):
        item = {"type": "swap", "symbol": "NVDA", "name": "NVIDIA",
                "instId": "NVDA-USDT-SWAP", "category": "3"}
        self.store.save_instruments({"NVDA": {"instId": item["instId"], "instCategory": "3"}})
        self.store.save_search("英伟达", [item])
        self.store.save_daily_hot("2026-10-11", [item])
        restarted = MarketStore(self.path)
        with restarted._db() as db:
            self.assertEqual(db.execute("SELECT count FROM searches WHERE query='英伟达'").fetchone()[0], 1)
            self.assertEqual(json.loads(db.execute(
                "SELECT results FROM searches WHERE query='英伟达'").fetchone()[0]), [item])
            self.assertEqual(db.execute("SELECT COUNT(*) FROM instruments").fetchone()[0], 1)
        self.assertEqual(restarted.daily_hot("2026-10-11")["items"], [item])
        self.assertIsNone(restarted.summary("stock", "NVDA"))


if __name__ == "__main__":
    unittest.main()
