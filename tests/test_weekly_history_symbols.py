import json
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from scripts import update_backtest_prices as ubp


def weekly(count, latest="2026-10-23", close=100.0):
    end = date.fromisoformat(latest)
    return [{"date": (end - timedelta(weeks=count - 1 - i)).isoformat(), "close": close + i} for i in range(count)]


class ExtraSymbolsConfigTests(unittest.TestCase):
    def write(self, payload):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / "symbols.json"
        path.write_text(json.dumps(payload), encoding="utf-8")
        return path

    def test_repository_config_is_valid_and_excludes_core(self):
        extras = ubp.load_extra_symbols(Path("data/weekly-history-symbols.json"))
        self.assertTrue(extras)
        self.assertFalse(set(extras) & set(ubp.SYMBOLS))

    def test_dedupes_and_drops_core_symbols(self):
        path = self.write({"symbols": ["WMT", "SPY", "WMT", "BRK.B"]})
        self.assertEqual(ubp.load_extra_symbols(path), ("WMT", "BRK.B"))

    def test_rejects_unsafe_or_malformed_config(self):
        for payload in ({"symbols": ["../x"]}, {"symbols": ["wmt"]}, {"symbols": "WMT"}, ["WMT"],
                        {"symbols": [f"S{i}" for i in range(ubp.MAX_EXTRA_SYMBOLS + 1)]}):
            with self.assertRaises(ValueError):
                ubp.load_extra_symbols(self.write(payload))

    def test_missing_file_means_no_extras(self):
        self.assertEqual(ubp.load_extra_symbols(Path("does-not-exist.json")), ())


class AddExtraSymbolsTests(unittest.TestCase):
    def run_add(self, fetch, previous=None, extras=("WMT",)):
        result = {"symbols": {}, "metadata": {}, "errors": {}}
        ubp.add_extra_symbols(result, previous or {"symbols": {}}, extras, "2021-06-01", "2026-10-28", 10, fetch=fetch)
        return result

    def test_short_but_sufficient_history_is_validated(self):
        result = self.run_add(lambda *a, **k: weekly(22))
        self.assertEqual(len(result["symbols"]["WMT"]), 22)
        self.assertEqual(result["metadata"]["WMT"]["validationStatus"], "validated")

    def test_too_short_history_is_skipped_without_raising(self):
        result = self.run_add(lambda *a, **k: weekly(10))
        self.assertNotIn("WMT", result["symbols"])
        self.assertIn("WMT", result["errors"])

    def test_fetch_failure_keeps_previous_valid_rows(self):
        def boom(*a, **k):
            raise RuntimeError("network down")
        previous = {"symbols": {"WMT": weekly(30, latest="2026-10-02")}}
        result = self.run_add(boom, previous)
        self.assertEqual(result["metadata"]["WMT"]["validationStatus"], "stale_fallback")
        self.assertEqual(result["symbols"]["WMT"][-1]["date"], "2026-10-02")

    def test_regression_or_stale_refresh_falls_back(self):
        previous = {"symbols": {"WMT": weekly(30, latest="2026-10-23")}}
        result = self.run_add(lambda *a, **k: weekly(30, latest="2026-10-09"), previous)
        self.assertEqual(result["metadata"]["WMT"]["validationStatus"], "stale_fallback")
        self.assertIn("regressed", result["errors"]["WMT"])

    def test_invalid_close_is_rejected(self):
        rows = weekly(25)
        rows[5]["close"] = 0
        result = self.run_add(lambda *a, **k: rows)
        self.assertNotIn("WMT", result["symbols"])

    def test_one_failure_does_not_affect_other_extras(self):
        def fetch(symbol, *a, **k):
            if symbol == "BAD":
                raise RuntimeError("delisted")
            return weekly(25)
        result = self.run_add(fetch, extras=("BAD", "PEP"))
        self.assertIn("PEP", result["symbols"])
        self.assertNotIn("BAD", result["symbols"])


if __name__ == "__main__":
    unittest.main()
