"""Score conversion without weight reallocation or method domination."""

from __future__ import annotations

from statistics import median
from typing import Any


def percentile(value: float, values: list[float]) -> float:
    ordered = sorted(values)
    if len(ordered) <= 1:
        return 50.0
    rank = sum(item <= value for item in ordered) - 1
    return 100.0 * rank / (len(ordered) - 1)


def family_score(values: list[float] | float | None, *, missing: bool = False) -> float | None:
    if missing or values is None:
        return None
    if isinstance(values, (int, float)):
        return float(values)
    return float(median([float(value) for value in values])) if values else None


def weighted_score(dimensions: dict[str, float | None], config: dict[str, Any]) -> tuple[float, list[str]]:
    total = 0.0
    positive = []
    for name, weight in config["dimensions"].items():
        value = dimensions.get(name)
        if value is None:
            continue
        score = max(0.0, min(100.0, float(value)))
        total += score * float(weight)
        if score >= 60:
            positive.append(name)
    return round(total, 6), positive


def cap_method_contribution(points: float, config: dict[str, Any]) -> float:
    return max(-float(config["limits"]["method_max_points"]), min(float(config["limits"]["method_max_points"]), float(points)))
