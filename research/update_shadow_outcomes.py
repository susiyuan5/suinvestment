"""Backfill immutable 1/4/12-week Shadow outcomes and monitoring metrics."""

from __future__ import annotations

import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean


ROOT = Path(__file__).resolve().parents[1]
PHASE6S = ROOT / "research" / "results" / "phase6s"
HISTORY = PHASE6S / "history" / "shadow-observation-history-manifest.json"
LATEST = PHASE6S / "shadow-observation-log.json"
PRICES = ROOT / "data" / "research-prices-sector-balanced-80.json"
OUT = PHASE6S / "shadow-observation-outcomes.json"
HORIZONS = (1, 4, 12)
BENCHMARK = "QQQ"


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def positive(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0


def normalized_rows(entry: object) -> list[dict]:
    rows = entry.get("rows", []) if isinstance(entry, dict) else entry
    if not isinstance(rows, list):
        return []
    return sorted(
        [row for row in rows if isinstance(row, dict) and row.get("date") and positive(row.get("close"))],
        key=lambda row: row["date"],
    )


def start_index(rows: list[dict], as_of: str) -> int | None:
    as_of_day = datetime.fromisoformat(as_of.replace("Z", "+00:00")).date().isoformat()
    eligible = [index for index, row in enumerate(rows) if row["date"] <= as_of_day]
    return eligible[-1] if eligible else None


def horizon_outcome(rows: list[dict], benchmark_rows: list[dict], as_of: str, horizon: int) -> dict:
    index = start_index(rows, as_of)
    benchmark_index = start_index(benchmark_rows, as_of)
    if index is None:
        return {"status": "pending", "reason": "no price at observation date"}
    if benchmark_index is None:
        return {"status": "pending", "reason": "benchmark missing at observation date"}
    target_index = index + horizon
    benchmark_target = benchmark_index + horizon
    if target_index >= len(rows) or benchmark_target >= len(benchmark_rows):
        return {"status": "pending", "reason": "future horizon has not matured"}
    start, end = float(rows[index]["close"]), float(rows[target_index]["close"])
    benchmark_start = float(benchmark_rows[benchmark_index]["close"])
    benchmark_end = float(benchmark_rows[benchmark_target]["close"])
    absolute_return = end / start - 1
    benchmark_return = benchmark_end / benchmark_start - 1
    relative_return = (1 + absolute_return) / (1 + benchmark_return) - 1
    adverse = min(float(row["close"]) / start - 1 for row in rows[index : target_index + 1])
    return {
        "status": "matured",
        "start_date": rows[index]["date"],
        "end_date": rows[target_index]["date"],
        "absolute_return": round(absolute_return, 8),
        "benchmark_return": round(benchmark_return, 8),
        "relative_return": round(relative_return, 8),
        "maximum_adverse_excursion": round(adverse, 8),
        "false_positive": relative_return <= 0,
    }


def observation_payloads() -> list[dict]:
    manifest = load(HISTORY) if HISTORY.exists() else {"entries": []}
    payloads = []
    archived_timestamps = set()
    for entry in manifest.get("entries", []):
        log_path = ROOT / entry["archiveFolder"] / "shadow-observation-log.json"
        if log_path.exists():
            payload = load(log_path)
            payloads.append(payload)
            archived_timestamps.add(payload.get("generatedAt"))
    if LATEST.exists():
        latest = load(LATEST)
        if latest.get("generatedAt") not in archived_timestamps:
            payloads.append(latest)
    return sorted(payloads, key=lambda payload: payload.get("generatedAt", ""))


def ranking_turnover(payloads: list[dict]) -> list[dict]:
    output = []
    previous: set[str] | None = None
    for payload in payloads:
        observations = payload.get("observations", [])
        ranked = sorted(enumerate(observations, start=1), key=lambda item: int(item[1].get("as_of_rank", item[0])))
        count = max(1, math.ceil(len(ranked) * 0.25))
        current = {row["symbol"] for _, row in ranked[:count]}
        if previous is not None:
            output.append({
                "observation_timestamp": payload.get("generatedAt"),
                "top_quartile_size": count,
                "membership_turnover": round(1 - len(previous & current) / max(len(previous), len(current)), 8),
            })
        previous = current
    return output


def aggregate_metrics(outcomes: list[dict], payloads: list[dict]) -> dict:
    horizon_metrics = {}
    for horizon in HORIZONS:
        matured = [row["outcomes"][str(horizon)] for row in outcomes if row["outcomes"][str(horizon)]["status"] == "matured"]
        false_count = sum(bool(row["false_positive"]) for row in matured)
        horizon_metrics[str(horizon)] = {
            "matured_count": len(matured),
            "false_positive_count": false_count,
            "false_positive_rate": round(false_count / len(matured), 8) if matured else None,
            "mean_relative_return": round(mean(row["relative_return"] for row in matured), 8) if matured else None,
            "mean_maximum_adverse_excursion": round(mean(row["maximum_adverse_excursion"] for row in matured), 8) if matured else None,
        }
    all_observations = [row for payload in payloads for row in payload.get("observations", [])]
    category_counts: dict[str, int] = defaultdict(int)
    for row in all_observations:
        if row.get("category"):
            category_counts[str(row["category"])] += 1
    category_total = sum(category_counts.values())
    largest_share = max(category_counts.values()) / category_total if category_total else None
    volatilities = [float(row["volatility_proxy"]) for row in all_observations if isinstance(row.get("volatility_proxy"), (int, float))]
    missing = sum(bool(row.get("missing_price_warning")) for row in all_observations)
    return {
        "horizons": horizon_metrics,
        "ranking_turnover": ranking_turnover(payloads),
        "missing_price_frequency": round(missing / len(all_observations), 8) if all_observations else None,
        "mean_volatility_impact": round(mean(volatilities), 8) if volatilities else None,
        "sector_diversification_benefit": round(1 - largest_share, 8) if largest_share is not None else None,
    }


def build() -> dict:
    prices = load(PRICES).get("symbols", {})
    benchmark_rows = normalized_rows(prices.get(BENCHMARK, {}))
    payloads = observation_payloads()
    outcomes = []
    for payload in payloads:
        for position, observation in enumerate(payload.get("observations", []), start=1):
            rows = normalized_rows(prices.get(observation["symbol"], {}))
            timestamp = observation["observation_date"]
            outcomes.append({
                "observation_timestamp": timestamp,
                "symbol": observation["symbol"],
                "as_of_rank": observation.get("as_of_rank", position),
                "as_of_signal": observation.get("as_of_signal"),
                "input_hash": observation.get("input_hash"),
                "code_version": observation.get("code_version"),
                "model_version": observation.get("model_version"),
                "outcomes": {str(horizon): horizon_outcome(rows, benchmark_rows, timestamp, horizon) for horizon in HORIZONS},
            })
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "research_only": True,
        "benchmark": BENCHMARK,
        "false_positive_definition": "mature candidate relative return versus QQQ <= 0",
        "eligible_for_live_promotion": False,
        "outcomes": outcomes,
        "metrics": aggregate_metrics(outcomes, payloads),
    }


def main() -> None:
    payload = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT} with {len(payload['outcomes'])} frozen observations")


if __name__ == "__main__":
    main()
