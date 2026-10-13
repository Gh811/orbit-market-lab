import unittest
from unittest.mock import patch

import okx_market


class OkxMarketTests(unittest.TestCase):
    def test_daily_hot_uses_real_turnover_and_balances_categories(self):
        catalog = {symbol: {"instId": symbol + "-USDT-SWAP", "instCategory": category}
                   for symbol, category in [("BTC", "1"), ("ETH", "1"),
                                            ("NVDA", "3"), ("AAPL", "3"), ("XAU", "4")]}
        tickers = [{"instId": symbol + "-USDT-SWAP", "last": str(price),
                    "volCcy24h": str(volume), "ts": "1791694510868"}
                   for symbol, price, volume in [("BTC", 100, 20), ("ETH", 10, 100),
                                                 ("NVDA", 20, 100), ("AAPL", 50, 10),
                                                 ("XAU", 100, 1000)]]
        with patch("okx_market.request", return_value=tickers):
            result = okx_market.daily_hot(catalog, per_category=1)
        self.assertEqual([row["symbol"] for row in result], ["BTC", "NVDA"])
        self.assertEqual([row["turnover24h"] for row in result], [2000, 2000])

    def test_search_unifies_stock_referenced_and_crypto_perpetuals(self):
        catalog = {symbol: {"instId": f"{symbol}-USDT-SWAP"}
                   for symbol in ("BTC", "SOXL", "AAPL")}
        soxl = okx_market.search("SOXLUSDT", catalog)
        self.assertEqual(soxl[0]["instId"], "SOXL-USDT-SWAP")
        self.assertEqual(soxl[0]["type"], "swap")
        self.assertEqual(okx_market.search("Bitcoin", catalog)[0]["symbol"], "BTC")

    def test_catalog_contains_instant_search_metadata(self):
        catalog = {"SOXL": {"instId": "SOXL-USDT-SWAP", "instCategory": "tradfi"},
                   "BTC": {"instId": "BTC-USDT-SWAP"}}
        items = okx_market.search_catalog(catalog)
        self.assertEqual([item["symbol"] for item in items], ["BTC", "SOXL"])
        self.assertEqual(items[1]["name"], "Direxion Semiconductor Bull 3X ETF")
        self.assertEqual(items[1]["instId"], "SOXL-USDT-SWAP")

    def test_chinese_names_and_terms_match_exact_okx_symbols(self):
        catalog = {symbol: {"instId": f"{symbol}-USDT-SWAP", "instCategory": "3"}
                   for symbol in ("SAMSUNG", "SKHYNIX", "QQQ")}
        self.assertEqual(okx_market.search("三星", catalog)[0]["symbol"], "SAMSUNG")
        self.assertEqual(okx_market.search("海力", catalog)[0]["symbol"], "SKHYNIX")
        self.assertEqual(okx_market.search("纳指100", catalog)[0]["symbol"], "QQQ")
        self.assertEqual(okx_market.search("HBM", catalog)[0]["symbol"], "SKHYNIX")
        self.assertEqual(okx_market.search("三星", catalog)[0]["aliases"][0], "三星")

    def test_candles_use_usdt_turnover_and_sort_oldest_first(self):
        rows = [
            ["2000", "101", "103", "100", "102", "8", "8", "816", "0"],
            ["1000", "100", "102", "99", "101", "7", "7", "707", "1"],
            ["3000", "100", "99", "98", "100", "7", "7", "700", "1"],
        ]
        normalized = okx_market.normalize_candles(rows)
        self.assertEqual([bar["t"] for bar in normalized], [1000, 2000])
        self.assertEqual(normalized[-1]["v"], 816.0)
        self.assertEqual([bar["confirmed"] for bar in normalized], [True, False])


if __name__ == "__main__":
    unittest.main()
