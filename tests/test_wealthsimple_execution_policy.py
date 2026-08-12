import json
import unittest
from datetime import datetime, timezone
from pathlib import Path
from wealthsimple_execution_policy import execute

class WealthsimpleExecutionPolicyTests(unittest.TestCase):
    def test_shared_golden_fixtures(self):
        fixtures = json.loads((Path(__file__).parent / "fixtures" / "execution_policy_cases.json").read_text(encoding="utf-8"))
        now = datetime(2026, 8, 12, 12, tzinfo=timezone.utc)
        for fixture in fixtures:
            with self.subTest(fixture=fixture["name"]):
                result = execute(fixture["input"], now=now)
                for key, value in fixture["expected"].items(): self.assertEqual(value, result[key])

if __name__ == "__main__": unittest.main()
