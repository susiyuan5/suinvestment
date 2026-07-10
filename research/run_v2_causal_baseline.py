"""Versioned causal baseline for research only.

Signals are formed at week t close and executed at week t+1 adjusted open.
This script never changes dashboard recommendations or the existing Phase 3–6
reports; it writes an isolated v2 research artifact.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

from config import StrategyConfig
from data_loader import WeeklyBar, daily_to_weekly_bars, load_yahoo_daily_prices
from strategy import calculate_buy_amount, calculate_weekly_return


DEFAULT_SYMBOLS = ("BYDDY", "MSFT", "NVDA", "AAPL", "ASML", "KO", "QQQ", "SPY")


@dataclass(frozen=True)
class CausalTrade:
    signal_date: str
    execution_date: str
    signal_return: float
    execution_price: float
    buy_amount: float
    shares_bought: float
    multiplier: float


def simulate(symbol: str, bars: list[WeeklyBar], strategy: StrategyConfig) -> dict:
    if len(bars) < 3:
        raise ValueError(f"{symbol} needs at least three weekly bars")
    cash = strategy.initial_cash
    shares = 0.0
    trades: list[CausalTrade] = []
    for index in range(1, len(bars) - 1):
        previous, signal_bar, execution_bar = bars[index - 1], bars[index], bars[index + 1]
        signal_return = calculate_weekly_return(signal_bar.adjusted_close, previous.adjusted_close)
        desired, multiplier = calculate_buy_amount(signal_return, strategy)
        desired = min(desired, cash * 0.30)
        execution_price = execution_bar.adjusted_open * (1 + strategy.slippage_rate)
        affordable = cash / (1 + strategy.commission_rate)
        buy_amount = min(desired, affordable)
        shares_bought = buy_amount / execution_price if buy_amount > 0 else 0.0
        commission = buy_amount * strategy.commission_rate
        cash -= buy_amount + commission
        shares += shares_bought
        trades.append(
            CausalTrade(
                signal_date=signal_bar.week_end.isoformat(),
                execution_date=execution_bar.week_end.isoformat(),
                signal_return=round(signal_return, 8),
                execution_price=round(execution_price, 6),
                buy_amount=round(buy_amount, 6),
                shares_bought=round(shares_bought, 8),
                multiplier=round(multiplier, 6),
            )
        )
    final_value = cash + shares * bars[-1].adjusted_close
    return {
        "symbol": symbol,
        "initial_cash": strategy.initial_cash,
        "final_value": round(final_value, 6),
        "cash_left": round(cash, 6),
        "shares": round(shares, 8),
        "trade_count": len(trades),
        "trades": [asdict(trade) for trade in trades],
    }


def run(symbols: tuple[str, ...], start: str, end: str) -> dict:
    strategy = StrategyConfig(commission_rate=0.001, slippage_rate=0.0005)
    outputs = []
    input_manifest = {}
    for symbol in symbols:
        daily = load_yahoo_daily_prices(symbol, start, end)
        bars = daily_to_weekly_bars(daily)
        outputs.append(simulate(symbol, bars, strategy))
        input_manifest[symbol] = {
            "bar_count": len(bars),
            "first_date": bars[0].week_end.isoformat(),
            "last_date": bars[-1].week_end.isoformat(),
        }
    input_hash = hashlib.sha256(json.dumps(input_manifest, sort_keys=True).encode("utf-8")).hexdigest()
    return {
        "version": "v2-causal-baseline",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "research_only": True,
        "execution_rule": "signal at t adjusted close; execute at t+1 adjusted open",
        "strategy": asdict(strategy),
        "input_manifest": input_manifest,
        "input_hash": input_hash,
        "results": outputs,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the isolated v2 causal research baseline.")
    parser.add_argument("--start", default="2021-06-01")
    parser.add_argument("--end", default=datetime.now(timezone.utc).date().isoformat())
    parser.add_argument("--symbols", nargs="*", default=list(DEFAULT_SYMBOLS))
    parser.add_argument("--output", default="research/results/v2/causal-baseline.json")
    args = parser.parse_args()
    payload = run(tuple(symbol.upper() for symbol in args.symbols), args.start, args.end)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {output}")


if __name__ == "__main__":
    main()
