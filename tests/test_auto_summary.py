"""Auto-generated first-visit summaries for uncurated symbols."""
import unittest
from unittest.mock import patch

import server


class AutoSummaryTests(unittest.TestCase):
    def test_trump_meme_coin_has_curated_chinese_summary(self):
        record = server.SUMMARIES.get(("crypto", "TRUMP"))
        self.assertIsNotNone(record)
        self.assertTrue(server.has_chinese(record[0]))
        self.assertIn("TRUMP", record[0])
        self.assertNotIn(record[1], server.EN_AUTO_SOURCES)

    def test_public_profile_hides_summary_provenance(self):
        profile = {"symbol": "XAU", "summary": "黄金标的。", "website": "",
                   "summarySource": "内置资料", "summaryUrl": "https://example.com/source"}
        visible = server.public_asset_info(profile)
        self.assertEqual(visible, {"symbol": "XAU", "summary": "黄金标的。", "website": ""})

    def test_old_explanatory_summary_is_not_shown(self):
        for symbol, name, category in (("XAU", "黄金", "commodity"),
                                       ("BZ", "布伦特原油", "commodity"),
                                       ("TESTA", "测试公司", "stock")):
            with self.subTest(symbol=symbol):
                profile = {"symbol": symbol, "name": name, "category": category,
                           "summary": "这里展示的是旧说明，不是实物黄金。"}
                visible = server.public_asset_info(profile)
                self.assertNotIn("这里展示的是", visible["summary"])
                self.assertNotIn("不是实物黄金", visible["summary"])
                if symbol == "XAU":
                    self.assertIn("贵金属", visible["summary"])

    def tearDown(self):
        with server.market_store()._db() as db:
            db.execute("DELETE FROM asset_summaries "
                       "WHERE symbol IN ('TESTA','TESTB','TESTC','TESTD')")
            for kind in ("swap", "stock", "crypto"):
                db.execute("DELETE FROM responses WHERE key=?",
                           (server.MarketStore.key("info", kind, "TESTD"),))

    def test_first_sentence_skips_abbreviations_and_domains(self):
        text = "Amazon.com, Inc. is a retailer of things. More detail here."
        self.assertEqual(server.first_sentence(text),
                         "Amazon.com, Inc. is a retailer of things.")
        self.assertEqual(server.first_sentence("<p>Hello <b>world</b>.</p> Next."),
                         "Hello world.")

    def test_stock_english_wikipedia_sentence_is_not_saved(self):
        wiki = {"type": "standard", "title": "Testa",
                "extract": "Testa Inc. is a fictional cloud security company. It sells software.",
                "content_urls": {"desktop": {"page": "https://en.wikipedia.org/wiki/Testa"}}}
        with patch.object(server, "remote_json", return_value=wiki):
            record = server.auto_generated_summary("stock", "TESTA", {"name": "Testa Inc."})
        self.assertIsNone(record)
        self.assertIsNone(server.market_store().summary("stock", "TESTA"))

    def test_wikipedia_disambiguation_is_rejected(self):
        with patch.object(server, "remote_json",
                          return_value={"type": "disambiguation", "title": "Testa"}):
            self.assertIsNone(server.wikipedia_intro("Testa"))
        self.assertIsNone(server.market_store().summary("stock", "TESTB"))

    def test_wikipedia_title_mismatch_is_rejected(self):
        wiki = {"type": "standard", "title": "Totally Different Thing",
                "extract": "Testa is mentioned only in passing somewhere else entirely."}
        with patch.object(server, "remote_json", return_value=wiki):
            self.assertIsNone(server.wikipedia_intro("Testa Corporation"))

    def test_stock_prefers_chinese_wikipedia(self):
        def fake_remote(url, **kwargs):
            if "w/api.php" in url:
                return {"query": {"pages": {"123": {"langlinks": [{"*": "安谋控股"}]}}}}
            if "zh.wikipedia.org" in url:
                return {"type": "standard", "title": "安谋控股",
                        "extract": "安谋控股是一家英国半导体与软件设计公司。它授权技术。",
                        "content_urls": {"desktop": {"page": "https://zh.wikipedia.org/wiki/安谋控股"}}}
            return {"type": "standard", "title": "Arm Holdings",
                    "extract": "Arm Holdings plc is a British semiconductor company. More."}
        with patch.object(server, "remote_json", side_effect=fake_remote):
            record = server.auto_generated_summary("stock", "TESTA", {"name": "Arm Holdings plc"})
        self.assertEqual(record[0], "安谋控股是一家英国半导体与软件设计公司。")
        self.assertEqual(record[2], "https://zh.wikipedia.org/wiki/安谋控股")
        saved = server.market_store().summary("stock", "TESTA")
        self.assertEqual(saved[0], record[0])

    def test_chinese_wiki_requests_simplified_variant(self):
        calls = []

        def fake_remote(url, **kwargs):
            calls.append((url, kwargs))
            if "w/api.php" in url:
                return {"query": {"pages": {"123": {"langlinks": [{"*": "安谋控股"}]}}}}
            if "en.wikipedia.org/api/rest_v1" in url:
                return {"type": "standard", "title": "Arm Holdings",
                        "extract": "Arm Holdings plc is a British semiconductor company. More."}
            return {"type": "standard", "title": "安谋控股",
                    "extract": "安谋控股是一家英国半导体与软件设计公司，其处理器技术授权给全球众多厂商广泛使用。",
                    "content_urls": {"desktop": {"page": "https://zh.wikipedia.org/wiki/安谋控股"}}}

        with patch.object(server, "remote_json", side_effect=fake_remote):
            record = server.chinese_wikipedia_intro("Arm Holdings plc")
        self.assertIsNotNone(record)
        zh_calls = [c for c in calls
                    if "zh.wikipedia.org" in c[0] and "w/api.php" not in c[0]]
        self.assertTrue(zh_calls)
        self.assertEqual(zh_calls[0][1].get("extra_headers", {}).get("Accept-Language"),
                         "zh-cn")

    def test_crypto_does_not_save_english_without_zh_page(self):
        def fake_remote(url, **kwargs):
            if "/coins/" in url:
                return {"description": {"en": "Testa is a decentralized network for tests."}}
            return {"type": "disambiguation", "title": "Testa"}
        with patch.object(server, "remote_json", side_effect=fake_remote):
            record = server.auto_generated_summary("crypto", "TESTC",
                                                   {"id": "testa", "name": "Testa"})
        self.assertIsNone(record)

    def test_crypto_description_html_is_stripped(self):
        coin = {"description": {"zh": "<p>泰斯塔是一个用于测试的去中心化网络。</p><p>更多介绍。</p>"},
                "categories": ["Layer 1"]}
        with patch.object(server, "remote_json", return_value=coin):
            record = server.auto_generated_summary("crypto", "TESTC", {"id": "testa"})
        self.assertEqual(record[0], "泰斯塔是一个用于测试的去中心化网络。")
        self.assertEqual(record[1], "自动生成 · CoinGecko")
        saved = server.market_store().summary("crypto", "TESTC")
        self.assertEqual(saved[0], record[0])

    def test_crypto_categories_fallback(self):
        coin = {"description": {"en": ""}, "categories": ["Layer 1", "DeFi", " Governance "]}
        with patch.object(server, "remote_json", return_value=coin):
            record = server.coingecko_intro({"id": "testa"})
        self.assertIsNone(record)

    def test_search_fallback_finds_company_by_ticker(self):
        def fake_remote(url, **kwargs):
            if "list=search" in url:
                return {"query": {"search": [{"title": "ChangXin Memory Technologies"}]}}
            if "w/api.php" in url:
                return {"query": {"pages": {"123": {"langlinks": [{"*": "长鑫存储"}]}}}}
            if "zh.wikipedia.org" in url:
                return {"type": "standard", "title": "长鑫存储",
                        "extract": "长鑫存储技术股份有限公司是一家中国的存储器芯片制造商，专注于动态随机存取存储器的设计与生产。",
                        "content_urls": {"desktop": {"page": "https://zh.wikipedia.org/wiki/长鑫存储"}}}
            return {"type": "standard", "title": "ChangXin Memory Technologies",
                    "extract": "ChangXin Memory Technologies (CXMT) is a Chinese memory chip maker. More detail."}

        with patch.object(server, "remote_json", side_effect=fake_remote):
            record = server.wikipedia_search_intro("CXMT")
        self.assertEqual(record[0],
                         "长鑫存储技术股份有限公司是一家中国的存储器芯片制造商，专注于动态随机存取存储器的设计与生产。")
        self.assertEqual(record[1], "自动生成 · 维基百科")
        self.assertEqual(record[2], "https://zh.wikipedia.org/wiki/长鑫存储")

    def test_crypto_never_saves_english_wikipedia(self):
        def fake_remote(url, **kwargs):
            if "w/api.php" in url:
                return {"query": {"pages": {"1": {"langlinks": []}}}}
            if "/coins/" in url:
                return {"description": {"en": "Pump is a launchpad token for testing purposes only."}}
            return {"type": "standard", "title": "Pump.fun",
                    "extract": "Pump.fun is a Solana-based memecoin launchpad platform for tokens. More."}

        with patch.object(server, "remote_json", side_effect=fake_remote):
            record = server.auto_generated_summary("crypto", "TESTC",
                                                   {"id": "pump-fun", "name": "Pump.fun"})
        self.assertIsNone(record)

    def test_english_auto_row_is_upgraded_to_chinese(self):
        store = server.market_store()
        store.save_summary("stock", "TESTD", "Testa Inc. is a company doing things the plain way.",
                           "自动生成 · 维基百科", "https://en.wikipedia.org/wiki/Testa")

        def fake_remote(url, **kwargs):
            if "w/api.php" in url:
                return {"query": {"pages": {"1": {"langlinks": [{"*": "泰斯塔"}]}}}}
            return {"type": "standard", "title": "泰斯塔",
                    "extract": "泰斯塔是一家测试公司，专注于提供各类软件测试服务。",
                    "content_urls": {"desktop": {"page": "https://zh.wikipedia.org/wiki/泰斯塔"}}}

        with patch.object(server, "remote_json", side_effect=fake_remote):
            record = server.chinese_upgrade("stock", "TESTD")
        self.assertIsNotNone(record)
        self.assertTrue(server.has_chinese(record[0]))
        saved = store.summary("stock", "TESTD")
        self.assertEqual(saved[0], record[0])

    def test_chinese_upgrade_invalidates_info_cache(self):
        store = server.market_store()
        store.save_summary("stock", "TESTD", "Testa Inc. is a company doing things the plain way.",
                           "自动生成 · 维基百科", "https://en.wikipedia.org/wiki/Testa")
        stale_key = server.MarketStore.key("info", "swap", "TESTD")
        store.write(stale_key, {"symbol": "TESTD", "summary": "Testa Inc. is a stale English blurb."})
        self.assertIsNotNone(store.read(stale_key))

        def fake_remote(url, **kwargs):
            if "w/api.php" in url:
                return {"query": {"pages": {"1": {"langlinks": [{"*": "泰斯塔"}]}}}}
            return {"type": "standard", "title": "泰斯塔",
                    "extract": "泰斯塔是一家测试公司，专注于提供各类软件测试服务。",
                    "content_urls": {"desktop": {"page": "https://zh.wikipedia.org/wiki/泰斯塔"}}}

        with patch.object(server, "remote_json", side_effect=fake_remote):
            record = server.chinese_upgrade("stock", "TESTD")
        self.assertIsNotNone(record)
        self.assertIsNone(store.read(stale_key))

    def test_chinese_upgrade_never_touches_manual_rows(self):
        store = server.market_store()
        store.save_summary("stock", "TESTB", "手工文案", "手工", "https://example.com")
        with patch.object(server, "remote_json") as mocked:
            self.assertIsNone(server.chinese_upgrade("stock", "TESTB"))
        mocked.assert_not_called()

    def test_chinese_search_intro_rejects_english_only_results(self):
        def fake_remote(url, **kwargs):
            if "list=search" in url:
                return {"query": {"search": [{"title": "Testa Corp"}]}}
            return {"type": "standard", "title": "Testa Corp",
                    "extract": "Testa Corp is an American company doing things in a plain way."}

        with patch.object(server, "remote_json", side_effect=fake_remote):
            self.assertIsNone(server._chinese_search_intro("TESTA", attempts=1))

    def test_manual_summary_is_never_overwritten(self):
        store = server.market_store()
        store.save_summary("stock", "TESTD", "手工文案", "手工", "https://example.com")
        wiki = {"type": "standard", "title": "Testa",
                "extract": "Testa Inc. is a fictional cloud security company."}
        with patch.object(server, "remote_json", return_value=wiki):
            server.auto_generated_summary("stock", "TESTD", {"name": "Testa Inc."})
        saved = store.summary("stock", "TESTD")
        self.assertEqual(saved[0], "手工文案")


if __name__ == "__main__":
    unittest.main()
