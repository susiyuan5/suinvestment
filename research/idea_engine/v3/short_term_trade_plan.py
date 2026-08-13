"""Research-only short-term plan engine with strict daily OHLCV gates."""
from __future__ import annotations
import argparse, json, math, tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from .short_term_daily_bars import validate_snapshot

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_CONFIG = ROOT / "data/short-term-trade-plan-v1.json"
DEFAULT_CANDIDATES = ROOT / "research/results/v3_1/idea-engine/latest-candidates.json"
DEFAULT_PRICES = ROOT / "data/short-term-daily-bars-v1.json"
DEFAULT_EVENTS = ROOT / "data/idea-engine-events-v1.json"
DEFAULT_GOVERNANCE = ROOT / "research/results/v3_1/idea-engine/shadow/governance-report.json"
DEFAULT_OUTPUT = ROOT / "research/results/v3_1/short-term-trade-plans-v1_1/latest.json"

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

def compute_indicators(rows, benchmark_rows, config=None):
    stock = normalize_rows(rows); benchmark = normalize_rows(benchmark_rows)
    # Unit-level indicator calculation accepts a shorter injected series; the
    # production generator enforces the 252-row snapshot gate above it.
    if len(stock) < 60 or len(benchmark) < 60: raise ValueError("insufficient_daily_ohlcv_history")
    by_date = {row["date"]: row for row in benchmark}; stock = [row for row in stock if row["date"] in by_date]; benchmark = [by_date[row["date"]] for row in stock]
    if len(stock) < 60: raise ValueError("insufficient_common_trading_dates")
    closes = [row["close"] for row in stock]; qqq = [row["close"] for row in benchmark]; current_atr = atr(stock, int((config or {}).get("indicators", {}).get("atr_period", 14)))
    if not current_atr or not math.isfinite(current_atr): raise ValueError("invalid_atr")
    sr5, sr20, qr5, qr20 = pct_change(closes, 5), pct_change(closes, 20), pct_change(qqq, 5), pct_change(qqq, 20)
    if None in (sr5, sr20, qr5, qr20): raise ValueError("insufficient_benchmark_history")
    avg_volume = sum(row["volume"] for row in stock[-21:-1]) / 20
    if avg_volume <= 0: raise ValueError("volume_history_unavailable")
    return {"signal_date": stock[-1]["date"], "current_close": closes[-1], "atr14": current_atr, "sma10": sma(closes, 10), "sma20": sma(closes, 20), "sma50": sma(closes, 50), "ema10": ema(closes, 10), "ema20": ema(closes, 20), "ema50": ema(closes, 50), "prior20_high": max(row["high"] for row in stock[-21:-1]), "recent10_low": min(row["low"] for row in stock[-10:]), "stock_return_5": sr5, "stock_return_20": sr20, "qqq_return_5": qr5, "qqq_return_20": qr20, "relative_return_5": sr5 - qr5, "relative_return_20": sr20 - qr20, "volume_ratio": stock[-1]["volume"] / avg_volume, "distance_sma20_atr": (closes[-1] - sma(closes, 20)) / current_atr, "qqq_close_vs_sma20": qqq[-1] - (sma(qqq, 20) or qqq[-1])}

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

def calculate_position_size(total_assets, cash, entry, stop, config, *, current_experiment_notional=0.0):
    assets, available, entry, stop = map(finite, (total_assets, cash, entry, stop))
    if None in (assets, available, entry, stop) or min(assets, available, entry) <= 0 or stop >= entry: return {"shares": None, "notional": 0.0, "binding_constraint": "missing_assets_cash_or_fx", "reason_codes": ["sizing_inputs_missing"]}
    risk = entry - stop; risk_budget = assets * float(config["sizing"]["risk_budget_pct_assets"]); maximum = min(assets * float(config["sizing"]["maximum_notional_pct_assets"]), assets * float(config["sizing"]["maximum_experiment_pct_assets"]) - current_experiment_notional, available); shares = max(0, math.floor(min(risk_budget / risk, maximum / entry)))
    return {"shares": shares, "notional": shares * entry, "risk_per_share": risk, "risk_budget": risk_budget, "binding_constraint": "risk_or_notional_or_cash", "reason_codes": [] if shares else ["minimum_position_not_reached"]}

def trailing_stop(entry_stop, highest_close, atr_value, recent10_low):
    values = [finite(entry_stop), finite(highest_close), finite(atr_value), finite(recent10_low)]
    if any(value is None for value in values): return None
    return max(values[0], values[1] - values[2] * 1.5, values[3])

def time_exit(days_held, reached_half_r, relative_positive):
    if int(days_held) >= 20: return "research_exit_review"
    if int(days_held) >= 10 and not reached_half_r and not relative_positive: return "ten_day_review"
    return None

