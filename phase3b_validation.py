from __future__ import annotations

import csv
import math
from dataclasses import dataclass
from pathlib import Path
from statistics import mean, median

from config import BacktestConfig, StrategyConfig
from data_loader import PricePoint
from risk_adjuster import calculate_risk_adjusted_multiplier_v2
from strategy import calculate_buy_multiplier, calculate_weekly_return
from stress_test_algorithms import enhanced_multiplier, load_prices, risk_adjusted_candidate_multiplier


DATA_PATH = Path("data/backtest-prices.json")
PHASE3A_RANKED_PATH = Path("results/phase3a_stress/parameter_sensitivity_ranked.csv")
RESULTS_DIR = Path("results/phase3b_validation")
REPORT_PATH = Path("ALGORITHM_PHASE3B_VALIDATION.md")
SYMBOLS = ["NVDA", "MSFT", "AAPL", "ASML", "KO", "BYDDY"]
CORE_STRATEGIES = ["fixed_weekly_dca", "simple_dip_buy", "risk_adjusted_v2"]
ALL_STRATEGIES = CORE_STRATEGIES + ["enhanced_low_frequency_proxy", "v3_sandbox_candidate"]


@dataclass(frozen=True)
class RiskParams:
    name: str
    sensitivity: float
    min_multiplier: float
    max_multiplier: float
    target_weekly_vol: float
    extreme_drawdown_cap: float
    consecutive_decline_cap: float
    combined_stress_cap: float


@dataclass(frozen=True)
class SimPoint:
    date: str
    value: float
    cash: float


@dataclass(frozen=True)
class SimResult:
    ticker: str
    strategy: str
    mode: str
    start_date: str
    end_date: str
    history: list[SimPoint]
    total_contributed: float
    total_invested: float
    cash_remaining: float
    buy_actions: int
    average_buy_amount: float
    shares: float

    @property
    def final_value(self) -> float:
        return self.history[-1].value if self.history else self.cash_remaining


def main() -> None:
    prices_by_symbol = {symbol: rows for symbol, rows in load_prices(DATA_PATH).items() if symbol in SYMBOLS}
    v3_params = load_top_v3_candidate(PHASE3A_RANKED_PATH)
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

    initial_rows = run_full_period_mode(prices_by_symbol, config, v3_params, "initial_cash_pool")
    true_contribution_rows = run_full_period_mode(prices_by_symbol, config, v3_params, "true_weekly_contribution")
    rolling_rows = run_rolling_walk_forward(prices_by_symbol, config, v3_params)
    equal_invested_rows = build_equal_invested_rows(initial_rows + true_contribution_rows + rolling_rows)
    ex_nvda_rows = run_ex_nvda_portfolio(prices_by_symbol, config, v3_params)
    win_rate_rows = build_win_rate_rows(rolling_rows)
    v3_rows = build_v3_robustness_rows(rolling_rows, initial_rows, true_contribution_rows, v3_params)

    write_csv(RESULTS_DIR / "initial_cash_pool_summary.csv", initial_rows)
    write_csv(RESULTS_DIR / "true_contribution_summary.csv", true_contribution_rows)
    write_csv(RESULTS_DIR / "equal_invested_summary.csv", equal_invested_rows)
    write_csv(RESULTS_DIR / "rolling_walk_forward.csv", rolling_rows)
    write_csv(RESULTS_DIR / "ex_nvda_portfolio_summary.csv", ex_nvda_rows)
    write_csv(RESULTS_DIR / "strategy_win_rates.csv", win_rate_rows)
    write_csv(RESULTS_DIR / "v3_candidate_robustness.csv", v3_rows)

    report = build_report(
        initial_rows,
        true_contribution_rows,
        equal_invested_rows,
        rolling_rows,
        ex_nvda_rows,
        win_rate_rows,
        v3_rows,
        v3_params,
    )
    REPORT_PATH.write_text(report, encoding="utf-8")

    print(f"Wrote {RESULTS_DIR / 'initial_cash_pool_summary.csv'}")
    print(f"Wrote {RESULTS_DIR / 'true_contribution_summary.csv'}")
    print(f"Wrote {RESULTS_DIR / 'equal_invested_summary.csv'}")
    print(f"Wrote {RESULTS_DIR / 'rolling_walk_forward.csv'}")
    print(f"Wrote {RESULTS_DIR / 'ex_nvda_portfolio_summary.csv'}")
    print(f"Wrote {RESULTS_DIR / 'strategy_win_rates.csv'}")
    print(f"Wrote {RESULTS_DIR / 'v3_candidate_robustness.csv'}")
    print(f"Wrote {REPORT_PATH}")


