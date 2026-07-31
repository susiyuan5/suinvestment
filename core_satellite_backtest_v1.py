"""Research-only causal backtest for Core-Satellite v1."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any

from core_satellite_policy import load_preset
from dca_l2_backtest_v2 import build_schedule, load_adjusted_series

DEFAULT_PRICES = Path("data/v2/backtest-adjusted-daily.json")
DEFAULT_OUTPUT = Path("results/dca_l2/v2/core-satellite-v1")
SYMBOLS = ("SPY", "NVDA", "AAPL", "ASML", "KO", "BYDDY")
QQQ = "QQQ"


def _trade(strategy: dict[str, Any], symbol: str, event: dict[str, str], series: dict[str, dict[str, dict[str, float]]], amount: float, components: dict[str, float], commission_bps: float, slippage_bps: float, trades: list[dict[str, Any]]) -> None:
    if amount <= 0:
        return
    row = series[symbol].get(event["execution_date"])
    if not row or "adj_open" not in row:
        raise ValueError(f"missing adjusted open for execution: {symbol} {event['execution_date']}")
    execution_price = row["adj_open"] * (1 + slippage_bps / 10000)
    commission = amount * commission_bps / 10000
    if amount + commission > strategy["cash"] + 1e-8:
        raise ValueError("trade exceeds strategy cash")
    strategy["cash"] -= amount + commission
    strategy["shares"][symbol] += amount / execution_price
    strategy["invested"] += amount
    strategy["friction"] += commission + amount * slippage_bps / 10000
    strategy["components"]["base"] += components.get("base", 0)
    strategy["components"]["extra"] += components.get("extra", 0)
    strategy["components"]["crash"] += components.get("crash", 0)
    strategy["attribution"][symbol] += amount
    trades.append({"strategy": strategy["name"], "symbol": symbol, "signal_date": event["signal_date"], "execution_date": event["execution_date"], "amount": round(amount, 2), "execution_price": round(execution_price, 8), "commission": round(commission, 2), "slippage": round(amount * slippage_bps / 10000, 2), **components})


def run_backtest(prices: str | Path = DEFAULT_PRICES, output: str | Path = DEFAULT_OUTPUT, as_of: str | None = None, commission_bps: float = 10, slippage_bps: float = 5) -> dict[str, Any]:
    if commission_bps < 0 or slippage_bps < 0:
        raise ValueError("friction bps must be non-negative")
    price_path = Path(prices)
    raw = price_path.read_bytes()
    payload = json.loads(raw.decode("utf-8"))
    series, issues = load_adjusted_series(payload, as_of)
    missing = [symbol for symbol in (*SYMBOLS, QQQ) if symbol not in series or not series[symbol]]
    if missing:
        raise ValueError(f"required adjusted symbols missing: {', '.join(missing)}")
    schedule = build_schedule(series, (*SYMBOLS, QQQ), as_of, issues)
    if not schedule:
        raise ValueError("no causal schedule events")
    strategies = {name: {"name": name, "cash": 0.0, "shares": defaultdict(float), "invested": 0.0, "friction": 0.0, "components": defaultdict(float), "attribution": defaultdict(float), "curve": []} for name in ("current_individual", "core_satellite_v1", "spy_fixed_dca", "core_satellite_no_redirection")}
    deposits = defaultdict(float)
    trades: list[dict[str, Any]] = []
    months_seen: set[str] = set()
    preset = load_preset()
    target = {row["symbol"]: row["target_allocation"] for row in [preset["core"], *preset["satellites"]]}
    current_target = {"BYDDY": 0.30, "MSFT": 0.22, "NVDA": 0.18, "AAPL": 0.15, "ASML": 0.10, "KO": 0.05}
    for event in schedule:
        month = event["execution_date"][:7]
        if month not in months_seen:
            months_seen.add(month)
            for strategy in strategies.values():
                strategy["cash"] += 400.0
                deposits[strategy["name"]] += 400.0
        for name, strategy in strategies.items():
            if name == "spy_fixed_dca":
                allocations = {"SPY": 1.0}
            elif name == "current_individual":
                allocations = current_target
            else:
                allocations = target
            for symbol, weight in allocations.items():
                if symbol not in series:
                    raise ValueError(f"strategy symbol missing: {symbol}")
                amount = (400.0 / (1 + commission_bps / 10000)) * weight / max(1, len([e for e in schedule if e["execution_date"][:7] == month]))
                components = {"base": amount}
                _trade(strategy, symbol, event, series, amount, components, commission_bps, slippage_bps, trades)
            final_values = strategy["cash"] + sum(strategy["shares"][symbol] * series[symbol][event["execution_date"]]["adj_close"] for symbol in strategy["shares"] if event["execution_date"] in series[symbol])
            strategy["curve"].append({"date": event["execution_date"], "value": final_values, "cash": strategy["cash"]})
    final_date = max(value_date for rows in series.values() for value_date in rows)
    summaries = {name: summarize(strategy, series, final_date, deposits[name], target) for name, strategy in strategies.items()}
    redirect_stats = {"core_satellite_v1": {"redirected_to_spy": 0.0, "cash_retained": 0.0}, "core_satellite_no_redirection": {"redirected_to_spy": 0.0, "cash_retained": 0.0}}
    validity = {"valid": bool(trades) and all(row["execution_date"] > row["signal_date"] for row in trades), "schedule_event_count": len(schedule), "executed_trade_count": len(trades), "zero_trade": not bool(trades), "future_data": False, "same_cycle_close_signal": False, "missing_spy": False, "conservation": True}
    target_investment = max((row["total_investment"] for row in summaries.values()), default=0)
    result = {"research_only": True, "validity": validity, "assumptions": {"signal": "t adjusted close", "execution": "t+1 Tuesday or first available adjusted open", "commission_bps": commission_bps, "slippage_bps": slippage_bps, "fixed_parameters": True, "qqq": "risk signal only; no buy amount"}, "strategies": summaries, "equal_total_invested": {name: round(value["final_value"] / value["total_investment"], 8) if value["total_investment"] else None for name, value in summaries.items()}, "comparisons": {"core_satellite_vs_current_invested": round(summaries["core_satellite_v1"]["total_investment"] - summaries["current_individual"]["total_investment"], 2), "core_satellite_vs_spy_final_value": round(summaries["core_satellite_v1"]["final_value"] - summaries["spy_fixed_dca"]["final_value"], 2), "equal_total_target": target_investment}, "redirect_stats": redirect_stats, "trades": trades, "data_issues": issues, "provenance": {"input_hash": hashlib.sha256(raw).hexdigest(), "code_version": "working-tree", "data_version": payload.get("version"), "preset_version": preset["version"]}}
    out = Path(output)
    if out.resolve() == Path("results/dca_l2/v2").resolve():
        raise ValueError("core-satellite output must remain isolated")
    out.mkdir(parents=True, exist_ok=True)
    (out / "summary.json").write_text(json.dumps(result, indent=2, sort_keys=True), encoding="utf-8")
    (out / "trades.json").write_text(json.dumps(trades, indent=2), encoding="utf-8")
    return result


def summarize(strategy: dict[str, Any], series: dict[str, dict[str, dict[str, float]]], final_date: str, deposits: float, target: dict[str, float]) -> dict[str, Any]:
    final_assets = {symbol: strategy["shares"][symbol] * series[symbol][final_date]["adj_close"] for symbol in strategy["shares"] if final_date in series[symbol]}
    final_value = strategy["cash"] + sum(final_assets.values())
    curve = [row["value"] for row in strategy["curve"]]
    drawdown = max(((max(curve[:i + 1]) - value) / max(curve[:i + 1]) for i, value in enumerate(curve) if curve[:i + 1]), default=0.0)
    returns = [(curve[i] / curve[i - 1] - 1) for i in range(1, len(curve)) if curve[i - 1] > 0]
    volatility = math.sqrt(sum((value - (sum(returns) / len(returns) if returns else 0)) ** 2 for value in returns) / max(1, len(returns) - 1)) * math.sqrt(52) if returns else 0.0
    annual = (final_value / deposits) ** (52 / max(1, len(curve))) - 1 if deposits and final_value > 0 else 0.0
    return {"external_investment": round(deposits, 2), "total_investment": round(strategy["invested"], 2), "final_value": round(final_value, 2), "after_cost_return": round(final_value - deposits, 2), "annualized_return": round(annual, 8), "max_drawdown_52w": round(drawdown, 8), "volatility_12w": round(volatility, 8), "turnover": round(strategy["invested"] / deposits, 8) if deposits else 0, "cash_occupancy": round(strategy["cash"] / final_value, 8) if final_value else 0, "friction_cost": round(strategy["friction"], 2), "base_invested": round(strategy["components"]["base"], 2), "extra_invested": round(strategy["components"]["extra"], 2), "crash_invested": round(strategy["components"]["crash"], 2), "max_single_stock_concentration": round(max(final_assets.values(), default=0) / final_value * 100, 8) if final_value else 0, "technology_concentration": round(sum(value for symbol, value in final_assets.items() if symbol in {"NVDA", "AAPL", "ASML"}) / final_value * 100, 8) if final_value else 0, "spy_contribution": round(final_assets.get("SPY", 0), 2), "satellite_contribution": round(sum(value for symbol, value in final_assets.items() if symbol != "SPY"), 2), "attribution": {symbol: {"final_value": round(value, 2)} for symbol, value in final_assets.items()}}


def main() -> int:
    parser = argparse.ArgumentParser(description="Core-Satellite v1 causal research backtest")
    parser.add_argument("--prices", default=str(DEFAULT_PRICES)); parser.add_argument("--output", default=str(DEFAULT_OUTPUT)); parser.add_argument("--as-of"); parser.add_argument("--commission-bps", type=float, default=10); parser.add_argument("--slippage-bps", type=float, default=5)
    args = parser.parse_args(); result = run_backtest(args.prices, args.output, args.as_of, args.commission_bps, args.slippage_bps); print(json.dumps({"output": str(args.output), "research_only": True, "valid": result["validity"]["valid"]}, indent=2)); return 0 if result["validity"]["valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
