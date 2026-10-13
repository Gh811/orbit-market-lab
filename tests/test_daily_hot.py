"""Daily rankings are shared, complete, persisted, and safe on upstream failure."""
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import server
from market_store import MarketStore


def ranking():
    return [{"type": "swap", "symbol": f"{prefix}{i}", "category": category,
             "instId": f"{prefix}{i}-USDT-SWAP", "turnover24h": 1000 - i}
            for prefix, category in [("C", "1"), ("S", "3")] for i in range(10)]


class DailyHotTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.store = MarketStore(Path(self.folder.name) / 'market.sqlite3')
        self.items = ranking()
        self.catalog = {item['symbol']: {'instId': item['instId'], 'instCategory': item['category']}
                        for item in self.items}
        self.patches = [patch.object(server, 'market_store', return_value=self.store),
                        patch.object(server, 'cached', return_value=self.catalog),
                        patch.object(server, 'DAILY_HOT_RETRY', {})]
        for p in self.patches:
            p.start()
        self.addCleanup(self.folder.cleanup)
        for p in self.patches:
            self.addCleanup(p.stop)

    def test_concurrent_clients_share_one_snapshot(self):
        with patch.object(server.okx_market, 'daily_hot', return_value=self.items) as fetch:
            with ThreadPoolExecutor(max_workers=4) as pool:
                records = list(pool.map(lambda _: server.daily_hot_record('2026-10-11'), range(4)))
            self.assertEqual(fetch.call_count, 1)
        self.assertTrue(all(len(record['items']) == 20 and not record['stale'] for record in records))
        restarted = MarketStore(self.store.path)
        self.assertEqual(restarted.daily_hot('2026-10-11')['items'], self.items)

    def test_new_day_creates_new_snapshot(self):
        self.store.save_daily_hot('2026-10-11', self.items)
        with patch.object(server.okx_market, 'daily_hot', return_value=self.items) as fetch:
            record = server.daily_hot_record('2026-10-12')
        fetch.assert_called_once()
        self.assertEqual(record['day'], '2026-10-12')
        self.assertFalse(record['stale'])
        self.assertIsNotNone(self.store.daily_hot('2026-10-11'))

    def test_same_day_refreshes_at_four_hours(self):
        self.store.save_daily_hot('2026-10-12', self.items)
        fetched = self.store.daily_hot('2026-10-12')['fetchedAt']
        with patch.object(server.okx_market, 'daily_hot', return_value=self.items) as fetch:
            with patch.object(server.time, 'time', return_value=fetched + 4 * 3600 - 1):
                self.assertFalse(server.daily_hot_record('2026-10-12')['stale'])
                fetch.assert_not_called()
            with patch.object(server.time, 'time', return_value=fetched + 4 * 3600):
                with ThreadPoolExecutor(max_workers=4) as pool:
                    records = list(pool.map(lambda _: server.daily_hot_record('2026-10-12'), range(4)))
                fetch.assert_called_once()
                self.assertTrue(all(not r['stale'] for r in records))
                self.assertEqual(self.store.daily_hot('2026-10-12')['fetchedAt'], fetched + 4 * 3600)

    def test_expired_same_day_snapshot_survives_failed_refresh(self):
        self.store.save_daily_hot('2026-10-12', self.items)
        fetched = self.store.daily_hot('2026-10-12')['fetchedAt']
        with patch.object(server.time, 'time', return_value=fetched + 4 * 3600), \
                patch.object(server.okx_market, 'daily_hot', side_effect=ValueError('upstream failed')) as fetch:
            for _ in range(2):
                record = server.daily_hot_record('2026-10-12')
                self.assertTrue(record['stale'])
                self.assertEqual(record['items'], self.items)
            fetch.assert_called_once()
        self.assertEqual(self.store.daily_hot('2026-10-12')['fetchedAt'], fetched)

    def test_failure_keeps_old_snapshot_and_throttles_retry(self):
        self.store.save_daily_hot('2026-10-11', self.items)
        with patch.object(server.okx_market, 'daily_hot', side_effect=ValueError('upstream failed')) as fetch:
            for _ in range(2):
                record = server.daily_hot_record('2026-10-12')
                self.assertTrue(record['stale'])
                self.assertEqual(record['day'], '2026-10-11')
            self.assertEqual(fetch.call_count, 1)
        self.assertIsNone(self.store.daily_hot('2026-10-12'))

    def test_incomplete_or_duplicate_data_cannot_overwrite_snapshot(self):
        self.store.save_daily_hot('2026-10-11', self.items)
        bad = self.items[:-1] + [self.items[0]]
        with patch.object(server.okx_market, 'daily_hot', return_value=bad):
            self.assertTrue(server.daily_hot_record('2026-10-12')['stale'])
        self.assertIsNone(self.store.daily_hot('2026-10-12'))
        self.assertFalse(server.valid_daily_hot({'items': self.items[:-1]}))
        self.assertFalse(server.valid_daily_hot({'items': [dict(i, category='1') for i in self.items]}))

    def test_no_valid_snapshot_returns_failure(self):
        with patch.object(server.okx_market, 'daily_hot', side_effect=ValueError('upstream failed')):
            with self.assertRaisesRegex(ValueError, '热门榜暂不可用'):
                server.daily_hot_record('2026-10-11')


if __name__ == '__main__':
    unittest.main()
