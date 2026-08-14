"""Research-only short-term plan engine with strict daily OHLCV gates."""
from __future__ import annotations
import argparse, json, math, tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from .short_term_daily_bars import validate_snapshot

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_CONFIG = ROOT / "data/short-term-trade-plan-v1.2.json"
DEFAULT_CANDIDATES = ROOT / "research/results/v3_1/idea-engine/latest-candidates.json"
DEFAULT_PRICES = ROOT / "data/short-term-daily-bars-v1.json"
DEFAULT_EVENTS = ROOT / "data/idea-engine-events-v1.json"
DEFAULT_GOVERNANCE = ROOT / "research/results/v3_1/idea-engine/shadow/governance-report.json"
DEFAULT_OUTPUT = ROOT / "research/results/v3_1/short-term-trade-plans-v1_2/latest.json"
DEFAULT_STYLE_OOS = ROOT / "research/results/v3_1/global-style-short-term-oos/latest.json"

def finite(value: Any) -> float | None:
    try: value = float(value)
    except (TypeError, ValueError): return None
    return value if math.isfinite(value) else None

def normalize_rows(value: Any) -> list[dict[str, Any]]:
    value = value.get("rows", []) if isinstance(value, dict) else value
    if not isinstance(value, list): return []
    rows = []
    for raw in value:
        if not isinstance(raw, dict): continue
        values = {key: finite(raw.get(key)) for key in ("open", "high", "low", "close", "volume")}
        # The strict snapshot validator requires adjusted; direct unit callers
        # may inject raw OHLCV only because this function does not certify a
        # production snapshot.
        values["adjusted"] = finite(raw.get("adjusted")) or values.get("close")
        if any(value is None or value <= 0 for value in values.values()): continue
        rows.append({"date": str(raw.get("date", ""))[:10], **values})
    return rows

def sma(values, period): return sum(values[-period:]) / period if len(values) >= period else None

def ema(values, period):
    if len(values) < period: return None
    result = sum(values[:period]) / period; multiplier = 2 / (period + 1)
    for value in values[period:]: result = (value - result) * multiplier + result
    return result

def atr(rows, period=14):
    if len(rows) < period + 1: return None
    ranges = []
    for index, row in enumerate(rows):
        previous = rows[index - 1]["close"] if index else row["close"]
        ranges.append(max(row["high"] - row["low"], abs(row["high"] - previous), abs(row["low"] - previous)))
    return sum(ranges[-period:]) / period

def pct_change(values, periods): return values[-1] / values[-periods - 1] - 1 if len(values) > periods and values[-periods - 1] > 0 else None

def sma_offset(values, period, offset=0):
    end = len(values) - int(offset)
    start = end - int(period)
    return sum(values[start:end]) / period if start >= 0 and end > start else None

def average(values):
    return sum(values) / len(values) if values else None

def window_range_pct(rows):
    if not rows: return None
    low = min(row["low"] for row in rows); high = max(row["high"] for row in rows)
    return (high - low) / low if low > 0 else None

