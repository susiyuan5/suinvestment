"""Leakage-aware, versioned factor validation for the v2 research baseline."""

from __future__ import annotations

import argparse
import csv
import json
import math
import random
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean
from typing import Iterable

from research.phase6_expansion_utils import FACTORS, HORIZONS, build_factor_records, load_universe_pair


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "research" / "results" / "v2" / "validation"
BLOCK_WEEKS = 12
BOOTSTRAP_RESAMPLES = 2_000
RANDOM_SEED = 42
ONE_WAY_COST_RATE = 0.0015


def rank(values: list[float]) -> list[float]:
    order = sorted(range(len(values)), key=values.__getitem__)
    output = [0.0] * len(values)
    index = 0
    while index < len(order):
        end = index + 1
        while end < len(order) and values[order[end]] == values[order[index]]:
            end += 1
        average_rank = (index + end - 1) / 2
        for position in order[index:end]:
            output[position] = average_rank
        index = end
    return output


def pearson(left: list[float], right: list[float]) -> float | None:
    if len(left) != len(right) or len(left) < 3:
        return None
    left_mean, right_mean = mean(left), mean(right)
    numerator = sum((a - left_mean) * (b - right_mean) for a, b in zip(left, right))
    left_scale = math.sqrt(sum((value - left_mean) ** 2 for value in left))
    right_scale = math.sqrt(sum((value - right_mean) ** 2 for value in right))
    if left_scale == 0 or right_scale == 0:
        return None
    return numerator / (left_scale * right_scale)


def spearman(left: list[float], right: list[float]) -> float | None:
    return pearson(rank(left), rank(right))


def category_neutral_spearman(rows: list[dict], factor: str, target: str) -> float | None:
    clean = [row for row in rows if is_number(row.get(factor)) and is_number(row.get(target)) and row.get("category")]
    if len(clean) < 6 or len({row["category"] for row in clean}) < 2:
        return None
    factor_ranks = rank([float(row[factor]) for row in clean])
    target_ranks = rank([float(row[target]) for row in clean])
    category_positions: dict[str, list[int]] = defaultdict(list)
    for index, row in enumerate(clean):
        category_positions[str(row["category"])].append(index)
    factor_residuals = factor_ranks[:]
    target_residuals = target_ranks[:]
    for positions in category_positions.values():
        factor_group_mean = mean(factor_ranks[index] for index in positions)
        target_group_mean = mean(target_ranks[index] for index in positions)
        for index in positions:
            factor_residuals[index] -= factor_group_mean
            target_residuals[index] -= target_group_mean
    return pearson(factor_residuals, target_residuals)


def moving_block_bootstrap_mean(
    values: Iterable[float], *, block_size: int = BLOCK_WEEKS, resamples: int = BOOTSTRAP_RESAMPLES, seed: int = RANDOM_SEED
) -> dict:
    clean = [float(value) for value in values if is_number(value)]
    if len(clean) < 2:
        return {"mean": None, "ci_low": None, "ci_high": None, "p_value": None, "samples": len(clean)}
    block = max(1, min(block_size, len(clean)))
    starts = list(range(len(clean) - block + 1))
    rng = random.Random(seed)

    def draw(source: list[float]) -> float:
        sample: list[float] = []
        while len(sample) < len(source):
            start = rng.choice(starts)
            sample.extend(source[start : start + block])
        return mean(sample[: len(source)])

    observed = mean(clean)
    bootstrap_means = sorted(draw(clean) for _ in range(resamples))
    centered = [value - observed for value in clean]
    null_means = [draw(centered) for _ in range(resamples)]
    low_index = max(0, int(resamples * 0.025) - 1)
    high_index = min(resamples - 1, int(resamples * 0.975))
    exceedances = sum(abs(value) >= abs(observed) for value in null_means)
    return {
        "mean": round(observed, 8),
        "ci_low": round(bootstrap_means[low_index], 8),
        "ci_high": round(bootstrap_means[high_index], 8),
        "p_value": round((exceedances + 1) / (resamples + 1), 8),
        "samples": len(clean),
    }


def benjamini_hochberg(p_values: dict[str, float], alpha: float = 0.05) -> dict[str, dict]:
    ordered = sorted((float(value), key) for key, value in p_values.items() if is_number(value))
    count = len(ordered)
    adjusted: dict[str, float] = {}
    running = 1.0
    for reverse_index in range(count - 1, -1, -1):
        p_value, key = ordered[reverse_index]
        rank_index = reverse_index + 1
        running = min(running, p_value * count / rank_index)
        adjusted[key] = min(1.0, running)
    return {key: {"q_value": round(adjusted[key], 8), "fdr_significant": adjusted[key] <= alpha} for key in adjusted}


def target_weights(rows: list[dict], factor: str, quantile: float = 0.2) -> dict[str, float]:
    clean = [row for row in rows if is_number(row.get(factor))]
    if len(clean) < 6:
        return {}
    ordered = sorted(clean, key=lambda row: float(row[factor]))
    count = max(1, int(len(ordered) * quantile))
    low, high = ordered[:count], ordered[-count:]
    weights = {str(row["ticker"]): -1 / count for row in low}
    weights.update({str(row["ticker"]): 1 / count for row in high})
    return weights


