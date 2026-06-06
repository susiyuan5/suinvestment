from __future__ import annotations

import csv
import math
import os
from dataclasses import asdict, dataclass
from typing import Iterable

from config import BacktestConfig
from data_loader import PricePoint
from strategy import calculate_buy_amount, calculate_weekly_return


@dataclass
class TradeRecord:
    date: str
    ticker: str
    price: float
    weekly_return: float
    buy_multiplier: float
    buy_amount: float
    shares_bought: float
    total_shares: float
    cash: float
    portfolio_value: float
    total_cost: float
    unrealized_profit: float


@dataclass
class PortfolioPoint:
    date: str
    close: float
    cash: float
    total_shares: float
    portfolio_value: float
    drawdown: float


@dataclass
class BacktestResult:
    trades: list[TradeRecord]
    history: list[PortfolioPoint]
    total_invested: float
    final_portfolio_value: float
    average_buy_price: float


def run_backtest(
    ticker: str,
    weekly_prices: Iterable[PricePoint],
    config: BacktestConfig,
    save_results: bool = True,
) -> BacktestResult:
    prices = list(weekly_prices)
    if len(prices) < 2:
        raise ValueError("At least two weekly price points are required")

    cash = config.strategy.initial_cash
    shares = 0.0
    total_invested = 0.0
    total_share_cost = 0.0
    peak_price = prices[0].close
    peak_portfolio = cash
    consecutive_declines = 0
    trades: list[TradeRecord] = []
    history: list[PortfolioPoint] = []

    for index in range(1, len(prices)):
        previous = prices[index - 1]
        current = prices[index]
        weekly_return = calculate_weekly_return(current.close, previous.close)
        peak_price = max(peak_price, current.close)
        price_drawdown = 1 - current.close / peak_price if peak_price else 0
        consecutive_declines = consecutive_declines + 1 if weekly_return < 0 else 0
        conservative_mode = consecutive_declines > config.risk.consecutive_decline_weeks

        desired_amount, multiplier = calculate_buy_amount(
            weekly_return,
            config.strategy,
            conservative_mode=conservative_mode,
        )

        if price_drawdown >= config.risk.drawdown_threshold:
            if config.risk.drawdown_action == "pause":
                desired_amount = 0.0
                multiplier = 0.0
            elif config.risk.drawdown_action == "reduce":
                desired_amount *= config.risk.drawdown_reduce_multiplier
                multiplier = desired_amount / config.strategy.base_buy_amount

        max_by_cash_rule = cash * config.risk.max_single_buy_pct_cash
        desired_amount = min(desired_amount, max_by_cash_rule)
        execution_price = current.close * (1 + config.strategy.slippage_rate)
        affordable_before_commission = cash / (1 + config.strategy.commission_rate)
        buy_amount = min(desired_amount, affordable_before_commission)

        if buy_amount <= 0 or execution_price <= 0:
            shares_bought = 0.0
            total_cost = 0.0
            buy_amount = 0.0
        else:
            shares_bought = buy_amount / execution_price
            if not config.strategy.fractional_shares:
                shares_bought = math.floor(shares_bought)
                buy_amount = shares_bought * execution_price
            commission = buy_amount * config.strategy.commission_rate
            total_cost = buy_amount + commission
            if total_cost > cash and shares_bought > 0:
                buy_amount = affordable_before_commission
                shares_bought = buy_amount / execution_price
                if not config.strategy.fractional_shares:
                    shares_bought = math.floor(shares_bought)
                    buy_amount = shares_bought * execution_price
                commission = buy_amount * config.strategy.commission_rate
                total_cost = buy_amount + commission

        cash -= total_cost
        if cash < 0 and cash > -1e-8:
            cash = 0.0
        shares += shares_bought
        total_invested += total_cost
        total_share_cost += buy_amount
        portfolio_value = cash + shares * current.close
        peak_portfolio = max(peak_portfolio, portfolio_value)
        drawdown = 1 - portfolio_value / peak_portfolio if peak_portfolio else 0
        unrealized_profit = shares * current.close - total_share_cost

        trades.append(
            TradeRecord(
                date=current.date.isoformat(),
                ticker=ticker.upper(),
                price=round(current.close, 6),
                weekly_return=round(weekly_return, 8),
                buy_multiplier=round(multiplier, 6),
                buy_amount=round(buy_amount, 6),
                shares_bought=round(shares_bought, 8),
                total_shares=round(shares, 8),
                cash=round(cash, 6),
                portfolio_value=round(portfolio_value, 6),
                total_cost=round(total_cost, 6),
                unrealized_profit=round(unrealized_profit, 6),
            )
        )
        history.append(
            PortfolioPoint(
                date=current.date.isoformat(),
                close=round(current.close, 6),
                cash=round(cash, 6),
                total_shares=round(shares, 8),
                portfolio_value=round(portfolio_value, 6),
                drawdown=round(drawdown, 8),
            )
        )

    result = BacktestResult(
        trades=trades,
        history=history,
        total_invested=round(total_invested, 6),
        final_portfolio_value=history[-1].portfolio_value if history else config.strategy.initial_cash,
        average_buy_price=round(total_share_cost / shares, 6) if shares else 0.0,
    )
    if save_results:
        save_backtest_result(ticker, result, config.results_dir)
    return result


def save_backtest_result(ticker: str, result: BacktestResult, results_dir: str) -> None:
    os.makedirs(results_dir, exist_ok=True)
    _write_csv(os.path.join(results_dir, f"{ticker.upper()}_trades.csv"), result.trades)
    _write_csv(os.path.join(results_dir, f"{ticker.upper()}_portfolio_history.csv"), result.history)


def _write_csv(path: str, rows: list[object]) -> None:
    if not rows:
        return
    with open(path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(asdict(rows[0]).keys()))
        writer.writeheader()
        for row in rows:
            writer.writerow(asdict(row))
