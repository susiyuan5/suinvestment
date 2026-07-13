import unittest

from research.analyze_shadow_observation_history import candidate_status
from research.update_shadow_outcomes import horizon_outcome, ranking_turnover


class ShadowGovernanceTests(unittest.TestCase):
    def test_relative_outcome_false_positive_and_adverse_excursion(self):
        rows = [
            {"date": "2026-01-02", "close": 100},
            {"date": "2026-01-09", "close": 90},
            {"date": "2026-01-16", "close": 105},
        ]
        benchmark = [
            {"date": "2026-01-02", "close": 100},
            {"date": "2026-01-09", "close": 102},
            {"date": "2026-01-16", "close": 110},
        ]
        outcome = horizon_outcome(rows, benchmark, "2026-01-02T00:00:00Z", 2)
        self.assertEqual(outcome["status"], "matured")
        self.assertTrue(outcome["false_positive"])
        self.assertEqual(outcome["maximum_adverse_excursion"], -0.1)

    def test_missing_benchmark_keeps_outcome_pending(self):
        rows = [{"date": "2026-01-02", "close": 100}, {"date": "2026-01-09", "close": 101}]
        self.assertEqual(horizon_outcome(rows, [], "2026-01-02T00:00:00Z", 1)["status"], "pending")

    def test_ranking_turnover_uses_frozen_top_quartile(self):
        payloads = [
            {"generatedAt": "1", "observations": [{"symbol": symbol, "as_of_rank": index} for index, symbol in enumerate("ABCDEFGH", 1)]},
            {"generatedAt": "2", "observations": [{"symbol": symbol, "as_of_rank": index} for index, symbol in enumerate("CDEFGHAB", 1)]},
        ]
        self.assertEqual(ranking_turnover(payloads)[0]["membership_turnover"], 1.0)

    def test_pending_outcomes_block_human_review_even_when_other_gates_pass(self):
        governance = {
            "minimum_observation_runs_before_review": 8,
            "minimum_calendar_weeks_before_review": 8,
            "minimum_mature_outcomes_before_review": 4,
            "maximum_allowed_risk_warning_count": 0,
            "maximum_allowed_candidate_degraded_count": 0,
            "maximum_allowed_missing_data_count": 0,
        }
        self.assertEqual(
            candidate_status(8, 8, 0, 0, 0, 3, governance),
            "not_enough_mature_outcomes",
        )
        self.assertEqual(
            candidate_status(8, 8, 0, 0, 0, 4, governance),
            "eligible_for_human_review_only",
        )
