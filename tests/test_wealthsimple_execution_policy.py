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

    def test_closed_market_last_close_is_not_reported_as_expired(self):
        result = execute({"symbol": "SPY", "marketType": "listed", "price": 600, "suggestedAmount": 20, "tradingCurrency": "USD", "accountCurrency": "USD", "accountType": "NON_REGISTERED", "fractionalSupported": "unknown", "quoteTimestamp": "2026-09-11T20:00:00Z", "dataFreshness": "market_closed", "marketClosedLastClose": True}, now=datetime(2026, 9, 14, 13, tzinfo=timezone.utc))
        self.assertEqual("休市 · 最近收盘价", result["executionStatus"])
        self.assertEqual(["MARKET_CLOSED_LAST_CLOSE"], result["reasonCodes"])

if __name__ == "__main__": unittest.main()
