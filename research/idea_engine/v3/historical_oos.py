"""Leakage-aware historical OOS calibration for the price-timing layer.

This module deliberately does not backfill the full Idea Engine score because
point-in-time fundamentals, consensus, transcripts and event evidence are not
available for the historical dates.  It validates only the independently
defined price/volume timing layer and keeps the permanent OOS outcomes out of
threshold and calibration fitting.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean
from tempfile import NamedTemporaryFile
from typing import Any

from .short_term_trade_plan import compute_indicators, normalize_rows


ROOT = Path(__file__).resolve().parents[3]
DEFAULT_PRICES = ROOT / "data" / "short-term-daily-bars-v1.json"
DEFAULT_CONFIG = ROOT / "data" / "short-term-trade-plan-v1.json"
DEFAULT_OUTPUT = ROOT / "research" / "results" / "v3_1" / "historical-oos-price-timing" / "latest.json"
SCHEMA_VERSION = "historical-oos-price-timing-v1"
ORIGIN_STEP_DAYS = 5
FORWARD_DAYS = 20
OUTER_TEST_FRACTION = 0.20
EMBARGO_ORIGINS = 1
ROUND_TRIP_COST_BPS = 30
BOOTSTRAP_RESAMPLES = 2_000
RANDOM_SEED = 42
FROZEN_SPLIT_BOUNDARY = "2025-04-09"
FROZEN_TEST_START = "2025-04-16"


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, float(value)))


def timing_score(indicators: dict[str, Any]) -> float:
    """Return a fixed, outcome-independent 0-100 price-timing score."""
    atr_value = max(float(indicators.get("atr14") or 0), 1e-12)
    current = float(indicators.get("current_close") or 0)
    sma20 = float(indicators.get("sma20") or current)
    sma50 = float(indicators.get("sma50") or current)
    components = [
        20 * clamp((float(indicators.get("relative_return_20") or 0) + 0.10) / 0.20),
        15 * clamp((float(indicators.get("relative_return_5") or 0) + 0.05) / 0.10),
        10 if float(indicators.get("qqq_close_vs_sma20") or 0) > 0 else 0,
        15 if current > sma20 else 0,
        10 if current > sma50 else 0,
        10 * clamp((float(indicators.get("volume_ratio") or 0) - 0.5) / 1.5),
        10 * clamp((current - sma20) / (2 * atr_value) + 0.5),
        10 * clamp((sma20 - sma50) / (2 * atr_value) + 0.5),
    ]
    return round(sum(components), 6)


def adjusted_value(row: dict[str, Any], field: str) -> float:
    close = float(row["close"])
    adjusted = float(row.get("adjusted") or close)
    return float(row[field]) * adjusted / close


def outcome_at(rows: list[dict[str, Any]], benchmark_rows: list[dict[str, Any]], index: int, forward_days: int = FORWARD_DAYS) -> dict[str, Any]:
    entry_row, exit_row = rows[index + 1], rows[index + forward_days]
    q_entry_row, q_exit_row = benchmark_rows[index + 1], benchmark_rows[index + forward_days]
    entry = adjusted_value(entry_row, "open")
    exit_price = adjusted_value(exit_row, "close")
    benchmark_entry = adjusted_value(q_entry_row, "open")
    benchmark_exit = adjusted_value(q_exit_row, "close")
    stock_return = exit_price / entry - 1
    benchmark_return = benchmark_exit / benchmark_entry - 1
    relative_return = stock_return - benchmark_return
    future_lows = [adjusted_value(row, "low") for row in rows[index + 1 : index + forward_days + 1]]
    return {
        "entry_date": entry_row["date"],
        "exit_date": exit_row["date"],
        "stock_return": stock_return,
        "benchmark_return": benchmark_return,
        "relative_return": relative_return,
        "net_relative_return": relative_return - ROUND_TRIP_COST_BPS / 10_000,
        "max_adverse_move": min(future_lows) / entry - 1,
    }


def build_records(prices: dict[str, Any], config: dict[str, Any]) -> list[dict[str, Any]]:
    source = prices.get("symbols", {}) if isinstance(prices, dict) else {}
    benchmark = normalize_rows(source.get("QQQ", []))
    benchmark_by_date = {row["date"]: row for row in benchmark}
    records: list[dict[str, Any]] = []
    for ticker, raw_rows in sorted(source.items()):
        if ticker == "QQQ":
            continue
        stock = [row for row in normalize_rows(raw_rows) if row["date"] in benchmark_by_date]
        qqq = [benchmark_by_date[row["date"]] for row in stock]
        if len(stock) < 60 + FORWARD_DAYS:
            continue
        for index in range(59, len(stock) - FORWARD_DAYS, ORIGIN_STEP_DAYS):
            indicators = compute_indicators(stock[: index + 1], qqq[: index + 1], config)
            outcome = outcome_at(stock, qqq, index)
            records.append({
                "ticker": ticker,
                "signal_date": stock[index]["date"],
                "timing_score": timing_score(indicators),
                **outcome,
            })
    return records


def permanent_oos_split(records: list[dict[str, Any]], *, split_boundary: str | None = None, test_start: str | None = None) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    dates = sorted({row["signal_date"] for row in records})
    if len(dates) < 12:
        raise ValueError("historical OOS requires at least 12 weekly origins")
    split_index = min(len(dates) - 2, max(8, math.floor(len(dates) * (1 - OUTER_TEST_FRACTION))))
    split_boundary = split_boundary or dates[split_index]
    test_start = test_start or dates[min(len(dates) - 1, split_index + EMBARGO_ORIGINS)]
    train = [row for row in records if row["exit_date"] < split_boundary]
    test = [row for row in records if row["signal_date"] >= test_start]
    if not train or not test:
        raise ValueError("historical OOS split is empty")
    if max(row["exit_date"] for row in train) >= min(row["signal_date"] for row in test):
        raise AssertionError("purge/embargo boundary leaked future outcomes")
    return train, test, {
        "permanent_oos": True,
        "outer_test_fraction": OUTER_TEST_FRACTION,
        "split_boundary": split_boundary,
        "test_start": test_start,
        "purge_horizon_trading_days": FORWARD_DAYS,
        "embargo_trading_days": ORIGIN_STEP_DAYS * EMBARGO_ORIGINS,
        "train_signal_start": min(row["signal_date"] for row in train),
        "train_signal_end": max(row["signal_date"] for row in train),
        "train_last_exit": max(row["exit_date"] for row in train),
        "oos_signal_start": min(row["signal_date"] for row in test),
        "oos_signal_end": max(row["signal_date"] for row in test),
        "oos_last_exit": max(row["exit_date"] for row in test),
    }


def quantile_boundaries(values: list[float], bins: int = 5) -> list[float]:
    ordered = sorted(float(value) for value in values)
    if len(ordered) < bins * 2:
        raise ValueError("not enough training scores for calibration bins")
    return [ordered[min(len(ordered) - 1, math.ceil(len(ordered) * index / bins) - 1)] for index in range(1, bins)]


def bin_number(score: float, boundaries: list[float]) -> int:
    return 1 + sum(float(score) > boundary for boundary in boundaries)


def block_bootstrap_rate(rows: list[dict[str, Any]], *, resamples: int = BOOTSTRAP_RESAMPLES, seed: int = RANDOM_SEED) -> dict[str, Any]:
    groups: dict[str, list[float]] = defaultdict(list)
    for row in rows:
        groups[row["signal_date"]].append(1.0 if row["net_relative_return"] > 0 else 0.0)
    date_rates = [mean(groups[key]) for key in sorted(groups)]
    if len(date_rates) < 2:
        observed = mean(date_rates) if date_rates else None
        return {"rate": observed, "ci_low": None, "ci_high": None, "origin_dates": len(date_rates), "resamples": 0}
    block_size = min(4, len(date_rates))
    starts = range(len(date_rates) - block_size + 1)
    rng = random.Random(seed)
    samples = []
    for _ in range(resamples):
        drawn = []
        while len(drawn) < len(date_rates):
            start = rng.choice(list(starts))
            drawn.extend(date_rates[start : start + block_size])
        samples.append(mean(drawn[: len(date_rates)]))
    samples.sort()
    return {
        "rate": round(mean(date_rates), 8),
        "ci_low": round(samples[max(0, int(resamples * 0.025) - 1)], 8),
        "ci_high": round(samples[min(resamples - 1, int(resamples * 0.975))], 8),
        "origin_dates": len(date_rates),
        "resamples": resamples,
    }


def calibrate(train: list[dict[str, Any]], test: list[dict[str, Any]]) -> dict[str, Any]:
    boundaries = quantile_boundaries([row["timing_score"] for row in train])
    train_bins: dict[int, list[dict[str, Any]]] = defaultdict(list)
    test_bins: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in train:
        train_bins[bin_number(row["timing_score"], boundaries)].append(row)
    for row in test:
        test_bins[bin_number(row["timing_score"], boundaries)].append(row)
    probabilities = {
        number: (sum(row["net_relative_return"] > 0 for row in rows) + 1) / (len(rows) + 2)
        for number, rows in train_bins.items()
    }
    bins = []
    predictions = []
    for number in range(1, 6):
        train_rows, test_rows = train_bins[number], test_bins[number]
        probability = probabilities[number]
        observed = block_bootstrap_rate(test_rows, seed=RANDOM_SEED + number)
        predictions.extend((probability, 1.0 if row["net_relative_return"] > 0 else 0.0) for row in test_rows)
        bins.append({
            "bin": number,
            "score_low_exclusive": boundaries[number - 2] if number > 1 else None,
            "score_high_inclusive": boundaries[number - 1] if number <= len(boundaries) else None,
            "train_samples": len(train_rows),
            "train_estimated_probability": round(probability, 8),
            "oos_samples": len(test_rows),
            "oos_cost_adjusted_hit_rate": observed["rate"],
            "oos_hit_rate_ci_low": observed["ci_low"],
            "oos_hit_rate_ci_high": observed["ci_high"],
            "oos_origin_dates": observed["origin_dates"],
            "mean_oos_net_relative_return": round(mean(row["net_relative_return"] for row in test_rows), 8) if test_rows else None,
            "mean_oos_max_adverse_move": round(mean(row["max_adverse_move"] for row in test_rows), 8) if test_rows else None,
        })
    brier = mean((prediction - actual) ** 2 for prediction, actual in predictions)
    calibration_gap = sum(abs(row["train_estimated_probability"] - row["oos_cost_adjusted_hit_rate"]) * row["oos_samples"] for row in bins if row["oos_cost_adjusted_hit_rate"] is not None) / len(test)
    return {
        "bin_boundaries": boundaries,
        "bins": bins,
        "brier_score": round(brier, 8),
        "weighted_absolute_calibration_gap": round(calibration_gap, 8),
    }


def latest_mappings(prices: dict[str, Any], config: dict[str, Any], calibration: dict[str, Any]) -> dict[str, Any]:
    source = prices["symbols"]
    qqq_by_date = {row["date"]: row for row in normalize_rows(source["QQQ"])}
    bins = {row["bin"]: row for row in calibration["bins"]}
    output = {}
    for ticker, raw_rows in sorted(source.items()):
        if ticker == "QQQ":
            continue
        stock = [row for row in normalize_rows(raw_rows) if row["date"] in qqq_by_date]
        qqq = [qqq_by_date[row["date"]] for row in stock]
        if len(stock) < 60:
            continue
        score = timing_score(compute_indicators(stock, qqq, config))
        number = bin_number(score, calibration["bin_boundaries"])
        row = bins[number]
        reliable_edge = bool(row["mean_oos_net_relative_return"] is not None and row["mean_oos_net_relative_return"] > 0 and row["oos_hit_rate_ci_low"] is not None and row["oos_hit_rate_ci_low"] > 0.5)
        positive_skew = bool(row["mean_oos_net_relative_return"] is not None and row["mean_oos_net_relative_return"] > 0)
        output[ticker] = {
            "as_of": stock[-1]["date"],
            "timing_score": score,
            "calibration_bin": number,
            "train_estimated_probability": row["train_estimated_probability"],
            "oos_samples": row["oos_samples"],
            "oos_origin_dates": row["oos_origin_dates"],
            "oos_cost_adjusted_hit_rate": row["oos_cost_adjusted_hit_rate"],
            "oos_hit_rate_ci_low": row["oos_hit_rate_ci_low"],
            "oos_hit_rate_ci_high": row["oos_hit_rate_ci_high"],
            "mean_oos_net_relative_return": row["mean_oos_net_relative_return"],
            "evidence_status": "preliminary_reliable_edge" if reliable_edge else "positive_skew_unconfirmed" if positive_skew else "no_historical_edge",
        }
    return output


def generate(
    prices_path: Path = DEFAULT_PRICES,
    config_path: Path = DEFAULT_CONFIG,
    *,
    now: datetime | None = None,
    split_boundary: str | None = FROZEN_SPLIT_BOUNDARY,
    test_start: str | None = FROZEN_TEST_START,
) -> dict[str, Any]:
    raw = prices_path.read_bytes()
    prices = json.loads(raw.decode("utf-8"))
    config = json.loads(config_path.read_text(encoding="utf-8"))
    records = build_records(prices, config)
    train, test, split = permanent_oos_split(records, split_boundary=split_boundary, test_start=test_start)
    calibration = calibrate(train, test)
    mappings = latest_mappings(prices, config, calibration)
    overall = block_bootstrap_rate(test)
    reliable_bins = [row["bin"] for row in calibration["bins"] if row["mean_oos_net_relative_return"] is not None and row["mean_oos_net_relative_return"] > 0 and row["oos_hit_rate_ci_low"] is not None and row["oos_hit_rate_ci_low"] > 0.5]
    positive_mean_bins = [row["bin"] for row in calibration["bins"] if row["mean_oos_net_relative_return"] is not None and row["mean_oos_net_relative_return"] > 0]
    enough_oos = len(test) >= 1_000 and overall["origin_dates"] >= 52
    status = "preliminary_reliable_edge" if enough_oos and reliable_bins else "preliminary_no_reliable_edge" if enough_oos else "insufficient_oos"
    return {
        "schema_version": SCHEMA_VERSION,
        "methodology_version": "historical-oos-price-timing-v1.1.0",
        "generated_at": (now or datetime.now(timezone.utc)).isoformat(),
        "as_of": prices.get("as_of"),
        "research_only": True,
        "no_trade": True,
        "status": status,
        "scope": "price_timing_layer_only",
        "composite_score_calibrated": False,
        "point_in_time_fundamentals_available": False,
        "point_in_time_universe_available": False,
        "survivorship_bias_controlled": False,
        "universe_method": "current_research_universe_backfill",
        "benchmark": "QQQ",
        "target": "20_trading_day_net_relative_return_positive",
        "execution": "signal_at_t_close_entry_t_plus_1_adjusted_open_exit_t_plus_20_adjusted_close",
        "round_trip_cost_bps": ROUND_TRIP_COST_BPS,
        "input": {"path": prices_path.name, "sha256": hashlib.sha256(raw).hexdigest(), "symbols": len(prices.get("symbols", {})), "source": prices.get("source"), "frequency": prices.get("frequency"), "adjustment": prices.get("adjustment")},
        "split": split,
        "sample_counts": {"all": len(records), "train": len(train), "permanent_oos": len(test), "permanent_oos_origin_dates": overall["origin_dates"]},
        "overall_oos": {
            "cost_adjusted_hit_rate": overall["rate"],
            "hit_rate_ci_low": overall["ci_low"],
            "hit_rate_ci_high": overall["ci_high"],
            "mean_net_relative_return": round(mean(row["net_relative_return"] for row in test), 8),
            "mean_max_adverse_move": round(mean(row["max_adverse_move"] for row in test), 8),
        },
        "calibration": calibration,
        "reliability_gate": {
            "minimum_oos_samples": 1_000,
            "minimum_oos_origin_dates": 52,
            "maximum_weighted_calibration_gap": 0.10,
            "calibration_gap_passed": calibration["weighted_absolute_calibration_gap"] <= 0.10,
            "positive_mean_bins": positive_mean_bins,
            "reliable_edge_bins": reliable_bins,
            "passed": bool(enough_oos and reliable_bins and calibration["weighted_absolute_calibration_gap"] <= 0.10),
        },
        "current_mappings": mappings,
        "warnings": [
            "仅校验价格与成交量择时层，不校验 Idea Engine 综合分或公司基本面。",
            "历史 OOS 是初步证据，不替代实时 Shadow，不代表未来收益承诺。",
            "所有阈值和分箱仅在训练段确定，永久 OOS 只评估一次。",
            "使用当前研究股票池回填历史，未包含退市证券，仍存在幸存者偏差。",
            "公开行情供应商可能追溯修订复权数据；输入 hash 用于识别每次运行的数据版本。",
        ],
    }


def atomic_write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False, suffix=".tmp") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        temporary = Path(handle.name)
    os.replace(temporary, path)


def write_markdown(path: Path, payload: dict[str, Any]) -> None:
    overall = payload["overall_oos"]
    lines = [
        "# 历史 OOS 价格择时层初步校准",
        "",
        f"- 状态：`{payload['status']}`",
        f"- 数据截至：`{payload['as_of']}`",
        f"- 永久 OOS 样本：`{payload['sample_counts']['permanent_oos']}`",
        f"- 永久 OOS 起止：`{payload['split']['oos_signal_start']}` 至 `{payload['split']['oos_signal_end']}`",
        f"- 成本后相对 QQQ 命中率：`{overall['cost_adjusted_hit_rate']:.2%}`",
        f"- 95% block-bootstrap 区间：`{overall['hit_rate_ci_low']:.2%}` 至 `{overall['hit_rate_ci_high']:.2%}`",
        f"- 成本后平均相对收益：`{overall['mean_net_relative_return']:.2%}`",
        f"- 通过可靠优势门禁的分档：`{payload['reliability_gate']['reliable_edge_bins']}`",
        "- 股票池方法：当前股票池历史回填；幸存者偏差未完全控制",
        "",
        "本报告只验证价格与成交量择时层，不校验综合研究分，也不替代实时 Shadow。当前股票池回填仍存在幸存者偏差。仅供人工研究，不生成订单。",
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prices", type=Path, default=DEFAULT_PRICES)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    payload = generate(args.prices, args.config)
    atomic_write(args.output, payload)
    write_markdown(args.output.with_suffix(".md"), payload)
    print(f"historical_oos_status={payload['status']} oos_samples={payload['sample_counts']['permanent_oos']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