def compute_indicators(rows, benchmark_rows, config=None):
    stock = normalize_rows(rows); benchmark = normalize_rows(benchmark_rows)
    # Unit-level indicator calculation accepts a shorter injected series; the
    # production generator enforces the 252-row snapshot gate above it.
    periods = [int(value) for value in (config or {}).get("indicators", {}).get("sma_periods", [10, 20, 50])]
    slope_lookback = int((config or {}).get("indicators", {}).get("sma200_slope_lookback", 0))
    required = max(60, max(periods) + slope_lookback)
    if len(stock) < required or len(benchmark) < required: raise ValueError("insufficient_daily_ohlcv_history")
    by_date = {row["date"]: row for row in benchmark}; stock = [row for row in stock if row["date"] in by_date]; benchmark = [by_date[row["date"]] for row in stock]
    if len(stock) < required: raise ValueError("insufficient_common_trading_dates")
    closes = [row["close"] for row in stock]; qqq = [row["close"] for row in benchmark]; current_atr = atr(stock, int((config or {}).get("indicators", {}).get("atr_period", 14)))
    if not current_atr or not math.isfinite(current_atr): raise ValueError("invalid_atr")
    sr5, sr20, qr5, qr20 = pct_change(closes, 5), pct_change(closes, 20), pct_change(qqq, 5), pct_change(qqq, 20)
    if None in (sr5, sr20, qr5, qr20): raise ValueError("insufficient_benchmark_history")
    avg_volume = sum(row["volume"] for row in stock[-21:-1]) / 20
    if avg_volume <= 0: raise ValueError("volume_history_unavailable")
    sma200 = sma(closes, 200); qqq_sma50 = sma(qqq, 50); qqq_sma200 = sma(qqq, 200)
    sma200_prior = sma_offset(closes, 200, slope_lookback) if slope_lookback else sma200
    qqq_sma200_prior = sma_offset(qqq, 200, slope_lookback) if slope_lookback else qqq_sma200
    contraction_days = int((config or {}).get("vcp_darvas", {}).get("contraction_window_days", 5))
    comparison_days = int((config or {}).get("vcp_darvas", {}).get("comparison_window_days", 10))
    recent_contract = stock[-contraction_days - 1:-1]
    prior_contract = stock[-contraction_days - comparison_days - 1:-contraction_days - 1]
    return {
        "signal_date": stock[-1]["date"], "current_close": closes[-1], "current_low": stock[-1]["low"], "previous_high": stock[-2]["high"], "atr14": current_atr,
        "sma10": sma(closes, 10), "sma20": sma(closes, 20), "sma50": sma(closes, 50), "sma200": sma200, "sma200_slope_20": (sma200 - sma200_prior) if sma200 is not None and sma200_prior is not None else None,
        "ema10": ema(closes, 10), "ema20": ema(closes, 20), "ema50": ema(closes, 50), "prior20_high": max(row["high"] for row in stock[-21:-1]), "recent10_low": min(row["low"] for row in stock[-10:]),
        "stock_return_5": sr5, "stock_return_20": sr20, "qqq_return_5": qr5, "qqq_return_20": qr20, "relative_return_5": sr5 - qr5, "relative_return_20": sr20 - qr20,
        "volume_ratio": stock[-1]["volume"] / avg_volume, "contraction_volume_ratio": average([row["volume"] for row in recent_contract]) / avg_volume,
        "recent_contraction_range_pct": window_range_pct(recent_contract), "prior_contraction_range_pct": window_range_pct(prior_contract),
        "distance_sma20_atr": (closes[-1] - sma(closes, 20)) / current_atr, "distance_prior_high_atr": (max(row["high"] for row in stock[-21:-1]) - closes[-1]) / current_atr,
        "qqq_close": qqq[-1], "qqq_sma20": sma(qqq, 20), "qqq_sma50": qqq_sma50, "qqq_sma200": qqq_sma200,
        "qqq_sma200_slope_20": (qqq_sma200 - qqq_sma200_prior) if qqq_sma200 is not None and qqq_sma200_prior is not None else None,
        "qqq_close_vs_sma20": qqq[-1] - (sma(qqq, 20) or qqq[-1]),
    }

def market_regime(indicators, config):
    if "market_regime" not in config: return {"state": "legacy", "risk_scale": 1.0, "passed": True}
    close, sma50, sma200, slope = (finite(indicators.get(key)) for key in ("qqq_close", "qqq_sma50", "qqq_sma200", "qqq_sma200_slope_20"))
    if None in (close, sma50, sma200, slope): return {"state": "red", "risk_scale": 0.0, "passed": False}
    if close > sma50 > sma200 and slope > 0: state = "green"
    elif close > sma200 and slope >= 0: state = "yellow"
    else: state = "red"
    return {"state": state, "risk_scale": float(config["market_regime"][f"{state}_risk_scale"]), "passed": state != "red"}

