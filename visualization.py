from __future__ import annotations

import os

from backtest import BacktestResult


def save_charts(result: BacktestResult, benchmark_rows: list[dict[str, float | str]], results_dir: str) -> list[str]:
    try:
        import matplotlib.pyplot as plt
    except ImportError:
        print("matplotlib is not installed; skipping chart generation.")
        return []

    os.makedirs(results_dir, exist_ok=True)
    saved: list[str] = []

    dates = [point.date for point in result.history]
    values = [point.portfolio_value for point in result.history]
    drawdowns = [point.drawdown for point in result.history]
    buy_amounts = [trade.buy_amount for trade in result.trades]
    prices = [trade.price for trade in result.trades]

    saved.append(_line_chart(plt, dates, values, "Portfolio Value", "Value", os.path.join(results_dir, "portfolio_value.png")))
    saved.append(_bar_chart(plt, benchmark_rows, os.path.join(results_dir, "benchmark_comparison.png")))
    saved.append(_line_chart(plt, dates, buy_amounts, "Buy Amounts", "Buy Amount", os.path.join(results_dir, "buy_amounts.png")))
    saved.append(_line_chart(plt, dates, drawdowns, "Drawdown", "Drawdown", os.path.join(results_dir, "drawdown.png")))
    saved.append(_scatter_chart(plt, dates, prices, buy_amounts, os.path.join(results_dir, "buy_points.png")))
    return saved


def _line_chart(plt, dates, values, title: str, ylabel: str, path: str) -> str:
    plt.figure(figsize=(10, 5))
    plt.plot(dates, values)
    plt.title(title)
    plt.ylabel(ylabel)
    plt.xticks(rotation=45, ha="right")
    plt.tight_layout()
    plt.savefig(path)
    plt.close()
    return path


def _bar_chart(plt, rows, path: str) -> str:
    plt.figure(figsize=(9, 5))
    labels = [str(row["strategy"]) for row in rows]
    values = [float(row["final_portfolio_value"]) for row in rows]
    plt.bar(labels, values)
    plt.title("Benchmark Comparison")
    plt.ylabel("Final Portfolio Value")
    plt.xticks(rotation=15, ha="right")
    plt.tight_layout()
    plt.savefig(path)
    plt.close()
    return path


def _scatter_chart(plt, dates, prices, buy_amounts, path: str) -> str:
    sizes = [max(amount, 1) for amount in buy_amounts]
    plt.figure(figsize=(10, 5))
    plt.plot(dates, prices, color="#334155", linewidth=1)
    plt.scatter(dates, prices, s=sizes, alpha=0.55)
    plt.title("Buy Points")
    plt.ylabel("Price")
    plt.xticks(rotation=45, ha="right")
    plt.tight_layout()
    plt.savefig(path)
    plt.close()
    return path
