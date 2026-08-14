"""Research-only short-term plan engine with strict daily OHLCV gates."""
from __future__ import annotations
import argparse, json, math, tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from .short_term_daily_bars import validate_snapshot

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_CONFIG = ROOT / "data/short-term-trade-plan-v1.3.json"
DEFAULT_CANDIDATES = ROOT / "research/results/v3_1/idea-engine/latest-candidates.json"
DEFAULT_PRICES = ROOT / "data/short-term-daily-bars-v1.json"
DEFAULT_EVENTS = ROOT / "data/idea-engine-events-v1.json"
DEFAULT_GOVERNANCE = ROOT / "research/results/v3_1/idea-engine/shadow/governance-report.json"
DEFAULT_OUTPUT = ROOT / "research/results/v3_1/short-term-trade-plans-v1_3/latest.json"
DEFAULT_STYLE_OOS = ROOT / "research/results/v3_1/global-style-short-term-oos-v1_3/latest.json"
STRATEGY_IDS = ("oneil_volume_breakout", "trend_pullback", "vcp_darvas_breakout")

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
    triggered_models = [model for model, passed in (("oneil_volume_breakout", breakout), ("trend_pullback", pullback), ("vcp_darvas_breakout", breakout and vcp)) if passed]
    model = "vcp_darvas_breakout" if "vcp_darvas_breakout" in triggered_models else triggered_models[0] if triggered_models else None
    return {"market_regime": regime, "trend_template": trend, "vcp_contraction": vcp, "volume_breakout": breakout, "trend_pullback": pullback, "triggered_models": triggered_models, "triggered_model": model}

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

def research_eligibility(candidate, config, *, as_of=None):
    """Separate company-research grade from historical price-timing eligibility."""
    grade = str(candidate.get("status") or "")
    historical_status = str(candidate.get("historical_screen_status") or "")
    reference = candidate.get("historical_oos_reference") or {}
    blocked_reason = {
        "VALUATION_GATED": "valuation_gate_not_eligible",
        "EXPOSURE_UNPROVEN": "exposure_not_proven",
        "REJECTED": "research_candidate_rejected",
        "C_SCREEN": "historical_screen_not_eligible",
    }.get(grade, "idea_status_not_eligible")
    base = {
        "allowed": False,
        "mode": "blocked",
        "reason_code": blocked_reason,
        "research_grade": grade,
        "historical_screen_status": historical_status or "HISTORICAL_UNAVAILABLE",
        "historical_evidence_status": str(reference.get("evidence_status") or "unavailable"),
        "preserves_research_grade": True,
        "maximum_action": "blocked",
    }
    if grade in config.get("gates", {}).get("eligible_statuses", []):
        return {**base, "allowed": True, "mode": "research_grade", "reason_code": None, "maximum_action": "manual_research_review"}

    override = config.get("gates", {}).get("historical_screen_override") or {}
    if override.get("enabled") is not True or grade not in override.get("eligible_idea_statuses", []):
        return base
    if historical_status not in override.get("eligible_historical_screen_statuses", []):
        return base
    if base["historical_evidence_status"] not in override.get("eligible_evidence_statuses", []):
        return base
    policy = candidate.get("historical_selection_policy") or {}
    if str(policy.get("primary_reference") or "") != str(override.get("required_primary_reference") or ""):
        return base
    required_metrics = override.get("required_reference_metrics", [])
    if any(finite(reference.get(metric)) is None for metric in required_metrics):
        return base
    if finite(reference.get("oos_samples")) < float(override.get("minimum_oos_samples", 0)):
        return base
    if finite(reference.get("oos_origin_dates")) < float(override.get("minimum_oos_origin_dates", 0)):
        return base
    mean_return = finite(reference.get("mean_oos_net_relative_return"))
    if override.get("require_positive_mean_net_relative_return") is True and (mean_return is None or mean_return <= 0):
        return base
    try:
        reference_date = date.fromisoformat(str(reference.get("as_of") or "")[:10])
        evaluation_date = date.fromisoformat(str(as_of or candidate.get("as_of") or "")[:10])
    except ValueError:
        return base
    if reference_date > evaluation_date:
        return base
    return {
        **base,
        "allowed": True,
        "mode": "historical_screen_override",
        "reason_code": None,
        "maximum_action": str(override.get("maximum_action") or "research_scenarios_only"),
    }

