import unittest

from research.idea_engine.arbitration import arbitrate


CONFIG = {"dimensions": {"financial_quality": .25, "valuation": .2, "demand_catalyst": .2, "expectations_confirmation": .15, "industry_cycle": .1, "risk_liquidity_health": .1}, "limits": {"method_max_points": 25, "juglar_max_points": 10, "conflict_threshold": 30, "a_min_score": 70, "a_leave_one_out_floor": 65, "a_min_positive_dimensions": 3, "a_min_evidence_chains": 2}}


class IdeaEngineArbitrationTests(unittest.TestCase):
    def test_juglar_adjustment_is_limited(self):
        payload = {"ticker": "AAA", "dimensions": {key: 80 for key in CONFIG["dimensions"]}, "method_adjustments": {"juglar": 99}, "evidence": [], "gates_failed": ["insufficient_independent_evidence"]}
        row = arbitrate(payload, CONFIG, as_of="2026-08-08T00:00:00+00:00")
        self.assertLessEqual(row["composite_score"], 100)

    def test_conflict_prevents_a(self):
        payload = {"ticker": "AAA", "dimensions": {key: 90 for key in CONFIG["dimensions"]}, "method_scores": {"serenity": 90, "juglar": 20}, "evidence": [], "gates_failed": []}
        row = arbitrate(payload, CONFIG, as_of="2026-08-08T00:00:00+00:00")
        self.assertNotEqual(row["status"], "A")
        self.assertIn("存在重大分歧", row["conflicts"])


if __name__ == "__main__":
    unittest.main()