def one_way_turnover(previous: dict[str, float], current: dict[str, float]) -> float:
    symbols = set(previous) | set(current)
    return 0.5 * sum(abs(current.get(symbol, 0.0) - previous.get(symbol, 0.0)) for symbol in symbols)


def portfolio_periods(records: list[dict], factor: str, target: str, cost_rate: float = ONE_WAY_COST_RATE) -> list[dict]:
    by_date: dict[str, list[dict]] = defaultdict(list)
    for row in records:
        by_date[str(row["date"])].append(row)
    previous: dict[str, float] = {}
    output = []
    for date_value in sorted(by_date):
        rows = by_date[date_value]
        weights = target_weights(rows, factor)
        return_by_symbol = {str(row["ticker"]): float(row[target]) for row in rows if is_number(row.get(target))}
        if not weights or not all(symbol in return_by_symbol for symbol in weights):
            continue
        turnover = one_way_turnover(previous, weights)
        gross = sum(weight * return_by_symbol[symbol] for symbol, weight in weights.items())
        cost = turnover * cost_rate
        output.append({
            "date": date_value,
            "gross_return": round(gross, 8),
            "one_way_turnover": round(turnover, 8),
            "cost": round(cost, 8),
            "net_return": round(gross - cost, 8),
        })
        previous = weights
    return output


def validate_factor(records: list[dict], factor: str, horizon: int) -> dict:
    target = f"forward_{horizon}w_return"
    by_date: dict[str, list[dict]] = defaultdict(list)
    for row in records:
        by_date[str(row["date"])].append(row)
    raw_ics: list[float] = []
    neutral_ics: list[float] = []
    for rows in (by_date[key] for key in sorted(by_date)):
        clean = [row for row in rows if is_number(row.get(factor)) and is_number(row.get(target))]
        if len(clean) >= 6:
            value = spearman([float(row[factor]) for row in clean], [float(row[target]) for row in clean])
            if value is not None:
                raw_ics.append(value)
            neutral = category_neutral_spearman(clean, factor, target)
            if neutral is not None:
                neutral_ics.append(neutral)
    bootstrap = moving_block_bootstrap_mean(raw_ics)
    neutral_bootstrap = moving_block_bootstrap_mean(neutral_ics)
    periods = portfolio_periods(records, factor, target)
    return {
        "factor": factor,
        "horizon": f"{horizon}w",
        "ic": bootstrap,
        "category_neutral_ic": neutral_bootstrap,
        "portfolio_periods": len(periods),
        "mean_one_way_turnover": round(mean(row["one_way_turnover"] for row in periods), 8) if periods else None,
        "mean_gross_return": round(mean(row["gross_return"] for row in periods), 8) if periods else None,
        "mean_cost": round(mean(row["cost"] for row in periods), 8) if periods else None,
        "mean_net_return": round(mean(row["net_return"] for row in periods), 8) if periods else None,
    }


def run(records: list[dict]) -> dict:
    rows = [validate_factor(records, factor, horizon) for factor in FACTORS for horizon in HORIZONS]
    fdr = benjamini_hochberg({f"{row['factor']}:{row['horizon']}": row["ic"]["p_value"] for row in rows if row["ic"]["p_value"] is not None})
    for row in rows:
        row.update(fdr.get(f"{row['factor']}:{row['horizon']}", {"q_value": None, "fdr_significant": False}))
    return {
        "version": "v2-factor-validation",
        "research_only": True,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": {
            "block_weeks": BLOCK_WEEKS,
            "bootstrap_resamples": BOOTSTRAP_RESAMPLES,
            "random_seed": RANDOM_SEED,
            "fdr": "Benjamini-Hochberg across factor x horizon hypotheses",
            "category_neutral": "global ranks residualized by category on each date",
            "one_way_cost_rate": ONE_WAY_COST_RATE,
        },
        "rows": rows,
    }


def write_outputs(payload: dict, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "factor-validation.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    flat_rows = []
    for row in payload["rows"]:
        flat_rows.append({
            "factor": row["factor"], "horizon": row["horizon"],
            "mean_ic": row["ic"]["mean"], "ic_ci_low": row["ic"]["ci_low"], "ic_ci_high": row["ic"]["ci_high"],
            "p_value": row["ic"]["p_value"], "q_value": row["q_value"], "fdr_significant": row["fdr_significant"],
            "category_neutral_ic": row["category_neutral_ic"]["mean"],
            "mean_one_way_turnover": row["mean_one_way_turnover"], "mean_gross_return": row["mean_gross_return"],
            "mean_cost": row["mean_cost"], "mean_net_return": row["mean_net_return"],
        })
    with (out_dir / "factor-validation.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(flat_rows[0]))
        writer.writeheader()
        writer.writerows(flat_rows)


def is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def main() -> None:
    parser = argparse.ArgumentParser(description="Run isolated v2 factor validation.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    _active, expanded = load_universe_pair()
    payload = run(build_factor_records(expanded))
    write_outputs(payload, args.output)
    print(f"Wrote v2 factor validation to {args.output}")


if __name__ == "__main__":
    main()
