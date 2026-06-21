from __future__ import annotations

import unittest
from datetime import datetime, timezone

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
