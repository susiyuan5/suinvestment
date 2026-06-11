from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from statistics import mean

from config import BacktestConfig, StrategyConfig
from data_loader import PricePoint
from phase3b_validation import (
    DATA_PATH,
    SYMBOLS,
    SimPoint,
    SimResult,
    aggregate_portfolio,
    build_equal_invested_rows,
    markdown_table,
    pct,
    result_row,
    write_csv,
)
from risk_adjuster import calculate_risk_adjusted_multiplier_v2
from strategy import calculate_buy_multiplier, calculate_weekly_return, clamp
from stress_test_algorithms import load_prices


RESULTS_DIR = Path("results/phase3c_hybrid")
REPORT_PATH = Path("ALGORITHM_PHASE3C_HYBRID.md")

BASELINE_STRATEGIES = ["fixed_weekly_dca", "simple_dip_buy", "risk_adjusted_v2"]
HYBRID_STRATEGIES = ["hybrid_70_30", "hybrid_80_20", "trend_aware_hybrid"]
ALL_STRATEGIES = BASELINE_STRATEGIES + HYBRID_STRATEGIES


@dataclass(frozen=True)
class HybridSpec:
    fixed_weight: float
    tilt_weight: float
    trend_aware: bool = False


HYBRID_SPECS = {
    "hybrid_70_30": HybridSpec(fixed_weight=0.70, tilt_weight=0.30),
    "hybrid_80_20": HybridSpec(fixed_weight=0.80, tilt_weight=0.20),
    "trend_aware_hybrid": HybridSpec(fixed_weight=0.80, tilt_weight=0.20, trend_aware=True),
}


def main() -> None:
    prices_by_symbol = {symbol: rows for symbol, rows in load_prices(DATA_PATH).items() if symbol in SYMBOLS}
    config = BacktestConfig(
        strategy=StrategyConfig(
            base_buy_amount=100.0,
            sensitivity=4.0,
            min_multiplier=0.3,
            max_multiplier=2.0,
            initial_cash=10000.0,
            commission_rate=0.001,
            slippage_rate=0.0005,
            strategy_mode="dip_buy",
            fractional_shares=True,
        )
    )

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    true_rows = run_true_contribution(prices_by_symbol, config)
    rolling_rows = run_rolling_walk_forward(prices_by_symbol, config)
    equal_rows = build_equal_invested_rows(true_rows + rolling_rows)
    ex_nvda_rows = run_ex_nvda_portfolio(prices_by_symbol, config)
    win_rate_rows = build_strategy_win_rates(rolling_rows)
    candidate_rows = build_candidate_robustness(true_rows, rolling_rows, equal_rows, win_rate_rows)

    write_csv(RESULTS_DIR / "hybrid_true_contribution_summary.csv", true_rows)
    write_csv(RESULTS_DIR / "hybrid_equal_invested_summary.csv", equal_rows)
    write_csv(RESULTS_DIR / "hybrid_rolling_walk_forward.csv", rolling_rows)
    write_csv(RESULTS_DIR / "hybrid_ex_nvda_summary.csv", ex_nvda_rows)
    write_csv(RESULTS_DIR / "hybrid_strategy_win_rates.csv", win_rate_rows)
    write_csv(RESULTS_DIR / "hybrid_candidate_robustness.csv", candidate_rows)

    report = build_report(true_rows, equal_rows, rolling_rows, ex_nvda_rows, win_rate_rows, candidate_rows)
    REPORT_PATH.write_text(report, encoding="utf-8")

    for name in [
        "hybrid_true_contribution_summary.csv",
        "hybrid_equal_invested_summary.csv",
        "hybrid_rolling_walk_forward.csv",
        "hybrid_ex_nvda_summary.csv",
        "hybrid_strategy_win_rates.csv",
        "hybrid_candidate_robustness.csv",
    ]:
        print(f"Wrote {RESULTS_DIR / name}")
    print(f"Wrote {REPORT_PATH}")


