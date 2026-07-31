import math
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from scripts.price_sources import is_publishable
from scripts.update_backtest_prices import SYMBOLS, validate_snapshot, write_json_atomic
from scripts.update_backtest_daily_prices import validate_adjusted_snapshot


def rows(latest: str = "2026-06-05"):
    start = date(2025, 6, 6)
    return [
        {"date": (start + timedelta(weeks=index)).isoformat(), "close": 100.0 + index}
        for index in range(49)
    ] + [{"date": latest, "close": 150.0}]


def snapshot(latest: str = "2026-06-05"):
    data = rows(latest)
    return {
        "symbols": {symbol: data for symbol in SYMBOLS},
        "metadata": {symbol: {"validationStatus": "validated"} for symbol in SYMBOLS},
    }


class SnapshotIntegrityTests(unittest.TestCase):
    def test_backtest_snapshot_requires_finite_positive_monotonic_rows(self):
        payload = snapshot()
        validate_snapshot(payload, previous={"symbols": {}}, max_lag_days=10, as_of="2026-06-10")
        payload["symbols"]["QQQ"][-1]["close"] = math.nan
        with self.assertRaisesRegex(RuntimeError, "non-positive or non-finite"):
            validate_snapshot(payload, previous={"symbols": {}}, max_lag_days=10, as_of="2026-06-10")

    def test_backtest_snapshot_rejects_date_regression(self):
        current = snapshot("2026-06-05")
        previous = snapshot("2026-06-12")
        with self.assertRaisesRegex(RuntimeError, "regressed"):
            validate_snapshot(current, previous=previous, max_lag_days=10, as_of="2026-06-10")

    def test_atomic_writer_never_leaves_temporary_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "snapshot.json"
            write_json_atomic(path, {"ok": True})
            self.assertTrue(path.exists())
            self.assertFalse(path.with_suffix(".json.tmp").exists())

    def test_market_publish_requires_validated_references_and_monotonic_times(self):
        result = {"symbols": {"QQQ": {"validationStatus": "validated", "quoteTimestamp": "2026-06-10T00:00:00Z"}, "SPY": {"validationStatus": "validated", "quoteTimestamp": "2026-06-10T00:00:00Z"}}}
        self.assertTrue(is_publishable(result, {"symbols": {}})[0])
        result["symbols"]["SPY"]["validationStatus"] = "stale_fallback"
        self.assertFalse(is_publishable(result, {"symbols": {}})[0])

    def test_v2_adjusted_snapshot_requires_complete_positive_ohlc(self):
        row = {
            "date": "2026-06-10", "open": 100.0, "high": 102.0, "low": 99.0, "close": 101.0,
            "adjusted_open": 100.0, "adjusted_high": 102.0, "adjusted_low": 99.0, "adjusted_close": 101.0,
        }
        rows_by_symbol = {symbol: [{**row, "date": (date(2025, 1, 1) + timedelta(days=index)).isoformat()} for index in range(260)] for symbol in SYMBOLS}
        payload = {
            "version": "adjusted-daily-v2", "research_only": True,
            "symbols": rows_by_symbol,
            "metadata": {symbol: {"validationStatus": "validated"} for symbol in SYMBOLS},
        }
        validate_adjusted_snapshot(payload, previous={"symbols": {}}, max_lag_days=10, as_of=rows_by_symbol["QQQ"][-1]["date"])
        payload["symbols"]["QQQ"][-1]["adjusted_open"] = math.nan
        with self.assertRaisesRegex(RuntimeError, "invalid adjusted OHLC"):
            validate_adjusted_snapshot(payload, previous={"symbols": {}}, max_lag_days=10, as_of=rows_by_symbol["QQQ"][-1]["date"])
