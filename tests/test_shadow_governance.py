import unittest

from research.analyze_shadow_observation_history import candidate_status


class ShadowGovernanceTests(unittest.TestCase):
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
