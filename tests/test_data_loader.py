import json
import unittest
from unittest.mock import patch

from data_loader import load_yahoo_daily_prices
from data_loader import PricePoint
from scripts.refresh_short_term_daily_bars import verified_rows
from datetime import date


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class DataLoaderTests(unittest.TestCase):
    @patch("data_loader.urllib.request.urlopen")
    def test_yahoo_daily_prices_preserve_positive_volume(self, urlopen):
        urlopen.return_value = FakeResponse({"chart": {"error": None, "result": [{
            "timestamp": [1767225600, 1767312000],
            "indicators": {
                "quote": [{"close": [100, 101], "open": [99, 100], "high": [101, 102], "low": [98, 99], "volume": [1234, 2345]}],
                "adjclose": [{"adjclose": [100, 101]}],
            },
        }]}})
        points = load_yahoo_daily_prices("TSM", "2026-01-01", "2026-01-02")
        self.assertEqual([point.volume for point in points], [1234.0, 2345.0])

    def test_refresh_excludes_invalid_provider_rows_without_rewriting_ohlc(self):
        valid = PricePoint(date(2026, 1, 1), 100, 99, 101, 98, 100, 1234)
        invalid = PricePoint(date(2026, 1, 2), 100, 102, 101, 98, 100, 1234)
        rows, rejected = verified_rows([valid, invalid])
        self.assertEqual(rejected, 1)
        self.assertEqual(rows, [{"date": "2026-01-01", "open": 99, "high": 101, "low": 98, "close": 100, "volume": 1234, "adjusted": 100}])


if __name__ == "__main__":
    unittest.main()
