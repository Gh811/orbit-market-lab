"""Prevent a same-ticker coin from receiving another project's logo."""
import unittest
from unittest.mock import patch

import server


class LogoResolutionTests(unittest.TestCase):
    def setUp(self):
        with server.CACHE_LOCK:
            for key in list(server.CACHE):
                if key[0] in ("coin", "company", "logo"):
                    server.CACHE.pop(key, None)

    def test_curated_company_and_issuer_icons_are_local(self):
        for symbol in ("SKHYNIX", "SAMSUNG", "QQQ", "NKE", "WDC", "GOOGL", "TSLA", "XAU",
                       "ANTHROPIC", "INTC", "OPENAI"):
            with self.subTest(symbol=symbol):
                icon = server.resolve_logo(symbol, {symbol: {"instCategory": "3"}})
                self.assertTrue(icon["url"].startswith("/assets/icons/brand/"))

    def test_ashare_brand_icons_are_local_and_verified(self):
        for symbol in ("SH600519", "SZ002384"):
            with self.subTest(symbol=symbol):
                icon = server.resolve_ashare_logo(symbol)
                self.assertTrue(icon["url"].startswith("/assets/icons/brand/"))
                self.assertTrue((server.ROOT / icon["url"].lstrip("/")).is_file())
        with patch.object(server, "saved_logo", return_value=None):
            self.assertEqual(server.resolve_ashare_logo("SZ000001")["url"], "")

    def test_doge_uses_the_dogecoin_website_artwork(self):
        with patch.object(server, "remote_json") as remote:
            icon = server.resolve_logo("DOGE", {"DOGE": {"instCategory": "1"}})
        self.assertEqual(icon["url"], "/assets/icons/crypto/doge.png")
        self.assertTrue((server.ROOT / icon["url"].lstrip("/")).is_file())
        remote.assert_not_called()

    def test_commodity_never_uses_same_ticker_coin_logo(self):
        with patch.object(server, "remote_json") as remote:
            icon = server.resolve_logo("XAU", {"XAU": {"instCategory": "4"}})
        self.assertEqual(icon["url"], "/assets/icons/brand/gold.svg")
        remote.assert_not_called()

    def test_company_profile_uses_stock_category_and_description(self):
        for symbol in ("MRVL", "NKE", "WDC"):
            with self.subTest(symbol=symbol):
                info = server.asset_info("swap", symbol)
                self.assertEqual(info["category"], "stock")
                self.assertNotIn("简介尚未收录", info["summary"])
                self.assertTrue(info["summaryUrl"].startswith("https://"))

    def test_gold_profile_is_commodity_not_token(self):
        info = server.asset_info("swap", "XAU")
        self.assertEqual(info["category"], "commodity")
        self.assertIn("黄金", info["summary"])
        self.assertIn("贵金属", info["summary"])
        self.assertNotIn("这里展示的是", info["summary"])

    def test_ambiguous_coin_symbol_has_no_remote_logo(self):
        catalog = {"ABC": {"instCategory": "1"}}
        result = {"coins": [
            {"symbol": "ABC", "large": "https://coin-images.coingecko.com/one.png"},
            {"symbol": "abc", "large": "https://coin-images.coingecko.com/two.png"},
        ]}
        with patch.object(server, "remote_json", return_value=result):
            self.assertEqual(server.resolve_logo("ABC", catalog)["url"], "")

    def test_exact_unambiguous_coin_uses_allowlisted_image(self):
        catalog = {"ABC": {"instCategory": "1"}}
        result = {"coins": [{"symbol": "ABC", "large": "https://coin-images.coingecko.com/one.png"}]}
        with patch.object(server, "remote_json", return_value=result), patch.object(server, "store_logo", return_value=None):
            self.assertEqual(server.resolve_logo("ABC", catalog)["url"], result["coins"][0]["large"])

    def test_clear_market_leader_resolves_same_ticker(self):
        catalog = {"WIF": {"instCategory": "1"}}
        result = {"coins": [
            {"symbol": "WIF", "market_cap_rank": 182, "large": "https://coin-images.coingecko.com/wif.png"},
            {"symbol": "WIF", "market_cap_rank": 3055, "large": "https://coin-images.coingecko.com/other.png"},
        ]}
        with patch.object(server, "remote_json", return_value=result), patch.object(server, "store_logo", return_value=None):
            self.assertEqual(server.resolve_logo("WIF", catalog)["url"], result["coins"][0]["large"])

    def test_exact_stock_ticker_uses_directory_domain(self):
        catalog = {"XYZ": {"instCategory": "3"}}
        result = {"results": [
            {"symbol": "XYZ", "name": "Example Inc.", "website": "https://www.example.com", "exchange": "NMS"},
            {"symbol": "XYZ.MI", "name": "Wrong listing", "website": "https://wrong.example", "exchange": "MIL"},
        ]}
        with patch.object(server, "remote_json", return_value=result), patch.object(server, "store_logo", return_value=None):
            logo = server.resolve_logo("XYZ", catalog)
        self.assertEqual(logo["url"], "https://cdn.tickerlogos.com/example.com")

    def test_altcoin_uses_second_exact_identity_when_first_source_is_down(self):
        catalog = {"YGG": {"instCategory": "1"}}
        backup = {"symbol": "YGG", "name": "Yield Guild Games"}
        with patch.object(server, "saved_logo", return_value=None), \
             patch.object(server, "coin_metadata", side_effect=TimeoutError), \
             patch.object(server, "remote_json", return_value=backup), \
             patch.object(server, "store_logo", return_value=None):
            logo = server.resolve_logo("YGG", catalog)
        self.assertEqual(logo["url"],
                         "https://img.loadlogo.com/crypto/ygg?fallback=404&format=png&size=128")
        self.assertIn("Yield Guild Games", logo["source"])

    def test_stock_uses_second_exact_identity_when_first_source_is_down(self):
        catalog = {"XYZ": {"instCategory": "3"}}
        backup = {"symbol": "XYZ", "name": "Example Inc.", "domain": "example.com"}
        with patch.object(server, "company_metadata", side_effect=TimeoutError), \
             patch.object(server, "remote_json", return_value=backup), \
             patch.object(server, "store_logo", return_value=None):
            logo = server.resolve_logo("XYZ", catalog)
        self.assertEqual(logo["url"],
                         "https://img.loadlogo.com/ticker/XYZ?fallback=404&format=png&size=128")

    def test_stock_rejects_mismatched_backup_ticker(self):
        with patch.object(server, "company_metadata", return_value={}), \
             patch.object(server, "remote_json", return_value={"symbol": "ABC", "name": "Wrong", "domain": "wrong.com"}):
            self.assertEqual(server.stock_identity("XYZ"), {})

    def test_saved_exact_logo_is_stable_without_network(self):
        catalog = {"YGG": {"instCategory": "1"}}
        with patch.object(server, "saved_logo", return_value={"url": "/api/logo-image?symbol=YGG", "source": "CoinGecko · Yield Guild Games"}), \
             patch.object(server, "remote_json") as remote:
            logo = server.resolve_logo("YGG", catalog)
        self.assertEqual(logo["url"], "/api/logo-image?symbol=YGG")
        remote.assert_not_called()

    def test_other_image_host_is_rejected(self):
        catalog = {"ABC": {"instCategory": "1"}}
        result = {"coins": [{"symbol": "ABC", "large": "https://example.com/logo.png"}]}
        with patch.object(server, "remote_json", return_value=result):
            self.assertEqual(server.resolve_logo("ABC", catalog)["url"], "")


if __name__ == "__main__":
    unittest.main()
