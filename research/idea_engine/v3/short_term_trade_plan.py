"""Deterministic, research-only short-term trade-plan layer.

This module describes human review candidates. It never creates, submits, or
routes an order and deliberately returns no executable instruction.
"""
from __future__ import annotations

import argparse
import json
import math
import tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
DEFAULT_CONFIG = ROOT / "data" / "short-term-trade-plan-v1.json"
DEFAULT_CANDIDATES = ROOT / "research" / "results" / "v3_1" / "idea-engine" / "latest-candidates.json"
DEFAULT_PRICES = ROOT / "data" / "research-prices.json"
DEFAULT_OUTPUT = ROOT / "research" / "results" / "v3_1" / "short-term-trade-plans" / "latest.json"


def finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def normalize_rows(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, dict):
        value = value.get("rows") or value.get("points") or value.get("data") or []
    if not isinstance(value, list):
        return []
    rows: list[dict[str, Any]] = []
    for raw in value:
        if not isinstance(raw, dict):
            continue
        close = finite(raw.get("close"))
        if close is None or close <= 0:
            continue
        rows.append({
            "date": str(raw.get("date") or raw.get("time") or ""),
            "open": finite(raw.get("open")),
            "high": finite(raw.get("high")) or close,
            "low": finite(raw.get("low")) or close,
            "close": close,
            "volume": finite(raw.get("volume")),
        })
    return rows


def sma(values: list[float], period: int) -> float | None:
    if len(values) < period:
        return None
    return sum(values[-period:]) / period


def ema(values: list[float], period: int) -> float | None:
    if len(values) < period:
        return None
    result = sum(values[:period]) / period
    multiplier = 2 / (period + 1)
    for value in values[period:]:
        result = (value - result) * multiplier + result
    return result


def atr(rows: list[dict[str, Any]], period: int = 14) -> float | None:
    if len(rows) < period + 1:
        return None
    true_ranges = []
    for index, row in enumerate(rows):
        previous_close = rows[index - 1]["close"] if index else row["close"]
        true_ranges.append(max(row["high"] - row["low"], abs(row["high"] - previous_close), abs(row["low"] - previous_close)))
    return sum(true_ranges[-period:]) / period


def pct_change(values: list[float], periods: int) -> float | None:
    if len(values) <= periods or values[-periods - 1] <= 0:
        return None
    return values[-1] / values[-periods - 1] - 1


def compute_indicators(rows: Any, benchmark_rows: Any, config: dict[str, Any] | None = None) -> dict[str, Any]:
    stock = normalize_rows(rows)
    benchmark = normalize_rows(benchmark_rows)
    if len(stock) < 55 or len(benchmark) < 21:
        raise ValueError("insufficient_price_history")
    closes = [row["close"] for row in stock]
    benchmark_closes = [row["close"] for row in benchmark]
    current_atr = atr(stock, int((config or {}).get("indicators", {}).get("atr_period", 14)))
    if current_atr is None or not math.isfinite(current_atr) or current_atr <= 0:
        raise ValueError("invalid_atr")
    stock_return_5 = pct_change(closes, 5)
    stock_return_20 = pct_change(closes, 20)
    qqq_return_5 = pct_change(benchmark_closes, 5)
    qqq_return_20 = pct_change(benchmark_closes, 20)
    if None in (stock_return_5, stock_return_20, qqq_return_5, qqq_return_20):
        raise ValueError("insufficient_benchmark_history")
    volume_values = [row["volume"] for row in stock if row.get("volume") is not None]
    average_volume = sum(volume_values[-21:-1]) / 20 if len(volume_values) >= 21 else None
    return {
        "signal_date": stock[-1]["date"],
        "current_close": closes[-1],
        "atr14": current_atr,
        "sma10": sma(closes, 10), "sma20": sma(closes, 20), "sma50": sma(closes, 50),
        "ema10": ema(closes, 10), "ema20": ema(closes, 20), "ema50": ema(closes, 50),
        "prior20_high": max(row["high"] for row in stock[-21:-1]),
        "recent10_low": min(row["low"] for row in stock[-10:]),
        "stock_return_5": stock_return_5, "stock_return_20": stock_return_20,
        "qqq_return_5": qqq_return_5, "qqq_return_20": qqq_return_20,
        "relative_return_5": stock_return_5 - qqq_return_5,
        "relative_return_20": stock_return_20 - qqq_return_20,
        "volume_ratio": closes[-1] / closes[-1] if average_volume is None else (stock[-1].get("volume") or 0) / average_volume,
        "distance_sma20_atr": (closes[-1] - sma(closes, 20)) / current_atr,
        "qqq_close_vs_sma20": benchmark_closes[-1] - (sma(benchmark_closes, 20) or benchmark_closes[-1]),
    }


