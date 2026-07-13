from __future__ import annotations

import csv
import json
import math
from collections import defaultdict
from datetime import date
from pathlib import Path

from dca_l2_policy import evaluate_dca_l2_policy, load_config


LIVE_SYMBOLS = ("BYDDY", "MSFT", "NVDA", "AAPL", "ASML", "KO")
ALLOCATIONS = {"BYDDY": 0.30, "MSFT": 0.22, "NVDA": 0.18, "AAPL": 0.15, "ASML": 0.10, "KO": 0.05}


def run_dca_l2_backtest(snapshot_path: str = "data/backtest-daily-prices.json", output_dir: str = "results/dca_l2") -> dict:
    payload = json.loads(Path(snapshot_path).read_text(encoding="utf-8"))
    series = {symbol: {row["date"]: float(row["close"]) for row in payload["symbols"][symbol]} for symbol in LIVE_SYMBOLS + ("QQQ",)}
    common_dates = sorted(set.intersection(*(set(series[symbol]) for symbol in LIVE_SYMBOLS + ("QQQ",))))
    config = load_config()
    weekly_deployment = round(300 / (52 / 12), 2)
    crash_initial = 100.0
    cash = 100000.0
    fixed_cash = 100000.0
    shares = defaultdict(float)
    fixed_shares = defaultdict(float)
    peak = {symbol: 0.0 for symbol in LIVE_SYMBOLS}
    ledger = {"month": "", "initial": crash_initial, "used": 0.0, "defensiveLatched": False, "recoveryConfirmations": 0, "lastRecoveryTradingDate": ""}
    cumulative_crash_used = 0.0
    decisions, trades, fixed_trades = [], [], []

    for index, value_date in enumerate(common_dates):
        current = date.fromisoformat(value_date)
        month = value_date[:7]
        if ledger["month"] != month:
            ledger.update({"month": month, "initial": crash_initial, "used": 0.0})
        qqq_history = [series["QQQ"][day] for day in common_dates[: index + 1]]
        market = market_regime(qqq_history)
        weekly_vol = weekly_volatility(qqq_history)
        is_buy_day = current.weekday() == 4
        base_total = weekly_deployment if is_buy_day else 0.0
        provisional = []
        for symbol in LIVE_SYMBOLS:
            closes = [series[symbol][day] for day in common_dates[: index + 1]]
            price = closes[-1]
            peak[symbol] = max(peak[symbol], price)
            drawdown = 0.0 if peak[symbol] <= 0 else (peak[symbol] - price) / peak[symbol] * 100
            base = round(base_total * ALLOCATIONS[symbol], 2)
            provisional.append((symbol, closes, price, drawdown, base, evaluate_dca_l2_policy({"baseAmount": base, "price": price, "dataStatus": "fresh", "marketRegime": market, "drawdownPct": drawdown, "trendStatus": trend_status(closes), "volatilityPct": weekly_vol, "monthlyBudget": 400, "crashFundInitial": ledger["initial"], "crashFundBalance": max(0, ledger["initial"] - ledger["used"]), "date": value_date}, ledger, config)))
        defensive = any(item[5].defensive_now for item in provisional)
        if defensive:
            ledger.update({"defensiveLatched": True, "recoveryConfirmations": 0, "lastRecoveryTradingDate": ""})
        elif ledger["defensiveLatched"]:
            if ledger["lastRecoveryTradingDate"] != value_date:
                ledger["recoveryConfirmations"] += 1
                ledger["lastRecoveryTradingDate"] = value_date
            if ledger["recoveryConfirmations"] >= 2:
                ledger["defensiveLatched"] = False
        deep_base = sum(item[4] for item in provisional if item[5].state == "deep_drawdown")
        daily_crash = 0.0
        for symbol, closes, price, drawdown, base, _decision in provisional:
            decision = evaluate_dca_l2_policy({"baseAmount": base, "price": price, "dataStatus": "fresh", "marketRegime": market, "drawdownPct": drawdown, "trendStatus": trend_status(closes), "volatilityPct": weekly_vol, "monthlyBudget": 400, "crashFundInitial": ledger["initial"], "crashFundBalance": max(0, ledger["initial"] - ledger["used"]), "crashFundWeight": base / deep_base if deep_base else 0, "date": value_date}, ledger, config)
            amount = min(decision.final_amount, cash)
            if is_buy_day and amount > 0:
                shares[symbol] += amount / price
                cash -= amount
                daily_crash += decision.crash_fund_amount
                trades.append({"date": value_date, "symbol": symbol, "price": round(price, 6), "base_dca": decision.base_amount, "extra_dip_buy": decision.extra_amount, "crash_fund": decision.crash_fund_amount, "final_amount": amount, "state": decision.state, "reason_codes": "|".join(decision.reason_codes)})
            decisions.append({"date": value_date, "symbol": symbol, **decision.to_dict()})
            if is_buy_day:
                fixed_amount = min(round(weekly_deployment * ALLOCATIONS[symbol], 2), fixed_cash)
                fixed_shares[symbol] += fixed_amount / price
                fixed_cash -= fixed_amount
                fixed_trades.append({"date": value_date, "symbol": symbol, "amount": fixed_amount})
        if is_buy_day:
            ledger["used"] = round(min(ledger["initial"], ledger["used"] + daily_crash), 2)
            cumulative_crash_used = round(cumulative_crash_used + daily_crash, 2)
    final_prices = {symbol: series[symbol][common_dates[-1]] for symbol in LIVE_SYMBOLS}
    l2_value = cash + sum(shares[symbol] * final_prices[symbol] for symbol in LIVE_SYMBOLS)
    fixed_value = fixed_cash + sum(fixed_shares[symbol] * final_prices[symbol] for symbol in LIVE_SYMBOLS)
    summary = {"start_date": common_dates[0], "end_date": common_dates[-1], "weekly_deployment": weekly_deployment, "dca_l2_final_value": round(l2_value, 2), "fixed_dca_final_value": round(fixed_value, 2), "dca_l2_total_invested": round(100000 - cash, 2), "fixed_dca_total_invested": round(100000 - fixed_cash, 2), "crash_fund_simulated_used": cumulative_crash_used, "decision_rows": len(decisions), "trade_rows": len(trades)}
    out = Path(output_dir); out.mkdir(parents=True, exist_ok=True)
    write_csv(out / "dca_l2_summary.csv", [summary])
    write_csv(out / "dca_l2_trades.csv", trades)
    write_csv(out / "dca_l2_decisions.csv", decisions)
    return summary


