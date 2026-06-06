from __future__ import annotations

import math

from backtest import BacktestResult


def calculate_metrics(result: BacktestResult, initial_cash: float) -> dict[str, float]:
    values = [point.portfolio_value for point in result.history]
    if not values:
        return {}

    returns = []
    for previous, current in zip(values, values[1:]):
        if previous > 0:
            returns.append(current / previous - 1)

    total_return = values[-1] / initial_cash - 1
    weeks = max(len(values), 1)
    annualized_return = (values[-1] / initial_cash) ** (52 / weeks) - 1 if values[-1] > 0 else -1
    max_drawdown = max((point.drawdown for point in result.history), default=0.0)
    volatility = _stddev(returns) * math.sqrt(52) if returns else 0.0
    average_return = sum(returns) / len(returns) if returns else 0.0
    sharpe_ratio = (average_return / _stddev(returns) * math.sqrt(52)) if len(returns) > 1 and _stddev(returns) else 0.0
    final_trade = result.trades[-1] if result.trades else None

    return {
        "total_return": round(total_return, 8),
        "annualized_return": round(annualized_return, 8),
        "max_drawdown": round(max_drawdown, 8),
        "volatility": round(volatility, 8),
        "sharpe_ratio": round(sharpe_ratio, 8),
        "final_portfolio_value": round(values[-1], 6),
        "total_invested": round(result.total_invested, 6),
        "cash_left": round(final_trade.cash if final_trade else initial_cash, 6),
        "number_of_trades": len([trade for trade in result.trades if trade.shares_bought > 0]),
        "average_buy_price": round(result.average_buy_price, 6),
    }


def result_row(strategy_name: str, result: BacktestResult, initial_cash: float) -> dict[str, float | str]:
    row: dict[str, float | str] = {"strategy": strategy_name}
    row.update(calculate_metrics(result, initial_cash))
    return row


def _stddev(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    variance = sum((value - mean) ** 2 for value in values) / (len(values) - 1)
    return math.sqrt(variance)