def _check(code, label, passed, current, required):
    return {"code": code, "label": label, "passed": bool(passed), "current": current, "required": required}

def strategy_condition_checks(indicators, signals, config, model):
    trend_checks = [
        _check("close_above_sma20", "收盘价高于 SMA20", indicators["current_close"] > indicators["sma20"], indicators["current_close"], f"> {indicators['sma20']:.2f}"),
        _check("sma20_above_sma50", "SMA20 高于 SMA50", indicators["sma20"] > indicators["sma50"], indicators["sma20"], f"> {indicators['sma50']:.2f}"),
        _check("sma50_above_sma200", "SMA50 高于 SMA200", indicators["sma50"] > indicators["sma200"], indicators["sma50"], f"> {indicators['sma200']:.2f}"),
        _check("sma200_rising", "SMA200 保持上升", indicators["sma200_slope_20"] > 0, indicators["sma200_slope_20"], "> 0"),
        _check("relative_qqq_20_positive", "20 日相对 QQQ 强度为正", indicators["relative_return_20"] > 0, indicators["relative_return_20"], "> 0"),
        _check("market_regime", "大盘环境允许新开多仓", signals["market_regime"]["passed"], signals["market_regime"]["state"], "green / yellow"),
    ]
    breakout_price = indicators["prior20_high"] + indicators["atr14"] * float(config["breakout"]["close_buffer_atr"])
    breakout_checks = [
        _check("breakout_price", "收盘突破参考价", indicators["current_close"] >= breakout_price, indicators["current_close"], f">= {breakout_price:.2f}"),
        _check("breakout_volume", "成交量确认", indicators["volume_ratio"] >= float(config["breakout"]["volume_ratio_min"]), indicators["volume_ratio"], f">= {float(config['breakout']['volume_ratio_min']):.2f}x"),
        _check("relative_qqq_5_positive", "5 日相对 QQQ 强度为正", indicators["relative_return_5"] > 0, indicators["relative_return_5"], "> 0"),
    ]
    if model == "oneil_volume_breakout":
        return trend_checks + breakout_checks
    if model == "trend_pullback":
        touch_limit = indicators["sma20"] * (1 + float(config["pullback"]["touch_tolerance_pct"]))
        return trend_checks + [
            _check("pullback_touch", "盘中回踩 SMA20 附近", indicators["current_low"] <= touch_limit, indicators["current_low"], f"<= {touch_limit:.2f}"),
            _check("pullback_reclaim", "收盘重新站上 SMA20", indicators["current_close"] >= indicators["sma20"], indicators["current_close"], f">= {indicators['sma20']:.2f}"),
            _check("pullback_confirmation", "收盘高于前一日高点", indicators["current_close"] > indicators["previous_high"], indicators["current_close"], f"> {indicators['previous_high']:.2f}"),
            _check("pullback_volume", "回踩成交量不过热", indicators["volume_ratio"] <= float(config["pullback"]["maximum_volume_ratio"]), indicators["volume_ratio"], f"<= {float(config['pullback']['maximum_volume_ratio']):.2f}x"),
        ]
    range_limit = indicators["prior_contraction_range_pct"] * float(config["vcp_darvas"]["maximum_range_ratio"])
    return trend_checks + [
        _check("vcp_range_contract", "波动区间收缩", indicators["recent_contraction_range_pct"] <= range_limit, indicators["recent_contraction_range_pct"], f"<= {range_limit:.4f}"),
        _check("vcp_volume_dryup", "收缩期成交量萎缩", indicators["contraction_volume_ratio"] <= float(config["vcp_darvas"]["maximum_dryup_volume_ratio"]), indicators["contraction_volume_ratio"], f"<= {float(config['vcp_darvas']['maximum_dryup_volume_ratio']):.2f}x"),
        _check("vcp_near_high", "价格接近箱体上沿", indicators["distance_prior_high_atr"] <= float(config["vcp_darvas"]["maximum_distance_to_prior_high_atr"]), indicators["distance_prior_high_atr"], f"<= {float(config['vcp_darvas']['maximum_distance_to_prior_high_atr']):.2f} ATR"),
        *breakout_checks,
    ]

def strategy_triggered(signals, model):
    return model in signals.get("triggered_models", []) or signals.get("triggered_model") == model