def load_top_v3_candidate(path: Path) -> RiskParams:
    with path.open(newline="", encoding="utf-8") as handle:
        row = next(csv.DictReader(handle))
    return RiskParams(
        name=row["parameter_set"],
        sensitivity=float(row["sensitivity"]),
        min_multiplier=float(row["min_multiplier"]),
        max_multiplier=float(row["max_multiplier"]),
        target_weekly_vol=float(row["target_weekly_vol"]),
        extreme_drawdown_cap=float(row["extreme_drawdown_cap"]),
        consecutive_decline_cap=float(row["consecutive_decline_cap"]),
        combined_stress_cap=float(row["combined_stress_cap"]),
    )


def run_full_period_mode(
    prices_by_symbol: dict[str, list[PricePoint]],
    config: BacktestConfig,
    v3_params: RiskParams,
    mode: str,
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for symbol in sorted(prices_by_symbol):
        prices = prices_by_symbol[symbol]
        results = [simulate_ticker(symbol, prices, strategy, mode, config, v3_params) for strategy in ALL_STRATEGIES]
        rows.extend(result_row(result, "ticker", "all_symbols", "full_available", len(prices) - 1) for result in results)
    rows.extend(portfolio_rows(prices_by_symbol, sorted(prices_by_symbol), ALL_STRATEGIES, mode, config, v3_params, "all_symbols", "full_available", 0, len(next(iter(prices_by_symbol.values()))) - 1))
    return rows


def run_rolling_walk_forward(
    prices_by_symbol: dict[str, list[PricePoint]],
    config: BacktestConfig,
    v3_params: RiskParams,
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
                    result = simulate_ticker(symbol, prices, strategy, "true_weekly_contribution", config, v3_params)
                    rows.append(result_row(result, "ticker", "all_symbols", window_name, window_weeks))
            rows.extend(portfolio_rows(prices_by_symbol, all_symbols, ALL_STRATEGIES, "true_weekly_contribution", config, v3_params, "all_symbols", window_name, start, end, window_weeks))
    return rows


def run_ex_nvda_portfolio(
    prices_by_symbol: dict[str, list[PricePoint]],
    config: BacktestConfig,
    v3_params: RiskParams,
) -> list[dict[str, object]]:
    symbols = [symbol for symbol in sorted(prices_by_symbol) if symbol != "NVDA"]
    end = min(len(prices_by_symbol[symbol]) for symbol in symbols) - 1
    rows = portfolio_rows(prices_by_symbol, symbols, ALL_STRATEGIES, "initial_cash_pool", config, v3_params, "ex_nvda", "full_available", 0, end)
    rows.extend(portfolio_rows(prices_by_symbol, symbols, ALL_STRATEGIES, "true_weekly_contribution", config, v3_params, "ex_nvda", "full_available", 0, end))
    return rows


def portfolio_rows(
    prices_by_symbol: dict[str, list[PricePoint]],
    symbols: list[str],
    strategies: list[str],
    mode: str,
    config: BacktestConfig,
    v3_params: RiskParams,
    universe: str,
    window: str,
    start: int,
    end: int,
    window_weeks: int | None = None,
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for strategy in strategies:
        results = [
            simulate_ticker(symbol, prices_by_symbol[symbol][start : end + 1], strategy, mode, config, v3_params)
            for symbol in symbols
        ]
        aggregate = aggregate_portfolio(results, strategy, mode, universe)
        rows.append(result_row(aggregate, "portfolio", universe, window, window_weeks or (end - start)))
    return rows


def simulate_ticker(
    symbol: str,
    prices: list[PricePoint],
    strategy: str,
    mode: str,
    config: BacktestConfig,
    v3_params: RiskParams,
) -> SimResult:
    if len(prices) < 2:
        raise ValueError("At least two weekly price points are required")

    base_buy = config.strategy.base_buy_amount
    cash = config.strategy.initial_cash if mode == "initial_cash_pool" else 0.0
    total_contributed = cash
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
        if mode == "true_weekly_contribution":
            cash += base_buy
            total_contributed += base_buy
        weekly_return = calculate_weekly_return(current.close, previous.close)
        recent_returns.append(weekly_return)
        recent_returns = recent_returns[-52:]
        peak_price = max(peak_price, current.close)
        price_drawdown = 1 - current.close / peak_price if peak_price else 0.0
        consecutive_declines = consecutive_declines + 1 if weekly_return < 0 else 0

        multiplier = strategy_multiplier(
            strategy,
            prices,
            index,
            weekly_return,
            recent_returns,
            consecutive_declines,
            price_drawdown,
            config,
            v3_params,
        )
        desired_amount = base_buy * multiplier
        if mode == "initial_cash_pool":
            desired_amount, multiplier = apply_python_pool_risk_controls(desired_amount, multiplier, price_drawdown, config)
            desired_amount = min(desired_amount, cash * config.risk.max_single_buy_pct_cash)
        else:
            desired_amount = min(desired_amount, cash)

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
        mode=mode,
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
    v3_params: RiskParams,
) -> float:
    if strategy == "fixed_weekly_dca":
        return 1.0
    if strategy == "simple_dip_buy":
        multiplier = calculate_buy_multiplier(weekly_return, config.strategy)
        if consecutive_declines > config.risk.consecutive_decline_weeks:
            multiplier = min(multiplier, 1.0)
        return multiplier
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
    if strategy == "enhanced_low_frequency_proxy":
        return enhanced_multiplier(prices, index, weekly_return)
    if strategy == "v3_sandbox_candidate":
        return risk_adjusted_candidate_multiplier(
            weekly_return,
            recent_returns,
            consecutive_declines,
            price_drawdown,
            v3_params,
        )
    raise ValueError(f"Unsupported strategy: {strategy}")


def apply_python_pool_risk_controls(
    desired_amount: float,
    multiplier: float,
    price_drawdown: float,
    config: BacktestConfig,
) -> tuple[float, float]:
    if price_drawdown >= config.risk.drawdown_threshold:
        if config.risk.drawdown_action == "pause":
            return 0.0, 0.0
        if config.risk.drawdown_action == "reduce":
            desired_amount *= config.risk.drawdown_reduce_multiplier
            multiplier = desired_amount / config.strategy.base_buy_amount if config.strategy.base_buy_amount else 0.0
    return desired_amount, multiplier


def aggregate_portfolio(results: list[SimResult], strategy: str, mode: str, universe: str) -> SimResult:
    length = min(len(result.history) for result in results)
    history = []
    for index in range(length):
        date = results[0].history[index].date
        value = sum(result.history[index].value for result in results)
        cash = sum(result.history[index].cash for result in results)
        history.append(SimPoint(date, round(value, 6), round(cash, 6)))
    return SimResult(
        ticker=universe,
        strategy=strategy,
        mode=mode,
        start_date=history[0].date,
        end_date=history[-1].date,
        history=history,
        total_contributed=round(sum(result.total_contributed for result in results), 6),
        total_invested=round(sum(result.total_invested for result in results), 6),
        cash_remaining=round(sum(result.cash_remaining for result in results), 6),
        buy_actions=sum(result.buy_actions for result in results),
        average_buy_amount=round(mean([result.average_buy_amount for result in results if result.average_buy_amount > 0]), 6),
        shares=0.0,
    )


def result_row(
    result: SimResult,
    level: str,
    universe: str,
    window: str,
    window_weeks: int,
) -> dict[str, object]:
    metrics = calculate_result_metrics(result)
    return {
        "validation_mode": result.mode,
        "level": level,
        "universe": universe,
        "ticker": result.ticker,
        "window": window,
        "window_weeks": window_weeks,
        "start_date": result.start_date,
        "end_date": result.end_date,
        "strategy": result.strategy,
        "final_value": round(result.final_value, 2),
        "total_contributed": round(result.total_contributed, 2),
        "total_invested": round(result.total_invested, 2),
        "cash_remaining": round(result.cash_remaining, 2),
        "return_on_contributed_pct": round(metrics["return_on_contributed"] * 100, 2),
        "return_on_invested_pct": round(metrics["return_on_invested"] * 100, 2),
        "cagr_on_contributed_pct": round(metrics["cagr_on_contributed"] * 100, 2),
        "max_drawdown_pct": round(metrics["max_drawdown"] * 100, 2),
        "volatility_pct": round(metrics["volatility"] * 100, 2),
        "sharpe_ratio": round(metrics["sharpe_ratio"], 3),
        "calmar_ratio": round(metrics["calmar_ratio"], 3),
        "buy_actions": result.buy_actions,
        "average_buy_amount": round(result.average_buy_amount, 2),
    }


def calculate_result_metrics(result: SimResult) -> dict[str, float]:
    values = [point.value for point in result.history]
    returns = [values[index] / values[index - 1] - 1 for index in range(1, len(values)) if values[index - 1] > 0]
    max_drawdown = calculate_max_drawdown(values)
    volatility = stddev(returns) * math.sqrt(52) if returns else 0.0
    avg_return = mean(returns) if returns else 0.0
    sharpe = avg_return / stddev(returns) * math.sqrt(52) if len(returns) > 1 and stddev(returns) > 0 else 0.0
    years = max(len(values) / 52, 1 / 52)
    return_on_contributed = result.final_value / result.total_contributed - 1 if result.total_contributed else 0.0
    return_on_invested = result.final_value / result.total_invested - 1 if result.total_invested else 0.0
    cagr = (result.final_value / result.total_contributed) ** (1 / years) - 1 if result.total_contributed > 0 and result.final_value > 0 else 0.0
    calmar = cagr / max_drawdown if max_drawdown > 0 else 0.0
    return {
        "return_on_contributed": return_on_contributed,
        "return_on_invested": return_on_invested,
        "cagr_on_contributed": cagr,
        "max_drawdown": max_drawdown,
        "volatility": volatility,
        "sharpe_ratio": sharpe,
        "calmar_ratio": calmar,
    }


def build_equal_invested_rows(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    groups: dict[tuple[str, str, str, str, str], list[dict[str, object]]] = {}
    for row in rows:
        if row["level"] == "ticker":
            key = (
                str(row["validation_mode"]),
                str(row["universe"]),
                str(row["ticker"]),
                str(row["window"]),
                str(row["window_weeks"]),
            )
        else:
            key = (
                str(row["validation_mode"]),
                str(row["universe"]),
                "portfolio",
                str(row["window"]),
                str(row["window_weeks"]),
            )
        groups.setdefault(key, []).append(row)

    normalized: list[dict[str, object]] = []
    for key, items in groups.items():
        positive = [float(item["total_invested"]) for item in items if float(item["total_invested"]) > 0]
        if not positive:
            continue
        target = min(positive)
        for item in items:
            invested = float(item["total_invested"])
            scale = target / invested if invested > 0 else 0.0
            normalized_final = float(item["final_value"]) * scale
            normalized.append(
                {
                    "analysis_type": "equal_total_invested_normalized_not_real_account_path",
                    "validation_mode": item["validation_mode"],
                    "level": item["level"],
                    "universe": item["universe"],
                    "ticker": item["ticker"],
                    "window": item["window"],
                    "window_weeks": item["window_weeks"],
                    "strategy": item["strategy"],
                    "target_invested": round(target, 2),
                    "actual_invested": item["total_invested"],
                    "normalized_final_value": round(normalized_final, 2),
                    "normalized_return_pct": round((normalized_final / target - 1) * 100, 2) if target else 0.0,
                }
            )
    return normalized


def build_win_rate_rows(rolling_rows: list[dict[str, object]]) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for metric in ["return_on_contributed_pct", "calmar_ratio"]:
        groups: dict[tuple[str, str, str, str], list[dict[str, object]]] = {}
        for row in rolling_rows:
            if row["strategy"] in CORE_STRATEGIES:
                key = (str(row["validation_mode"]), str(row["level"]), str(row["ticker"]), str(row["window"]))
                groups.setdefault(key, []).append(row)

        wins: dict[tuple[str, str, str], dict[str, int]] = {}
        counts: dict[tuple[str, str, str], int] = {}
        values: dict[tuple[str, str, str], dict[str, list[float]]] = {}
        for key, items in groups.items():
            if len(items) != len(CORE_STRATEGIES):
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
            for strategy in CORE_STRATEGIES:
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


def build_v3_robustness_rows(
    rolling_rows: list[dict[str, object]],
    initial_rows: list[dict[str, object]],
    contribution_rows: list[dict[str, object]],
    v3_params: RiskParams,
) -> list[dict[str, object]]:
    rows = []
    for source_name, source_rows in [
        ("initial_cash_pool_full", initial_rows),
        ("true_weekly_contribution_full", contribution_rows),
        ("rolling_true_weekly_contribution", rolling_rows),
    ]:
        strategy_rows = [row for row in source_rows if row["strategy"] in {"v3_sandbox_candidate", "simple_dip_buy", "fixed_weekly_dca", "risk_adjusted_v2"}]
        for strategy in ["v3_sandbox_candidate", "simple_dip_buy", "fixed_weekly_dca", "risk_adjusted_v2"]:
            subset = [row for row in strategy_rows if row["strategy"] == strategy and row["level"] == "portfolio"]
            if not subset:
                continue
            rows.append(
                {
                    "source": source_name,
                    "strategy": strategy,
                    "parameter_set": v3_params.name if strategy == "v3_sandbox_candidate" else "",
                    "observations": len(subset),
                    "avg_return_on_contributed_pct": round(mean(float(row["return_on_contributed_pct"]) for row in subset), 2),
                    "avg_max_drawdown_pct": round(mean(float(row["max_drawdown_pct"]) for row in subset), 2),
                    "avg_calmar_ratio": round(mean(float(row["calmar_ratio"]) for row in subset), 3),
                }
            )
    return rows


def calculate_max_drawdown(values: list[float]) -> float:
    peak = 0.0
    max_drawdown = 0.0
    for value in values:
        peak = max(peak, value)
        if peak > 0:
            max_drawdown = max(max_drawdown, 1 - value / peak)
    return max_drawdown


def stddev(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    avg = mean(values)
    variance = sum((value - avg) ** 2 for value in values) / (len(values) - 1)
    return math.sqrt(variance)


def write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    if not rows:
        return
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def aggregate_strategy(rows: list[dict[str, object]], mode: str, level: str, universe: str = "all_symbols") -> dict[str, dict[str, float]]:
    grouped: dict[str, list[dict[str, object]]] = {}
    for row in rows:
        if row["validation_mode"] == mode and row["level"] == level and row["universe"] == universe:
            grouped.setdefault(str(row["strategy"]), []).append(row)
    return {
        strategy: {
            "avg_return": mean(float(row["return_on_contributed_pct"]) for row in items),
            "avg_drawdown": mean(float(row["max_drawdown_pct"]) for row in items),
            "avg_calmar": mean(float(row["calmar_ratio"]) for row in items),
            "count": float(len(items)),
        }
        for strategy, items in grouped.items()
    }


def extract_win_rate(win_rows: list[dict[str, object]], level: str, ticker: str, metric: str) -> dict[str, float]:
    return {
        str(row["strategy"]): float(row["win_rate_pct"])
        for row in win_rows
        if row["level"] == level and row["ticker"] == ticker and row["metric"] == metric
    }


def build_report(
    initial_rows: list[dict[str, object]],
    contribution_rows: list[dict[str, object]],
    equal_invested_rows: list[dict[str, object]],
    rolling_rows: list[dict[str, object]],
    ex_nvda_rows: list[dict[str, object]],
    win_rate_rows: list[dict[str, object]],
    v3_rows: list[dict[str, object]],
    v3_params: RiskParams,
) -> str:
    initial = aggregate_strategy(initial_rows, "initial_cash_pool", "ticker")
    contribution = aggregate_strategy(contribution_rows, "true_weekly_contribution", "ticker")
    portfolio_win = extract_win_rate(win_rate_rows, "portfolio", "all_symbols", "return_on_contributed_pct")
    ticker_win_rows = [row for row in win_rate_rows if row["metric"] == "return_on_contributed_pct" and row["level"] == "ticker"]
    dca_wins = [float(row["win_rate_pct"]) for row in ticker_win_rows if row["strategy"] == "fixed_weekly_dca"]
    simple_wins = [float(row["win_rate_pct"]) for row in ticker_win_rows if row["strategy"] == "simple_dip_buy"]
    risk_wins = [float(row["win_rate_pct"]) for row in ticker_win_rows if row["strategy"] == "risk_adjusted_v2"]
    ex_rows = {row["strategy"]: row for row in ex_nvda_rows if row["validation_mode"] == "true_weekly_contribution"}
    equal_full = [
        row
        for row in equal_invested_rows
        if row["validation_mode"] == "true_weekly_contribution"
        and row["level"] == "ticker"
        and row["window"] == "full_available"
        and row["strategy"] in CORE_STRATEGIES
    ]
    equal_by_strategy: dict[str, list[float]] = {}
    for row in equal_full:
        equal_by_strategy.setdefault(str(row["strategy"]), []).append(float(row["normalized_return_pct"]))
    equal_simple = mean(equal_by_strategy["simple_dip_buy"])
    equal_dca = mean(equal_by_strategy["fixed_weekly_dca"])
    equal_risk = mean(equal_by_strategy["risk_adjusted_v2"])
    v3_rolling = {row["strategy"]: row for row in v3_rows if row["source"] == "rolling_true_weekly_contribution"}

    lines = [
        "# Algorithm Phase 3B Validation Report",
        "",
        "## Executive Summary",
        "",
        f"- **Simple Dip-Buy is not robustly better than Fixed Weekly DCA on raw account paths.** In true weekly contribution mode, Simple averaged {contribution['simple_dip_buy']['avg_return']:.2f}% per-ticker return versus {contribution['fixed_weekly_dca']['avg_return']:.2f}% for DCA. In rolling portfolio windows, Simple won {portfolio_win.get('simple_dip_buy', 0):.2f}% of return comparisons versus {portfolio_win.get('fixed_weekly_dca', 0):.2f}% for DCA.",
        f"- **But DCA's edge is mostly deployment/timing-path driven, not better return per invested dollar.** In equal-total-invested normalization, Simple averaged {equal_simple:.2f}% versus {equal_dca:.2f}% for DCA and {equal_risk:.2f}% for Risk-Adjusted v2.",
        f"- **NVDA still matters, but it is not the only cash-deployment artifact.** In the ex-NVDA true-contribution portfolio test, DCA returned {float(ex_rows['fixed_weekly_dca']['return_on_contributed_pct']):.2f}% versus {float(ex_rows['simple_dip_buy']['return_on_contributed_pct']):.2f}% for Simple, while Simple had lower drawdown and a slightly better Calmar ratio.",
        f"- **Risk-Adjusted v2 remains optional.** Its rolling ticker win-rate averaged {mean(risk_wins):.2f}% versus {mean(simple_wins):.2f}% for Simple and {mean(dca_wins):.2f}% for DCA; it did not show enough broad stress-window advantage to replace the default.",
        f"- **The v3 candidate remains sandbox-only.** `{v3_params.name}` averaged {float(v3_rolling['v3_sandbox_candidate']['avg_return_on_contributed_pct']):.2f}% in rolling portfolio validation, but this is not enough to promote it without older data and out-of-sample testing.",
        "- **The live dashboard should remain unchanged.** Phase 3B strengthens the evidence that validation needs to continue before any live or default strategy change.",
        "",
        "## Validation Modes Were Kept Separate",
        "",
        "Initial cash pool mode uses the existing Python-style cash pool framing. True weekly contribution mode starts with no cash and adds the same weekly amount before each scheduled buy. Equal-total-invested normalization is labeled as a normalized analysis only; it is not a real account path. Rolling walk-forward windows use true weekly contribution mode so conclusions do not depend on one endpoint.",
        "",
        "## Full-Period Per-Ticker Averages",
        "",
        markdown_table(
            ["Mode", "Strategy", "Avg return", "Avg max DD", "Avg Calmar"],
            [
                ["Initial cash pool", strategy, pct(values["avg_return"]), pct(values["avg_drawdown"]), f"{values['avg_calmar']:.2f}"]
                for strategy, values in sorted(initial.items())
            ]
            + [
                ["True weekly contribution", strategy, pct(values["avg_return"]), pct(values["avg_drawdown"]), f"{values['avg_calmar']:.2f}"]
                for strategy, values in sorted(contribution.items())
            ],
        ),
        "",
        "## Rolling Walk-Forward Win Rates",
        "",
        "Rolling windows include 1-year, 2-year, and 3-year windows where the local dataset allows them. This makes the conclusion less dependent on the June 2021 to June 2026 endpoint.",
        "",
        markdown_table(
            ["Level", "Strategy", "Return win rate", "Avg return metric"],
            [
                [row["level"], row["strategy"], pct(row["win_rate_pct"]), f"{float(row['average_metric']):.2f}"]
                for row in win_rate_rows
                if row["metric"] == "return_on_contributed_pct" and row["level"] == "portfolio"
            ],
        ),
        "",
        "## Equal-Total-Invested Normalization",
        "",
        "This is not a real account path. It rescales each strategy to the same invested capital so a strategy cannot win only because it deployed more cash earlier. Under that lens, Simple Dip-Buy looks better than the raw true-contribution account path suggests.",
        "",
        markdown_table(
            ["Strategy", "Avg normalized return"],
            [
                [strategy, pct(mean(values))]
                for strategy, values in sorted(equal_by_strategy.items())
            ],
        ),
        "",
        "## Ex-NVDA Check",
        "",
        "Removing NVDA narrows the raw-return gap substantially but does not fully reverse it in true weekly contribution mode. The initial cash pool result still slightly favors Simple/Risk-Adjusted, while true contribution still slightly favors DCA. That points to cash deployment and sample path effects, not a clean structural edge for either side.",
        "",
        markdown_table(
            ["Mode", "Strategy", "Return", "Max DD", "Calmar"],
            [
                [row["validation_mode"], row["strategy"], pct(row["return_on_contributed_pct"]), pct(row["max_drawdown_pct"]), f"{float(row['calmar_ratio']):.2f}"]
                for row in ex_nvda_rows
                if row["strategy"] in CORE_STRATEGIES
            ],
        ),
        "",
        "## V3 Candidate Status",
        "",
        "The best Phase 3A parameter candidate is still useful as a sandbox object, but Phase 3B does not make it production-ready. The right next validation is out-of-sample and longer-history testing, not promotion.",
        "",
        markdown_table(
            ["Source", "Strategy", "Observations", "Avg return", "Avg DD", "Avg Calmar"],
            [
                [row["source"], row["strategy"], str(row["observations"]), pct(row["avg_return_on_contributed_pct"]), pct(row["avg_max_drawdown_pct"]), f"{float(row['avg_calmar_ratio']):.2f}"]
                for row in v3_rows
            ],
        ),
        "",
        "## Answers To The Phase 3B Questions",
        "",
        "1. Simple Dip-Buy does not robustly beat Fixed Weekly DCA on raw account paths, but it does look better after equal-total-invested normalization.",
        "2. Fixed DCA's advantage is partly NVDA path dependency and partly broader cash-deployment drag from timing rules that underinvest during persistent uptrends.",
        "3. Risk-Adjusted v2 does not add enough broad stress-window value to become default.",
        "4. The v3 candidate is worth further sandbox testing only.",
        "5. The live dashboard algorithm should remain unchanged.",
        "",
        "## Outputs",
        "",
        f"- `{(RESULTS_DIR / 'initial_cash_pool_summary.csv').as_posix()}`",
        f"- `{(RESULTS_DIR / 'true_contribution_summary.csv').as_posix()}`",
        f"- `{(RESULTS_DIR / 'equal_invested_summary.csv').as_posix()}`",
        f"- `{(RESULTS_DIR / 'rolling_walk_forward.csv').as_posix()}`",
        f"- `{(RESULTS_DIR / 'ex_nvda_portfolio_summary.csv').as_posix()}`",
        f"- `{(RESULTS_DIR / 'strategy_win_rates.csv').as_posix()}`",
        f"- `{(RESULTS_DIR / 'v3_candidate_robustness.csv').as_posix()}`",
    ]
    return "\n".join(lines) + "\n"


def markdown_table(headers: list[str], rows: list[list[object]]) -> str:
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---"] * len(headers)) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(str(value) for value in row) + " |")
    return "\n".join(lines)


def pct(value: object) -> str:
    return f"{float(value):.2f}%"


if __name__ == "__main__":
    main()
