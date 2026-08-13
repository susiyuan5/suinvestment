import unittest

from research.idea_engine.v3.short_term_daily_bars import validate_rows, validate_snapshot


def rows(count=252, *, volume=True):
    return [{"date": f"2025-{(index // 28) + 1:02d}-{(index % 28) + 1:02d}", "open": 100 + index, "high": 101 + index, "low": 99 + index, "close": 100.5 + index, "volume": 1000 if volume else None, "adjusted": 100.5 + index} for index in range(count)]


class ShortTermDailyBarsTests(unittest.TestCase):
    def test_missing_volume_is_not_filled_from_close(self):
        normalized, errors = validate_rows(rows(volume=False))
        self.assertEqual(normalized, [])
        self.assertIn("insufficient_daily_history", errors)

    def test_missing_schema_is_blocked(self):
        result = validate_snapshot({"schema_version": "short-term-daily-bars-v1", "research_only": True, "frequency": "1d", "adjustment": "split_and_dividend_adjusted", "symbols": {}}, ["AAPL"])
        self.assertFalse(result["valid"])
        self.assertTrue(any("rows_missing" in error for error in result["errors"]))


if __name__ == "__main__":
    unittest.main()