def evaluate_plan(candidate, rows, benchmark_rows, config, *, as_of=None, portfolio=None):
    ticker = str(candidate.get("ticker") or "").upper(); base = {"schema_version": "short-term-trade-plan-v1.1", "ticker": ticker, "research_only": True, "no_trade": True, "status": "blocked", "status_label": "数据阻断", "reason_codes": [], "warnings": [], "signal": None, "execution": {"order_type": "limit", "human_review_required": True}}
    if str(candidate.get("status")) not in config["gates"]["eligible_statuses"]: base["reason_codes"] = ["idea_status_not_eligible"]; base["status_label"] = "仅研究观察"; return base
    try: indicators = compute_indicators(rows, benchmark_rows, config)
    except ValueError as error: base["reason_codes"] = [str(error)]; return base
    signal_date = indicators["signal_date"]
    if as_of and signal_date > str(as_of)[:10]: base["reason_codes"] = ["future_data_detected"]; return base
    if as_of and (date.fromisoformat(str(as_of)[:10]) - date.fromisoformat(signal_date)).days > int(config["gates"]["max_data_age_days"]): base["reason_codes"].append("stale_price_data")
    if indicators["relative_return_20"] <= float(config["gates"]["minimum_relative_return_20"]): base["reason_codes"].append("relative_qqq_gate_failed")
    event_status, event_reasons = _event_gate(candidate, signal_date, config); base["reason_codes"].extend(event_reasons)
    breakout = indicators["current_close"] >= indicators["prior20_high"] + indicators["atr14"] * float(config["breakout"]["close_buffer_atr"]) and indicators["volume_ratio"] >= float(config["breakout"]["volume_ratio_min"]) and indicators["relative_return_5"] > 0 and indicators["relative_return_20"] > 0
    pullback = indicators["sma20"] > indicators["sma50"] and indicators["current_close"] > indicators["sma50"] and abs(indicators["current_close"] - indicators["sma20"]) <= indicators["atr14"] * float(config["pullback"]["touch_tolerance"])
    base.update({"indicators": indicators, "event_status": event_status, "trigger_models": {"breakout": breakout, "pullback": pullback}})
    if event_status == "blocked": base.update(status="event_blocked", status_label="财报风险阻断"); return base
    if any(code in base["reason_codes"] for code in ("future_data_detected", "stale_price_data", "qqq_market_state_blocked", "relative_qqq_gate_failed")): return base
    if breakout or pullback:
        risk_distance = max(0.0, 1.0 - indicators["recent10_low"] / indicators["current_close"])
        if not float(config["risk"]["minimum_risk_pct"]) <= risk_distance <= float(config["risk"]["maximum_risk_pct"]):
            base["reason_codes"].append("risk_distance_out_of_bounds"); return base
        base["status"] = "simulation_only"; base["status_label"] = "仅研究演练"; base["warnings"].append("Shadow治理尚未成熟，仅供研究演练")
    else: base["status"] = "waiting_breakout" if not pullback else "waiting_pullback"; base["status_label"] = "等待突破" if not pullback else "等待回踩"
    base["reason_codes"] = list(dict.fromkeys(base["reason_codes"] + ([] if breakout or pullback else ["no_trigger"])))
    return base

def atomic_write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False, suffix=".tmp") as handle: json.dump(payload, handle, ensure_ascii=False, indent=2); handle.write("\n"); temp = Path(handle.name)
    temp.replace(path)

def generate(candidates_path=DEFAULT_CANDIDATES, prices_path=DEFAULT_PRICES, config_path=DEFAULT_CONFIG, output_path=DEFAULT_OUTPUT, *, as_of=None, events_path=DEFAULT_EVENTS, governance_path=DEFAULT_GOVERNANCE):
    config = json.loads(config_path.read_text(encoding="utf-8")); candidates = json.loads(candidates_path.read_text(encoding="utf-8")); prices = json.loads(prices_path.read_text(encoding="utf-8")); governance = json.loads(governance_path.read_text(encoding="utf-8")) if governance_path.exists() else {"status": "blocked", "manual_review_eligible": False, "reason": "Shadow治理报告缺失"}
    symbols = [str(row.get("ticker", "")).upper() for row in candidates.get("candidates", []) if row.get("ticker")]; effective_as_of = as_of or candidates.get("as_of") or datetime.now(timezone.utc).isoformat(); validation = validate_snapshot(prices, symbols, benchmark=config.get("benchmark", "QQQ"), as_of=effective_as_of); rows_by_symbol = prices.get("symbols", {}); benchmark = rows_by_symbol.get(config.get("benchmark", "QQQ"), {})
    plans = [evaluate_plan(candidate, rows_by_symbol.get(candidate.get("ticker"), {}), benchmark, config, as_of=effective_as_of) for candidate in candidates.get("candidates", [])]
    for plan in plans:
        if not validation["valid"]: plan.update(status="blocked", status_label="数据阻断", signal=None, reason_codes=list(dict.fromkeys(["short_term_daily_bars_unavailable", *validation["errors"]])), warnings=["缺少经过验证的日线OHLCV数据；不生成短线交易研究触发建议"])
    statuses = ("conditional_review", "manual_review_ready", "simulation_only", "waiting_breakout", "waiting_pullback", "chase_blocked", "event_blocked", "invalidated", "blocked")
    return {"schema_version": "short-term-trade-plan-v1.1", "methodology_version": "short-term-trade-plan-v1.1.0", "generated_at": datetime.now(timezone.utc).isoformat(), "as_of": effective_as_of, "research_only": True, "no_trade": True, "benchmark": "QQQ", "config_version": config["schema_version"], "shadow_governance": {key: governance.get(key) for key in ("status", "observation_count", "calendar_week_count", "complete_count", "primary_complete_count", "manual_review_eligible", "reliability_claim_eligible", "reason")}, "data_validation": {"valid": validation["valid"], "errors": validation["errors"], "coverage": validation["coverage"], "common_dates": validation.get("common_dates", 0)}, "plans": plans, "summary": {"candidate_count": len(plans), "status_counts": {status: sum(plan["status"] == status for plan in plans) for status in statuses}, "manual_review_required": True}}

def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--candidates", type=Path, default=DEFAULT_CANDIDATES); parser.add_argument("--prices", type=Path, default=DEFAULT_PRICES); parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG); parser.add_argument("--events", type=Path, default=DEFAULT_EVENTS); parser.add_argument("--governance", type=Path, default=DEFAULT_GOVERNANCE); parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT); parser.add_argument("--as-of", default=None); args = parser.parse_args(); atomic_write(args.output, generate(args.candidates, args.prices, args.config, args.output, as_of=args.as_of, events_path=args.events, governance_path=args.governance))

if __name__ == "__main__": main()
