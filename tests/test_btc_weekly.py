import unittest
from datetime import date, datetime, timedelta, timezone

from scripts import update_btc_weekly as btc


def daily(start: date, days: int, base: float = 100.0):
    return [(start + timedelta(days=i), base + i) for i in range(days)]


class BtcWeeklyTests(unittest.TestCase):
    def test_parse_yahoo_chart_skips_null_and_bad_closes(self):
        stamps = [int(datetime(2026, 10, d, tzinfo=timezone.utc).timestamp()) for d in (12, 13, 14, 15)]
        payload = {"chart": {"result": [{"timestamp": stamps, "indicators": {"quote": [{"close": [1.0, None, -5, 3.5]}]}}]}}
        self.assertEqual(btc.parse_yahoo_chart(payload), [(date(2026, 10, 12), 1.0), (date(2026, 10, 15), 3.5)])

    def test_parse_yahoo_chart_rejects_missing_result(self):
        with self.assertRaises(ValueError):
            btc.parse_yahoo_chart({"chart": {"result": None}})

    def test_weekly_closes_use_sunday_close_and_hold_back_current_week(self):
        rows = daily(date(2026, 10, 5), 16)  # Mon 10-05 .. Tue 10-20
        weeks, partial = btc.weekly_closes(rows, today=date(2026, 10, 20))
        self.assertEqual(weeks, [{"week_end": "2026-10-11", "close": 106.0}, {"week_end": "2026-10-18", "close": 113.0}])
        self.assertEqual(partial, {"week_end": "2026-10-25", "date": "2026-10-20", "close": 115.0})

    def test_sunday_bar_is_not_complete_on_the_same_utc_day(self):
        weeks, partial = btc.weekly_closes(daily(date(2026, 10, 12), 7), today=date(2026, 10, 18))
        self.assertEqual(weeks, [])
        self.assertEqual(partial["week_end"], "2026-10-18")

    def test_week_missing_sunday_bar_is_dropped(self):
        rows = [r for r in daily(date(2026, 10, 5), 14) if r[0] != date(2026, 10, 11)]
        weeks, _ = btc.weekly_closes(rows, today=date(2026, 10, 20))
        self.assertEqual([w["week_end"] for w in weeks], ["2026-10-18"])

    def _weeks(self, count, end=date(2026, 10, 18)):
        return [{"week_end": (end - timedelta(weeks=count - 1 - i)).isoformat(), "close": 100.0 + i} for i in range(count)]

    def test_validate_accepts_contiguous_recent_weeks(self):
        btc.validate(self._weeks(70), today=date(2026, 10, 20))

    def test_validate_rejects_short_gapped_stale_or_implausible_series(self):
        with self.assertRaisesRegex(ValueError, "complete weeks"):
            btc.validate(self._weeks(10), today=date(2026, 10, 20))
        gapped = self._weeks(70)
        del gapped[30]
        with self.assertRaisesRegex(ValueError, "gap"):
            btc.validate(gapped, today=date(2026, 10, 20))
        with self.assertRaisesRegex(ValueError, "days old"):
            btc.validate(self._weeks(70), today=date(2026, 11, 20))
        jump = self._weeks(70)
        jump[40]["close"] = 1000.0
        with self.assertRaisesRegex(ValueError, "implausible"):
            btc.validate(jump, today=date(2026, 10, 20))

    def test_build_marks_snapshot_research_only(self):
        rows = daily(date(2025, 6, 2), 505)
        payload = btc.build(rows, datetime(2026, 10, 20, 12, tzinfo=timezone.utc))
        self.assertEqual(payload["schema"], "btc-weekly-v1")
        self.assertTrue(payload["researchOnly"])
        self.assertEqual(payload["lastCompleteWeek"], "2026-10-18")
        self.assertEqual(payload["generatedAt"], "2026-10-20T12:00:00Z")


if __name__ == "__main__":
    unittest.main()
