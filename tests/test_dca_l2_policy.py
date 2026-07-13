from __future__ import annotations

import json
import unittest
from pathlib import Path

from dca_l2_policy import evaluate_dca_l2_policy, load_config


class DcaL2PolicyTests(unittest.TestCase):
    def test_shared_fixtures(self):
        fixtures = json.loads((Path(__file__).parent / "fixtures" / "dca_l2_policy_cases.json").read_text(encoding="utf-8"))
        config = load_config()
        for fixture in fixtures:
            with self.subTest(fixture=fixture["name"]):
                result = evaluate_dca_l2_policy(fixture["input"], {}, config).to_dict()
                for key, expected in fixture["expected"].items():
                    actual = result[{"baseAmount": "base_amount", "extraAmount": "extra_amount", "crashFundAmount": "crash_fund_amount", "crashFundWeeklyLimit": "crash_fund_weekly_limit", "finalAmount": "final_amount", "reasonCodes": "reason_codes"}.get(key, key)]
                    self.assertEqual(expected, actual)

    def test_defensive_recovery_requires_two_distinct_fresh_dates(self):
        config = load_config()
        first = evaluate_dca_l2_policy({"baseAmount": 100, "price": 90, "dataStatus": "fresh", "marketRegime": "Bear", "date": "2026-07-06"}, {}, config)
        state = {"defensiveLatched": True, "recoveryConfirmations": first.recovery_confirmations, "lastRecoveryTradingDate": ""}
        one = evaluate_dca_l2_policy({"baseAmount": 100, "price": 100, "dataStatus": "fresh", "marketRegime": "Bull", "date": "2026-07-07"}, state, config)
        self.assertEqual("panic_bear_extreme_volatility", one.state)
        self.assertFalse(one.defensive_now)
        duplicate = evaluate_dca_l2_policy({"baseAmount": 100, "price": 100, "dataStatus": "fresh", "marketRegime": "Bull", "date": "2026-07-07"}, {"defensiveLatched": True, "recoveryConfirmations": one.recovery_confirmations, "lastRecoveryTradingDate": "2026-07-07"}, config)
        self.assertEqual(1, duplicate.recovery_confirmations)
        two = evaluate_dca_l2_policy({"baseAmount": 100, "price": 100, "dataStatus": "fresh", "marketRegime": "Bull", "date": "2026-07-08"}, {"defensiveLatched": True, "recoveryConfirmations": one.recovery_confirmations, "lastRecoveryTradingDate": "2026-07-07"}, config)
        self.assertEqual("normal", two.state)

    def test_cash_cap_reduces_crash_then_extra_then_base(self):
        result = evaluate_dca_l2_policy({"baseAmount": 100, "price": 75, "dataStatus": "fresh", "marketRegime": "Bull", "drawdownPct": 30, "trendStatus": "above_sma", "volatilityPct": 2, "monthlyBudget": 400, "crashFundBalance": 100, "availableCashProvided": True, "availableCash": 400, "date": "2026-07-06"}, {}, load_config())
        self.assertEqual(120, result.cash_cap_amount)
        self.assertEqual(0, result.crash_fund_amount)
        self.assertLessEqual(result.final_amount, 120)
