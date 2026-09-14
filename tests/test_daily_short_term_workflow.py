import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class DailyShortTermWorkflowTests(unittest.TestCase):
    def test_daily_workflow_refreshes_signals_without_freezing_shadow(self):
        workflow = (ROOT / ".github/workflows/update-short-term-signals.yml").read_text(encoding="utf-8")
        self.assertIn('20 23 * * 1-5', workflow)
        self.assertIn('--task update-short-term-signals', workflow)
        task = json.loads((ROOT / 'scripts/live-data-tasks.json').read_text(encoding='utf-8'))['update-short-term-signals']
        commands = json.dumps(task)
        self.assertIn('refresh_short_term_daily_bars', commands)
        self.assertIn('short-term-trade-plans-v1_3', commands)
        self.assertNotIn('gh pr merge', workflow)
        self.assertNotIn('run_idea_engine_v3', commands)
        self.assertNotIn('shadow/observations', commands)

    def test_published_v13_has_exactly_three_non_executable_strategies_per_candidate(self):
        payload = json.loads((ROOT / "research/results/v3_1/short-term-trade-plans-v1_3/latest.json").read_text(encoding="utf-8"))
        self.assertEqual(payload["schema_version"], "short-term-trade-plan-v1.3")
        self.assertEqual(payload["summary"]["strategy_count"], payload["summary"]["candidate_count"] * 3)
        for plan in payload["plans"]:
            self.assertEqual(len(plan["strategies"]), 3)
            self.assertTrue(all(row["prediction_calibrated"] is False for row in plan["strategies"]))
            self.assertTrue(all(row["execution_ready"] is False for row in plan["strategies"]))


if __name__ == "__main__":
    unittest.main()
