"""Explainable v3 score with fixed weights and missing-data penalties."""

from __future__ import annotations

from statistics import median
from typing import Any

from .contracts import DIMENSIONS


def clamp(value: float) -> float:
    return max(0.0, min(100.0, float(value)))


def median_score(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return clamp(float(value))
    values = [clamp(float(item)) for item in value if isinstance(item, (int, float))]
    return median(values) if values else None


def sector_percentile(value: float | None, peer_values: list[float] | None) -> float | None:
    if value is None or not peer_values:
        return None
    peers = sorted(float(item) for item in peer_values if isinstance(item, (int, float)))
    if not peers:
        return None
    return round(100.0 * sum(peer <= float(value) for peer in peers) / len(peers), 4)


def _weighted(dimensions: dict[str, Any], weights: dict[str, float]) -> tuple[float, list[str], dict[str, float]]:
    total = 0.0
    positive = []
    contributions = {}
    for name in DIMENSIONS:
        value = median_score(dimensions.get(name))
        if value is None:
            continue
        contribution = min(float(weights.get(name, 0.0)) * value, 25.0)
        contributions[name] = round(contribution, 6)
        total += contribution
        if value >= 60:
            positive.append(name)
    return round(total, 6), positive, contributions


def score_candidate(dimensions: dict[str, Any], evidence: list[dict[str, Any]], config: dict[str, Any], *, gates_failed: list[str] | None = None, peer_values: list[float] | None = None) -> dict[str, Any]:
    weights = config["dimensions"]
    raw, positive, contributions = _weighted(dimensions, weights)
    missing = [name for name in DIMENSIONS if median_score(dimensions.get(name)) is None]
    families = {}
    total_confidence = 0.0
    for item in evidence:
        family = item["source_family"]
        families[family] = families.get(family, 0.0) + float(item.get("confidence", 0.0))
        total_confidence += float(item.get("confidence", 0.0))
    family_total = sum(families.values()) or 1.0
    source_penalty = sum(max(0.0, share / family_total - float(config["limits"]["source_family_max_weight"])) * 10 for share in families.values())
    stale_penalty = sum(1 for item in evidence if item.get("stale")) * float(config["limits"]["staleness_penalty"])
    contradiction_penalty = sum(1 for item in evidence if item.get("supports_or_contradicts", {}).get("contradicts")) * float(config["limits"]["contradiction_penalty"])
    missing_penalty = len(missing) * float(config["limits"]["missing_dimension_penalty"])
    data_penalty = float(config["limits"]["liquidity_data_penalty"]) if not evidence else 0.0
    penalties = {"missing": round(missing_penalty, 6), "contradiction": round(contradiction_penalty, 6), "staleness": round(stale_penalty, 6), "liquidity_data": round(data_penalty + source_penalty, 6)}
    composite = round(max(0.0, min(100.0, raw - sum(penalties.values()))), 6)
    coverage = round(100.0 * (len(DIMENSIONS) - len(missing)) / len(DIMENSIONS), 6)
    fresh_ratio = 1.0 if not evidence else sum(not item.get("stale", False) for item in evidence) / len(evidence)
    confidence = round(max(0.0, min(100.0, coverage * 0.55 + min(100.0, total_confidence / max(1, len(evidence)) * 100) * 0.30 + fresh_ratio * 15 - source_penalty)), 6)
    leave_dim = []
    for dimension in DIMENSIONS:
        reduced = dict(dimensions)
        reduced.pop(dimension, None)
        reduced_score, _, _ = _weighted(reduced, weights)
        leave_dim.append(max(0.0, min(100.0, reduced_score - sum(penalties.values()))))
    leave_source = []
    for family in families:
        reduced_evidence = [item for item in evidence if item["source_family"] != family]
        family_penalty = 0.0 if reduced_evidence else float(config["limits"]["liquidity_data_penalty"])
        leave_source.append(max(0.0, min(100.0, raw - sum(penalties.values()) - family_penalty)))
    return {"raw_score": round(raw, 6), "composite_score": composite, "positive_dimensions": positive, "score_contributions": contributions, "penalties": penalties, "missing_dimensions": missing, "leave_one_dimension_out_floor": round(min(leave_dim) if leave_dim else composite, 6), "leave_one_source_out_floor": round(min(leave_source) if leave_source else composite, 6), "evidence_coverage_score": coverage, "confidence_score": confidence, "sector_percentile": sector_percentile(composite, peer_values)}