def next_business_day(value: str) -> str:
    try:
        current = date.fromisoformat(value[:10])
    except ValueError:
        current = date.today()
    current += timedelta(days=1)
    while current.weekday() >= 5:
        current += timedelta(days=1)
    return current.isoformat()


def _event_gate(candidate: dict[str, Any], signal_date: str, config: dict[str, Any]) -> tuple[str, list[str]]:
    event = candidate.get("event_dates") or candidate.get("events") or {}
    if not event:
        return "unknown", ["event_date_unknown"]
    earnings = event.get("earnings") if isinstance(event, dict) else None
    if not earnings:
        return "unknown", ["earnings_date_unknown"]
    try:
        days = (date.fromisoformat(str(earnings)[:10]) - date.fromisoformat(signal_date[:10])).days
    except ValueError:
        return "unknown", ["earnings_date_invalid"]
    return ("blocked", ["earnings_blackout_3_trading_days"] if 0 <= days <= int(config["gates"]["earnings_blackout_trading_days"]) else []) if 0 <= days <= int(config["gates"]["earnings_blackout_trading_days"]) else ("clear", [])


def calculate_position_size(total_assets: Any, cash: Any, entry: Any, stop: Any, config: dict[str, Any], *, current_experiment_notional: float = 0.0) -> dict[str, Any]:
    assets = finite(total_assets); available_cash = finite(cash); entry_price = finite(entry); stop_price = finite(stop)
    if None in (assets, available_cash, entry_price, stop_price) or min(assets, available_cash, entry_price) <= 0 or stop_price >= entry_price:
        return {"shares": None, "notional": 0.0, "binding_constraint": "missing_assets_cash_or_fx", "reason_codes": ["sizing_inputs_missing"]}
    per_share_risk = entry_price - stop_price
    risk_budget = assets * float(config["sizing"]["risk_budget_pct_assets"])
    max_notional = min(assets * float(config["sizing"]["maximum_notional_pct_assets"]), assets * float(config["sizing"]["maximum_experiment_pct_assets"]) - current_experiment_notional, available_cash)
    shares = max(0, math.floor(min(risk_budget / per_share_risk, max_notional / entry_price)))
    return {"shares": shares, "notional": shares * entry_price, "risk_per_share": per_share_risk, "risk_budget": risk_budget, "binding_constraint": "risk_or_notional_or_cash", "reason_codes": [] if shares else ["minimum_position_not_reached"]}


