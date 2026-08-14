"""Permanent OOS validation for the v1.2 global-style short-term engine.

The rules are fixed in the versioned config before the permanent OOS segment is
evaluated.  This report validates the entry and exit policy only; it does not
calibrate the Idea Engine composite score or replace live Shadow observations.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean

from .historical_oos import (
    BOOTSTRAP_RESAMPLES,
    FROZEN_SPLIT_BOUNDARY,
    FROZEN_TEST_START,
    ORIGIN_STEP_DAYS,
    RANDOM_SEED,
    ROUND_TRIP_COST_BPS,
    adjusted_value,
    atomic_write,
    block_bootstrap_rate,
    permanent_oos_split,
)
from .short_term_trade_plan import build_signal, compute_indicators, normalize_rows, style_signals


ROOT = Path(__file__).resolve().parents[3]
DEFAULT_PRICES = ROOT / "data" / "short-term-daily-bars-v1.json"
DEFAULT_CONFIG = ROOT / "data" / "short-term-trade-plan-v1.2.json"
DEFAULT_OUTPUT = ROOT / "research" / "results" / "v3_1" / "global-style-short-term-oos" / "latest.json"
SCHEMA_VERSION = "global-style-short-term-oos-v1"
FORWARD_DAYS = 20


def adjusted_signal_price(value, signal_row):
    return float(value) * float(signal_row.get("adjusted") or signal_row["close"]) / float(signal_row["close"])


def simulate_trade(rows, benchmark_rows, index, signal, model, config):
    signal_row = rows[index]
    entry_row = rows[index + 1]
    benchmark_entry_row = benchmark_rows[index + 1]
    entry = adjusted_value(entry_row, "open")
    benchmark_entry = adjusted_value(benchmark_entry_row, "open")
    chase_limit = adjusted_signal_price(signal["chase_limit"], signal_row)
    if entry > chase_limit:
        return None
    initial_stop = adjusted_signal_price(signal["stop"], signal_row)
    if initial_stop >= entry:
        return None
    risk = entry - initial_stop
    targets = [entry + risk * float(value) for value in config["risk"]["target_r_multiples"]]
    stop = initial_stop
    highest_close = entry
    remaining = 1.0
    realized_stock = 0.0
    realized_benchmark = 0.0
    target_one_hit = False
    exits = []
    lows = []
    atr_value = adjusted_signal_price(signal.get("atr14") or (signal["entry_reference"] - signal["stop"]) / float(config["risk"]["volatility_stop_atr"]), signal_row)
    breakout_level = adjusted_signal_price(signal.get("breakout_level") or signal["entry_reference"], signal_row)
    for offset in range(1, FORWARD_DAYS + 1):
        row = rows[index + offset]
        qqq_row = benchmark_rows[index + offset]
        open_price = adjusted_value(row, "open")
        low = adjusted_value(row, "low")
        high = adjusted_value(row, "high")
        close = adjusted_value(row, "close")
        qqq_close = adjusted_value(qqq_row, "close")
        lows.append(low)
        if low <= stop:
            exit_price = min(open_price, stop)
            realized_stock += remaining * (exit_price / entry - 1)
            realized_benchmark += remaining * (qqq_close / benchmark_entry - 1)
            exits.append({"day": offset, "reason": "stop", "weight": remaining})
            remaining = 0.0
            break
        if not target_one_hit and high >= targets[0]:
            weight = min(remaining, float(config["exit"]["partial_target_fraction"]))
            realized_stock += weight * (targets[0] / entry - 1)
            realized_benchmark += weight * (qqq_close / benchmark_entry - 1)
            exits.append({"day": offset, "reason": "target_1", "weight": weight})
            remaining -= weight
            target_one_hit = True
        elif target_one_hit and remaining > 0 and high >= targets[1]:
            realized_stock += remaining * (targets[1] / entry - 1)
            realized_benchmark += remaining * (qqq_close / benchmark_entry - 1)
            exits.append({"day": offset, "reason": "target_2", "weight": remaining})
            remaining = 0.0
            break
        if model in {"vcp_darvas_breakout", "oneil_volume_breakout"} and offset <= int(config["exit"]["failed_breakout_review_days"]) and close < breakout_level:
            realized_stock += remaining * (close / entry - 1)
            realized_benchmark += remaining * (qqq_close / benchmark_entry - 1)
            exits.append({"day": offset, "reason": "failed_breakout", "weight": remaining})
            remaining = 0.0
            break
        if offset >= int(config["exit"]["time_review_days"]) and not target_one_hit and close < entry + risk * float(config["exit"]["time_review_minimum_r"]):
            realized_stock += remaining * (close / entry - 1)
            realized_benchmark += remaining * (qqq_close / benchmark_entry - 1)
            exits.append({"day": offset, "reason": "time_stop", "weight": remaining})
            remaining = 0.0
            break
        highest_close = max(highest_close, close)
        stop = max(stop, highest_close - atr_value * float(config["risk"]["trailing_stop_atr"]))
        if offset == FORWARD_DAYS and remaining > 0:
            realized_stock += remaining * (close / entry - 1)
            realized_benchmark += remaining * (qqq_close / benchmark_entry - 1)
            exits.append({"day": offset, "reason": "maximum_holding", "weight": remaining})
            remaining = 0.0
    relative = realized_stock - realized_benchmark
    return {
        "entry_date": entry_row["date"], "exit_date": rows[index + max(item["day"] for item in exits)]["date"],
        "stock_return": realized_stock, "benchmark_return": realized_benchmark, "relative_return": relative,
        "net_relative_return": relative - ROUND_TRIP_COST_BPS / 10_000,
        "max_adverse_move": min(lows) / entry - 1 if lows else None,
        "exit_reasons": [item["reason"] for item in exits],
    }


def build_records(prices, config):
    source = prices.get("symbols", {})
    benchmark = normalize_rows(source.get(config.get("benchmark", "QQQ"), []))
    benchmark_by_date = {row["date"]: row for row in benchmark}
    records = []
    rejected_chases = 0
    for ticker, raw_rows in sorted(source.items()):
        if ticker == config.get("benchmark", "QQQ"):
            continue
        stock = [row for row in normalize_rows(raw_rows) if row["date"] in benchmark_by_date]
        qqq = [benchmark_by_date[row["date"]] for row in stock]
        for index in range(219, len(stock) - FORWARD_DAYS, ORIGIN_STEP_DAYS):
            try:
                indicators = compute_indicators(stock[:index + 1], qqq[:index + 1], config)
            except ValueError:
                continue
            signals = style_signals(indicators, config)
            if not signals["triggered_model"]:
                continue
            signal = build_signal(indicators, signals, config)
            if not signal:
                continue
            signal["atr14"] = indicators["atr14"]
            signal["breakout_level"] = indicators["prior20_high"]
            outcome = simulate_trade(stock, qqq, index, signal, signals["triggered_model"], config)
            if outcome is None:
                rejected_chases += 1
                continue
            records.append({"ticker": ticker, "signal_date": stock[index]["date"], "model": signals["triggered_model"], "market_regime": signals["market_regime"]["state"], **outcome})
    return records, rejected_chases


def summarize(rows, seed=RANDOM_SEED):
    if not rows:
        return {"samples": 0, "origin_dates": 0, "cost_adjusted_hit_rate": None, "hit_rate_ci_low": None, "hit_rate_ci_high": None, "mean_net_relative_return": None, "mean_max_adverse_move": None, "passed": False}
    bootstrap = block_bootstrap_rate(rows, resamples=BOOTSTRAP_RESAMPLES, seed=seed)
    passed = len(rows) >= 100 and bootstrap["origin_dates"] >= 26 and bootstrap["ci_low"] is not None and bootstrap["ci_low"] > 0.5 and mean(row["net_relative_return"] for row in rows) > 0
    return {
        "samples": len(rows), "origin_dates": bootstrap["origin_dates"], "cost_adjusted_hit_rate": bootstrap["rate"],
        "hit_rate_ci_low": bootstrap["ci_low"], "hit_rate_ci_high": bootstrap["ci_high"],
        "mean_net_relative_return": round(mean(row["net_relative_return"] for row in rows), 8),
        "mean_max_adverse_move": round(mean(row["max_adverse_move"] for row in rows), 8), "passed": passed,
    }


def current_mappings(prices, config, by_model):
    source = prices.get("symbols", {}); benchmark = normalize_rows(source.get(config.get("benchmark", "QQQ"), [])); by_date = {row["date"]: row for row in benchmark}; output = {}
    for ticker, raw_rows in sorted(source.items()):
        if ticker == config.get("benchmark", "QQQ"): continue
        stock = [row for row in normalize_rows(raw_rows) if row["date"] in by_date]; qqq = [by_date[row["date"]] for row in stock]
        try: indicators = compute_indicators(stock, qqq, config); signals = style_signals(indicators, config)
        except ValueError: continue
        model = signals["triggered_model"]; evidence = by_model.get(model, {}) if model else {}
        output[ticker] = {"as_of": indicators["signal_date"], "current_model": model, "market_regime": signals["market_regime"]["state"], "trend_template": signals["trend_template"], "vcp_contraction": signals["vcp_contraction"], "passed": bool(model and evidence.get("passed")), "model_oos": evidence or None, "status": "preliminary_reliable_edge" if model and evidence.get("passed") else "current_trigger_unvalidated" if model else "no_current_trigger"}
    return output


def generate(prices_path=DEFAULT_PRICES, config_path=DEFAULT_CONFIG, *, now=None):
    raw = prices_path.read_bytes(); prices = json.loads(raw.decode("utf-8")); config = json.loads(config_path.read_text(encoding="utf-8"))
    records, rejected_chases = build_records(prices, config)
    train, test, split = permanent_oos_split(records, split_boundary=FROZEN_SPLIT_BOUNDARY, test_start=FROZEN_TEST_START)
    models = sorted({row["model"] for row in records}); by_model = {model: summarize([row for row in test if row["model"] == model], RANDOM_SEED + index + 1) for index, model in enumerate(models)}
    overall = summarize(test)
    passed_models = [model for model, result in by_model.items() if result["passed"]]
    enough = overall["samples"] >= 100 and overall["origin_dates"] >= 26
    status = "preliminary_reliable_edge" if passed_models else "preliminary_no_reliable_edge" if enough else "insufficient_oos"
    return {
        "schema_version": SCHEMA_VERSION, "methodology_version": "global-style-short-term-oos-v1.0.0", "generated_at": (now or datetime.now(timezone.utc)).isoformat(), "as_of": prices.get("as_of"),
        "research_only": True, "no_trade": True, "status": status, "scope": "global_style_entry_and_exit_policy", "composite_score_calibrated": False,
        "permanent_oos": True, "survivorship_bias_controlled": False, "universe_method": "current_research_universe_backfill", "benchmark": config.get("benchmark", "QQQ"), "round_trip_cost_bps": ROUND_TRIP_COST_BPS,
        "input": {"path": prices_path.name, "sha256": hashlib.sha256(raw).hexdigest(), "config_version": config.get("schema_version"), "symbols": len(prices.get("symbols", {})), "source": prices.get("source")},
        "split": split, "sample_counts": {"all": len(records), "train": len(train), "permanent_oos": len(test), "rejected_chase_entries": rejected_chases},
        "overall_oos": overall, "by_model": by_model,
        "reliability_gate": {"minimum_samples": 100, "minimum_origin_dates": 26, "required_ci_low": 0.5, "passed_models": passed_models, "passed": bool(passed_models)},
        "current_mappings": current_mappings(prices, config, by_model),
        "warnings": ["当前股票池历史回填仍存在幸存者偏差。", "仅校验v1.2价格、成交量、市场门禁和退出规则，不校验Idea Engine综合分。", "任何未通过的子模型不得由其他风格分数补偿。", "历史OOS不替代实时Shadow，不生成订单。"],
    }


def write_markdown(path, payload):
    overall = payload["overall_oos"]
    lines = ["# 全球风格融合短线 v1.2 历史 OOS", "", f"- 状态：`{payload['status']}`", f"- 数据截至：`{payload['as_of']}`", f"- 永久 OOS 样本：`{payload['sample_counts']['permanent_oos']}`", f"- 独立周：`{overall['origin_dates']}`", f"- 成本后相对 QQQ 命中率：`{overall['cost_adjusted_hit_rate']}`", f"- 平均成本后相对收益：`{overall['mean_net_relative_return']}`", f"- 通过门禁的子模型：`{payload['reliability_gate']['passed_models']}`", "", "只供人工研究。当前股票池回填存在幸存者偏差；完整模型继续由实时 Shadow 验证。"]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("--prices", type=Path, default=DEFAULT_PRICES); parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG); parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT); args = parser.parse_args()
    payload = generate(args.prices, args.config); atomic_write(args.output, payload); write_markdown(args.output.with_suffix(".md"), payload); print(f"style_oos_status={payload['status']} oos_samples={payload['sample_counts']['permanent_oos']}")
    return 0


if __name__ == "__main__": raise SystemExit(main())
