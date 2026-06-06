from __future__ import annotations

import csv
import itertools
import os
from dataclasses import replace

from backtest import run_backtest
from config import BacktestConfig
from data_loader import PricePoint
from metrics import calculate_metrics


SENSITIVITY_VALUES = [1, 2, 3, 5, 8, 10]
MIN_MULTIPLIER_VALUES = [0.2, 0.3, 0.5]
MAX_MULTIPLIER_VALUES = [1.5, 2.0, 3.0]


def optimize_parameters(ticker: str, weekly_prices: list[PricePoint], config: BacktestConfig) -> list[dict[str, float]]:
    rows: list[dict[str, float]] = []
    for sensitivity, min_multiplier, max_multiplier in itertools.product(
        SENSITIVITY_VALUES,
        MIN_MULTIPLIER_VALUES,
        MAX_MULTIPLIER_VALUES,
    ):
        if min_multiplier >= max_multiplier:
            continue
        strategy = replace(
            config.strategy,
            sensitivity=float(sensitivity),
            min_multiplier=float(min_multiplier),
            max_multiplier=float(max_multiplier),
        )
        trial_config = replace(config, strategy=strategy)
        result = run_backtest(ticker, weekly_prices, trial_config, save_results=False)
        metrics = calculate_metrics(result, config.strategy.initial_cash)
        rows.append(
            {
                "sensitivity": sensitivity,
                "min_multiplier": min_multiplier,
                "max_multiplier": max_multiplier,
                "total_return": metrics["total_return"],
                "max_drawdown": metrics["max_drawdown"],
                "sharpe_ratio": metrics["sharpe_ratio"],
                "final_portfolio_value": metrics["final_portfolio_value"],
            }
        )
    return rows


def save_parameter_optimization(rows: list[dict[str, float]], results_dir: str) -> str:
    os.makedirs(results_dir, exist_ok=True)
    path = os.path.join(results_dir, "parameter_optimization.csv")
    with open(path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    return path