def style_signals(indicators, config):
    regime = market_regime(indicators, config)
    if "trend_template" not in config:
        breakout = indicators["current_close"] >= indicators["prior20_high"] + indicators["atr14"] * float(config["breakout"]["close_buffer_atr"]) and indicators["volume_ratio"] >= float(config["breakout"]["volume_ratio_min"]) and indicators["relative_return_5"] > 0 and indicators["relative_return_20"] > 0
        pullback = indicators["sma20"] > indicators["sma50"] and indicators["current_close"] > indicators["sma50"] and abs(indicators["current_close"] - indicators["sma20"]) <= indicators["atr14"] * float(config["pullback"]["touch_tolerance"])
        return {"market_regime": regime, "trend_template": True, "vcp_contraction": False, "volume_breakout": breakout, "trend_pullback": pullback, "triggered_model": "volume_breakout" if breakout else "trend_pullback" if pullback else None}
    trend = all([
        indicators["current_close"] > indicators["sma20"], indicators["sma20"] > indicators["sma50"], indicators["sma50"] > indicators["sma200"],
        indicators["sma200_slope_20"] > 0, indicators["relative_return_20"] > float(config["trend_template"]["minimum_relative_return_20"]),
    ])
    vcp = bool(
        trend and indicators["recent_contraction_range_pct"] <= indicators["prior_contraction_range_pct"] * float(config["vcp_darvas"]["maximum_range_ratio"])
        and indicators["contraction_volume_ratio"] <= float(config["vcp_darvas"]["maximum_dryup_volume_ratio"])
        and indicators["distance_prior_high_atr"] <= float(config["vcp_darvas"]["maximum_distance_to_prior_high_atr"])
    )
    breakout = bool(
        trend and regime["passed"] and indicators["current_close"] >= indicators["prior20_high"] + indicators["atr14"] * float(config["breakout"]["close_buffer_atr"])
        and indicators["volume_ratio"] >= float(config["breakout"]["volume_ratio_min"])
        and indicators["relative_return_5"] > float(config["breakout"]["min_relative_return_5"])
        and indicators["relative_return_20"] > float(config["breakout"]["min_relative_return_20"])
    )
    pullback = bool(
        trend and regime["passed"] and indicators["current_low"] <= indicators["sma20"] * (1 + float(config["pullback"]["touch_tolerance_pct"]))
        and indicators["current_close"] >= indicators["sma20"] and indicators["current_close"] > indicators["previous_high"]
        and indicators["volume_ratio"] <= float(config["pullback"]["maximum_volume_ratio"])
    )
    model = "vcp_darvas_breakout" if breakout and vcp else "oneil_volume_breakout" if breakout else "trend_pullback" if pullback else None
    return {"market_regime": regime, "trend_template": trend, "vcp_contraction": vcp, "volume_breakout": breakout, "trend_pullback": pullback, "triggered_model": model}

def next_business_day(value):
    current = date.fromisoformat(str(value)[:10]) + timedelta(days=1)
    while current.weekday() >= 5: current += timedelta(days=1)
    return current.isoformat()

def _event_gate(candidate, signal_date, config):
    event = candidate.get("event_dates") or candidate.get("events") or {}
    if not event: return "unknown", ["event_date_unknown"]
    earnings = event.get("earnings") if isinstance(event, dict) else None
    if not earnings: return "unknown", ["earnings_date_unknown"]
    try: days = (date.fromisoformat(str(earnings)[:10]) - date.fromisoformat(signal_date[:10])).days
    except ValueError: return "unknown", ["earnings_date_invalid"]
    return ("blocked", ["earnings_blackout_3_trading_days"]) if 0 <= days <= int(config["gates"]["earnings_blackout_trading_days"]) else ("clear", [])

def calculate_position_size(total_assets, cash, entry, stop, config, *, current_experiment_notional=0.0, risk_scale=1.0):
    assets, available, entry, stop = map(finite, (total_assets, cash, entry, stop))
    if None in (assets, available, entry, stop) or min(assets, available, entry) <= 0 or stop >= entry: return {"shares": None, "notional": 0.0, "binding_constraint": "missing_assets_cash_or_fx", "reason_codes": ["sizing_inputs_missing"]}
    scale = max(0.0, min(1.0, float(risk_scale))); risk = entry - stop; risk_budget = assets * float(config["sizing"]["risk_budget_pct_assets"]) * scale; maximum = min(assets * float(config["sizing"]["maximum_notional_pct_assets"]) * scale, assets * float(config["sizing"]["maximum_experiment_pct_assets"]) - current_experiment_notional, available); shares = max(0, math.floor(min(risk_budget / risk, maximum / entry)))
    return {"shares": shares, "notional": shares * entry, "risk_per_share": risk, "risk_budget": risk_budget, "risk_scale": scale, "binding_constraint": "risk_or_notional_or_cash", "reason_codes": [] if shares else ["minimum_position_not_reached"]}