def evaluate_plan(candidate: dict[str, Any], rows: Any, benchmark_rows: Any, config: dict[str, Any], *, as_of: str | None = None, portfolio: dict[str, Any] | None = None) -> dict[str, Any]:
    ticker = str(candidate.get("ticker") or "").upper()
    base = {"schema_version": "short-term-trade-plan-v1", "ticker": ticker, "research_only": True, "no_trade": True, "event_trade": False, "status": "blocked", "status_label": "数据阻断", "reason_codes": [], "warnings": [], "signal": None, "execution": {"order_type": "limit", "human_review_required": True}}
    if str(candidate.get("status")) not in config["gates"]["eligible_statuses"]:
        base["reason_codes"].append("idea_status_not_eligible"); base["status_label"] = "仅作观察"; return base
    if float(candidate.get("evidence_coverage_score") or 0) < float(config["gates"]["minimum_evidence_coverage"]):
        base["reason_codes"].append("evidence_threshold_not_met"); base["status_label"] = "证据不足，仅作观察"; return base
    try:
        indicators = compute_indicators(rows, benchmark_rows, config)
    except ValueError as error:
        base["reason_codes"].append(str(error)); base["status_label"] = "数据阻断"; return base
    signal_date = indicators["signal_date"]
    if as_of and signal_date[:10] > str(as_of)[:10]:
        base["reason_codes"].append("future_data_detected"); base["status_label"] = "未来数据阻断"; return base
    if as_of:
        try:
            age = (date.fromisoformat(str(as_of)[:10]) - date.fromisoformat(signal_date[:10])).days
            if age > int(config["gates"]["max_data_age_days"]): base["reason_codes"].append("stale_price_data")
        except ValueError: base["reason_codes"].append("as_of_invalid")
    if indicators["relative_return_20"] <= float(config["gates"]["minimum_relative_return_20"]): base["reason_codes"].append("relative_qqq_gate_failed")
    event_status, event_reasons = _event_gate(candidate, signal_date, config); base["reason_codes"].extend(event_reasons)
    if indicators["qqq_close_vs_sma20"] <= 0: base["reason_codes"].append("qqq_market_state_blocked")
    breakout = indicators["current_close"] >= indicators["prior20_high"] + indicators["atr14"] * float(config["breakout"]["close_buffer_atr"]) and indicators["volume_ratio"] >= float(config["breakout"]["volume_ratio_min"]) and indicators["relative_return_5"] > 0 and indicators["relative_return_20"] > 0
    pullback = indicators["sma20"] > indicators["sma50"] and indicators["current_close"] > indicators["sma50"] and (abs(indicators["current_close"] - indicators["sma20"]) <= indicators["atr14"] * float(config["pullback"]["touch_tolerance"]) or abs(indicators["current_close"] - indicators["ema20"]) <= indicators["atr14"] * float(config["pullback"]["touch_tolerance"]))
    models = []
    if breakout: models.append(("breakout", indicators["recent10_low"] - indicators["atr14"] * float(config["risk"]["structure_stop_atr"])))
    if pullback: models.append(("pullback", indicators["recent10_low"] - indicators["atr14"] * float(config["risk"]["structure_stop_atr"])))
    chosen = None
    if models:
        chosen = sorted(models, key=lambda item: (indicators["current_close"] - item[1], -2.5))[0]
    reasons = list(base["reason_codes"])
    if chosen is None: reasons.append("no_trigger")
    base["reason_codes"] = list(dict.fromkeys(reasons)); base["indicators"] = indicators; base["event_status"] = event_status; base["trigger_models"] = {"breakout": breakout, "pullback": pullback}
    if chosen:
        model, structure_stop = chosen; entry = indicators["current_close"]; volatility_stop = entry - indicators["atr14"] * float(config["risk"]["volatility_stop_atr"]); stop = max(structure_stop, volatility_stop); risk_pct = (entry - stop) / entry
        base["signal"] = {"model": model, "signal_date": signal_date, "entry_reference": entry, "entry_range": [entry + indicators["atr14"] * float(config["risk"]["entry_low_atr"]), entry + indicators["atr14"] * float(config["risk"]["entry_high_atr"])], "chase_limit": entry + indicators["atr14"] * float(config["risk"]["chase_limit_atr"]), "stop": stop, "stop_method": "stricter_of_structure_and_volatility", "risk_pct": risk_pct, "risk_per_share": entry - stop, "targets": [entry + (entry - stop) * multiple for multiple in config["risk"]["target_r_multiples"]], "risk_reward_ratio": config["risk"]["target_r_multiples"][-1], "earliest_execution_date": next_business_day(signal_date), "choice_reason": "同时触发时选择风险更低且收益风险比不低于另一模型的模型" if len(models) > 1 else "满足单一模型触发条件"}
    if base["reason_codes"] and any(code in base["reason_codes"] for code in ("future_data_detected", "stale_price_data", "qqq_market_state_blocked", "relative_qqq_gate_failed", "earnings_blackout_3_trading_days")):
        base["status"] = "blocked"; base["status_label"] = "安全门禁阻断"; base["signal"] = None
    elif chosen and event_status == "unknown":
        base["status"] = "simulation_only"; base["status_label"] = "仅作研究演练"; base["warnings"].append("事件日期未知，仅可模拟")
    elif chosen:
        base["status"] = "conditional_review" if config["shadow"]["mature"] else "simulation_only"; base["status_label"] = "条件满足，待人工确认" if config["shadow"]["mature"] else "仅作研究演练"
    else:
        base["status"] = "waiting_trigger"; base["status_label"] = "等待触发"
    if portfolio and base.get("signal"):
        base["sizing"] = calculate_position_size(portfolio.get("total_assets"), portfolio.get("cash"), base["signal"]["entry_reference"], base["signal"]["stop"], config, current_experiment_notional=portfolio.get("experiment_notional", 0))
    else:
        base["sizing"] = calculate_position_size(None, None, None, None, config)
    base["execution"].update({"order_type": "limit", "whole_share_first": True, "fractional_order": False, "regular_hours_only": True, "private_api": False, "warnings": ["不创建订单；仅供人工核对", "止损需人工执行，可能存在滑点"]})
    return base


