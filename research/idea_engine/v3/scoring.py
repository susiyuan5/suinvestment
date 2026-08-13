"""Explainable v3.1 scoring with evidence-lineage ablation and reliability labels."""

from __future__ import annotations

from statistics import median
from typing import Any

from .contracts import DIMENSIONS


def clamp(value: float) -> float:
    return max(0.0, min(100.0, float(value)))


def median_score(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return clamp(float(value))
    values = [clamp(float(item)) for item in value if isinstance(item, (int, float)) and not isinstance(item, bool)]
    return median(values) if values else None


def sector_percentile(value: float | None, peer_values: list[float] | None) -> float | None:
    if value is None or not peer_values:
        return None
    peers = sorted(float(item) for item in peer_values if isinstance(item, (int, float)) and not isinstance(item, bool))
    if not peers:
        return None
    return round(100.0 * sum(peer <= float(value) for peer in peers) / len(peers), 4)


def _weighted(dimensions: dict[str, Any], weights: dict[str, float]) -> tuple[float, list[str], dict[str, float]]:
    total, positive, contributions = 0.0, [], {}
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


def _supported_dimensions(evidence: list[dict[str, Any]]) -> set[str]:
    supported: set[str] = set()
    for item in evidence:
        supported.update(
            name for name in item.get("supports_or_contradicts", {}).get("supports", [])
            if name in DIMENSIONS
        )
    return supported


def _lineage_groups(evidence: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for item in evidence:
        lineage = str(item.get("lineage_group") or item.get("source_family") or "UNKNOWN")
        groups.setdefault(lineage, []).append(item)
    return groups


def _score_once(dimensions: dict[str, Any], evidence: list[dict[str, Any]], config: dict[str, Any]) -> dict[str, Any]:
    weights = config["dimensions"]
    raw, positive, contributions = _weighted(dimensions, weights)
    missing = [name for name in DIMENSIONS if median_score(dimensions.get(name)) is None]
    groups = _lineage_groups(evidence)
    group_confidence = {
        group: max(float(item.get("confidence", 0.0)) for item in rows)
        for group, rows in groups.items()
    }
    total_confidence = sum(group_confidence.values())
    group_total = total_confidence or 1.0
    source_penalty = sum(
        max(0.0, share / group_total - float(config["limits"]["source_family_max_weight"])) * 10
        for share in group_confidence.values()
    )
    stale_penalty = len({str(item.get("lineage_group") or item.get("source_family")) for item in evidence if item.get("stale")}) * float(config["limits"]["staleness_penalty"])
    contradiction_penalty = len({str(item.get("lineage_group") or item.get("source_family")) for item in evidence if item.get("supports_or_contradicts", {}).get("contradicts")}) * float(config["limits"]["contradiction_penalty"])
    missing_penalty = len(missing) * float(config["limits"]["missing_dimension_penalty"])
    evidence_penalty = float(config["limits"]["liquidity_data_penalty"]) if not evidence else 0.0
    penalties = {
        "missing": round(missing_penalty, 6),
        "contradiction": round(contradiction_penalty, 6),
        "staleness": round(stale_penalty, 6),
        "liquidity_data": round(evidence_penalty + source_penalty, 6),
    }
    composite = round(clamp(raw - sum(penalties.values())), 6)
    coverage = round(100.0 * (len(DIMENSIONS) - len(missing)) / len(DIMENSIONS), 6)
    fresh_groups = sum(any(not item.get("stale", False) for item in rows) for rows in groups.values())
    fresh_ratio = fresh_groups / len(groups) if groups else 0.0
    evidence_independence = round(min(100.0, len(groups) / 3 * 100.0), 6)
    mean_confidence = total_confidence / len(groups) if groups else 0.0
    data_confidence = round(clamp(coverage * 0.50 + mean_confidence * 100 * 0.20 + fresh_ratio * 15 + evidence_independence * 0.15 - source_penalty), 6)
    return {
        "raw_score": raw,
        "composite_score": composite,
        "positive_dimensions": positive,
        "score_contributions": contributions,
        "penalties": penalties,
        "missing_dimensions": missing,
        "evidence_coverage_score": coverage,
        "evidence_independence_score": evidence_independence,
        "confidence_score": data_confidence,
        "independent_lineage_count": len(groups),
        "independent_lineages": sorted(groups),
    }


def score_candidate(
    dimensions: dict[str, Any],
    evidence: list[dict[str, Any]],
    config: dict[str, Any],
    *,
    gates_failed: list[str] | None = None,
    peer_values: list[float] | None = None,
    model_calibration_score: float | None = None,
) -> dict[str, Any]:
    del gates_failed
    base = _score_once(dimensions, evidence, config)

    dimension_scores = []
    for dimension in DIMENSIONS:
        reduced = dict(dimensions)
        reduced.pop(dimension, None)
        dimension_scores.append(_score_once(reduced, evidence, config)["composite_score"])

    source_scores = []
    for lineage in base["independent_lineages"]:
        reduced_evidence = [item for item in evidence if str(item.get("lineage_group") or item.get("source_family") or "UNKNOWN") != lineage]
        supported = _supported_dimensions(reduced_evidence)
        reduced_dimensions = {name: value for name, value in dimensions.items() if name in supported}
        source_scores.append(_score_once(reduced_dimensions, reduced_evidence, config)["composite_score"])

    base.update({
        "leave_one_dimension_out_floor": round(min(dimension_scores) if dimension_scores else base["composite_score"], 6),
        "leave_one_source_out_floor": round(min(source_scores) if source_scores else 0.0, 6),
        "model_calibration_score": round(clamp(model_calibration_score), 6) if model_calibration_score is not None else None,
        "sector_percentile": sector_percentile(base["composite_score"], peer_values),
    })
    return base
