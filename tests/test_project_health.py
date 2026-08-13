import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from scripts.build_project_health import build_health, build_history, generate


NOW = datetime(2026, 7, 13, tzinfo=timezone.utc)
SUCCESS = {name: {"status": "completed", "conclusion": "success"} for name in ("market_update", "historical_update", "quality_checks", "pages_smoke", "shadow_update", "idea_engine_update")}


def write_json(root: Path, relative: str, payload: dict):
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def fixture_root(root: Path, market_date="2026-07-13", historical_date="2026-07-10"):
    write_json(root, "data/market-data.json", {"generatedAt": market_date, "summary": {"freshSymbols": 8, "staleSymbols": 0}})
    rows = [{"date": f"2025-01-{(index % 28) + 1:02d}", "close": 100 + index} for index in range(49)] + [{"date": historical_date, "close": 150}]
    write_json(root, "data/backtest-prices.json", {"generatedAt": historical_date, "symbols": {symbol: rows for symbol in ("QQQ", "SPY", "AAPL", "MSFT", "NVDA")}})


class ProjectHealthTests(unittest.TestCase):
    def test_healthy_operational_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture_root(root)
            payload = build_health(root, now=NOW, workflows=SUCCESS)
            self.assertEqual(payload["status"], "healthy")
            self.assertFalse(payload["shadow"]["live_promotion_eligible"])
            self.assertEqual(payload["watchlist"]["status"], "ready")
            self.assertIn("operational_metrics", payload)
            self.assertIsNone(payload["operational_metrics"]["page_js_error_count"])

    def test_stale_snapshot_blocks_health(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture_root(root, market_date="2026-06-01")
            self.assertEqual(build_health(root, now=NOW, workflows=SUCCESS)["status"], "blocked")

    def test_failed_workflow_warns(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture_root(root)
            workflows = dict(SUCCESS)
            workflows["quality_checks"] = {"status": "completed", "conclusion": "failure"}
            payload = build_health(root, now=NOW, workflows=workflows)
            self.assertEqual(payload["status"], "warning")
            self.assertGreater(payload["operational_metrics"]["workflow_failure_rate"], 0)

    def test_failed_pages_smoke_degrades_watchlist_probe(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture_root(root)
            workflows = dict(SUCCESS)
            workflows["pages_smoke"] = {"status": "completed", "conclusion": "failure"}
            payload = build_health(root, now=NOW, workflows=workflows)
            self.assertEqual(payload["status"], "warning")
            self.assertEqual(payload["watchlist"]["status"], "degraded")
            self.assertEqual(payload["watchlist"]["synthetic_probe_status"], "degraded")

    def test_pending_data_pr_is_visible(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture_root(root)
            pending = {"historical_prices": {"number": 6, "url": "https://example.test/6"}}
            payload = build_health(root, now=NOW, workflows=SUCCESS, pending_updates=pending)
            self.assertEqual(payload["status"], "warning")
            self.assertIn("pending_historical_prices_pr", payload["issues"])

    def test_invalid_v2_research_pipeline_warns_without_live_promotion(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture_root(root)
            write_json(root, "results/dca_l2/v2/summary.json", {"research_only": True, "validity": {"valid": False}})
            payload = build_health(root, now=NOW, workflows=SUCCESS)
            self.assertEqual(payload["status"], "warning")
            self.assertFalse(payload["research_pipeline"]["dca_l2_v2_valid"])
            self.assertFalse(payload["shadow"]["live_promotion_eligible"])

    def test_generation_failure_preserves_last_valid_report(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "missing"
            output = Path(directory) / "output"
            output.mkdir()
            report = output / "project-health.json"
            report.write_text("last-valid", encoding="utf-8")
            with self.assertRaises(ValueError):
                generate(root, output, now=NOW, workflows=SUCCESS)
            self.assertEqual(report.read_text(encoding="utf-8"), "last-valid")

    def test_health_prefers_v31_short_term_research_results(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture_root(root)
            write_json(root, "research/results/v3_1/idea-engine/latest-candidates.json", {
                "schema_version": "idea-engine-v3.1", "research_only": True,
                "methodology_version": "idea-engine-v3.1.0", "generated_at": NOW.isoformat(),
                "research_horizon": {"primary_horizon_weeks": 4}, "candidates": [],
            })
            write_json(root, "research/results/v3_1/idea-engine/provider-status.json", {"status": "ready", "active_provider": "free_public_data"})
            write_json(root, "research/results/v3_1/idea-engine/shadow/governance-report.json", {"manual_review_eligible": False, "status": "not_mature"})
            payload = build_health(root, now=NOW, workflows=SUCCESS)
            self.assertEqual(payload["idea_engine"]["schema_version"], "idea-engine-v3.1")
            self.assertEqual(payload["idea_engine"]["result_source"], "v3.1-short-term")
            self.assertEqual(payload["idea_engine"]["primary_horizon_weeks"], 4)

    def test_health_history_is_retained_for_the_last_90_days(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture_root(root)
            output = root / "results" / "health"
            payload = build_health(root, now=NOW, workflows=SUCCESS)
            history = build_history(output / "project-health-history.json", payload, now=NOW)
            self.assertEqual(history["retention_days"], 90)
            self.assertEqual(len(history["entries"]), 1)
            self.assertIn("workflow_failure_rate", history["entries"][0])