def build_signal(indicators, signals, config, model=None, *, triggered=True):
    model = model or signals.get("triggered_model")
    atr_value = indicators["atr14"]
    breakout_reference = indicators["prior20_high"] + atr_value * float(config["breakout"]["close_buffer_atr"])
    if model == "trend_pullback":
        planned_reference = max(indicators["sma20"], indicators["previous_high"] + float(config.get("execution", {}).get("default_tick_size", 0.01)))
    else:
        planned_reference = breakout_reference
    entry = indicators["current_close"] if triggered else planned_reference
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
        "model": model, "holding_window_days": [1, int(config.get("exit", {}).get("maximum_holding_days", 20))],
        "trigger_price": planned_reference, "prediction_calibrated": False,
        "directional_hypothesis": "仅当全部条件触发后观察上行延续；未触发时不作方向预测",
        "exit_rules": config.get("exit", {}), "style_fusion_version": config.get("style_fusion", {}).get("version"),
    }

def blocked_strategy_rows(config, reasons):
    return [{"strategy_id": model, "label": config.get("strategy_labels", {}).get(model, model), "status": "blocked", "status_label": "研究条件阻断", "triggered": False, "condition_checks": [], "missing_conditions": list(reasons), "entry_plan": None, "historical_oos": {"passed": False, "status": "unavailable"}, "prediction_calibrated": False, "research_selection_allowed": False, "execution_ready": False} for model in config.get("strategy_order", STRATEGY_IDS)]

def build_strategy_rows(indicators, signals, config, historical_oos_by_model, governance, global_blockers, eligibility=None):
    rows = []
    labels = config.get("strategy_labels", {})
    eligibility = eligibility or {"mode": "research_grade", "research_grade": ""}
    historical_override = eligibility.get("mode") == "historical_screen_override"
    for model in config.get("strategy_order", STRATEGY_IDS):
        checks = strategy_condition_checks(indicators, signals, config, model)
        triggered = strategy_triggered(signals, model)
        evidence = dict(historical_oos_by_model.get(model) or {})
        oos_passed = evidence.get("passed") is True
        evidence_tier = str(evidence.get("evidence_tier") or ("validated" if oos_passed else "unavailable"))
        oos_provisional = evidence_tier == "provisional_positive"
        signal = build_signal(indicators, signals, config, model, triggered=triggered)
        risk_distance = signal["risk_per_share"] / signal["entry_reference"] if signal else None
        local_reasons = list(global_blockers)
        if signal is None: local_reasons.append("invalid_stop_structure")
        elif not float(config["risk"]["minimum_risk_pct"]) <= risk_distance <= float(config["risk"]["maximum_risk_pct"]): local_reasons.append("risk_distance_out_of_bounds")
        if local_reasons:
            status, status_label = "blocked", "研究条件阻断"
        elif not triggered:
            status, status_label = "waiting", "等待全部条件触发"
        elif not oos_passed and not oos_provisional:
            status, status_label = "historical_edge_failed", "已触发但历史优势未通过"
        elif governance.get("manual_review_eligible") is True and not historical_override:
            status, status_label = "conditional_review", "正式门禁通过，待人工复核"
        elif oos_passed:
            status, status_label = "historical_review", "历史 OOS 已通过，可人工研究"
        elif oos_provisional:
            status, status_label = "historical_watch", "历史 OOS 初步为正，仅供观察"
        elif governance.get("preliminary_review_eligible") is True:
            status, status_label = "preliminary_review", "初步门禁通过，仅可人工研究"
        else:
            status, status_label = "triggered_simulation", "条件已触发，仅作模拟"
        rows.append({
            "strategy_id": model, "label": labels.get(model, model), "status": status, "status_label": status_label,
            "triggered": triggered, "condition_checks": checks,
            "missing_conditions": [item["code"] for item in checks if not item["passed"]] + local_reasons,
            "entry_plan": signal, "historical_oos": {**evidence, "passed": oos_passed, "status": "passed" if oos_passed else "provisional_positive" if oos_provisional else "failed_or_insufficient"},
            "prediction_calibrated": False, "research_selection_allowed": status != "blocked", "execution_ready": False,
            "shadow_validation_status": "monitoring" if historical_override else "mature" if governance.get("manual_review_eligible") is True else "monitoring",
            "research_eligibility_mode": eligibility.get("mode"),
            "research_grade": eligibility.get("research_grade"),
        })
    return rows

