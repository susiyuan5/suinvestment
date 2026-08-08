"""Independent-method arbitration and mandatory rejection gates."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from .contracts import empty_candidate
from .evidence import deduplicate_evidence
from .scoring import cap_method_contribution, weighted_score


def _score(payload: dict[str, Any], config: dict[str, Any]) -> tuple[float, list[str]]:
    dimensions = dict(payload.get("dimensions", {}))
    if payload.get("juglar", {}).get("not_applicable"):
        dimensions.pop("industry_cycle", None)
    score, positive = weighted_score(dimensions, config)
    for method, adjustment in payload.get("method_adjustments", {}).items():
        if method == "juglar":
            adjustment = max(-config["limits"]["juglar_max_points"], min(config["limits"]["juglar_max_points"], float(adjustment)))
        score += cap_method_contribution(float(adjustment), config)
    return round(max(0.0, min(100.0, score)), 6), positive


def arbitrate(payload: dict[str, Any], config: dict[str, Any], *, as_of: str) -> dict[str, Any]:
    ticker = str(payload.get("ticker", "UNKNOWN"))
    evidence = deduplicate_evidence(payload.get("evidence", []))
    candidate = empty_candidate(ticker, as_of, status="blocked")
    candidate.update({"method_versions": payload.get("method_versions", {}), "evidence": evidence, "family_scores": payload.get("family_scores", {}), "what_makes_investable": payload.get("what_makes_investable", []), "what_kills_thesis": payload.get("what_kills_thesis", []), "data_quality": payload.get("data_quality", {})})
    gates = list(payload.get("gates_failed", []))
    if payload.get("provider_failure"):
        gates.append("provider_failure_no_stale_score")
    score, positive = _score(payload, config)
    loo_scores = []
    for method in payload.get("methods", []):
        reduced = deepcopy(payload)
        reduced["method_adjustments"] = {key: value for key, value in payload.get("method_adjustments", {}).items() if key != method}
        reduced["dimensions"] = {key: value for key, value in payload.get("dimensions", {}).items() if key != method}
        loo_scores.append(_score(reduced, config)[0])
    floor = min(loo_scores) if loo_scores else score
    conflicts = list(payload.get("conflicts", []))
    if payload.get("method_scores"):
        values = [float(value) for value in payload["method_scores"].values()]
        if values and max(values) - min(values) > float(config["limits"]["conflict_threshold"]):
            conflicts.append("存在重大分歧")
    if not payload.get("dimensions") or len(payload.get("dimensions", {})) < len(config["dimensions"]):
        gates.append("missing_dimension")
    if len(evidence) < int(config["limits"]["a_min_evidence_chains"]):
        gates.append("insufficient_independent_evidence")
    if conflicts:
        candidate["conflicts"] = sorted(set(conflicts))
    status = "A" if score >= config["limits"]["a_min_score"] and floor >= config["limits"]["a_leave_one_out_floor"] and len(positive) >= config["limits"]["a_min_positive_dimensions"] and not gates and not conflicts else "B" if score >= 55 and not (set(gates) & {"future_data", "stale_core_data", "universe_gate", "provider_failure_no_stale_score"}) else "C"
    if gates:
        candidate["first_rejection"] = gates[0]
    candidate.update({"composite_score": score, "leave_one_out_floor": floor, "status": status, "data_quality": {**candidate["data_quality"], "gates_failed": sorted(set(gates)), "positive_dimensions": positive}})
    return candidate
