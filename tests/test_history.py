import calendar
import time
import unittest
from datetime import datetime
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import server


def coinbase_page(url, token=False):
    query = parse_qs(urlsplit(url).query)
    step = int(query["granularity"][0])
    start = calendar.timegm(datetime.strptime(query["start"][0], "%Y-%m-%dT%H:%M:%SZ").timetuple())
    end = calendar.timegm(datetime.strptime(query["end"][0], "%Y-%m-%dT%H:%M:%SZ").timetuple())
    return [[stamp, 99, 101, 100, 100, 10] for stamp in range(start, end, step)]


class HistoryTests(unittest.TestCase):
    def test_coinbase_pages_extend_beyond_single_request(self):
        before = 1_762_473_600_000
        with patch.object(server, "remote_json", side_effect=coinbase_page):
            rows = server.history_candles("crypto", "BTC", "1m", before)
        self.assertEqual(len(rows), 720)
        self.assertTrue(all(row["t"] < before for row in rows))
        self.assertEqual(len({row["t"] for row in rows}), len(rows))

    def test_weekly_aggregation_returns_older_weeks(self):
        before = 1_762_473_600_000
        with patch.object(server, "remote_json", side_effect=coinbase_page):
            rows = server.history_candles("crypto", "BTC", "1w", before)
        self.assertGreater(len(rows), 250)
        self.assertTrue(all(row["t"] < before for row in rows))
        self.assertEqual(len({row["t"] for row in rows}), len(rows))

    def test_stock_fallback_filters_at_boundary(self):
        before = 1_762_473_600_000
        sample = [{"t": before - 86400000, "c": 100}, {"t": before, "c": 101}]
        with patch.object(server, "TOKEN", "test"), \
             patch.object(server, "remote_json", return_value={"s": "no_data"}), \
             patch.object(server, "yahoo_candles", return_value=sample):
            rows = server.history_candles("stock", "AAPL", "1d", before)
        self.assertEqual(rows, sample[:1])


if __name__ == "__main__":
    unittest.main()
