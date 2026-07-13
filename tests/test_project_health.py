import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from scripts.build_project_health import build_health, generate


NOW = datetime(2026, 7, 13, tzinfo=timezone.utc)
SUCCESS = {name: {"status": "completed", "conclusion": "success"} for name in ("market_update", "historical_update", "quality_checks")}


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
