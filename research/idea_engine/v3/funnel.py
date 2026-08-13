"""Evidence-first research funnel classification."""

from __future__ import annotations

from typing import Any

from .contracts import STATUSES


def classify_candidate(scores: dict[str, Any], *, gates_failed: list[str], research_type: str, exposure_proof: list[str], valuation_verified: bool, config: dict[str, Any], rejection: bool = False) -> tuple[str, list[str], str]:
    failed = list(dict.fromkeys(gates_failed))
    passed = []
    if scores.get("evidence_coverage_score", 0) >= config["limits"]["a_min_evidence_coverage"]:
        passed.append("evidence_coverage")
    if scores.get("confidence_score", 0) >= config["limits"]["a_min_confidence"]:
        passed.append("confidence")
    if scores.get("evidence_independence_score", 0) >= config["limits"]["a_min_evidence_independence"]:
        passed.append("evidence_independence")
    if rejection:
        return "REJECTED", passed, "REJECT"
    if any(key in failed for key in ("invalid_security", "invalid_price", "stale_core_data", "missing_financial_data", "future_data", "provider_failure")):
        return "BLOCKED", passed, "REJECT"
    if research_type == "THEMATIC_BENEFICIARY" and not exposure_proof:
        failed.append("exposure_unproven")
        return "EXPOSURE_UNPROVEN", passed, "THESIS_TRACKER"
    if not valuation_verified:
        failed.append("valuation_unverified")
        return "VALUATION_GATED", passed, "VALUATION_REVIEW"
    robust = min(float(scores.get("leave_one_dimension_out_floor", 0)), float(scores.get("leave_one_source_out_floor", 0)))
    qualifies_a = (float(scores.get("composite_score", 0)) >= config["limits"]["a_min_score"] and robust >= config["limits"]["a_min_robust_score"] and float(scores.get("confidence_score", 0)) >= config["limits"]["a_min_confidence"] and float(scores.get("evidence_coverage_score", 0)) >= config["limits"]["a_min_evidence_coverage"] and float(scores.get("evidence_independence_score", 0)) >= config["limits"]["a_min_evidence_independence"] and scores.get("model_calibration_score") is not None and len(scores.get("positive_dimensions", [])) >= config["limits"]["a_min_positive_dimensions"] and not failed)
    if qualifies_a:
        return "A_RESEARCH", passed, "COMPANY_TEARSHEET"
    if float(scores.get("composite_score", 0)) >= 55 and float(scores.get("evidence_independence_score", 0)) >= float(config["limits"].get("a_min_evidence_independence", 0)):
        return "B_WATCH", passed, "EARNINGS_REVIEW"
    return "C_SCREEN", passed, "WATCHLIST_ONLY"


def funnel_summary(candidates: list[dict[str, Any]]) -> dict[str, int]:
    return {status: sum(1 for item in candidates if item.get("status") == status) for status in sorted(STATUSES)}