def trailing_stop(entry_stop, highest_close, atr_value, recent10_low):
    values = [finite(entry_stop), finite(highest_close), finite(atr_value), finite(recent10_low)]
    if any(value is None for value in values): return None
    return max(values[0], values[1] - values[2] * 1.5, values[3])

def time_exit(days_held, reached_half_r, relative_positive):
    if int(days_held) >= 20: return "research_exit_review"
    if int(days_held) >= 10 and not reached_half_r and not relative_positive: return "ten_day_review"
    return None

def candidate_evidence_coverage(candidate):
    values = [candidate.get("evidence_coverage_score"), (candidate.get("data_quality") or {}).get("score_dimension_coverage", {}).get("percent")]
    return next((value for value in (finite(item) for item in values) if value is not None), 0.0)

def build_signal(indicators, signals, config):
    entry = indicators["current_close"]; atr_value = indicators["atr14"]
    structure_stop = indicators["recent10_low"] - atr_value * float(config["risk"]["structure_stop_atr"])
    volatility_stop = entry - atr_value * float(config["risk"]["volatility_stop_atr"])
    stop = max(structure_stop, volatility_stop)
    risk = entry - stop
    if risk <= 0: return None
    return {
        "signal_date": indicators["signal_date"], "earliest_execution_date": next_business_day(indicators["signal_date"]),
        "entry_reference": entry, "entry_range": [entry + atr_value * float(config["risk"]["entry_low_atr"]), entry + atr_value * float(config["risk"]["entry_high_atr"])],
        "chase_limit": entry + atr_value * float(config["risk"]["chase_limit_atr"]), "stop": stop,
        "targets": [entry + risk * float(value) for value in config["risk"]["target_r_multiples"]], "risk_per_share": risk,
        "model": signals["triggered_model"], "holding_window_days": [1, int(config.get("exit", {}).get("maximum_holding_days", 20))],
        "exit_rules": config.get("exit", {}), "style_fusion_version": config.get("style_fusion", {}).get("version"),
    }

