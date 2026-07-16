from __future__ import annotations

import json
import unittest
from pathlib import Path

from dca_l2_policy import SAFE_CONFIG, evaluate_dca_l2_policy, load_config, normalize_dca_l2_ledger, dca_l2_ledger_used


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

    def test_defensive_recovery_requires_two_distinct_fresh_plan_weeks(self):
        config = load_config()
        first = evaluate_dca_l2_policy({"baseAmount": 100, "price": 90, "dataStatus": "fresh", "marketRegime": "Bear", "date": "2026-07-06"}, {}, config)
        state = {"defensiveLatched": True, "recoveryConfirmations": first.recovery_confirmations, "lastRecoveryWeek": ""}
        one = evaluate_dca_l2_policy({"baseAmount": 100, "price": 100, "dataStatus": "fresh", "marketRegime": "Bull", "date": "2026-07-07"}, state, config)
        self.assertEqual("panic_bear_extreme_volatility", one.state)
        self.assertFalse(one.defensive_now)
        duplicate = evaluate_dca_l2_policy({"baseAmount": 100, "price": 100, "dataStatus": "fresh", "marketRegime": "Bull", "date": "2026-07-07"}, {"defensiveLatched": True, "recoveryConfirmations": one.recovery_confirmations, "lastRecoveryWeek": "2026-W28"}, config)
        self.assertEqual(1, duplicate.recovery_confirmations)
        two = evaluate_dca_l2_policy({"baseAmount": 100, "price": 100, "dataStatus": "fresh", "marketRegime": "Bull", "date": "2026-07-14"}, {"defensiveLatched": True, "recoveryConfirmations": one.recovery_confirmations, "lastRecoveryWeek": "2026-W28"}, config)
        self.assertEqual("normal", two.state)

    def test_weight_zero_is_not_defaulted_and_missing_weight_is_one(self):
        base = {"baseAmount": 100, "price": 75, "dataStatus": "fresh", "marketRegime": "Bull", "drawdownPct": 30, "trendStatus": "above_sma", "volatilityPct": 2, "monthlyBudget": 400, "crashFundInitial": 100, "crashFundBalance": 100, "date": "2026-07-06"}
        self.assertEqual(25, evaluate_dca_l2_policy(base, {}, load_config()).crash_fund_amount)
        zero = evaluate_dca_l2_policy({**base, "crashFundWeight": 0}, {}, load_config())
        self.assertEqual(0, zero.crash_fund_amount)
        self.assertEqual(0, evaluate_dca_l2_policy({**base, "baseAmount": 0, "crashFundWeight": 0}, {}, load_config()).final_amount)

    def test_invalid_weight_is_safe_zero_and_manual_review(self):
        base = {"baseAmount": 100, "price": 75, "dataStatus": "fresh", "marketRegime": "Bull", "drawdownPct": 30, "trendStatus": "above_sma", "volatilityPct": 2, "crashFundInitial": 100, "crashFundBalance": 100, "date": "2026-07-06"}
        result = evaluate_dca_l2_policy({**base, "crashFundWeight": -1}, {}, load_config())
        self.assertEqual(0, result.crash_fund_amount)
        self.assertTrue(result.manual_review)

    def test_recovery_config_override_three(self):
        config = load_config()
        config["recovery"]["requiredDistinctPlanWeeks"] = 3
        state = {"defensiveLatched": True}
        dates = ["2026-07-07", "2026-07-14", "2026-07-21"]
        results = []
        for value in dates:
            result = evaluate_dca_l2_policy({"baseAmount": 100, "price": 100, "dataStatus": "fresh", "marketRegime": "Bull", "date": value}, state, config)
            results.append(result)
            state = {"defensiveLatched": True, "recoveryConfirmations": result.recovery_confirmations, "lastRecoveryWeek": f"2026-W{28 + len(results) - 1:02d}"}
        self.assertEqual("panic_bear_extreme_volatility", results[1].state)
        self.assertEqual("normal", results[2].state)

    def test_portfolio_budget_and_cash_caps(self):
        items = [{"decision": {"base_amount": 100, "extra_amount": 50, "crash_fund_amount": 25}, "currentAllocationPct": 10}, {"decision": {"base_amount": 100, "extra_amount": 50, "crash_fund_amount": 25}, "currentAllocationPct": 10}]
        result = __import__("dca_l2_policy").plan_portfolio_dca_l2(items, normal_pool=150, crash_fund=25, portfolio_cash_cap=100)
        self.assertLessEqual(result["planned_normal"], 150)
        self.assertLessEqual(result["planned_crash"], 25)
        self.assertLessEqual(result["total_planned"], 100)

    def test_shared_portfolio_fixtures(self):
        fixtures = json.loads((Path(__file__).parent / "fixtures" / "dca_l2_portfolio_cases.json").read_text(encoding="utf-8"))
        from dca_l2_policy import plan_portfolio_dca_l2
        for fixture in fixtures:
            options = {"normal_pool": fixture["options"]["normalPool"], "crash_fund": fixture["options"]["crashFund"]}
            result = plan_portfolio_dca_l2(fixture["items"], **options)
            for key, expected in fixture["expected"].items():
                self.assertEqual(expected, result[{"plannedNormal": "planned_normal", "plannedCrash": "planned_crash", "totalPlanned": "total_planned", "unallocatedCash": "unallocated_cash"}[key]], fixture["name"])

    def test_v1_ledger_migrates_to_typed_reversible_crash_record(self):
        ledger = normalize_dca_l2_ledger({"month": "2026-07", "initial": 100, "entries": [{"id": "legacy", "date": "2026-07-07", "amount": 12.5, "note": "legacy use"}]}, "2026-07")
        self.assertEqual("dca-l2-v2", ledger["version"])
        self.assertEqual("crash", ledger["entries"][0]["type"])
        self.assertTrue(ledger["entries"][0]["reversible"])
        self.assertEqual(12.5, dca_l2_ledger_used(ledger, "crash"))

    def test_invalid_config_fails_safe_to_base_only_manual_review(self):
        result = evaluate_dca_l2_policy({"baseAmount": 100, "price": 75, "dataStatus": "fresh", "marketRegime": "Bull", "drawdownPct": 30, "trendStatus": "above_sma", "volatilityPct": 2, "date": "2026-07-06"}, {}, SAFE_CONFIG)
        self.assertEqual(100, result.base_amount)
        self.assertEqual(0, result.extra_amount)
        self.assertEqual(0, result.crash_fund_amount)
        self.assertTrue(result.manual_review)

    def test_cash_cap_reduces_crash_then_extra_then_base(self):
        result = evaluate_dca_l2_policy({"baseAmount": 100, "price": 75, "dataStatus": "fresh", "marketRegime": "Bull", "drawdownPct": 30, "trendStatus": "above_sma", "volatilityPct": 2, "monthlyBudget": 400, "crashFundBalance": 100, "availableCashProvided": True, "availableCash": 400, "date": "2026-07-06"}, {}, load_config())
        self.assertEqual(120, result.cash_cap_amount)
        self.assertEqual(0, result.crash_fund_amount)
        self.assertLessEqual(result.final_amount, 120)