def evaluate_three_strategy_plan(candidate, rows, benchmark_rows, config, *, as_of=None, historical_oos_by_model=None, governance=None):
    ticker = str(candidate.get("ticker") or "").upper(); governance = governance or {}; historical_oos_by_model = historical_oos_by_model or {}
    eligibility = research_eligibility(candidate, config, as_of=as_of)
    base = {"schema_version": config["output_schema_version"], "ticker": ticker, "research_only": True, "no_trade": True, "status": "blocked", "status_label": "数据阻断", "reason_codes": [], "warnings": [], "signal": None, "strategies": [], "research_grade": eligibility["research_grade"], "research_eligibility": eligibility, "execution": {"order_type": "limit", "regular_hours_only": True, "human_review_required": True}, "style_fusion": config.get("style_fusion")}
    if eligibility["allowed"] is not True:
        base["reason_codes"] = [eligibility.get("reason_code") or "idea_status_not_eligible"]; base["strategies"] = blocked_strategy_rows(config, base["reason_codes"]); return base
    if candidate_evidence_coverage(candidate) < float(config["gates"]["minimum_evidence_coverage"]):
        base["reason_codes"] = ["evidence_threshold_not_met"]; base["strategies"] = blocked_strategy_rows(config, base["reason_codes"]); return base
    try: indicators = compute_indicators(rows, benchmark_rows, config)
    except ValueError as error:
        base["reason_codes"] = [str(error)]; base["strategies"] = blocked_strategy_rows(config, base["reason_codes"]); return base
    signal_date = indicators["signal_date"]
    if as_of and signal_date > str(as_of)[:10]: base["reason_codes"].append("future_data_detected")
    if as_of and (date.fromisoformat(str(as_of)[:10]) - date.fromisoformat(signal_date)).days > int(config["gates"]["max_data_age_days"]): base["reason_codes"].append("stale_price_data")
    event_status, event_reasons = _event_gate(candidate, signal_date, config); base["reason_codes"].extend(event_reasons)
    signals = style_signals(indicators, config); regime = signals["market_regime"]
    if not regime["passed"]: base["reason_codes"].append("qqq_market_state_blocked")
    if not signals.get("trend_template"): base["reason_codes"].append("trend_template_failed")
    hard_blockers = [code for code in base["reason_codes"] if code in {"future_data_detected", "stale_price_data", "qqq_market_state_blocked", "earnings_blackout_3_trading_days"}]
    strategies = build_strategy_rows(indicators, signals, config, historical_oos_by_model, governance, hard_blockers, eligibility)
    priority = {"conditional_review": 8, "historical_review": 7, "historical_watch": 6, "preliminary_review": 5, "triggered_simulation": 4, "historical_edge_failed": 3, "waiting": 2, "blocked": 1}
    best = max(strategies, key=lambda row: priority[row["status"]])
    if best["status"] in {"conditional_review", "historical_review", "historical_watch", "preliminary_review"}: status = best["status"]
    elif best["triggered"]: status = "simulation_only"
    elif all(row["status"] == "blocked" for row in strategies): status = "blocked"
    else: status = "waiting_trigger"
    selected_status = status
    if status in {"historical_review", "historical_watch"}: status = "preliminary_review"
    status_label = {"conditional_review": "正式门禁通过，待人工复核", "preliminary_review": "初步门禁通过，仅可人工研究", "simulation_only": "已有策略触发，但仅作模拟", "waiting_trigger": "三种策略均在等待触发", "blocked": "数据或风险门禁阻断"}[status]
    status = selected_status
    if status == "historical_review": status_label = "历史 OOS 已通过，可人工研究"
    if status == "historical_watch": status_label = "历史 OOS 初步为正，仅供观察"
    base.update(status=status, status_label=status_label, indicators=indicators, event_status=event_status, market_regime=regime, trigger_models=signals, strategies=strategies, signal=best.get("entry_plan") if best.get("triggered") else None)
    if not any(row["triggered"] for row in strategies): base["reason_codes"].append("no_trigger")
    base["reason_codes"] = list(dict.fromkeys(base["reason_codes"])); base["warnings"] = ["三种策略均为条件情景，不是上涨概率", "未通过历史 OOS 的策略只能记录模拟结果"]
    if eligibility["mode"] == "historical_screen_override":
        base["warnings"].insert(0, f"历史 OOS 候选通道已启用；公司研究等级仍为 {eligibility['research_grade']}，仅可研究观察")
    return base