def evaluate_plan(candidate, rows, benchmark_rows, config, *, as_of=None, portfolio=None, historical_oos=None):
    ticker = str(candidate.get("ticker") or "").upper(); schema = config.get("output_schema_version", "short-term-trade-plan-v1.1"); base = {"schema_version": schema, "ticker": ticker, "research_only": True, "no_trade": True, "status": "blocked", "status_label": "数据阻断", "reason_codes": [], "warnings": [], "signal": None, "execution": {"order_type": "limit", "regular_hours_only": bool(config.get("regular_hours_only", True)), "human_review_required": True}, "style_fusion": config.get("style_fusion"), "historical_oos": historical_oos or {"status": "unavailable", "passed": False}}
    if str(candidate.get("status")) not in config["gates"]["eligible_statuses"]: base["reason_codes"] = ["idea_status_not_eligible"]; base["status_label"] = "仅研究观察"; return base
    if candidate_evidence_coverage(candidate) < float(config["gates"].get("minimum_evidence_coverage", 0)): base["reason_codes"] = ["evidence_threshold_not_met"]; base["status_label"] = "证据覆盖不足"; return base
    try: indicators = compute_indicators(rows, benchmark_rows, config)
    except ValueError as error: base["reason_codes"] = [str(error)]; return base
    signal_date = indicators["signal_date"]
    if as_of and signal_date > str(as_of)[:10]: base["reason_codes"] = ["future_data_detected"]; return base
    if as_of and (date.fromisoformat(str(as_of)[:10]) - date.fromisoformat(signal_date)).days > int(config["gates"]["max_data_age_days"]): base["reason_codes"].append("stale_price_data")
    minimum_relative = float(config.get("trend_template", {}).get("minimum_relative_return_20", config["gates"].get("minimum_relative_return_20", 0)))
    if indicators["relative_return_20"] <= minimum_relative: base["reason_codes"].append("relative_qqq_gate_failed")
    event_status, event_reasons = _event_gate(candidate, signal_date, config); base["reason_codes"].extend(event_reasons)
    signals = style_signals(indicators, config); regime = signals["market_regime"]
    if not regime["passed"]: base["reason_codes"].append("qqq_market_state_blocked")
    base.update({"indicators": indicators, "event_status": event_status, "market_regime": regime, "trigger_models": signals})
    if event_status == "blocked": base.update(status="event_blocked", status_label="财报风险阻断"); return base
    if any(code in base["reason_codes"] for code in ("future_data_detected", "stale_price_data", "qqq_market_state_blocked", "relative_qqq_gate_failed")): return base
    if signals["triggered_model"]:
        signal = build_signal(indicators, signals, config)
        if not signal: base["reason_codes"].append("invalid_stop_structure"); return base
        risk_distance = signal["risk_per_share"] / indicators["current_close"] if config.get("style_fusion") else max(0.0, 1.0 - indicators["recent10_low"] / indicators["current_close"])
        if not float(config["risk"]["minimum_risk_pct"]) <= risk_distance <= float(config["risk"]["maximum_risk_pct"]):
            base["reason_codes"].append("risk_distance_out_of_bounds"); return base
        base["signal"] = signal; base["status"] = "simulation_only"; base["status_label"] = "仅研究演练"
        if not base["historical_oos"].get("passed"): base["warnings"].append("全球风格融合模型尚未通过历史OOS门禁")
        base["warnings"].append("Shadow治理尚未成熟，仅供研究演练")
    elif signals["vcp_contraction"]:
        base["status"] = "waiting_breakout"; base["status_label"] = "VCP收缩完成，等待放量突破"
    elif signals["trend_template"]:
        base["status"] = "waiting_pullback"; base["status_label"] = "趋势通过，等待回踩或突破"
    else:
        base["status"] = "waiting_trigger"; base["status_label"] = "趋势模板尚未通过"; base["reason_codes"].append("trend_template_failed")
    base["reason_codes"] = list(dict.fromkeys(base["reason_codes"] + ([] if signals["triggered_model"] else ["no_trigger"])))
    return base

def atomic_write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False, suffix=".tmp") as handle: json.dump(payload, handle, ensure_ascii=False, indent=2); handle.write("\n"); temp = Path(handle.name)
    temp.replace(path)

def relevant_validation_errors(errors, ticker, benchmark="QQQ"):
    ticker = str(ticker or "").upper(); benchmark = str(benchmark or "QQQ").upper()
    return [error for error in errors if error.startswith(f"{ticker}:") or error.startswith(f"{benchmark}:") or ":" not in error]

def event_dates_by_ticker(payload):
    rows = payload.get("events", []) if isinstance(payload, dict) and payload.get("research_only") is True else []
    output = {}
    for row in rows if isinstance(rows, list) else []:
        ticker = str(row.get("ticker") or "").upper() if isinstance(row, dict) else ""
        if ticker:
            output[ticker] = {key: row.get(key) for key in ("earnings",) if row.get(key)}
    return output

