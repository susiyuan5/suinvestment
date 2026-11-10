import json
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from scripts import update_tqqq_ma as tqqq

ROOT = Path(__file__).resolve().parents[1]


def sessions(count: int, end: date = date(2026, 11, 9), base: float = 100.0):
    out, day = [], end
    while len(out) < count:
        if day.weekday() < 5:
            out.append(day)
        day -= timedelta(days=1)
    return [(d, base + i * 0.1) for i, d in enumerate(reversed(out))]


class TqqqMaTests(unittest.TestCase):
    def test_todays_bar_counts_only_after_the_close_has_settled(self):
        during = datetime(2026, 11, 10, 19, 0, tzinfo=timezone.utc)  # 14:00 New York
        after = datetime(2026, 11, 10, 21, 30, tzinfo=timezone.utc)  # 16:30 New York
        self.assertEqual(tqqq.last_complete_session(during), date(2026, 11, 9))
        self.assertEqual(tqqq.last_complete_session(after), date(2026, 11, 10))
        summer = datetime(2026, 7, 10, 20, 30, tzinfo=timezone.utc)  # 16:30 New York (EDT)
        self.assertEqual(tqqq.last_complete_session(summer), date(2026, 7, 10))

    def test_merge_keeps_common_completed_sessions_only(self):
        spy = sessions(5, end=date(2026, 11, 10))
        qqq = [row for row in sessions(5, end=date(2026, 11, 10)) if row[0] != date(2026, 11, 6)]
        during = datetime(2026, 11, 10, 19, 0, tzinfo=timezone.utc)
        days = tqqq.merge_days({"SPY": spy, "QQQ": qqq}, during)
        self.assertEqual([d["date"] for d in days], ["2026-11-04", "2026-11-05", "2026-11-09"])
        after = datetime(2026, 11, 10, 21, 30, tzinfo=timezone.utc)
        self.assertEqual(tqqq.merge_days({"SPY": spy, "QQQ": qqq}, after)[-1]["date"], "2026-11-10")

    def _days(self, count=500, end=date(2026, 11, 9)):
        rows = sessions(count, end)
        return [{"date": d.isoformat(), "spy": c, "qqq": c * 0.9} for d, c in rows]

    def test_validate_accepts_recent_ordered_sessions(self):
        tqqq.validate(self._days(), datetime(2026, 11, 10, 12, tzinfo=timezone.utc))

    def test_validate_rejects_short_gapped_stale_or_implausible_series(self):
        now = datetime(2026, 11, 10, 12, tzinfo=timezone.utc)
        with self.assertRaisesRegex(ValueError, "complete sessions"):
            tqqq.validate(self._days(100), now)
        gapped = self._days()
        del gapped[200:212]
        with self.assertRaisesRegex(ValueError, "gap"):
            tqqq.validate(gapped, now)
        with self.assertRaisesRegex(ValueError, "days old"):
            tqqq.validate(self._days(), datetime(2026, 11, 25, 12, tzinfo=timezone.utc))
        jump = self._days()
        jump[300]["qqq"] *= 2
        with self.assertRaisesRegex(ValueError, "implausible"):
            tqqq.validate(jump, now)
        bad = self._days()
        bad[10]["spy"] = 0
        with self.assertRaisesRegex(ValueError, "invalid spy"):
            tqqq.validate(bad, now)
        weekend = self._days()
        weekend[-1]["date"] = "2026-11-08"
        with self.assertRaisesRegex(ValueError, "weekday"):
            tqqq.validate(weekend, now)

    def test_build_marks_snapshot_research_only(self):
        rows = sessions(500)
        payload = tqqq.build({"SPY": rows, "QQQ": rows}, datetime(2026, 11, 10, 12, tzinfo=timezone.utc))
        self.assertEqual(payload["schema"], "tqqq-ma-daily-v1")
        self.assertEqual(payload["asof"], "2026-11-09")
        self.assertIs(payload["researchOnly"], True)
        self.assertEqual(len(payload["days"]), 500)

    def test_fetch_falls_back_to_second_host_and_reports_all_failures(self):
        calls = []

        class Response:
            def __init__(self, body):
                self.body = body

            def read(self):
                return self.body

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        stamp = int(datetime(2026, 11, 9, 14, 30, tzinfo=timezone.utc).timestamp())
        body = json.dumps({"chart": {"result": [{"timestamp": [stamp], "indicators": {"quote": [{"close": [752.69]}]}}]}}).encode()

        def opener(request, timeout):
            calls.append(request.full_url)
            if "query1" in request.full_url:
                raise OSError("blocked")
            return Response(body)

        now = datetime(2026, 11, 10, 12, tzinfo=timezone.utc)
        self.assertEqual(tqqq.fetch_yahoo_daily("SPY", now, opener), [(date(2026, 11, 9), 752.69)])
        self.assertEqual(len(calls), 2)
        self.assertIn("interval=1d", calls[0])

        def failing(request, timeout):
            raise OSError("down")

        with self.assertRaisesRegex(RuntimeError, "SPY daily fetch failed"):
            tqqq.fetch_yahoo_daily("SPY", now, failing)

    def test_frozen_fixture_passes_validation_and_task_is_registered(self):
        fixture = json.loads((ROOT / "tests/fixtures/tqqq-ma-daily-v1.json").read_text(encoding="utf-8"))
        tqqq.validate(fixture["days"], datetime(2026, 11, 10, 12, 47, tzinfo=timezone.utc))
        task = json.loads((ROOT / "scripts/live-data-tasks.json").read_text(encoding="utf-8"))["update-tqqq-ma"]
        self.assertEqual(task["outputs"], ["data/tqqq-ma-daily-v1.json"])
        self.assertIn("data/tqqq-ma-daily-v1.json", (ROOT / "live-data.js").read_text(encoding="utf-8"))
        workflow = (ROOT / ".github/workflows/update-tqqq-ma.yml").read_text(encoding="utf-8")
        self.assertIn("python scripts/live_data.py --task update-tqqq-ma", workflow)


if __name__ == "__main__":
    unittest.main()
