"""Frozen Shadow observations and model-level degradation checks."""

from __future__ import annotations

from datetime import date
from math import sqrt
from statistics import mean
from typing import Any


def relative_return(stock_return: float, benchmark_return: float) -> float:
    return round(float(stock_return) - float(benchmark_return), 10)


def max_adverse_move(values: list[float]) -> float | None:
    if not values:
        return None
    peak = values[0]
    worst = 0.0
    for value in values:
        peak = max(peak, value)
        worst = min(worst, value - peak)
    return round(worst, 10)


def max_favorable_move(values: list[float]) -> float | None:
    if not values:
        return None
    low = values[0]
    best = 0.0
    for value in values:
        low = min(low, value)
        best = max(best, value - low)
    return round(best, 10)


def _weeks(observations: list[dict[str, Any]]) -> set[tuple[int, int]]:
    output = set()
    for item in observations:
        try:
            iso = date.fromisoformat(str(item.get("as_of", ""))[:10]).isocalendar()
            output.add((iso.year, iso.week))
        except ValueError:
            pass
    return output


def maturity(observations: list[dict], outcomes: list[dict], *, min_observations: int = 8, min_calendar_weeks: int = 8, min_complete: int = 4, degraded: bool = False) -> dict[str, Any]:
    complete = sum(all(row.get("horizons", {}).get(str(week), {}).get("status") == "matured" for week in (1, 4, 12)) for row in outcomes)
    eligible = len(observations) >= min_observations and len(_weeks(observations)) >= min_calendar_weeks and complete >= min_complete and not degraded
    return {"status": "DEGRADED" if degraded else "mature" if eligible else "not_mature", "observation_count": len(observations), "calendar_week_count": len(_weeks(observations)), "complete_count": complete, "manual_review_eligible": eligible, "live_promotion_eligible": False, "reason": "模型退化，暂停人工复核" if degraded else "Shadow 已成熟，仅可人工复核" if eligible else "样本尚未满足人工复核门槛"}


def spearman(values_a: list[float], values_b: list[float]) -> float | None:
    if len(values_a) != len(values_b) or len(values_a) < 2:
        return None
    def ranks(values: list[float]) -> list[float]:
        ordered = sorted((value, index) for index, value in enumerate(values))
        result = [0.0] * len(values)
        for rank, (_, index) in enumerate(ordered, start=1):
            result[index] = rank
        return result
    left, right = ranks(values_a), ranks(values_b)
    left_mean, right_mean = mean(left), mean(right)
    numerator = sum((a - left_mean) * (b - right_mean) for a, b in zip(left, right))
    denominator = sqrt(sum((a - left_mean) ** 2 for a in left) * sum((b - right_mean) ** 2 for b in right))
    return round(numerator / denominator, 8) if denominator else 0.0


def model_statistics(outcomes: list[dict[str, Any]], config: dict[str, Any]) -> dict[str, Any]:
    matured = [item for item in outcomes if all(item.get("horizons", {}).get(str(h), {}).get("status") == "matured" for h in (1, 4, 12))]
    scores = [float(item.get("score", 0)) for item in matured]
    returns = [float(item.get("horizons", {}).get("12", {}).get("absolute_return", 0)) for item in matured]
    false_positive_rate = sum(value <= 0 for value in returns) / len(returns) if returns else None
    correlation = spearman(scores, returns) if returns else None
    degraded_reasons = []
    if false_positive_rate is not None and false_positive_rate > config["limits"]["a_max_false_positive_rate"]:
        degraded_reasons.append("A 级误报率超过阈值")
    if correlation is not None and correlation < 0:
        degraded_reasons.append("分数与未来收益方向相反")
    return {"matured_count": len(matured), "false_positive_rate": false_positive_rate, "score_return_spearman": correlation, "degraded": bool(degraded_reasons), "degraded_reasons": degraded_reasons}
