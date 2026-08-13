import json
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from research.idea_engine.evidence import make_evidence
from research.idea_engine.v3.run_idea_engine_v3 import research_symbols, run


AS_OF = "2026-08-01T12:00:00+00:00"


def old_evidence(source, url, lineage, supports):
    return make_evidence(
        source=source,
        url=url,
        published_at=AS_OF,
        retrieved_at=AS_OF,
        as_of=AS_OF,
        content=lineage,
        lineage_id=lineage,
        freshness="fresh",
        first_party=source.startswith("SEC"),
        supports=supports,
        confidence=0.9,
        missing_fields=[],
    )


def provider(symbols, *, as_of):
    assert as_of == AS_OF
    universe_rows = []
    candidates = []
    for index, ticker in enumerate(symbols):
        universe_rows.append({
            "ticker": ticker,
            "company_name": f"{ticker} Company",
            "exchange": "NASDAQ",
            "asset_type": "stock",
            "is_us_listed": True,
            "market_cap_usd": 10_000_000_000,
            "average_dollar_volume_20d_usd": 100_000_000,
        })
        base = 80 - index / 10
        candidates.append({
            "ticker": ticker,
            "dimensions": {
                "financial_quality": base,
                "valuation": base,
                "demand_catalyst": base,
                "expectations_confirmation": base,
                "industry_cycle": base,
                "risk_liquidity_health": base,
            },
            "evidence": [
                old_evidence("SEC filing", "https://www.sec.gov/a", f"sec-{ticker}", ["financial_quality", "valuation", "demand_catalyst", "industry_cycle"]),
                old_evidence("SEC companyfacts", "https://data.sec.gov/a", f"facts-{ticker}", ["financial_quality", "valuation"]),
                old_evidence("Yahoo price", "https://query1.finance.yahoo.com/a", f"price-{ticker}", ["expectations_confirmation", "risk_liquidity_health"]),
            ],
            "gates_failed": ["free_source_scope_limited", "no_consensus_estimates"],
            "data_quality": {"missing_fields": ["analyst_consensus"]},
            "what_makes_investable": ["公开财务质量与相对价格同步改善"],
            "what_kills_thesis": ["财务趋势反转"],
            "method_versions": {"free": "test"},
        })
    return {"research_only": True, "provider": "free_public_data", "universe_rows": universe_rows, "candidates": candidates, "failures": []}


class IdeaEngineV31RunnerTests(unittest.TestCase):
    def test_full_sector_balanced_universe_is_the_provider_input(self):
        self.assertEqual(len(research_symbols()), 80)

    def test_runner_is_independent_of_v2_and_freezes_v31_outputs(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            result = run(Path(temp_dir), AS_OF, provider_fetcher=provider)
            self.assertEqual(result["schema_version"], "idea-engine-v3.1")
            self.assertEqual(result["screened_universe_count"], 80)
            self.assertEqual(result["eligible_universe_count"], 80)
            self.assertEqual(result["scored_candidate_count"], 80)
            self.assertEqual(result["source_manifest"]["input"], "direct_free_public_data")
            self.assertEqual(result["research_horizon"]["primary_horizon_weeks"], 4)
            self.assertEqual(result["research_horizon"]["decay_monitor_weeks"], 12)
            self.assertRegex(result["source_manifest"]["input_snapshot"], r"^input-snapshots/2026-08-01-[a-f0-9]{12}\.json$")
            self.assertNotIn("v2", json.dumps(result))
            self.assertEqual(len(result["candidates"]), 10)
            top = result["candidates"][0]
            self.assertEqual(top["evidence_independence_score"], 66.666667)
            self.assertIsNone(top["model_calibration_score"])
            self.assertIn("model_not_calibrated", top["gates_failed"])
            governance = json.loads((Path(temp_dir) / "shadow" / "governance-report.json").read_text(encoding="utf-8"))
            self.assertFalse(governance["manual_review_eligible"])
            self.assertFalse(governance["reliability_claim_eligible"])
            self.assertEqual(governance["primary_horizons_weeks"], [1, 4])
            self.assertTrue((Path(temp_dir) / result["source_manifest"]["input_snapshot"]).exists())

    def test_retry_at_same_as_of_does_not_duplicate_or_rewrite_shadow_observation(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir)
            first = run(output, AS_OF, provider_fetcher=provider)
            frozen = json.loads((output / "shadow" / "observations.json").read_text(encoding="utf-8"))["observations"][0]

            def changed_provider(symbols, *, as_of):
                self.assertEqual(as_of, "2026-08-01T18:30:00+00:00")
                payload = provider(symbols, as_of=AS_OF)
                payload["candidates"][0]["dimensions"]["expectations_confirmation"] = 1
                return payload

            second = run(output, "2026-08-01T18:30:00+00:00", provider_fetcher=changed_provider)
            observations = json.loads((output / "shadow" / "observations.json").read_text(encoding="utf-8"))["observations"]
            self.assertNotEqual(first["input_hash"], second["input_hash"])
            self.assertEqual(len(observations), 1)
            self.assertEqual(observations[0]["input_hash"], frozen["input_hash"])


if __name__ == "__main__":
    unittest.main()
