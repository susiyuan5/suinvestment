import json
from datetime import datetime
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch
from scripts import market_calendar as calendar, price_sources

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = json.loads((ROOT / "tests/fixtures/market-sessions.json").read_text())


class CalendarTests(unittest.TestCase):
    def test_shared_cases_and_generator_status(self):
        for f in FIXTURES:
            with self.subTest(f["name"]):
                now = datetime.fromisoformat(f["now"].replace("Z", "+00:00"))
                actual = calendar.assess(f["quote"], now)
                for key, value in f["expected"].items():
                    self.assertEqual(actual[key], value, key)
                self.assertEqual(price_sources.validate_snapshot(f["quote"], now=now)["validationStatus"], f["status"])

    def test_python_and_browser_are_identical(self):
        code = "const c=require('./market-calendar');const f=require('./tests/fixtures/market-sessions.json');console.log(JSON.stringify(f.map(x=>c.assess(x.quote,Date.parse(x.now)))));"
        actual = json.loads(subprocess.check_output(["node", "-e", code], cwd=ROOT))
        expected = [calendar.assess(f["quote"], datetime.fromisoformat(f["now"].replace("Z", "+00:00"))) for f in FIXTURES]
        self.assertEqual(actual, expected)

    def test_missing_calendar_and_closed_metadata_do_not_bypass_checks(self):
        f = FIXTURES[0]
        now = datetime.fromisoformat(f["now"].replace("Z", "+00:00"))
        self.assertFalse(calendar.assess(f["quote"], now, calendar=None)["eligible"])
        quote = dict(f["quote"], quoteTimestamp="2026-09-10T20:00:00Z", marketState="CLOSED")
        self.assertEqual(price_sources.validate_snapshot(quote, now=now)["validationStatus"], "stale")

    def test_unfinished_bar_keeps_observed_timestamp(self):
        now = datetime.fromisoformat("2026-09-14T15:00:00+00:00")
        observed = datetime.fromisoformat("2026-09-14T13:30:00+00:00")
        with patch.object(price_sources, "utc_now", return_value=now):
            self.assertEqual(price_sources.latest_close_timestamp(now.date(), bar_timestamp=observed), observed)
