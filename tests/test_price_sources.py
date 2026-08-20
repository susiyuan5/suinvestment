from __future__ import annotations

import unittest
from datetime import date, datetime, timezone

from scripts import price_sources


NOW = datetime(2026, 6, 21, 12, tzinfo=timezone.utc)


def candidate(**overrides):
    result = {
        "symbol": "AAPL",
        "price": 101.0,
        "previousClose": 100.0,
        "quoteTimestamp": "2026-06-21T10:00:00Z",
        "fetchTimestamp": "2026-06-21T11:00:00Z",
        "source": "Test API",
        "sourceType": "api",
        "trustedSource": True,
    }
    result.update(overrides)
    return result


class PriceSourceValidationTests(unittest.TestCase):
    def test_daily_close_timestamp_uses_new_york_summer_close(self):
        result = price_sources.latest_close_timestamp(date(2026, 6, 19))
        self.assertEqual("2026-06-19T20:00:00Z", price_sources.isoformat(result))

    def test_daily_close_timestamp_uses_new_york_winter_close(self):
        result = price_sources.latest_close_timestamp(date(2026, 1, 5))
        self.assertEqual("2026-01-05T21:00:00Z", price_sources.isoformat(result))

    def test_matching_regular_market_time_is_preferred(self):
        regular = datetime(2026, 6, 19, 20, 1, tzinfo=timezone.utc)
        result = price_sources.latest_close_timestamp(date(2026, 6, 19), regular.timestamp())
        self.assertEqual(price_sources.isoformat(regular), price_sources.isoformat(result))

    def test_mismatched_regular_market_time_falls_back_to_close(self):
        regular = datetime(2026, 6, 18, 20, 1, tzinfo=timezone.utc)
        result = price_sources.latest_close_timestamp(date(2026, 6, 19), regular.timestamp())
        self.assertEqual("2026-06-19T20:00:00Z", price_sources.isoformat(result))

    def test_daily_open_timestamp_is_not_used_as_quote_timestamp(self):
        points = [(datetime(2026, 6, 17, 13, 30, tzinfo=timezone.utc), 98),
                  (datetime(2026, 6, 18, 13, 30, tzinfo=timezone.utc), 99),
                  (datetime(2026, 6, 19, 13, 30, tzinfo=timezone.utc), 100),
                  (datetime(2026, 6, 20, 13, 30, tzinfo=timezone.utc), 101),
                  (datetime(2026, 6, 21, 13, 30, tzinfo=timezone.utc), 102),
                  (datetime(2026, 6, 22, 13, 30, tzinfo=timezone.utc), 103)]
        snapshot = price_sources.build_snapshot("AAPL", points, source="Yahoo Finance Chart API", source_type="api", trusted=True)
        self.assertNotEqual("2026-06-22T13:30:00Z", snapshot["quoteTimestamp"])
        self.assertEqual("2026-06-22T20:00:00Z", snapshot["quoteTimestamp"])

    def test_previous_close_is_fresh_next_trading_morning(self):
        result = price_sources.validate_snapshot(candidate(quoteTimestamp="2026-06-22T20:00:00Z"), now=datetime(2026, 6, 23, 13, 30, tzinfo=timezone.utc))
        self.assertEqual("validated", result["validationStatus"])

    def test_date_mismatched_quote_is_invalid_for_daily_snapshot(self):
        snapshot = candidate(latestDate="2026-06-21", quoteTimestamp="2026-06-20T20:00:00Z")
        self.assertEqual("invalid", price_sources.validate_snapshot(snapshot, now=NOW)["validationStatus"])

    def test_invalid_price_and_future_quote_are_rejected(self):
        self.assertEqual("invalid", price_sources.validate_snapshot(candidate(price=float("nan")), now=NOW)["validationStatus"])
        self.assertEqual("invalid", price_sources.validate_snapshot(candidate(quoteTimestamp="2026-06-21T13:06:00Z"), now=NOW)["validationStatus"])

    def test_fresh_positive_quote_is_validated(self):
        result = price_sources.validate_snapshot(candidate(), now=NOW)
        self.assertEqual("validated", result["validationStatus"])
        self.assertFalse(result["stale"])

    def test_quote_older_than_24_hours_is_stale(self):
        result = price_sources.validate_snapshot(
            candidate(quoteTimestamp="2026-06-20T10:00:00Z"), now=NOW
        )
        self.assertEqual("stale", result["validationStatus"])
        self.assertTrue(result["stale"])

    def test_future_quote_is_invalid(self):
        result = price_sources.validate_snapshot(
            candidate(quoteTimestamp="2026-06-21T13:00:00Z"), now=NOW
        )
        self.assertEqual("invalid", result["validationStatus"])

    def test_non_positive_price_is_invalid(self):
        result = price_sources.validate_snapshot(candidate(price=0), now=NOW)
        self.assertEqual("invalid", result["validationStatus"])

    def test_untrusted_large_move_requires_review(self):
        result = price_sources.validate_snapshot(
            candidate(price=150, trustedSource=False), now=NOW
        )
        self.assertEqual("manual_review", result["validationStatus"])

    def test_previous_snapshot_is_preserved_as_stale_fallback(self):
        result = price_sources.mark_previous_fallback(
            candidate(), "2026-06-20T00:00:00Z", ["API unavailable"], now=NOW
        )
        self.assertEqual(101.0, result["price"])
        self.assertEqual("fallback", result["sourceType"])
        self.assertEqual("stale_fallback", result["validationStatus"])

    def test_unavailable_snapshot_never_guesses_a_price(self):
        result = price_sources.unavailable_snapshot("SPY", ["No source"], now=NOW)
        self.assertIsNone(result["price"])
        self.assertEqual("unavailable", result["validationStatus"])
        self.assertTrue(result["stale"])

    def test_recent_official_closed_market_quote_has_distinct_status(self):
        result = price_sources.validate_snapshot(
            candidate(quoteTimestamp="2026-06-18T13:30:00Z", marketState="CLOSED"),
            now=datetime(2026, 6, 21, 12, tzinfo=timezone.utc),
        )
        self.assertEqual("market_closed_last_close", result["validationStatus"])
        self.assertFalse(result["stale"])

    def test_successful_same_timestamp_api_quote_keeps_api_provenance(self):
        stale_quote = candidate(quoteTimestamp="2026-06-18T13:30:00Z")

        def provider(_symbol):
            return stale_quote

        provider.source_name = "Test API"
        previous = {
            **stale_quote,
            "source": "Previous weekly snapshot",
            "sourceType": "fallback",
            "validationStatus": "stale_fallback",
        }
        result, _errors = price_sources.fetch_best_snapshot(
            "AAPL", previous, "2026-06-18T14:00:00Z", now=NOW, providers=(provider,)
        )
        self.assertEqual("Test API", result["source"])
        self.assertEqual("api", result["sourceType"])
        self.assertEqual("stale", result["validationStatus"])


if __name__ == "__main__":
    unittest.main()
