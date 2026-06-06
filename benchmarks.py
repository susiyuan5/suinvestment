from __future__ import annotations

import csv
import os
from dataclasses import replace

from backtest import BacktestResult, PortfolioPoint, TradeRecord, run_backtest
from config import BacktestConfig
from data_loader import PricePoint
from metrics import result_row


def run_fixed_dca_strategy(ticker: str, weekly_prices: list[PricePoint], config: BacktestConfig) -> BacktestResult:
    fixed_config = replace(
        config,
        strategy=replace(
            config.strategy,
            sensitivity=0.0,
            min_multiplier=1.0,
            max_multiplier=1.0,
            strategy_mode="dip_buy",
        ),
    )
    return run_backtest(ticker, weekly_prices, fixed_config, save_results=False)


def run_lump_sum_strategy(ticker: str, weekly_prices: list[PricePoint], config: BacktestConfig) -> BacktestResult:
    if len(weekly_prices) < 2:
        raise ValueError("At least two weekly price points are required")

    first = weekly_prices[0]
    execution_price = first.close * (1 + config.strategy.slippage_rate)
    buy_amount = config.strategy.initial_cash / (1 + config.strategy.commission_rate)
    shares = buy_amount / execution_price
    if not config.strategy.fractional_shares:
        import math

        shares = math.floor(shares)
        buy_amount = shares * execution_price
    commission = buy_amount * config.strategy.commission_rate
    total_cost = buy_amount + commission
    cash = max(config.strategy.initial_cash - total_cost, 0.0)
    total_share_cost = buy_amount
    trades = [
        TradeRecord(
            date=first.date.isoformat(),
            ticker=ticker.upper(),
            price=round(first.close, 6),
            weekly_return=0.0,
            buy_multiplier=1.0,
            buy_amount=round(buy_amount, 6),
            shares_bought=round(shares, 8),
            total_shares=round(shares, 8),
            cash=round(cash, 6),
            portfolio_value=round(cash + shares * first.close, 6),
            total_cost=round(total_cost, 6),
            unrealized_profit=round(shares * first.close - total_share_cost, 6),
        )
    ]

    peak_value = config.strategy.initial_cash
    history: list[PortfolioPoint] = []
    for point in weekly_prices:
        value = cash + shares * point.close
        peak_value = max(peak_value, value)
        drawdown = 1 - value / peak_value if peak_value else 0.0
        history.append(
            PortfolioPoint(
                date=point.date.isoformat(),
                close=round(point.close, 6),
                cash=round(cash, 6),
                total_shares=round(shares, 8),
                portfolio_value=round(value, 6),
                drawdown=round(drawdown, 8),
            )
        )

    return BacktestResult(
        trades=trades,
        history=history,
        total_invested=round(total_cost, 6),
        final_portfolio_value=history[-1].portfolio_value,
        average_buy_price=round(total_share_cost / shares, 6) if shares else 0.0,
    )


def compare_benchmarks(
    ticker: str,
    weekly_prices: list[PricePoint],
    current_strategy: BacktestResult,
    config: BacktestConfig,
) -> list[dict[str, float | str]]:
    rows = [
        result_row("weekly_return_adjust_strategy", current_strategy, config.strategy.initial_cash),
        result_row("fixed_dca_strategy", run_fixed_dca_strategy(ticker, weekly_prices, config), config.strategy.initial_cash),
        result_row("lump_sum_strategy", run_lump_sum_strategy(ticker, weekly_prices, config), config.strategy.initial_cash),
    ]
    return [
        {
            "strategy": row["strategy"],
            "final_portfolio_value": row["final_portfolio_value"],
            "total_return": row["total_return"],
            "max_drawdown": row["max_drawdown"],
            "sharpe_ratio": row["sharpe_ratio"],
        }
        for row in rows
    ]


def save_benchmark_comparison(rows: list[dict[str, float | str]], results_dir: str) -> str:
    os.makedirs(results_dir, exist_ok=True)
    path = os.path.join(results_dir, "benchmark_comparison.csv")
    with open(path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    return path