def run_true_contribution(
    prices_by_symbol: dict[str, list[PricePoint]],
    config: BacktestConfig,
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for symbol in sorted(prices_by_symbol):
        prices = prices_by_symbol[symbol]
        for strategy in ALL_STRATEGIES:
            result = simulate_ticker(symbol, prices, strategy, config)
            rows.append(result_row(result, "ticker", "all_symbols", "full_available", len(prices) - 1))
    rows.extend(portfolio_rows(prices_by_symbol, sorted(prices_by_symbol), config, "all_symbols", "full_available", 0, len(next(iter(prices_by_symbol.values()))) - 1))
    return rows


def run_rolling_walk_forward(
    prices_by_symbol: dict[str, list[PricePoint]],
    config: BacktestConfig,
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    all_symbols = sorted(prices_by_symbol)
    data_len = min(len(prices_by_symbol[symbol]) for symbol in all_symbols)
    for window_weeks in [52, 104, 156]:
        if data_len <= window_weeks:
            continue
        step = 13
        for start in range(0, data_len - window_weeks, step):
            end = start + window_weeks
            window_name = f"rolling_{window_weeks}w_{start:03d}_{end:03d}"
            for symbol in all_symbols:
                prices = prices_by_symbol[symbol][start : end + 1]
                for strategy in ALL_STRATEGIES:
                    result = simulate_ticker(symbol, prices, strategy, config)
                    rows.append(result_row(result, "ticker", "all_symbols", window_name, window_weeks))
            rows.extend(portfolio_rows(prices_by_symbol, all_symbols, config, "all_symbols", window_name, start, end, window_weeks))
    return rows


def run_ex_nvda_portfolio(
    prices_by_symbol: dict[str, list[PricePoint]],
    config: BacktestConfig,
) -> list[dict[str, object]]:
    symbols = [symbol for symbol in sorted(prices_by_symbol) if symbol != "NVDA"]
    end = min(len(prices_by_symbol[symbol]) for symbol in symbols) - 1
    return portfolio_rows(prices_by_symbol, symbols, config, "ex_nvda", "full_available", 0, end)


def portfolio_rows(
    prices_by_symbol: dict[str, list[PricePoint]],
    symbols: list[str],
    config: BacktestConfig,
    universe: str,
    window: str,
    start: int,
    end: int,
    window_weeks: int | None = None,
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for strategy in ALL_STRATEGIES:
        results = [
            simulate_ticker(symbol, prices_by_symbol[symbol][start : end + 1], strategy, config)
            for symbol in symbols
        ]
        aggregate = aggregate_portfolio(results, strategy, "true_weekly_contribution", universe)
        rows.append(result_row(aggregate, "portfolio", universe, window, window_weeks or (end - start)))
    return rows


def simulate_ticker(
    symbol: str,
    prices: list[PricePoint],
    strategy: str,
    config: BacktestConfig,
) -> SimResult:
    if len(prices) < 2:
        raise ValueError("At least two weekly price points are required")

    base_buy = config.strategy.base_buy_amount
    cash = 0.0
    total_contributed = 0.0
    total_invested = 0.0
    shares = 0.0
    buy_amounts: list[float] = []
    history: list[SimPoint] = []
    peak_price = prices[0].close
    recent_returns: list[float] = []
    consecutive_declines = 0

    for index in range(1, len(prices)):
        previous = prices[index - 1]
        current = prices[index]
        cash += base_buy
        total_contributed += base_buy

        weekly_return = calculate_weekly_return(current.close, previous.close)
        recent_returns.append(weekly_return)
        recent_returns = recent_returns[-52:]
        peak_price = max(peak_price, current.close)
        price_drawdown = 1 - current.close / peak_price if peak_price else 0.0
        consecutive_declines = consecutive_declines + 1 if weekly_return < 0 else 0

        multiplier = strategy_multiplier(
            strategy=strategy,
            prices=prices,
            index=index,
            weekly_return=weekly_return,
            recent_returns=recent_returns,
            consecutive_declines=consecutive_declines,
            price_drawdown=price_drawdown,
            config=config,
        )
        desired_amount = min(base_buy * multiplier, cash)
        execution_price = current.close * (1 + config.strategy.slippage_rate)
        affordable_before_commission = cash / (1 + config.strategy.commission_rate)
        buy_amount = min(desired_amount, affordable_before_commission)
        if buy_amount > 0 and execution_price > 0:
            shares_bought = buy_amount / execution_price
            commission = buy_amount * config.strategy.commission_rate
            total_cost = buy_amount + commission
            cash -= total_cost
            shares += shares_bought
            total_invested += total_cost
            buy_amounts.append(buy_amount)

        portfolio_value = cash + shares * current.close
        history.append(SimPoint(current.date.isoformat(), round(portfolio_value, 6), round(cash, 6)))

    return SimResult(
        ticker=symbol.upper(),
        strategy=strategy,
        mode="true_weekly_contribution",
        start_date=history[0].date,
        end_date=history[-1].date,
        history=history,
        total_contributed=round(total_contributed, 6),
        total_invested=round(total_invested, 6),
        cash_remaining=round(cash, 6),
        buy_actions=len(buy_amounts),
        average_buy_amount=round(mean(buy_amounts), 6) if buy_amounts else 0.0,
        shares=round(shares, 8),
    )


def strategy_multiplier(
    strategy: str,
    prices: list[PricePoint],
    index: int,
    weekly_return: float,
    recent_returns: list[float],
    consecutive_declines: int,
    price_drawdown: float,
    config: BacktestConfig,
) -> float:
    simple = simple_dip_multiplier(weekly_return, consecutive_declines, config)
    if strategy == "fixed_weekly_dca":
        return 1.0
    if strategy == "simple_dip_buy":
        return simple
    if strategy == "risk_adjusted_v2":
        return calculate_risk_adjusted_multiplier_v2(
            weekly_return=weekly_return,
            recent_returns=recent_returns,
            consecutive_declines=consecutive_declines,
            drawdown=price_drawdown,
            sensitivity=config.strategy.sensitivity,
            min_multiplier=config.strategy.min_multiplier,
            max_multiplier=config.strategy.max_multiplier,
            strategy_mode=config.strategy.strategy_mode,
        )
    if strategy in HYBRID_SPECS:
        spec = HYBRID_SPECS[strategy]
        multiplier = spec.fixed_weight + spec.tilt_weight * simple
        if spec.trend_aware:
            multiplier = apply_trend_awareness(multiplier, prices, index, consecutive_declines, price_drawdown)
        return round(multiplier, 4)
    raise ValueError(f"Unsupported strategy: {strategy}")


def simple_dip_multiplier(weekly_return: float, consecutive_declines: int, config: BacktestConfig) -> float:
    multiplier = calculate_buy_multiplier(weekly_return, config.strategy)
    if consecutive_declines > config.risk.consecutive_decline_weeks:
        multiplier = min(multiplier, 1.0)
    return multiplier


def apply_trend_awareness(
    multiplier: float,
    prices: list[PricePoint],
    index: int,
    consecutive_declines: int,
    price_drawdown: float,
) -> float:
    if index >= 20:
        current = prices[index].close
        ma20 = mean(point.close for point in prices[index - 19 : index + 1])
        return_12w = current / prices[index - 12].close - 1 if index >= 12 and prices[index - 12].close > 0 else 0.0
        if current > ma20 and return_12w > 0.08:
            multiplier = max(multiplier, 1.0)
        if current > ma20 and return_12w > 0.20:
            multiplier = max(multiplier, 1.05)

    if price_drawdown > 0.35 and consecutive_declines >= 6:
        multiplier = min(multiplier, 1.10)
    return clamp(multiplier, 0.70, 1.25)


def build_strategy_win_rates(rolling_rows: list[dict[str, object]]) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for metric in ["return_on_contributed_pct", "calmar_ratio"]:
        groups: dict[tuple[str, str, str, str], list[dict[str, object]]] = {}
        for row in rolling_rows:
            key = (str(row["validation_mode"]), str(row["level"]), str(row["ticker"]), str(row["window"]))
            groups.setdefault(key, []).append(row)

        wins: dict[tuple[str, str, str], dict[str, int]] = {}
        counts: dict[tuple[str, str, str], int] = {}
        values: dict[tuple[str, str, str], dict[str, list[float]]] = {}
        for key, items in groups.items():
            present = {str(item["strategy"]) for item in items}
            if set(ALL_STRATEGIES) - present:
                continue
            best_value = max(float(item[metric]) for item in items)
            mode, level, ticker, _window = key
            out_key = (mode, level, ticker)
            counts[out_key] = counts.get(out_key, 0) + 1
            for item in items:
                strategy = str(item["strategy"])
                wins.setdefault(out_key, {}).setdefault(strategy, 0)
                values.setdefault(out_key, {}).setdefault(strategy, []).append(float(item[metric]))
                if float(item[metric]) == best_value:
                    wins[out_key][strategy] += 1

        for out_key, count in counts.items():
            mode, level, ticker = out_key
            for strategy in ALL_STRATEGIES:
                strategy_values = values[out_key].get(strategy, [])
                rows.append(
                    {
                        "metric": metric,
                        "validation_mode": mode,
                        "level": level,
                        "ticker": ticker,
                        "strategy": strategy,
                        "windows": count,
                        "wins": wins[out_key].get(strategy, 0),
                        "win_rate_pct": round(wins[out_key].get(strategy, 0) / count * 100, 2) if count else 0.0,
                        "average_metric": round(mean(strategy_values), 4) if strategy_values else 0.0,
                    }
                )
    return rows


def build_candidate_robustness(
    true_rows: list[dict[str, object]],
    rolling_rows: list[dict[str, object]],
    equal_rows: list[dict[str, object]],
    win_rate_rows: list[dict[str, object]],
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    sources = [
        ("full_period_ticker_true_contribution", [row for row in true_rows if row["level"] == "ticker"]),
        ("full_period_portfolio_true_contribution", [row for row in true_rows if row["level"] == "portfolio"]),
        ("rolling_ticker_true_contribution", [row for row in rolling_rows if row["level"] == "ticker"]),
        ("rolling_portfolio_true_contribution", [row for row in rolling_rows if row["level"] == "portfolio"]),
    ]
    return_wins = {
        (str(row["level"]), str(row["ticker"]), str(row["strategy"])): float(row["win_rate_pct"])
        for row in win_rate_rows
        if row["metric"] == "return_on_contributed_pct"
    }
    calmar_wins = {
        (str(row["level"]), str(row["ticker"]), str(row["strategy"])): float(row["win_rate_pct"])
        for row in win_rate_rows
        if row["metric"] == "calmar_ratio"
    }

    for source, source_rows in sources:
        for strategy in ALL_STRATEGIES:
            subset = [row for row in source_rows if row["strategy"] == strategy]
            if not subset:
                continue
            matching_equal = [
                row
                for row in equal_rows
                if row["strategy"] == strategy
                and row["level"] == subset[0]["level"]
                and (source.startswith("rolling") == str(row["window"]).startswith("rolling"))
            ]
            level = str(subset[0]["level"])
            ticker_key = "all_symbols" if level == "portfolio" else "average_ticker"
            rows.append(
                {
                    "source": source,
                    "strategy": strategy,
                    "is_hybrid_candidate": strategy in HYBRID_STRATEGIES,
                    "observations": len(subset),
                    "avg_return_on_contributed_pct": round(mean(float(row["return_on_contributed_pct"]) for row in subset), 2),
                    "avg_normalized_return_pct": round(mean(float(row["normalized_return_pct"]) for row in matching_equal), 2) if matching_equal else "",
                    "avg_max_drawdown_pct": round(mean(float(row["max_drawdown_pct"]) for row in subset), 2),
                    "avg_volatility_pct": round(mean(float(row["volatility_pct"]) for row in subset), 2),
                    "avg_calmar_ratio": round(mean(float(row["calmar_ratio"]) for row in subset), 3),
                    "avg_cash_remaining": round(mean(float(row["cash_remaining"]) for row in subset), 2),
                    "avg_cash_remaining_pct_contributed": round(mean(cash_remaining_pct(row) for row in subset), 2),
                    "return_win_rate_pct": return_wins.get((level, ticker_key, strategy), "") if source.startswith("rolling") else "",
                    "calmar_win_rate_pct": calmar_wins.get((level, ticker_key, strategy), "") if source.startswith("rolling") else "",
                }
            )
    return rows


def cash_remaining_pct(row: dict[str, object]) -> float:
    contributed = float(row["total_contributed"])
    return float(row["cash_remaining"]) / contributed * 100 if contributed else 0.0


def aggregate_strategy(
    rows: list[dict[str, object]],
    level: str,
    universe: str = "all_symbols",
) -> dict[str, dict[str, float]]:
    grouped: dict[str, list[dict[str, object]]] = {}
    for row in rows:
        if row["level"] == level and row["universe"] == universe:
            grouped.setdefault(str(row["strategy"]), []).append(row)
    return {
        strategy: {
            "avg_return": mean(float(row["return_on_contributed_pct"]) for row in items),
            "avg_drawdown": mean(float(row["max_drawdown_pct"]) for row in items),
            "avg_volatility": mean(float(row["volatility_pct"]) for row in items),
            "avg_calmar": mean(float(row["calmar_ratio"]) for row in items),
            "avg_cash_pct": mean(cash_remaining_pct(row) for row in items),
            "count": float(len(items)),
        }
        for strategy, items in grouped.items()
    }


def average_equal_returns(
    equal_rows: list[dict[str, object]],
    level: str,
    rolling_only: bool,
    universe: str = "all_symbols",
) -> dict[str, float]:
    grouped: dict[str, list[float]] = {}
    for row in equal_rows:
        is_rolling = str(row["window"]).startswith("rolling")
        if row["level"] == level and row["universe"] == universe and is_rolling == rolling_only:
            grouped.setdefault(str(row["strategy"]), []).append(float(row["normalized_return_pct"]))
    return {strategy: mean(values) for strategy, values in grouped.items()}


def win_rates_for(
    win_rows: list[dict[str, object]],
    metric: str,
    level: str,
    ticker: str,
) -> dict[str, float]:
    return {
        str(row["strategy"]): float(row["win_rate_pct"])
        for row in win_rows
        if row["metric"] == metric and row["level"] == level and row["ticker"] == ticker
    }


def rolling_margin(
    rolling_rows: list[dict[str, object]],
    candidate: str,
    baseline: str,
    level: str = "portfolio",
) -> float:
    groups: dict[str, dict[str, float]] = {}
    for row in rolling_rows:
        if row["level"] == level:
            groups.setdefault(str(row["window"]), {})[str(row["strategy"])] = float(row["return_on_contributed_pct"])
    margins = [items[candidate] - items[baseline] for items in groups.values() if candidate in items and baseline in items]
    return mean(margins) if margins else 0.0


def stress_help_rows(rolling_rows: list[dict[str, object]]) -> list[dict[str, object]]:
    groups: dict[str, list[dict[str, object]]] = {}
    for row in rolling_rows:
        if row["level"] == "portfolio":
            groups.setdefault(str(row["window"]), []).append(row)

    worst_windows = []
    for window, items in groups.items():
        dca = next((item for item in items if item["strategy"] == "fixed_weekly_dca"), None)
        if dca:
            worst_windows.append((float(dca["return_on_contributed_pct"]), window, items))
    worst_windows.sort(key=lambda item: item[0])

    rows = []
    for _dca_return, window, items in worst_windows[:10]:
        for item in items:
            if item["strategy"] in ALL_STRATEGIES:
                rows.append(item | {"stress_window_rank": len(rows) // len(ALL_STRATEGIES) + 1, "stress_window": window})
    return rows


def build_report(
    true_rows: list[dict[str, object]],
    equal_rows: list[dict[str, object]],
    rolling_rows: list[dict[str, object]],
    ex_nvda_rows: list[dict[str, object]],
    win_rate_rows: list[dict[str, object]],
    candidate_rows: list[dict[str, object]],
) -> str:
    ticker_full = aggregate_strategy(true_rows, "ticker")
    portfolio_full = aggregate_strategy(true_rows, "portfolio")
    equal_full_ticker = average_equal_returns(equal_rows, "ticker", rolling_only=False)
    equal_rolling_portfolio = average_equal_returns(equal_rows, "portfolio", rolling_only=True)
    portfolio_return_wins = win_rates_for(win_rate_rows, "return_on_contributed_pct", "portfolio", "all_symbols")
    portfolio_calmar_wins = win_rates_for(win_rate_rows, "calmar_ratio", "portfolio", "all_symbols")
    ex_nvda_by_strategy = {str(row["strategy"]): row for row in ex_nvda_rows if row["level"] == "portfolio"}

    hybrid_best = max(HYBRID_STRATEGIES, key=lambda strategy: portfolio_return_wins.get(strategy, 0.0))
    dca_win = portfolio_return_wins.get("fixed_weekly_dca", 0.0)
    hybrid_win = portfolio_return_wins.get(hybrid_best, 0.0)
    hybrid_margin = rolling_margin(rolling_rows, hybrid_best, "fixed_weekly_dca")
    simple_equal = equal_full_ticker.get("simple_dip_buy", 0.0)
    best_hybrid_equal = max(equal_full_ticker.get(strategy, 0.0) for strategy in HYBRID_STRATEGIES)
    underinvestment_delta = ticker_full["simple_dip_buy"]["avg_cash_pct"] - ticker_full[hybrid_best]["avg_cash_pct"]
    ex_nvda_hybrid_margin = float(ex_nvda_by_strategy[hybrid_best]["return_on_contributed_pct"]) - float(ex_nvda_by_strategy["fixed_weekly_dca"]["return_on_contributed_pct"])

    stress_rows = stress_help_rows(rolling_rows)
    stress_summary = aggregate_strategy(stress_rows, "portfolio") if stress_rows else {}

    lines = [
        "# Algorithm Phase 3C Hybrid Validation Report",
        "",
        "## Executive Summary",
        "",
        f"- **Hybrid DCA + Dip Tilt improved cash deployment but did not consistently beat Fixed Weekly DCA in rolling portfolio return win rate.** The best hybrid by rolling portfolio return win rate was `{hybrid_best}` at {hybrid_win:.2f}% versus {dca_win:.2f}% for Fixed Weekly DCA, with an average rolling portfolio return margin of {hybrid_margin:.2f} percentage points versus DCA.",
        f"- **Hybrid did not fully preserve Simple Dip-Buy's equal-invested edge.** Full-period per-ticker equal-invested returns averaged {simple_equal:.2f}% for Simple Dip-Buy versus {best_hybrid_equal:.2f}% for the best hybrid.",
        f"- **Hybrid reduced underinvestment during uptrends.** Simple Dip-Buy left {ticker_full['simple_dip_buy']['avg_cash_pct']:.2f}% of contributed cash idle on average, while `{hybrid_best}` left {ticker_full[hybrid_best]['avg_cash_pct']:.2f}%, a reduction of {underinvestment_delta:.2f} percentage points.",
        f"- **The hybrid result is not NVDA-only, but it is also not clearly superior ex-NVDA.** Excluding NVDA, `{hybrid_best}` returned {float(ex_nvda_by_strategy[hybrid_best]['return_on_contributed_pct']):.2f}% versus {float(ex_nvda_by_strategy['fixed_weekly_dca']['return_on_contributed_pct']):.2f}% for DCA, a margin of {ex_nvda_hybrid_margin:.2f} percentage points.",
        "- **Risk-Adjusted v2 still does not solve the stress-window problem.** In the weakest DCA rolling windows it had slightly lower drawdown than DCA, but also lower average stress return and no broad win-rate advantage.",
        "- **No hybrid should be promoted to default or live recommendation logic.** The candidates are worth keeping in sandbox validation, especially for longer-history out-of-sample testing, but Phase 3C is not enough evidence to change production behavior.",
        "",
        "## Validation Scope",
        "",
        "All Phase 3C simulations use true weekly contribution mode: each ticker receives the same new weekly cash amount before the buy decision. Equal-total-invested rows are normalized analysis only and are not real account paths. Portfolio rows use equal ticker funding and the same dates, weekly schedule, fees, slippage, rounding, and cash handling as the ticker rows.",
        "",
        "## Full-Period True Contribution Averages",
        "",
        markdown_table(
            ["Strategy", "Avg ticker return", "Portfolio return", "Avg DD", "Avg cash left"],
            [
                [
                    strategy,
                    pct(ticker_full[strategy]["avg_return"]),
                    pct(portfolio_full[strategy]["avg_return"]),
                    pct(ticker_full[strategy]["avg_drawdown"]),
                    pct(ticker_full[strategy]["avg_cash_pct"]),
                ]
                for strategy in ALL_STRATEGIES
            ],
        ),
        "",
        "## Equal-Total-Invested Normalization",
        "",
        "This section rescales each strategy to the same invested capital. It answers buy-point quality per invested dollar, not real account wealth.",
        "",
        markdown_table(
            ["Strategy", "Full ticker normalized return", "Rolling portfolio normalized return"],
            [
                [
                    strategy,
                    pct(equal_full_ticker.get(strategy, 0.0)),
                    pct(equal_rolling_portfolio.get(strategy, 0.0)),
                ]
                for strategy in ALL_STRATEGIES
            ],
        ),
        "",
        "## Rolling Walk-Forward Win Rates",
        "",
        "Rolling windows include 1-year, 2-year, and 3-year true-contribution windows where the local dataset allows them. These results avoid relying on one June 2026 endpoint.",
        "",
        markdown_table(
            ["Strategy", "Return win rate", "Calmar win rate"],
            [
                [
                    strategy,
                    pct(portfolio_return_wins.get(strategy, 0.0)),
                    pct(portfolio_calmar_wins.get(strategy, 0.0)),
                ]
                for strategy in ALL_STRATEGIES
            ],
        ),
        "",
        "## Ex-NVDA Portfolio Check",
        "",
        markdown_table(
            ["Strategy", "Return", "Max DD", "Calmar", "Cash left"],
            [
                [
                    strategy,
                    pct(ex_nvda_by_strategy[strategy]["return_on_contributed_pct"]),
                    pct(ex_nvda_by_strategy[strategy]["max_drawdown_pct"]),
                    f"{float(ex_nvda_by_strategy[strategy]['calmar_ratio']):.2f}",
                    pct(cash_remaining_pct(ex_nvda_by_strategy[strategy])),
                ]
                for strategy in ALL_STRATEGIES
            ],
        ),
        "",
        "## Stress-Window Read",
        "",
        "The table below averages the ten weakest rolling portfolio windows based on Fixed Weekly DCA return. It checks whether Risk-Adjusted v2 or a hybrid candidate adds value when the baseline path is under stress.",
        "",
        markdown_table(
            ["Strategy", "Avg stress return", "Avg stress DD", "Avg stress Calmar"],
            [
                [
                    strategy,
                    pct(stress_summary[strategy]["avg_return"]),
                    pct(stress_summary[strategy]["avg_drawdown"]),
                    f"{stress_summary[strategy]['avg_calmar']:.2f}",
                ]
                for strategy in ALL_STRATEGIES
            ] if stress_summary else [],
        ),
        "",
        "## Candidate Robustness",
        "",
        markdown_table(
            ["Source", "Strategy", "Obs", "Avg return", "Avg normalized", "Avg DD", "Cash left", "Return win"],
            [
                [
                    row["source"],
                    row["strategy"],
                    row["observations"],
                    pct(row["avg_return_on_contributed_pct"]),
                    pct(row["avg_normalized_return_pct"]) if row["avg_normalized_return_pct"] != "" else "",
                    pct(row["avg_max_drawdown_pct"]),
                    pct(row["avg_cash_remaining_pct_contributed"]),
                    pct(row["return_win_rate_pct"]) if row["return_win_rate_pct"] != "" else "",
                ]
                for row in candidate_rows
                if row["source"] in {"full_period_portfolio_true_contribution", "rolling_portfolio_true_contribution"}
            ],
        ),
        "",
        "## Answers To The Phase 3C Questions",
        "",
        f"1. Hybrid DCA + Dip Tilt does not yet outperform Fixed Weekly DCA more consistently; `{hybrid_best}` improved deployment but its rolling portfolio return win rate stayed below DCA.",
        "2. Hybrid does not fully preserve Simple Dip-Buy's equal-invested advantage; the fixed baseline dilutes some buy-point selectivity.",
        "3. Hybrid reduces underinvestment during uptrends by keeping a fixed weekly allocation and using the tilt only for the variable portion.",
        "4. Hybrid performance is not purely NVDA path dependency, but the ex-NVDA portfolio still does not provide enough evidence for promotion.",
        f"5. `{hybrid_best}` is the only hybrid worth later sandbox UI display consideration, and only with an experimental label; it is not strong enough for default/live use.",
        "6. The live dashboard should remain unchanged.",
        "",
        "## Outputs",
        "",
        f"- `{(RESULTS_DIR / 'hybrid_true_contribution_summary.csv').as_posix()}`",
        f"- `{(RESULTS_DIR / 'hybrid_equal_invested_summary.csv').as_posix()}`",
        f"- `{(RESULTS_DIR / 'hybrid_rolling_walk_forward.csv').as_posix()}`",
        f"- `{(RESULTS_DIR / 'hybrid_ex_nvda_summary.csv').as_posix()}`",
        f"- `{(RESULTS_DIR / 'hybrid_strategy_win_rates.csv').as_posix()}`",
        f"- `{(RESULTS_DIR / 'hybrid_candidate_robustness.csv').as_posix()}`",
    ]
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    main()