def atomic_write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False, suffix=".tmp") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2); handle.write("\n"); temp = Path(handle.name)
    temp.replace(path)


def generate(candidates_path: Path = DEFAULT_CANDIDATES, prices_path: Path = DEFAULT_PRICES, config_path: Path = DEFAULT_CONFIG, output_path: Path = DEFAULT_OUTPUT, *, as_of: str | None = None) -> dict[str, Any]:
    config = json.loads(config_path.read_text(encoding="utf-8")); candidates = json.loads(candidates_path.read_text(encoding="utf-8")); prices = json.loads(prices_path.read_text(encoding="utf-8"))
    rows_by_symbol = prices.get("symbols", {})
    benchmark = rows_by_symbol.get(config["benchmark"], {})
    effective_as_of = as_of or candidates.get("as_of") or datetime.now(timezone.utc).isoformat()
    plans = [evaluate_plan(candidate, rows_by_symbol.get(candidate.get("ticker"), {}), benchmark, config, as_of=effective_as_of) for candidate in candidates.get("candidates", [])]
    return {"schema_version": "short-term-trade-plan-v1", "methodology_version": "short-term-trade-plan-v1.0.0", "generated_at": datetime.now(timezone.utc).isoformat(), "as_of": effective_as_of, "research_only": True, "no_trade": True, "benchmark": "QQQ", "config_version": config["schema_version"], "shadow_mature": bool(config["shadow"]["mature"]), "plans": plans, "summary": {"candidate_count": len(plans), "status_counts": {status: sum(1 for plan in plans if plan["status"] == status) for status in ("conditional_review", "simulation_only", "waiting_trigger", "blocked")}, "manual_review_required": True}}


def main() -> None:
    parser = argparse.ArgumentParser(); parser.add_argument("--candidates", type=Path, default=DEFAULT_CANDIDATES); parser.add_argument("--prices", type=Path, default=DEFAULT_PRICES); parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG); parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT); parser.add_argument("--as-of", default=None); args = parser.parse_args(); payload = generate(args.candidates, args.prices, args.config, args.output, as_of=args.as_of); atomic_write(args.output, payload); print(f"short_term_plans={len(payload['plans'])}")


if __name__ == "__main__": main()
