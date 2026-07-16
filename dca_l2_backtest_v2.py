"""Causal, budget-matched DCA-L2 v2 research backtest.

This module is intentionally independent from the historical DCA-L2 runner. It
does not change files under results/dca_l2/; the default output is
results/dca_l2/v2/ and every output is marked research_only.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from dca_l2_policy import evaluate_dca_l2_policy, load_config, plan_portfolio_dca_l2, update_recovery_state


LIVE_SYMBOLS = ("BYDDY", "MSFT", "NVDA", "AAPL", "ASML", "KO")
ALLOCATIONS = {"BYDDY": 0.30, "MSFT": 0.22, "NVDA": 0.18, "AAPL": 0.15, "ASML": 0.10, "KO": 0.05}
DEFAULT_PRICES = Path("data/backtest-daily-prices.json")
DEFAULT_OUTPUT = Path("results/dca_l2/v2")


def run_backtest(prices_path: str | Path = DEFAULT_PRICES, output_dir: str | Path = DEFAULT_OUTPUT, as_of: str | None = None, commission_bps: float = 10, slippage_bps: float = 5) -> dict[str, Any]:
    if commission_bps < 0 or slippage_bps < 0:
        raise ValueError("commission and slippage must be non-negative")
    payload = json.loads(Path(prices_path).read_text(encoding="utf-8"))
    config = load_config()
    series, missing = load_adjusted_series(payload, as_of)
    symbols = tuple(symbol for symbol in LIVE_SYMBOLS if symbol in series)
    required = symbols + ("QQQ",)
    if "QQQ" not in series or not symbols:
        raise ValueError("prices must contain QQQ and at least one live symbol")
    schedule = build_schedule(series, required, as_of, missing)
    months = defaultdict(list)
    for event in schedule:
        months[event["execution_date"][:7]].append(event)
    for month in months:
        months[month] = list({event["execution_date"] for event in months[month]})
    week_counts = {month: max(1, len(values)) for month, values in months.items()}

    strategies = {
        "budget_matched_fixed_dca": new_strategy(symbols),
        "reserve_matched_fixed_dca": new_strategy(symbols),
        "dca_l2_v2": new_strategy(symbols),
    }
    decisions: list[dict[str, Any]] = []
    trades: list[dict[str, Any]] = []
    issues = list(missing)
    policy_state: dict[str, Any] = {}
    normal_pool = float(config.get("budget", {}).get("defaultNormalPool", 300))
    crash_fund = float(config.get("budget", {}).get("defaultCrashFund", 100))
    monthly_budget = normal_pool + crash_fund

    for event in schedule:
        execution_date = event["execution_date"]
        signal_date = event["signal_date"]
        month = execution_date[:7]
        if execution_date == min(months[month]):
            for strategy in strategies.values():
                strategy["cash"] += monthly_budget
                strategy["external_deposits"] += monthly_budget
        qqq_closes = history(series["QQQ"], signal_date, "adj_close")
        market = market_regime(qqq_closes)
        volatility = rolling_volatility(qqq_closes, 12)
        current_prices = {symbol: series[symbol][signal_date]["adj_close"] for symbol in symbols if signal_date in series[symbol]}
        base_weekly = normal_pool / week_counts[month]

        # Fixed controls use the same deposit schedule and the same execution bars.
        for symbol in symbols:
            if symbol not in current_prices:
                issues.append(issue("missing_signal_price", signal_date, execution_date, symbol))
                continue
            amount = base_weekly * ALLOCATIONS[symbol] + crash_fund / week_counts[month] * ALLOCATIONS[symbol]
            execute_trade(strategies["budget_matched_fixed_dca"], symbol, execution_date, signal_date, amount, "fixed", series, commission_bps, slippage_bps, trades, components={"base_amount": base_weekly * ALLOCATIONS[symbol], "crash_fund_amount": crash_fund / week_counts[month] * ALLOCATIONS[symbol]})
            reserve_amount = base_weekly * ALLOCATIONS[symbol]
            execute_trade(strategies["reserve_matched_fixed_dca"], symbol, execution_date, signal_date, reserve_amount, "reserve_fixed", series, commission_bps, slippage_bps, trades, components={"base_amount": reserve_amount})

        if not all(symbol in current_prices for symbol in symbols):
            issues.append(issue("skipped_l2_period_missing_signal_price", signal_date, execution_date, "PORTFOLIO"))
            continue

        provisional: list[tuple[str, dict[str, Any], float]] = []
        for symbol in symbols:
            drawdown = drawdown_pct(series[symbol], signal_date, 52)
            trend = trend_status(history(series[symbol], signal_date, "adj_close"))
            allocation = current_allocation(strategies["dca_l2_v2"], symbol, current_prices)
            input_data = policy_input(base_weekly * ALLOCATIONS[symbol], current_prices[symbol], signal_date, market, drawdown, trend, volatility, allocation, normal_pool, crash_fund, strategies["dca_l2_v2"])
            provisional.append((symbol, input_data, evaluate_dca_l2_policy(input_data, policy_state, config).to_dict()))
        defensive = any(item[2]["defensive_now"] for item in provisional)
        if defensive:
            policy_state.update({"defensiveLatched": True, "recoveryConfirmations": 0, "lastRecoveryWeek": ""})
        elif policy_state.get("defensiveLatched"):
            recovery = update_recovery_state(policy_state, signal_date, "fresh", False, config)
            policy_state.update({"defensiveLatched": recovery["latched"], "recoveryConfirmations": recovery["confirmations"], "lastRecoveryWeek": recovery["last_week"]})

        deep_base = sum(input_data["baseAmount"] for _, input_data, decision in provisional if decision["state"] == "deep_drawdown")
        plan_items = []
        for symbol, input_data, _ in provisional:
            if deep_base > 0 and next(decision for sym, _, decision in provisional if sym == symbol)["state"] == "deep_drawdown":
                input_data["crashFundWeight"] = input_data["baseAmount"] / deep_base
            decision = evaluate_dca_l2_policy(input_data, policy_state, config).to_dict()
            plan_items.append({"symbol": symbol, "decision": decision, "currentAllocationPct": input_data["currentAllocationPct"]})
            decisions.append({"strategy": "dca_l2_v2", "signal_date": signal_date, "execution_date": execution_date, "symbol": symbol, **decision})
        cash_cap = strategies["dca_l2_v2"]["cash"] * float(config["cashUsageCap"])
        planned = plan_portfolio_dca_l2(plan_items, normal_pool=normal_pool, crash_fund=crash_fund, normal_used=strategies["dca_l2_v2"]["normal_used"], crash_used=strategies["dca_l2_v2"]["crash_used"], portfolio_cash_cap=cash_cap)
        for item in planned["items"]:
            decision = item["decision"]
            strategy = strategies["dca_l2_v2"]
            strategy["normal_used"] += decision["base_amount"] + decision["extra_amount"]
            strategy["crash_used"] += decision["crash_fund_amount"]
            execute_trade(strategy, item["symbol"], execution_date, signal_date, decision["final_amount"], "dca_l2_v2", series, commission_bps, slippage_bps, trades, components=decision)
        decisions.append({"strategy": "dca_l2_v2_portfolio", "signal_date": signal_date, "execution_date": execution_date, "symbol": "PORTFOLIO", "planned_normal": planned["planned_normal"], "planned_crash": planned["planned_crash"], "total_planned": planned["total_planned"], "normal_pool_remaining": planned["normal_pool_remaining"], "crash_fund_remaining": planned["crash_fund_remaining"], "unallocated_cash": planned["unallocated_cash"]})
        mark_equity(strategies["budget_matched_fixed_dca"], execution_date, series, symbols)
        mark_equity(strategies["reserve_matched_fixed_dca"], execution_date, series, symbols)
        mark_equity(strategies["dca_l2_v2"], execution_date, series, symbols)

    final_date = max((value_date for rows in series.values() for value_date in rows), default=None)
    summaries = {name: summarize(name, strategy, series, symbols, final_date, commission_bps, slippage_bps) for name, strategy in strategies.items()}
    summaries["equal_total_invested"] = equal_total_invested(summaries)
    comparisons = {
        "budget_matched_fixed_minus_dca_l2_invested": round(summaries["budget_matched_fixed_dca"]["total_investment"] - summaries["dca_l2_v2"]["total_investment"], 2),
        "reserve_matched_fixed_minus_dca_l2_invested": round(summaries["reserve_matched_fixed_dca"]["total_investment"] - summaries["dca_l2_v2"]["total_investment"], 2),
        "budget_matched_fixed_vs_dca_l2_final_value": round(summaries["budget_matched_fixed_dca"]["final_value"] - summaries["dca_l2_v2"]["final_value"], 2),
    }
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    write_json(output / "summary.json", {"research_only": True, "config_version": config["version"], "assumptions": assumptions(commission_bps, slippage_bps), "strategies": summaries, "comparisons": comparisons, "data_issues": issues})
    write_csv(output / "summary.csv", [flatten_summary(name, value) for name, value in summaries.items()])
    write_csv(output / "trades.csv", trades, ["strategy", "symbol", "signal_date", "execution_date", "status", "execution_price", "gross_invested", "commission", "slippage_cost", "base", "extra", "crash"])
    write_csv(output / "decisions.csv", decisions, ["strategy", "symbol", "signal_date", "execution_date", "state", "base_amount", "extra_amount", "crash_fund_amount", "final_amount", "reason_codes", "planned_normal", "planned_crash", "total_planned", "unallocated_cash"])
    write_csv(output / "data_issues.csv", issues, ["kind", "symbol", "signal_date", "execution_date", "count"])
    return {"research_only": True, "config_version": config["version"], "strategies": summaries, "comparisons": comparisons, "data_issues": issues, "output": str(output)}


def load_adjusted_series(payload: dict[str, Any], as_of: str | None) -> tuple[dict[str, dict[str, dict[str, float]]], list[dict[str, Any]]]:
    result: dict[str, dict[str, dict[str, float]]] = {}
    issues: list[dict[str, Any]] = []
    for symbol, rows in (payload.get("symbols") or {}).items():
        mapped: dict[str, dict[str, float]] = {}
        missing_close_count = 0
        first_missing_date = ""
        for row in rows or []:
            value_date = str(row.get("date") or "")
            if not value_date or (as_of and value_date > as_of):
                continue
            close = first_finite(row, "adjusted_close", "adj_close")
            opening = first_finite(row, "adjusted_open", "adj_open")
            if close is None:
                missing_close_count += 1
                first_missing_date = first_missing_date or value_date
                continue
            mapped[value_date] = {"adj_close": close}
            if opening is not None:
                mapped[value_date]["adj_open"] = opening
        result[str(symbol)] = mapped
        if missing_close_count:
            issues.append({**issue("missing_adjusted_close", first_missing_date, "", symbol), "count": missing_close_count})
    return result, issues


def build_schedule(series: dict[str, dict[str, dict[str, float]]], symbols: tuple[str, ...], as_of: str | None, issues: list[dict[str, Any]]) -> list[dict[str, str]]:
    dates = sorted(set().union(*(set(series.get(symbol, {})) for symbol in symbols)))
    if not dates:
        return []
    first = date.fromisoformat(dates[0])
    last = date.fromisoformat(as_of) if as_of else date.fromisoformat(dates[-1])
    events = []
    cursor = first + timedelta(days=(1 - first.weekday()) % 7)  # next/equal Monday, then Tuesday below
    while cursor <= last:
        tuesday = cursor
        candidates = [value for value in dates if tuesday.isoformat() <= value <= (tuesday + timedelta(days=5)).isoformat()]
        execution = next((value for value in candidates if all(value in series.get(symbol, {}) and "adj_open" in series[symbol][value] for symbol in symbols)), None)
        if execution is None:
            issues.append(issue("skipped_no_adjusted_open_after_tuesday", "", tuesday.isoformat(), "PORTFOLIO"))
        else:
            previous = [value for value in dates if value < execution and all(value in series.get(symbol, {}) and "adj_close" in series[symbol][value] for symbol in symbols + ("QQQ",))]
            if not previous:
                issues.append(issue("skipped_no_prior_signal_bar", "", execution, "PORTFOLIO"))
            else:
                events.append({"signal_date": previous[-1], "execution_date": execution})
        cursor += timedelta(days=7)
    return events


def first_finite(row: dict[str, Any], *keys: str) -> float | None:
    for key in keys:
        try:
            value = float(row[key])
        except (KeyError, TypeError, ValueError):
            continue
        if math.isfinite(value) and value > 0:
            return value
    return None


def history(rows: dict[str, dict[str, float]], through: str, field: str) -> list[float]:
    return [rows[value][field] for value in sorted(rows) if value <= through and field in rows[value]]


def policy_input(base: float, price: float, signal_date: str, market: str, drawdown: float, trend: str, volatility: float, allocation: float, normal_pool: float, crash_fund: float, strategy: dict[str, Any]) -> dict[str, Any]:
    return {"baseAmount": round(base, 2), "price": price, "dataStatus": "fresh", "marketRegime": market, "drawdownPct": drawdown, "trendStatus": trend, "volatilityPct": volatility, "currentAllocationPct": allocation, "normalPool": normal_pool, "crashFundInitial": crash_fund, "crashFundBalance": max(0, crash_fund - strategy["crash_used"]), "normalPoolUsed": strategy["normal_used"], "crashFundUsed": strategy["crash_used"], "date": signal_date}


def market_regime(closes: list[float]) -> str:
    if len(closes) < 50:
        return "Neutral"
    latest = closes[-1]
    ma20, ma50 = sum(closes[-20:]) / 20, sum(closes[-50:]) / 50
    high = max(closes[-260:])
    if latest < ma50 or (high - latest) / high > 0.20:
        return "Bear"
    if latest > ma20 > ma50:
        return "Bull"
    return "Correction" if latest < ma20 else "Neutral"


def trend_status(closes: list[float]) -> str:
    if len(closes) < 200:
        return "unavailable"
    sma = sum(closes[-200:]) / 200
    if closes[-1] < sma * 0.8:
        return "strong_downtrend"
    return "above_sma" if closes[-1] >= sma else "below_sma"


def rolling_volatility(closes: list[float], periods: int) -> float:
    returns = [(closes[index] / closes[index - 1] - 1) for index in range(max(1, len(closes) - periods), len(closes)) if closes[index - 1] > 0]
    if len(returns) < 2:
        return 0.0
    mean = sum(returns) / len(returns)
    return math.sqrt(sum((value - mean) ** 2 for value in returns) / (len(returns) - 1)) * 100


def drawdown_pct(rows: dict[str, dict[str, float]], through: str, lookback: int) -> float:
    closes = history(rows, through, "adj_close")[-lookback:]
    if not closes:
        return 0.0
    high = max(closes)
    return (high - closes[-1]) / high * 100 if high > 0 else 0.0


def new_strategy(symbols: tuple[str, ...]) -> dict[str, Any]:
    return {"cash": 0.0, "shares": defaultdict(float), "symbol_invested": defaultdict(float), "external_deposits": 0.0, "gross_invested": 0.0, "base_invested": 0.0, "extra_invested": 0.0, "crash_invested": 0.0, "commission": 0.0, "slippage": 0.0, "normal_used": 0.0, "crash_used": 0.0, "equity_curve": [], "symbols": symbols}


def current_allocation(strategy: dict[str, Any], symbol: str, prices: dict[str, float]) -> float:
    values = {item: strategy["shares"][item] * prices.get(item, 0.0) for item in strategy["symbols"]}
    total = strategy["cash"] + sum(values.values())
    return values.get(symbol, 0.0) / total * 100 if total > 0 else ALLOCATIONS.get(symbol, 0) * 100


def execute_trade(strategy: dict[str, Any], symbol: str, execution_date: str, signal_date: str, amount: float, strategy_name: str, series: dict[str, dict[str, dict[str, float]]], commission_bps: float, slippage_bps: float, trades: list[dict[str, Any]], components: dict[str, Any] | None = None) -> None:
    if amount <= 0:
        return
    row = series[symbol].get(execution_date)
    if not row or "adj_open" not in row:
        trades.append({"strategy": strategy_name, "symbol": symbol, "signal_date": signal_date, "execution_date": execution_date, "status": "skipped_missing_adjusted_open"})
        return
    slippage = row["adj_open"] * slippage_bps / 10000
    price = row["adj_open"] + slippage
    affordable = strategy["cash"] / (1 + commission_bps / 10000)
    gross = min(float(amount), max(0.0, affordable))
    commission = gross * commission_bps / 10000
    strategy["cash"] -= gross + commission
    strategy["shares"][symbol] += gross / price
    strategy["symbol_invested"][symbol] += gross
    strategy["gross_invested"] += gross
    component_data = components or {}
    strategy["base_invested"] += min(gross, float(component_data.get("base_amount", 0)))
    strategy["extra_invested"] += float(component_data.get("extra_amount", 0))
    strategy["crash_invested"] += float(component_data.get("crash_fund_amount", 0))
    strategy["commission"] += commission
    strategy["slippage"] += gross * slippage_bps / 10000
    trades.append({"strategy": strategy_name, "symbol": symbol, "signal_date": signal_date, "execution_date": execution_date, "status": "executed", "execution_price": round(price, 8), "gross_invested": round(gross, 2), "commission": round(commission, 2), "slippage_cost": round(gross * slippage_bps / 10000, 2), "base": round(float((components or {}).get("base_amount", 0)), 2), "extra": round(float((components or {}).get("extra_amount", 0)), 2), "crash": round(float((components or {}).get("crash_fund_amount", 0)), 2)})


def mark_equity(strategy: dict[str, Any], value_date: str, series: dict[str, dict[str, dict[str, float]]], symbols: tuple[str, ...]) -> None:
    value = strategy["cash"] + sum(strategy["shares"][symbol] * series[symbol][value_date]["adj_close"] for symbol in symbols if value_date in series[symbol])
    strategy["equity_curve"].append({"date": value_date, "value": value, "cash": strategy["cash"]})


def summarize(name: str, strategy: dict[str, Any], series: dict[str, dict[str, dict[str, float]]], symbols: tuple[str, ...], final_date: str | None, commission_bps: float, slippage_bps: float) -> dict[str, Any]:
    final_value = strategy["cash"] + sum(strategy["shares"][symbol] * series[symbol][final_date]["adj_close"] for symbol in symbols if final_date and final_date in series[symbol])
    invested = strategy["gross_invested"]
    curve = [row["value"] for row in strategy["equity_curve"]]
    max_dd = rolling_max_drawdown(curve, 52)
    years = max(1 / 52, len(curve) / 52)
    annual_return = (final_value / invested) ** (1 / years) - 1 if invested > 0 and final_value > 0 else 0.0
    calmar = annual_return / max_dd if max_dd > 0 else None
    attribution = {}
    for symbol in symbols:
        value = strategy["shares"][symbol] * series[symbol][final_date]["adj_close"] if final_date and final_date in series[symbol] else 0.0
        invested_symbol = strategy["symbol_invested"][symbol]
        attribution[symbol] = {"final_value": round(value, 2), "invested": round(invested_symbol, 2), "pnl": round(value - invested_symbol, 2)}
    return {"strategy": name, "external_deposits": round(strategy["external_deposits"], 2), "total_investment": round(invested, 2), "base_invested": round(strategy["base_invested"], 2), "extra_invested": round(strategy["extra_invested"], 2), "crash_invested": round(strategy["crash_invested"], 2), "cash_balance": round(strategy["cash"], 2), "total_friction_cost": round(strategy["commission"] + strategy["slippage"], 2), "final_value": round(final_value, 2), "total_return": round(final_value - invested, 2), "max_drawdown_52w": round(max_dd, 6), "calmar": round(calmar, 6) if calmar is not None else None, "investment_ratio": round(invested / strategy["external_deposits"], 6) if strategy["external_deposits"] else 0, "cash_drag": round(strategy["cash"] / final_value, 6) if final_value else 0, "attribution": attribution, "commission_bps": commission_bps, "slippage_bps": slippage_bps}


def rolling_max_drawdown(values: list[float], window: int) -> float:
    worst = 0.0
    for index, value in enumerate(values):
        prior = values[max(0, index - window + 1): index + 1]
        peak = max(prior) if prior else value
        if peak > 0:
            worst = max(worst, (peak - value) / peak)
    return worst


def equal_total_invested(summaries: dict[str, dict[str, Any]]) -> dict[str, Any]:
    target = max((value["total_investment"] for value in summaries.values()), default=0)
    return {"strategy": "equal_total_invested", "target_total_invested": target, "normalized": {name: {"final_value_per_invested": round(value["final_value"] / value["total_investment"], 6) if value["total_investment"] else None, "scaled_final_value": round(value["final_value"] * target / value["total_investment"], 2) if value["total_investment"] else None} for name, value in summaries.items()}}


def issue(kind: str, signal_date: str, execution_date: str, symbol: str) -> dict[str, Any]:
    return {"kind": kind, "signal_date": signal_date, "execution_date": execution_date, "symbol": symbol}


def assumptions(commission_bps: float, slippage_bps: float) -> dict[str, Any]:
    return {"schedule": "weekly Tuesday; holiday uses first available trading day after Tuesday", "signal": "prior valid trading day adjusted close", "execution": "Tuesday/first same-week available adjusted open", "commission_bps": commission_bps, "slippage_bps": slippage_bps, "future_data": False, "same_cycle_close_signal": False, "config_source": "data/dca-l2-policy-config.json", "fixed_parameters": True}


def flatten_summary(name: str, value: dict[str, Any]) -> dict[str, Any]:
    return {"strategy": name, **{key: json.dumps(item, sort_keys=True) if isinstance(item, (dict, list)) else item for key, item in value.items() if key != "strategy"}}


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True), encoding="utf-8")


def write_csv(path: Path, rows: list[dict[str, Any]], fieldnames: list[str] | None = None) -> None:
    keys = fieldnames or list(dict.fromkeys(key for row in rows for key in row))
    if not keys:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=keys, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description="Causal DCA-L2 v2 research-only backtest")
    parser.add_argument("--prices", default=str(DEFAULT_PRICES))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--as-of")
    parser.add_argument("--commission-bps", type=float, default=10)
    parser.add_argument("--slippage-bps", type=float, default=5)
    args = parser.parse_args()
    result = run_backtest(args.prices, args.output, args.as_of, args.commission_bps, args.slippage_bps)
    print(json.dumps({"output": result["output"], "research_only": True, "strategies": list(result["strategies"])}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