def generate(candidates_path=DEFAULT_CANDIDATES, prices_path=DEFAULT_PRICES, config_path=DEFAULT_CONFIG, output_path=DEFAULT_OUTPUT, *, as_of=None, events_path=DEFAULT_EVENTS, governance_path=DEFAULT_GOVERNANCE, style_oos_path=DEFAULT_STYLE_OOS):
    config = json.loads(config_path.read_text(encoding="utf-8")); candidates = json.loads(candidates_path.read_text(encoding="utf-8")); prices = json.loads(prices_path.read_text(encoding="utf-8")); governance = json.loads(governance_path.read_text(encoding="utf-8")) if governance_path.exists() else {"status": "blocked", "manual_review_eligible": False, "reason": "Shadow治理报告缺失"}; events = json.loads(events_path.read_text(encoding="utf-8")) if events_path.exists() else {}
    symbols = [str(row.get("ticker", "")).upper() for row in candidates.get("candidates", []) if row.get("ticker")]; effective_as_of = as_of or candidates.get("as_of") or datetime.now(timezone.utc).isoformat(); validation = validate_snapshot(prices, symbols, benchmark=config.get("benchmark", "QQQ"), as_of=effective_as_of); rows_by_symbol = prices.get("symbols", {}); benchmark = rows_by_symbol.get(config.get("benchmark", "QQQ"), {})
    event_map = event_dates_by_ticker(events); style_oos = json.loads(style_oos_path.read_text(encoding="utf-8")) if style_oos_path.exists() else {}
    oos_mappings = style_oos.get("current_mappings", {}) if style_oos.get("schema_version") == "global-style-short-term-oos-v1" else {}
    plans = [evaluate_plan({**candidate, "event_dates": event_map.get(str(candidate.get("ticker") or "").upper(), candidate.get("event_dates") or {})}, rows_by_symbol.get(candidate.get("ticker"), {}), benchmark, config, as_of=effective_as_of, historical_oos=oos_mappings.get(str(candidate.get("ticker") or "").upper())) for candidate in candidates.get("candidates", [])]
    if governance.get("manual_review_eligible") is True:
        for plan in plans:
            if plan["status"] == "simulation_only" and plan.get("historical_oos", {}).get("passed") is True:
                plan["status"] = "conditional_review"
                plan["status_label"] = "历史与实时门禁均通过，待人工确认"
    for plan in plans:
        ticker = plan["ticker"]
        ticker_errors = relevant_validation_errors(validation["errors"], ticker, config.get("benchmark", "QQQ"))
        if ticker_errors:
            plan.update(status="blocked", status_label="数据阻断", signal=None, reason_codes=list(dict.fromkeys(["short_term_daily_bars_unavailable", *ticker_errors])), warnings=["缺少经过验证的日线OHLCV数据；不生成短线交易研究触发建议"])
    statuses = ("conditional_review", "manual_review_ready", "simulation_only", "waiting_trigger", "waiting_breakout", "waiting_pullback", "chase_blocked", "event_blocked", "invalidated", "blocked")
    governance_keys = ("status", "observation_count", "calendar_week_count", "complete_count", "primary_complete_count", "manual_review_requirements", "reliability_requirements", "manual_review_eligible", "reliability_claim_eligible", "reason")
    return {"schema_version": config.get("output_schema_version", "short-term-trade-plan-v1.1"), "methodology_version": "global-style-short-term-v1.2.0" if config.get("style_fusion") else "short-term-trade-plan-v1.1.0", "generated_at": datetime.now(timezone.utc).isoformat(), "as_of": effective_as_of, "research_only": True, "no_trade": True, "benchmark": "QQQ", "config_version": config["schema_version"], "style_fusion": config.get("style_fusion"), "historical_oos_status": style_oos.get("status", "unavailable"), "shadow_governance": {key: governance.get(key) for key in governance_keys}, "data_validation": {"valid": validation["valid"], "errors": validation["errors"], "coverage": validation["coverage"], "common_dates": validation.get("common_dates", 0)}, "plans": plans, "summary": {"candidate_count": len(plans), "status_counts": {status: sum(plan["status"] == status for plan in plans) for status in statuses}, "manual_review_required": True}}

def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--candidates", type=Path, default=DEFAULT_CANDIDATES); parser.add_argument("--prices", type=Path, default=DEFAULT_PRICES); parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG); parser.add_argument("--events", type=Path, default=DEFAULT_EVENTS); parser.add_argument("--governance", type=Path, default=DEFAULT_GOVERNANCE); parser.add_argument("--style-oos", type=Path, default=DEFAULT_STYLE_OOS); parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT); parser.add_argument("--as-of", default=None); args = parser.parse_args(); atomic_write(args.output, generate(args.candidates, args.prices, args.config, args.output, as_of=args.as_of, events_path=args.events, governance_path=args.governance, style_oos_path=args.style_oos))

if __name__ == "__main__": main()
