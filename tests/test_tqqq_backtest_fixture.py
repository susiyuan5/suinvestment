import json
import unittest
from datetime import date, datetime, timezone
from pathlib import Path

from scripts import build_tqqq_backtest_fixture as builder

ROOT = Path(__file__).resolve().parents[1]


def payload(rows):
    stamps = [int(datetime(2026, 11, d, 14, 30, tzinfo=timezone.utc).timestamp()) for d, _, _ in rows]
    return {"chart": {"result": [{"timestamp": stamps, "indicators": {
        "quote": [{"close": [c for _, c, _ in rows]}], "adjclose": [{"adjclose": [a for _, _, a in rows]}]}}]}}


class TqqqBacktestFixtureTests(unittest.TestCase):
    def test_parse_keeps_close_and_adjusted_close_and_skips_bad_bars(self):
        parsed = builder.parse(payload([(5, 100.0, 90.0), (6, None, 91.0), (9, 102.0, -1.0), (10, 103.0, 93.0)]))
        self.assertEqual(parsed, {date(2026, 11, 5): (100.0, 90.0), date(2026, 11, 10): (103.0, 93.0)})
        with self.assertRaises(ValueError):
            builder.parse({"chart": {"result": None}})

    def test_build_uses_common_sessions_and_leaves_tqqq_empty_before_listing(self):
        spy = {date(2026, 11, 5): (1.0, 0.9), date(2026, 11, 6): (2.0, 1.9), date(2026, 11, 9): (3.0, 2.9)}
        qqq = {date(2026, 11, 6): (4.0, 3.9), date(2026, 11, 9): (5.0, 4.9), date(2026, 11, 10): (6.0, 5.9)}
        tqqq = {date(2026, 11, 9): (7.0, 6.9)}
        built = builder.build({"SPY": spy, "QQQ": qqq, "TQQQ": tqqq}, date(2026, 11, 9))
        self.assertEqual(built["rows"], [["2026-11-06", 2.0, 4.0, 1.9, 3.9, None], ["2026-11-09", 3.0, 5.0, 2.9, 4.9, 6.9]])
        self.assertIs(built["researchOnly"], True)

    def test_frozen_fixture_is_ordered_and_complete(self):
        data = json.loads((ROOT / "tests/fixtures/tqqq-backtest-daily-research-v1.json").read_text(encoding="utf-8"))
        rows = data["rows"]
        self.assertEqual(data["schema"], builder.SCHEMA)
        self.assertEqual(data["last"], "2026-11-09")
        self.assertGreater(len(rows), 6500)
        self.assertEqual([r[0] for r in rows], sorted({r[0] for r in rows}))
        self.assertTrue(all(all(v > 0 for v in r[1:5]) for r in rows))
        first_real = next(r[0] for r in rows if r[5] is not None)
        self.assertEqual(first_real, "2010-02-11")
        self.assertTrue(all(r[5] is not None and r[5] > 0 for r in rows if r[0] >= first_real))


if __name__ == "__main__":
    unittest.main()