def market_regime(closes: list[float]) -> str:
    if len(closes) < 50: return "Neutral"
    latest = closes[-1]; ma20 = sum(closes[-20:]) / 20; ma50 = sum(closes[-50:]) / 50; high = max(closes[-260:])
    if latest < ma50 or (high - latest) / high > .20: return "Bear"
    if latest > ma20 > ma50: return "Bull"
    return "Correction" if latest < ma20 else "Neutral"


def trend_status(closes: list[float]) -> str:
    if len(closes) < 200: return "unavailable"
    sma = sum(closes[-200:]) / 200
    if closes[-1] < sma * .8: return "strong_downtrend"
    return "above_sma" if closes[-1] >= sma else "below_sma"


def weekly_volatility(closes: list[float]) -> float:
    if len(closes) < 61: return 0.0
    samples = closes[-61::5]
    returns = [(samples[i] / samples[i - 1] - 1) for i in range(1, len(samples)) if samples[i - 1] > 0]
    if len(returns) < 2: return 0.0
    mean = sum(returns) / len(returns)
    return math.sqrt(sum((value - mean) ** 2 for value in returns) / (len(returns) - 1)) * 100


def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        return
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader(); writer.writerows(rows)


if __name__ == "__main__":
    print(run_dca_l2_backtest())
