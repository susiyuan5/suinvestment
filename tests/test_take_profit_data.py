import copy
from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts.build_take_profit_data import (
    BuildBlocked, build_snapshot, checked_child, latest_completed_session, latest_session,
    normalized_rows, public_symbols, publish_snapshot,
)
from scripts.market_calendar import session_close


def rows(count=20, end="2026-10-02"):
    day = date.fromisoformat(end)
    days = []
    while len(days) < count:
        if session_close(day) is not None:
            days.append(day.isoformat())
        day -= timedelta(days=1)
    return [{"date": text, "open": 100.123456789, "high": 102.0, "low": 99.0,
             "close": 101.0, "adjusted": 100.5, "volume": 1000.0} for text in reversed(days)]


def payload(count=20, end="2026-10-02"):
    return {"schema_version": "short-term-daily-bars-v1", "research_only": True,
            "source": "test daily adapter", "currency": "USD", "frequency": "1d", "as_of": end,
            "adjustment": "split_and_dividend_adjusted",
            "symbols": {"AAPL": rows(count, end), "SPY": rows(count, end)}}


class TakeProfitBrowserDataTests(unittest.TestCase):
    def setUp(self):
        actual = latest_completed_session
        self.frozen_session = patch("scripts.build_take_profit_data.latest_completed_session",
                                    side_effect=lambda now=None: actual(now or datetime(2026, 10, 4, 15, tzinfo=timezone.utc)))
        self.frozen_session.start()
        self.addCleanup(self.frozen_session.stop)

    def test_normalizes_adjusted_close_and_compact_lazy_files(self):
        source = payload()
        index, bars, coverage = build_snapshot(source, symbols=["SPY", "AAPL"])
        self.assertEqual(index["schema_version"], "take-profit-browser-index-v1")
        self.assertEqual(index["symbols"]["AAPL"]["rows"], 20)
        self.assertEqual(index["symbols"]["AAPL"]["path"], "data/take-profit-v1/symbols/AAPL.json")
        self.assertNotIn("rows", index)
        self.assertEqual(bars["AAPL"]["rows"][0]["adjusted_close"], 100.5)
        self.assertEqual(bars["AAPL"]["rows"][0]["open"], 100.12345679)
        self.assertNotIn("adjusted", bars["AAPL"]["rows"][0])
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "data"
            output = root / "take-profit-v1"
            publish_snapshot(output, index, bars, coverage, allowed_root=root)
            raw = (output / "symbols" / "AAPL.json").read_text()
            self.assertNotIn("\n ", raw)
            self.assertEqual(json.loads(raw), bars["AAPL"])
            self.assertEqual(json.loads((output / "index.json").read_text()), index)

    def test_download_schema_and_retained_row_limit(self):
        source = payload(count=180)
        source["schema_version"] = "take-profit-research-daily-prices-v1"
        source["adjustment"] = "raw_ohlc_plus_yahoo_adjusted_close"
        source["requested_end"] = source.pop("as_of")
        for series in source["symbols"].values():
            for row in series:
                row["adjusted_close"] = row.pop("adjusted")
        index, bars, _ = build_snapshot(source, symbols=["AAPL", "SPY"], keep_rows=60)
        self.assertEqual(index["minimum_rows"], 60)
        self.assertEqual(bars["AAPL"]["rows"][0]["date"], source["symbols"]["AAPL"][-60]["date"])

    def test_public_universe_excludes_otc_and_requires_all_symbols(self):
        allowed = public_symbols()
        self.assertEqual(len(allowed), 82)
        self.assertTrue({"SPY", "QQQ", "DIA", "IWM"} <= set(allowed))
        self.assertFalse({"BYDDY", "TCEHY"} & set(allowed))
        with self.assertRaises(BuildBlocked) as caught:
            build_snapshot(payload())
        self.assertIn("DIA", caught.exception.coverage["failures"])
        source = payload()
        source["symbols"]["BYDDY"] = rows()
        source["symbols"]["UNKNOWN"] = rows()
        index, _, coverage = build_snapshot(source, symbols=["AAPL", "SPY"])
        self.assertEqual(set(index["symbols"]), {"AAPL", "SPY"})
        self.assertEqual(coverage["excluded_symbols"], ["BYDDY", "UNKNOWN"])

    def test_missing_ohlc_nan_and_duplicate_dates_block_publication(self):
        for kind in ("missing", "nan", "duplicate", "invalid_high", "future"):
            source = payload()
            if kind == "missing":
                source["symbols"]["AAPL"][0].pop("open")
            elif kind == "nan":
                source["symbols"]["AAPL"][0]["adjusted"] = float("nan")
            elif kind == "duplicate":
                source["symbols"]["AAPL"][1]["date"] = source["symbols"]["AAPL"][0]["date"]
            elif kind == "invalid_high":
                source["symbols"]["AAPL"][0]["high"] = 99.0
            else:
                source["symbols"]["AAPL"][-1]["date"] = "2026-10-05"
            with self.subTest(kind=kind), self.assertRaises(BuildBlocked) as caught:
                build_snapshot(source, symbols=["AAPL", "SPY"])
            self.assertIn("AAPL", caught.exception.coverage["failures"])
            self.assertFalse(caught.exception.coverage["published"])

    def test_lagging_symbol_and_trading_date_gap_are_explicit(self):
        for missing_last in (True, False):
            source = payload()
            source["symbols"]["AAPL"].pop(-1 if missing_last else 5)
            with self.subTest(missing_last=missing_last), self.assertRaises(BuildBlocked) as caught:
                build_snapshot(source, symbols=["AAPL", "SPY"])
            reason = caught.exception.coverage["failures"]["AAPL"]
            self.assertIn("expected session" if missing_last else "benchmark trading dates", reason)

    def test_common_missing_session_cannot_hide_behind_benchmark(self):
        source = payload()
        for series in source["symbols"].values():
            series.pop(5)
        with self.assertRaises(BuildBlocked) as caught:
            build_snapshot(source, symbols=["AAPL", "SPY"])
        self.assertEqual(set(caught.exception.coverage["failures"]), {"AAPL", "SPY"})
        self.assertIn("pinned calendar sessions", caught.exception.coverage["failures"]["SPY"])

    def test_calendar_handles_weekends_and_independence_day_observation(self):
        self.assertEqual(latest_session("2026-10-04"), "2026-10-02")
        self.assertEqual(latest_session("2026-07-04"), "2026-07-02")
        with self.assertRaises(ValueError):
            latest_session("2029-01-01")
        source = payload(end="2026-07-02")
        source["as_of"] = "2026-07-04"
        index, _, _ = build_snapshot(source, symbols=["AAPL", "SPY"], as_of="2026-07-04")
        self.assertEqual(index["as_of"], "2026-07-02")

    def test_current_session_must_complete_and_source_utc_cutoff_is_not_price_date(self):
        before_close = datetime(2026, 10, 2, 19, 59, tzinfo=timezone.utc)
        self.assertEqual(latest_completed_session(before_close), "2026-10-01")
        after_close = datetime(2026, 10, 2, 20, 1, tzinfo=timezone.utc)
        self.assertEqual(latest_completed_session(after_close), "2026-10-02")
        source = payload()
        source["as_of"] = "2026-10-03"
        index, _, _ = build_snapshot(source, symbols=["AAPL", "SPY"], now=after_close)
        self.assertEqual(index["as_of"], "2026-10-02")
        self.assertEqual(index["source_as_of"], "2026-10-03")
        with self.assertRaises(BuildBlocked):
            build_snapshot(source, symbols=["AAPL", "SPY"], now=before_close)
        with self.assertRaises(ValueError):
            build_snapshot(source, symbols=["AAPL", "SPY"], now=before_close, as_of="2026-10-02")

    def test_stale_source_blocks_unless_historical_cutoff_is_explicit(self):
        source = payload(end="2026-07-02")
        with self.assertRaises(BuildBlocked):
            build_snapshot(source, symbols=["AAPL", "SPY"])
        index, _, _ = build_snapshot(source, symbols=["AAPL", "SPY"], as_of="2026-07-02")
        self.assertEqual(index["as_of"], "2026-07-02")

    def test_unknown_offline_source_requires_explicit_cutoff(self):
        source = payload()
        source.pop("schema_version")
        source.pop("source")
        with self.assertRaises(ValueError):
            build_snapshot(source, symbols=["AAPL", "SPY"])
        index, _, _ = build_snapshot(source, symbols=["AAPL", "SPY"], as_of="2026-10-02")
        self.assertIn("unverified source", index["source"])

    def test_missing_currency_or_adjustment_cannot_claim_validated_source(self):
        for field in ("currency", "adjustment", "frequency", "source"):
            source = payload()
            source.pop(field)
            with self.subTest(field=field), self.assertRaises(ValueError):
                build_snapshot(source, symbols=["AAPL", "SPY"])

    def test_publication_replaces_directory_and_rolls_back_failed_swap(self):
        index, bars, coverage = build_snapshot(payload(), symbols=["AAPL", "SPY"])
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "data"
            output = root / "take-profit-v1"
            publish_snapshot(output, index, bars, coverage, allowed_root=root)
            original = (output / "index.json").read_bytes()
            real_replace = __import__("os").replace
            calls = 0

            def fail_second_replace(source, target):
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise OSError("simulated publication failure")
                return real_replace(source, target)

            with patch("scripts.build_take_profit_data.os.replace", side_effect=fail_second_replace):
                with self.assertRaises(OSError):
                    publish_snapshot(output, index, bars, coverage, allowed_root=root)
            self.assertEqual((output / "index.json").read_bytes(), original)
            self.assertEqual(list(root.iterdir()), [output])
            publish_snapshot(output, index, bars, coverage, allowed_root=root)
            self.assertEqual(list(root.iterdir()), [output])

    def test_unsafe_output_and_invalid_coverage_preserve_existing_data(self):
        index, bars, coverage = build_snapshot(payload(), symbols=["AAPL", "SPY"])
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "data"
            output = root / "take-profit-v1"
            publish_snapshot(output, index, bars, coverage, allowed_root=root)
            with self.assertRaises(ValueError):
                checked_child(root.parent / "outside", root)
            with self.assertRaises(ValueError):
                checked_child(root, root)
            invalid = copy.deepcopy(coverage)
            invalid["published"] = False
            with self.assertRaises(ValueError):
                publish_snapshot(output, index, bars, invalid, allowed_root=root)
            self.assertTrue((output / "index.json").exists())


if __name__ == "__main__":
    unittest.main()