def evaluate_plan(candidate, rows, benchmark_rows, config, *, as_of=None, portfolio=None, historical_oos=None):
    if config.get("output_schema_version") == "short-term-trade-plan-v1.3":
        return evaluate_three_strategy_plan(candidate, rows, benchmark_rows, config, as_of=as_of, historical_oos_by_model=historical_oos or {}, governance=portfolio or {})
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
    is_v13 = config.get("output_schema_version") == "short-term-trade-plan-v1.3"
    oos_mappings = style_oos.get("by_model", {}) if is_v13 else style_oos.get("current_mappings", {}) if style_oos.get("schema_version") == "global-style-short-term-oos-v1" else {}
    plans = [evaluate_plan({**candidate, "historical_selection_policy": candidates.get("selection_policy", {}), "event_dates": event_map.get(str(candidate.get("ticker") or "").upper(), candidate.get("event_dates") or {})}, rows_by_symbol.get(candidate.get("ticker"), {}), benchmark, config, as_of=effective_as_of, portfolio=governance if is_v13 else None, historical_oos=oos_mappings if is_v13 else oos_mappings.get(str(candidate.get("ticker") or "").upper())) for candidate in candidates.get("candidates", [])]
    if not is_v13 and governance.get("manual_review_eligible") is True:
        for plan in plans:
            if plan["status"] == "simulation_only" and plan.get("historical_oos", {}).get("passed") is True:
                plan["status"] = "conditional_review"
                plan["status_label"] = "历史与实时门禁均通过，待人工确认"
    for plan in plans:
        ticker = plan["ticker"]
        ticker_errors = relevant_validation_errors(validation["errors"], ticker, config.get("benchmark", "QQQ"))
        if ticker_errors:
            plan.update(status="blocked", status_label="数据阻断", signal=None, reason_codes=list(dict.fromkeys(["short_term_daily_bars_unavailable", *ticker_errors])), warnings=["缺少经过验证的日线OHLCV数据；不生成短线交易研究触发建议"])
            if is_v13: plan["strategies"] = blocked_strategy_rows(config, plan["reason_codes"])
    statuses = ("conditional_review", "historical_review", "historical_watch", "preliminary_review", "manual_review_ready", "simulation_only", "waiting_trigger", "waiting_breakout", "waiting_pullback", "chase_blocked", "event_blocked", "invalidated", "blocked")
    governance_keys = ("status", "observation_count", "calendar_week_count", "complete_count", "primary_complete_count", "preliminary_review_requirements", "manual_review_requirements", "reliability_requirements", "preliminary_review_eligible", "manual_review_eligible", "reliability_claim_eligible", "reason")
    methodology = "global-style-short-term-v1.3.1" if is_v13 else "global-style-short-term-v1.2.0" if config.get("style_fusion") else "short-term-trade-plan-v1.1.0"
    return {"schema_version": config.get("output_schema_version", "short-term-trade-plan-v1.1"), "methodology_version": methodology, "generated_at": datetime.now(timezone.utc).isoformat(), "as_of": effective_as_of, "price_as_of": prices.get("as_of"), "research_only": True, "no_trade": True, "benchmark": "QQQ", "config_version": config["schema_version"], "style_fusion": config.get("style_fusion"), "historical_oos_status": style_oos.get("status", "unavailable"), "shadow_governance": {key: governance.get(key) for key in governance_keys}, "data_validation": {"valid": validation["valid"], "errors": validation["errors"], "coverage": validation["coverage"], "common_dates": validation.get("common_dates", 0)}, "plans": plans, "summary": {"candidate_count": len(plans), "strategy_count": sum(len(plan.get("strategies", [])) for plan in plans), "status_counts": {status: sum(plan["status"] == status for plan in plans) for status in statuses}, "manual_review_required": True}}

def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--candidates", type=Path, default=DEFAULT_CANDIDATES); parser.add_argument("--prices", type=Path, default=DEFAULT_PRICES); parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG); parser.add_argument("--events", type=Path, default=DEFAULT_EVENTS); parser.add_argument("--governance", type=Path, default=DEFAULT_GOVERNANCE); parser.add_argument("--style-oos", type=Path, default=DEFAULT_STYLE_OOS); parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT); parser.add_argument("--as-of", default=None); args = parser.parse_args(); atomic_write(args.output, generate(args.candidates, args.prices, args.config, args.output, as_of=args.as_of, events_path=args.events, governance_path=args.governance, style_oos_path=args.style_oos))

if __name__ == "__main__": main()
