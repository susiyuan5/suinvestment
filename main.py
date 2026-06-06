from __future__ import annotations

import argparse
from dataclasses import replace

from backtest import run_backtest
from benchmarks import compare_benchmarks, save_benchmark_comparison
from config import BacktestConfig
from data_loader import daily_to_weekly, load_yahoo_daily_prices
from metrics import calculate_metrics
from optimization import optimize_parameters, save_parameter_optimization
from visualization import save_charts


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backtest weekly-return-adjusted stock buying.")
    parser.add_argument("--ticker", required=True, help="Ticker symbol, e.g. SPY or QQQ")
    parser.add_argument("--start", required=True, help="Start date in YYYY-MM-DD format")
    parser.add_argument("--end", required=True, help="End date in YYYY-MM-DD format")
    parser.add_argument("--mode", default="dip_buy", choices=["dip_buy", "momentum"])
    parser.add_argument("--base-buy", type=float, default=100.0)
    parser.add_argument("--sensitivity", type=float, default=5.0)
    parser.add_argument("--min-multiplier", type=float, default=0.3)
    parser.add_argument("--max-multiplier", type=float, default=2.0)
    parser.add_argument("--initial-cash", type=float, default=10000.0)
    parser.add_argument("--commission-rate", type=float, default=0.001)
    parser.add_argument("--slippage-rate", type=float, default=0.0005)
    parser.add_argument("--no-fractional-shares", action="store_true")
    parser.add_argument("--drawdown-action", default="reduce", choices=["reduce", "pause", "none"])
    parser.add_argument("--optimize", action="store_true", help="Run parameter optimization")
    parser.add_argument("--no-charts", action="store_true", help="Skip PNG chart generation")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    base_config = BacktestConfig()
    strategy = replace(
        base_config.strategy,
        base_buy_amount=args.base_buy,
        sensitivity=args.sensitivity,
        min_multiplier=args.min_multiplier,
        max_multiplier=args.max_multiplier,
        initial_cash=args.initial_cash,
        commission_rate=args.commission_rate,
        slippage_rate=args.slippage_rate,
        strategy_mode=args.mode,
        fractional_shares=not args.no_fractional_shares,
    )
    risk = replace(
        base_config.risk,
        drawdown_action=args.drawdown_action,
    )
    config = replace(base_config, strategy=strategy, risk=risk)

    daily_prices = load_yahoo_daily_prices(args.ticker, args.start, args.end)
    weekly_prices = daily_to_weekly(daily_prices)
    result = run_backtest(args.ticker, weekly_prices, config)
    metrics = calculate_metrics(result, config.strategy.initial_cash)
    benchmark_rows = compare_benchmarks(args.ticker, weekly_prices, result, config)
    save_benchmark_comparison(benchmark_rows, config.results_dir)

    if args.optimize:
        optimization_rows = optimize_parameters(args.ticker, weekly_prices, config)
        save_parameter_optimization(optimization_rows, config.results_dir)

    if not args.no_charts:
        save_charts(result, benchmark_rows, config.results_dir)

    print("Backtest complete")
    print(f"Ticker: {args.ticker.upper()}")
    print(f"Final portfolio value: {metrics['final_portfolio_value']:.2f}")
    print(f"Total return: {metrics['total_return'] * 100:.2f}%")
    print(f"Max drawdown: {metrics['max_drawdown'] * 100:.2f}%")
    print(f"Sharpe ratio: {metrics['sharpe_ratio']:.2f}")
    print(f"Results folder: {config.results_dir}")


if __name__ == "__main__":
    main()
