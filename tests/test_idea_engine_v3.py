import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from research.idea_engine.v3.contracts import validate_https, validate_payload
from research.idea_engine.v3.evidence import deduplicate_evidence, make_evidence
from research.idea_engine.v3.funnel import classify_candidate
from research.idea_engine.v3.scoring import score_candidate
from research.idea_engine.v3.shadow import maturity, model_statistics


CONFIG = json.loads((Path(__file__).parents[1] / "research/idea_engine/v3/config.v3.json").read_text(encoding="utf-8"))
AS_OF = "2026-08-08T00:00:00+00:00"


def evidence(family="SEC", content="same", stale=False, contradicts=None):
    host = {"SEC": "https://www.sec.gov/a", "PUBLIC_PRICE": "https://query1.finance.yahoo.com/a", "COMPANY_IR": "https://investor.example.com/a"}[family]
    return make_evidence(evidence_id=family + content, source_name=family, url=host, document_type="filing", published_at=AS_OF, accessed_at=AS_OF, as_of=AS_OF, claim="claim", confidence=.9, content=content, stale=stale, source_family=family, supports_or_contradicts={"supports": ["financial_quality"], "contradicts": contradicts or []})


class IdeaEngineV3Tests(unittest.TestCase):
    def test_https_and_duplicate_content_are_enforced(self):
        with self.assertRaises(ValueError):
            validate_https("http://example.com")
        rows = [evidence(content="same"), evidence(family="COMPANY_IR", content="same"), evidence(content="better")]
        self.assertEqual(len(deduplicate_evidence(rows)), 2)

    def test_scoring_penalties_and_leave_one_out(self):
        dimensions = {"financial_quality": 90, "valuation": None, "demand_catalyst": 80, "expectations_confirmation": 70, "industry_cycle": 60, "risk_liquidity_health": 70}
        result = score_candidate(dimensions, [evidence(), evidence(family="PUBLIC_PRICE", content="price")], CONFIG)
        self.assertIn("missing", result["penalties"])
        self.assertLess(result["composite_score"], result["raw_score"])
        self.assertLessEqual(max(result["score_contributions"].values()), 25)
        self.assertIn("leave_one_source_out_floor", result)

    def test_missing_valuation_cannot_enter_a(self):
        scores = {"composite_score": 90, "leave_one_dimension_out_floor": 80, "leave_one_source_out_floor": 80, "confidence_score": 90, "evidence_coverage_score": 100, "positive_dimensions": ["financial_quality", "valuation", "demand_catalyst"]}
        status, _, workflow = classify_candidate(scores, gates_failed=[], research_type="QUALITY_COMPOUNDER", exposure_proof=["订单"], valuation_verified=False, config=CONFIG)
        self.assertEqual(status, "VALUATION_GATED")
        self.assertEqual(workflow, "VALUATION_REVIEW")

    def test_theme_without_exposure_is_not_a(self):
        scores = {"composite_score": 90, "leave_one_dimension_out_floor": 80, "leave_one_source_out_floor": 80, "confidence_score": 90, "evidence_coverage_score": 100, "positive_dimensions": ["financial_quality", "valuation", "demand_catalyst"]}
        status, _, _ = classify_candidate(scores, gates_failed=[], research_type="THEMATIC_BENEFICIARY", exposure_proof=[], valuation_verified=True, config=CONFIG)
        self.assertEqual(status, "EXPOSURE_UNPROVEN")

    def test_shadow_maturity_and_degradation(self):
        observations = [{"as_of": (datetime(2026, 6, 1) + timedelta(days=7 * index)).date().isoformat()} for index in range(8)]
        outcomes = [{"horizons": {str(h): {"status": "matured"} for h in (1, 4, 12)}} for _ in range(4)]
        result = maturity(observations, outcomes)
        self.assertEqual(result["status"], "mature")
        self.assertFalse(maturity(observations, outcomes, degraded=True)["manual_review_eligible"])
        self.assertIn("degraded", model_statistics([], CONFIG))

    def test_v3_payload_requires_research_only(self):
        with self.assertRaises(ValueError):
            validate_payload({"schema_version": "idea-engine-v3", "research_only": False})


if __name__ == "__main__":
    unittest.main()
