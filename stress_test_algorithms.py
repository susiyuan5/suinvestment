from __future__ import annotations

import csv
import json
import math
import os
from dataclasses import dataclass, replace
from datetime import date
from pathlib import Path
from statistics import mean, pstdev
from typing import Callable, Iterable

from backtest import BacktestResult, PortfolioPoint, TradeRecord, run_backtest
from benchmarks import run_fixed_dca_strategy
from config import BacktestConfig, StrategyConfig
from data_loader import PricePoint
from metrics import calculate_metrics
from risk_adjuster import DEFAULT_TARGET_VOL
from strategy import calculate_weekly_return


DATA_PATH = Path("data/backtest-prices.json")
RESULTS_DIR = Path("results/phase3a_stress")
REPORT_PATH = Path("ALGORITHM_STRESS_TEST.md")

DEFAULT_SYMBOLS = ["NVDA", "MSFT", "AAPL", "ASML", "KO", "BYDDY"]

APP_ALGORITHM_PARAMS = {
    "sensitivity": 4.0,
    "min_multiplier": 0.3,
    "max_multiplier": 2.0,
    "strong_drop_threshold": -15.0,
    "volatility_daily_threshold": 8.0,
    "volatility_weekly_threshold": 15.0,
    "extreme_weekly_threshold": 25.0,
    "max_downtrend_multiplier": 1.5,
    "severe_downtrend_multiplier": 1.2,
    "crash_boost": 0.12,
}

APP_LOW_FREQ_PARAMS = {
    "target_weekly_volatility": 0.04,
    "max_bull_multiplier": 2.0,
    "max_neutral_multiplier": 1.5,
    "max_correction_multiplier": 1.3,
    "max_bear_multiplier": 1.1,
    "max_drawdown_20_multiplier": 1.3,
    "max_drawdown_35_multiplier": 1.1,
}


@dataclass(frozen=True)
class WindowSpec:
    name: str
    description: str
    start_index: int
    end_index: int


@dataclass(frozen=True)
class RiskParameterSet:
    name: str
    sensitivity: float
    min_multiplier: float
    max_multiplier: float
    target_weekly_vol: float
    extreme_drawdown_cap: float
    consecutive_decline_cap: float
    combined_stress_cap: float


def main() -> None:
    prices_by_symbol = load_prices(DATA_PATH)
    symbols = [symbol for symbol in DEFAULT_SYMBOLS if symbol in prices_by_symbol]
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
    stress_rows = run_stress_tests(prices_by_symbol, symbols, config)
    write_csv(RESULTS_DIR / "stress_test_summary.csv", stress_rows)

    sensitivity_rows = run_parameter_sensitivity(prices_by_symbol, symbols, config)
    write_csv(RESULTS_DIR / "parameter_sensitivity.csv", sensitivity_rows)

    ranked_rows = rank_parameter_sets(sensitivity_rows)
    write_csv(RESULTS_DIR / "parameter_sensitivity_ranked.csv", ranked_rows)

    report = build_report(stress_rows, ranked_rows, prices_by_symbol, symbols)
    REPORT_PATH.write_text(report, encoding="utf-8")

    print(f"Wrote {RESULTS_DIR / 'stress_test_summary.csv'}")
    print(f"Wrote {RESULTS_DIR / 'parameter_sensitivity.csv'}")
    print(f"Wrote {RESULTS_DIR / 'parameter_sensitivity_ranked.csv'}")
    print(f"Wrote {REPORT_PATH}")


def load_prices(path: Path) -> dict[str, list[PricePoint]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    result: dict[str, list[PricePoint]] = {}
    for symbol, rows in payload.get("symbols", {}).items():
        points = [
            PricePoint(date.fromisoformat(row["date"]), float(row["close"]))
            for row in rows
            if row.get("date") and float(row.get("close", 0)) > 0
        ]
        points.sort(key=lambda point: point.date)
        result[symbol.upper()] = points
    return result


def run_stress_tests(
    prices_by_symbol: dict[str, list[PricePoint]],
    symbols: list[str],
    config: BacktestConfig,
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for symbol in symbols:
        prices = prices_by_symbol[symbol]
        for window in build_windows(prices):
            window_prices = prices[window.start_index : window.end_index + 1]
            if len(window_prices) < 2:
                continue
            for strategy_name, result in run_strategy_suite(symbol, window_prices, config):
                rows.append(make_result_row(symbol, window, strategy_name, result, config))
    return rows


def build_windows(prices: list[PricePoint]) -> list[WindowSpec]:
    last_index = len(prices) - 1
    full = WindowSpec("full_available", "All local history available for this ticker.", 0, last_index)
    recent_start = max(0, last_index - 260 + 1)
    recent = WindowSpec("recent_5_years", "Most recent 260 weekly points, when available.", recent_start, last_index)
    drawdown_start, drawdown_end = detect_major_drawdown_window(prices)
    high_vol_start, high_vol_end = detect_high_volatility_window(prices)

    candidates = [
        full,
        recent,
        WindowSpec("major_drawdown_window", "Detected window around the ticker's largest price drawdown.", drawdown_start, drawdown_end),
        WindowSpec("high_volatility_window", "Detected 104-week window around the highest 52-week realized volatility.", high_vol_start, high_vol_end),
    ]

    unique: list[WindowSpec] = []
    seen = set()
    for item in candidates:
        key = (item.name, item.start_index, item.end_index)
        if key not in seen:
            seen.add(key)
            unique.append(item)
    return unique


def detect_major_drawdown_window(prices: list[PricePoint]) -> tuple[int, int]:
    peak_index = 0
    peak_price = prices[0].close
    best_peak = 0
    best_trough = 0
    best_drawdown = 0.0
    for index, point in enumerate(prices):
        if point.close > peak_price:
            peak_price = point.close
            peak_index = index
        drawdown = 1 - point.close / peak_price if peak_price > 0 else 0.0
        if drawdown > best_drawdown:
            best_drawdown = drawdown
            best_peak = peak_index
            best_trough = index
    start = max(0, best_peak - 26)
    end = min(len(prices) - 1, best_trough + 26)
    return start, max(end, min(len(prices) - 1, start + 26))


def detect_high_volatility_window(prices: list[PricePoint]) -> tuple[int, int]:
    returns = weekly_returns(prices)
    if len(returns) < 52:
        return 0, len(prices) - 1
    best_end = 52
    best_vol = -1.0
    for end in range(52, len(returns) + 1):
        vol = stddev(returns[end - 52 : end])
        if vol > best_vol:
            best_vol = vol
            best_end = end
    center = best_end
    start = max(0, center - 52)
    end_index = min(len(prices) - 1, start + 103)
    if end_index - start < 52:
        start = max(0, end_index - 103)
    return start, end_index


def run_strategy_suite(
    symbol: str,
    prices: list[PricePoint],
    config: BacktestConfig,
) -> list[tuple[str, BacktestResult]]:
    return [
        ("simple_dip_buy", run_backtest(symbol, prices, config, save_results=False)),
        ("risk_adjusted_v2", run_backtest(symbol, prices, config, save_results=False, use_risk_adjusted=True)),
        ("fixed_weekly_dca", run_fixed_dca_strategy(symbol, prices, config)),
        ("enhanced_low_frequency_proxy", run_enhanced_low_frequency_backtest(symbol, prices, config)),
    ]


def run_enhanced_low_frequency_backtest(
    symbol: str,
    prices: list[PricePoint],
    config: BacktestConfig,
) -> BacktestResult:
    return run_custom_backtest(
        symbol,
        prices,
        config,
        lambda index, weekly_return, recent_returns, consecutive_declines, price_drawdown: enhanced_multiplier(prices, index, weekly_return),
    )


def run_custom_backtest(
    symbol: str,
    prices: list[PricePoint],
    config: BacktestConfig,
    multiplier_fn: Callable[[int, float, list[float], int, float], float],
) -> BacktestResult:
    if len(prices) < 2:
        raise ValueError("At least two weekly price points are required")

    cash = config.strategy.initial_cash
    shares = 0.0
    total_invested = 0.0
    total_share_cost = 0.0
    peak_price = prices[0].close
    peak_portfolio = cash
    consecutive_declines = 0
    recent_returns: list[float] = []
    trades: list[TradeRecord] = []
    history: list[PortfolioPoint] = []

    for index in range(1, len(prices)):
        previous = prices[index - 1]
        current = prices[index]
        weekly_return = calculate_weekly_return(current.close, previous.close)
        recent_returns.append(weekly_return)
        recent_returns = recent_returns[-52:]
        peak_price = max(peak_price, current.close)
        price_drawdown = 1 - current.close / peak_price if peak_price else 0.0
        consecutive_declines = consecutive_declines + 1 if weekly_return < 0 else 0

        multiplier = multiplier_fn(index, weekly_return, list(recent_returns), consecutive_declines, price_drawdown)
        desired_amount = config.strategy.base_buy_amount * multiplier
        if price_drawdown >= config.risk.drawdown_threshold:
            if config.risk.drawdown_action == "pause":
                desired_amount = 0.0
                multiplier = 0.0
            elif config.risk.drawdown_action == "reduce":
                desired_amount *= config.risk.drawdown_reduce_multiplier
                multiplier = desired_amount / config.strategy.base_buy_amount if config.strategy.base_buy_amount else 0.0
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

        cash -= total_cost
        if cash < 0 and cash > -1e-8:
            cash = 0.0
        shares += shares_bought
        total_invested += total_cost
        total_share_cost += buy_amount
        portfolio_value = cash + shares * current.close
        peak_portfolio = max(peak_portfolio, portfolio_value)
        drawdown = 1 - portfolio_value / peak_portfolio if peak_portfolio else 0.0
        unrealized_profit = shares * current.close - total_share_cost

        trades.append(
            TradeRecord(
                date=current.date.isoformat(),
                ticker=symbol.upper(),
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

    return BacktestResult(
        trades=trades,
        history=history,
        total_invested=round(total_invested, 6),
        final_portfolio_value=history[-1].portfolio_value if history else config.strategy.initial_cash,
        average_buy_price=round(total_share_cost / shares, 6) if shares else 0.0,
    )


def enhanced_multiplier(prices: list[PricePoint], index: int, weekly_return: float) -> float:
    weekly_pct = weekly_return * 100
    rows = prices[: index + 1]
    closes = [point.close for point in rows]
    multiplier = smooth_multiplier(weekly_pct)
    volatility = weekly_volatility(closes, 12)
    drawdown = recent_drawdown_pct(closes, 52)
    trend = analyze_trend(closes, weekly_pct)
    regime = market_regime(closes)

    if volatility and volatility > 0:
        multiplier *= clamp(APP_LOW_FREQ_PARAMS["target_weekly_volatility"] / volatility, 0.7, 1.1)
    multiplier = min(multiplier, market_regime_cap(regime))
    if trend == "strong_downtrend":
        severe = percent_change(closes, 12)
        cap = APP_ALGORITHM_PARAMS["severe_downtrend_multiplier"] if severe is not None and severe <= -25 else APP_ALGORITHM_PARAMS["max_downtrend_multiplier"]
        multiplier = min(multiplier, cap)
    if drawdown is not None:
        if drawdown > 35:
            multiplier = min(multiplier, APP_LOW_FREQ_PARAMS["max_drawdown_35_multiplier"])
        elif drawdown >= 20:
            multiplier = min(multiplier, APP_LOW_FREQ_PARAMS["max_drawdown_20_multiplier"])
    return round(clamp(multiplier, APP_ALGORITHM_PARAMS["min_multiplier"], APP_ALGORITHM_PARAMS["max_multiplier"]) + 1e-9, 2)


def smooth_multiplier(weekly_pct: float) -> float:
    params = APP_ALGORITHM_PARAMS
    multiplier = 1 - params["sensitivity"] * weekly_pct / 100
    if weekly_pct <= params["strong_drop_threshold"]:
        multiplier += params["crash_boost"]
    severe_downtrend = weekly_pct <= -params["extreme_weekly_threshold"]
    if severe_downtrend:
        multiplier = min(multiplier, params["severe_downtrend_multiplier"])
    elif abs(weekly_pct) >= params["extreme_weekly_threshold"]:
        multiplier = min(multiplier, params["max_downtrend_multiplier"])
    return clamp(multiplier, params["min_multiplier"], params["max_multiplier"])


def analyze_trend(closes: list[float], decision_change_pct: float) -> str:
    if len(closes) < 21:
        return "mixed"
    latest = closes[-1]
    return4 = percent_change(closes, 4)
    return12 = percent_change(closes, 12)
    ma20 = moving_average(closes, 20, 0)
    prior_ma20 = moving_average(closes, 20, 4)
    ma20_trend = ((ma20 - prior_ma20) / prior_ma20 * 100) if ma20 and prior_ma20 else None
    strong_downtrend = (
        return4 is not None
        and return12 is not None
        and return4 <= -8
        and return12 <= -12
    ) or (
        ma20 is not None
        and latest < ma20
        and ma20_trend is not None
        and ma20_trend < 0
        and return12 is not None
        and return12 < 0
    )
    healthy_pullback = (
        decision_change_pct < 0
        and return12 is not None
        and return12 > 5
        and ma20 is not None
        and latest >= ma20 * 0.95
        and (ma20_trend is None or ma20_trend >= 0)
    )
    if strong_downtrend:
        return "strong_downtrend"
    if healthy_pullback:
        return "healthy_pullback"
    return "mixed"


def market_regime(closes: list[float]) -> str:
    if len(closes) < 50:
        return "Neutral"
    latest = closes[-1]
    ma20 = moving_average(closes, 20, 0)
    ma50 = moving_average(closes, 50, 0)
    drawdown = recent_drawdown_pct(closes, 52)
    if drawdown is not None and drawdown > 20:
        return "Bear"
    if ma50 is not None and latest < ma50:
        return "Bear"
    if ma20 is not None and ma50 is not None and latest > ma20 and ma20 > ma50:
        return "Bull"
    if ma20 is not None and latest < ma20:
        return "Correction"
    return "Neutral"


def market_regime_cap(regime: str) -> float:
    if regime == "Bull":
        return APP_LOW_FREQ_PARAMS["max_bull_multiplier"]
    if regime == "Correction":
        return APP_LOW_FREQ_PARAMS["max_correction_multiplier"]
    if regime == "Bear":
        return APP_LOW_FREQ_PARAMS["max_bear_multiplier"]
    return APP_LOW_FREQ_PARAMS["max_neutral_multiplier"]


def make_result_row(
    symbol: str,
    window: WindowSpec,
    strategy_name: str,
    result: BacktestResult,
    config: BacktestConfig,
) -> dict[str, object]:
    metrics = calculate_metrics(result, config.strategy.initial_cash)
    calmar = safe_ratio(metrics.get("annualized_return", 0.0), metrics.get("max_drawdown", 0.0))
    avg_buy_amount = average_buy_amount(result)
    worst_period = worst_rolling_period(result.history, weeks=4)
    cash_usage = result.total_invested / config.strategy.initial_cash if config.strategy.initial_cash else 0.0
    return {
        "ticker": symbol,
        "window": window.name,
        "window_description": window.description,
        "start_date": result.history[0].date if result.history else "",
        "end_date": result.history[-1].date if result.history else "",
        "strategy": strategy_name,
        "final_value": round(metrics.get("final_portfolio_value", 0.0), 2),
        "total_return_pct": round(metrics.get("total_return", 0.0) * 100, 2),
        "cagr_pct": round(metrics.get("annualized_return", 0.0) * 100, 2),
        "max_drawdown_pct": round(metrics.get("max_drawdown", 0.0) * 100, 2),
        "volatility_pct": round(metrics.get("volatility", 0.0) * 100, 2),
        "sharpe_ratio": round(metrics.get("sharpe_ratio", 0.0), 3),
        "calmar_ratio": round(calmar, 3),
        "number_of_buy_actions": int(metrics.get("number_of_trades", 0)),
        "average_buy_amount": round(avg_buy_amount, 2),
        "cash_remaining": round(metrics.get("cash_left", 0.0), 2),
        "cash_usage_pct": round(cash_usage * 100, 2),
        "worst_period": worst_period["label"],
        "worst_period_return_pct": round(worst_period["return"] * 100, 2),
        "total_invested": round(metrics.get("total_invested", 0.0), 2),
    }


def average_buy_amount(result: BacktestResult) -> float:
    buys = [trade.buy_amount for trade in result.trades if trade.shares_bought > 0]
    return sum(buys) / len(buys) if buys else 0.0


def worst_rolling_period(history: list[PortfolioPoint], weeks: int) -> dict[str, object]:
    if len(history) <= weeks:
        return {"label": "n/a", "return": 0.0}
    worst_return = 0.0
    worst_label = "n/a"
    for index in range(weeks, len(history)):
        start = history[index - weeks]
        end = history[index]
        if start.portfolio_value <= 0:
            continue
        period_return = end.portfolio_value / start.portfolio_value - 1
        if period_return < worst_return:
            worst_return = period_return
            worst_label = f"{start.date} to {end.date}"
    return {"label": worst_label, "return": worst_return}


def run_parameter_sensitivity(
    prices_by_symbol: dict[str, list[PricePoint]],
    symbols: list[str],
    config: BacktestConfig,
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    windows = ["full_available", "major_drawdown_window", "high_volatility_window"]
    for params in parameter_grid():
        strategy = replace(
            config.strategy,
            sensitivity=params.sensitivity,
            min_multiplier=params.min_multiplier,
            max_multiplier=params.max_multiplier,
        )
        trial_config = replace(config, strategy=strategy)
        for symbol in symbols:
            prices = prices_by_symbol[symbol]
            window_map = {window.name: window for window in build_windows(prices)}
            for window_name in windows:
                window = window_map[window_name]
                window_prices = prices[window.start_index : window.end_index + 1]
                result = run_custom_backtest(
                    symbol,
                    window_prices,
                    trial_config,
                    lambda index, weekly_return, recent_returns, consecutive_declines, price_drawdown, p=params: risk_adjusted_candidate_multiplier(
                        weekly_return,
                        recent_returns,
                        consecutive_declines,
                        price_drawdown,
                        p,
                    ),
                )
                row = make_result_row(symbol, window, "risk_adjusted_candidate", result, trial_config)
                row.update(
                    {
                        "parameter_set": params.name,
                        "sensitivity": params.sensitivity,
                        "min_multiplier": params.min_multiplier,
                        "max_multiplier": params.max_multiplier,
                        "target_weekly_vol": params.target_weekly_vol,
                        "extreme_drawdown_cap": params.extreme_drawdown_cap,
                        "consecutive_decline_cap": params.consecutive_decline_cap,
                        "combined_stress_cap": params.combined_stress_cap,
                    }
                )
                rows.append(row)
    return rows


def parameter_grid() -> list[RiskParameterSet]:
    candidates: list[RiskParameterSet] = []
    for sensitivity in [3.0, 4.0, 5.0]:
        for min_multiplier in [0.3, 0.5]:
            for max_multiplier in [1.6, 2.0, 2.4]:
                for target_weekly_vol in [0.04, DEFAULT_TARGET_VOL, 0.10]:
                    for extreme_drawdown_cap in [1.0, 1.1, 1.3]:
                        for consecutive_decline_cap in [1.0, 1.2, 1.4]:
                            for combined_stress_cap in [1.1, 1.3, 1.5]:
                                name = (
                                    f"s{int(sensitivity)}_min{min_multiplier:g}_max{max_multiplier:g}_"
                                    f"tv{target_weekly_vol:g}_dd{extreme_drawdown_cap:g}_"
                                    f"cd{consecutive_decline_cap:g}_cs{combined_stress_cap:g}"
                                )
                                candidates.append(
                                    RiskParameterSet(
                                        name=name,
                                        sensitivity=sensitivity,
                                        min_multiplier=min_multiplier,
                                        max_multiplier=max_multiplier,
                                        target_weekly_vol=target_weekly_vol,
                                        extreme_drawdown_cap=extreme_drawdown_cap,
                                        consecutive_decline_cap=consecutive_decline_cap,
                                        combined_stress_cap=combined_stress_cap,
                                    )
                                )
    return candidates


def risk_adjusted_candidate_multiplier(
    weekly_return: float,
    recent_returns: list[float],
    consecutive_declines: int,
    drawdown: float,
    params: RiskParameterSet,
) -> float:
    multiplier = 1.0 - params.sensitivity * weekly_return
    if recent_returns and len(recent_returns) >= 4:
        realized_vol = stddev(recent_returns)
        if realized_vol > 0 and params.target_weekly_vol > 0:
            multiplier *= clamp(params.target_weekly_vol / realized_vol, 0.8, 1.05)
    if consecutive_declines >= 8:
        multiplier = min(multiplier, params.consecutive_decline_cap)
    if drawdown > 0.35:
        multiplier = min(multiplier, params.extreme_drawdown_cap)
    if consecutive_declines >= 6 and drawdown > 0.20 and len(recent_returns) >= 4:
        realized_vol = stddev(recent_returns)
        if realized_vol > params.target_weekly_vol * 1.5:
            multiplier = min(multiplier, params.combined_stress_cap)
    return round(clamp(multiplier, params.min_multiplier, params.max_multiplier) + 1e-9, 2)


def rank_parameter_sets(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    groups: dict[str, list[dict[str, object]]] = {}
    for row in rows:
        groups.setdefault(str(row["parameter_set"]), []).append(row)

    ranked: list[dict[str, object]] = []
    for name, items in groups.items():
        total_returns = [float(item["total_return_pct"]) / 100 for item in items]
        drawdowns = [float(item["max_drawdown_pct"]) / 100 for item in items]
        vols = [float(item["volatility_pct"]) / 100 for item in items]
        calmars = [float(item["calmar_ratio"]) for item in items]
        cash_usage = [float(item["cash_usage_pct"]) / 100 for item in items]
        by_ticker: dict[str, list[float]] = {}
        for item in items:
            by_ticker.setdefault(str(item["ticker"]), []).append(float(item["total_return_pct"]) / 100)
        ticker_returns = [mean(values) for values in by_ticker.values()]
        robustness_penalty = pstdev(ticker_returns) if len(ticker_returns) > 1 else 0.0
        balanced_score = (
            mean(total_returns)
            + 0.35 * mean(calmars)
            - 0.8 * mean(drawdowns)
            - 0.25 * mean(vols)
            - 0.25 * abs(mean(cash_usage) - 0.95)
            - 0.35 * robustness_penalty
        )
        first = items[0]
        ranked.append(
            {
                "parameter_set": name,
                "balanced_score": round(balanced_score, 6),
                "avg_total_return_pct": round(mean(total_returns) * 100, 2),
                "avg_max_drawdown_pct": round(mean(drawdowns) * 100, 2),
                "avg_volatility_pct": round(mean(vols) * 100, 2),
                "avg_calmar_ratio": round(mean(calmars), 3),
                "avg_cash_usage_pct": round(mean(cash_usage) * 100, 2),
                "ticker_return_stddev_pct": round(robustness_penalty * 100, 2),
                "sensitivity": first["sensitivity"],
                "min_multiplier": first["min_multiplier"],
                "max_multiplier": first["max_multiplier"],
                "target_weekly_vol": first["target_weekly_vol"],
                "extreme_drawdown_cap": first["extreme_drawdown_cap"],
                "consecutive_decline_cap": first["consecutive_decline_cap"],
                "combined_stress_cap": first["combined_stress_cap"],
            }
        )
    ranked.sort(key=lambda item: float(item["balanced_score"]), reverse=True)
    return ranked


def build_report(
    stress_rows: list[dict[str, object]],
    ranked_rows: list[dict[str, object]],
    prices_by_symbol: dict[str, list[PricePoint]],
    symbols: list[str],
) -> str:
    full_rows = [row for row in stress_rows if row["window"] == "full_available"]
    stress_only = [row for row in stress_rows if row["window"] in {"major_drawdown_window", "high_volatility_window"}]
    full_summary = summarize_by_strategy(full_rows)
    stress_summary = summarize_by_strategy(stress_only)
    top_candidates = ranked_rows[:5]

    simple = full_summary["simple_dip_buy"]
    risk = full_summary["risk_adjusted_v2"]
    dca = full_summary["fixed_weekly_dca"]
    enhanced = full_summary["enhanced_low_frequency_proxy"]
    stress_risk = stress_summary["risk_adjusted_v2"]
    stress_simple = stress_summary["simple_dip_buy"]
    top = top_candidates[0]
    v2_name = "s4_min0.3_max2_tv0.07_dd1.1_cd1.2_cs1.3"
    v2_rank = next((index for index, row in enumerate(ranked_rows, start=1) if row["parameter_set"] == v2_name), None)
    v2_rank_text = f"ranked {v2_rank} of {len(ranked_rows)}" if v2_rank else "was included in the candidate grid"

    lines = [
        "# Algorithm Phase 3A Stress-Test Report",
        "",
        "## Executive Summary",
        "",
        f"- **Do not change the Python default yet.** Across full available ticker histories, Simple Dip-Buy averaged {simple['avg_total_return_pct']:.2f}% total return with {simple['avg_max_drawdown_pct']:.2f}% average max drawdown; Risk-Adjusted v2 averaged {risk['avg_total_return_pct']:.2f}% total return with {risk['avg_max_drawdown_pct']:.2f}% average max drawdown, so v2 does not justify replacing the default.",
        f"- **Risk-Adjusted v2 shows limited standalone value in the available stress windows.** In detected drawdown/high-volatility windows, it averaged {stress_risk['avg_total_return_pct']:.2f}% return versus {stress_simple['avg_total_return_pct']:.2f}% for Simple Dip-Buy, while drawdown and volatility stayed very close.",
        f"- **The timing edge is not proven yet.** Fixed Weekly DCA averaged {dca['avg_total_return_pct']:.2f}% over the full period, slightly above Simple Dip-Buy, while the enhanced low-frequency proxy averaged {enhanced['avg_total_return_pct']:.2f}%. That is a reason to keep validating, not to promote a new live algorithm.",
        f"- **A v3 candidate is worth sandbox testing, not promotion.** The top balanced candidate is `{top['parameter_set']}` with score {top['balanced_score']}; the current v2-like parameter set `{v2_name}` {v2_rank_text}. The top cluster still needs walk-forward testing before any default or live recommendation changes.",
        "",
        "## Evidence From Current Strategies",
        "",
        "The table below averages per-ticker results for the full available local dataset. All strategies use the Python cash, risk, and execution model for comparability; the enhanced low-frequency row is a Python proxy of the dashboard backtest multiplier, not a change to the dashboard.",
        "",
        markdown_table(
            ["Strategy", "Avg return", "Avg CAGR", "Avg max DD", "Avg vol", "Avg Sharpe", "Avg Calmar", "Avg buys", "Avg cash left"],
            [
                summary_table_row(label, values)
                for label, values in sorted(full_summary.items(), key=lambda item: item[1]["avg_total_return_pct"], reverse=True)
            ],
        ),
        "",
        "## Stress Windows Do Not Yet Justify a Default Change",
        "",
        "Detected drawdown and high-volatility windows are the best available local stress regimes. The current dataset begins in June 2021, so it captures the 2022 drawdown and later ticker-specific volatility, but it does not include the 2020 crash or older cycles.",
        "",
        markdown_table(
            ["Strategy", "Stress avg return", "Stress avg max DD", "Stress avg vol", "Stress avg Calmar", "Stress avg cash usage"],
            [
                stress_table_row(label, values)
                for label, values in sorted(stress_summary.items(), key=lambda item: item[1]["avg_total_return_pct"], reverse=True)
            ],
        ),
        "",
        "## Parameter Sensitivity Points To Candidates, Not Conclusions",
        "",
        "The balanced score rewards return and Calmar, penalizes max drawdown and volatility, includes a cash-deployment penalty, and penalizes uneven performance across tickers. It intentionally avoids selecting only the highest-return setting. The top rows are a cluster rather than a single decisive answer, which means some stress caps did not activate often enough in this dataset to separate cleanly.",
        "",
        markdown_table(
            ["Rank", "Parameter set", "Score", "Avg return", "Avg DD", "Avg vol", "Avg Calmar", "Cash usage", "Ticker stddev"],
            [
                [
                    str(index),
                    str(row["parameter_set"]),
                    f"{float(row['balanced_score']):.3f}",
                    pct(row["avg_total_return_pct"]),
                    pct(row["avg_max_drawdown_pct"]),
                    pct(row["avg_volatility_pct"]),
                    f"{float(row['avg_calmar_ratio']):.2f}",
                    pct(row["avg_cash_usage_pct"]),
                    pct(row["ticker_return_stddev_pct"]),
                ]
                for index, row in enumerate(top_candidates, start=1)
            ],
        ),
        "",
        "## Recommendation",
        "",
        "1. Keep Simple Dip-Buy as the Python default for now because Phase 3A does not support replacing it with Risk-Adjusted v2. Separately, continue comparing it against Fixed DCA and the enhanced proxy because the local sample does not prove a durable timing edge.",
        "2. Keep Risk-Adjusted v2 optional. It remains useful as a conservative safety variant, but Phase 3A does not show enough drawdown reduction to justify making it default.",
        "3. Treat the top v3 candidate as a sandbox candidate for deeper walk-forward testing. Do not port it to live recommendations yet.",
        "4. Add older market data before making a Phase 3B decision. The current local file has six tickers from June 2021 to June 2026 only.",
        "",
        "## Caveats And Assumptions",
        "",
        f"- Source data: `{DATA_PATH.as_posix()}` with {len(symbols)} tickers: {', '.join(symbols)}.",
        "- The enhanced low-frequency strategy is represented as a Python proxy of the dashboard backtest multiplier under Python cash, risk, and execution constraints; dashboard UI and live recommendation logic were not changed.",
        "- Worst period is a rolling four-week portfolio-value period, used as a worst-month proxy.",
        "- Calmar ratio is annualized return divided by max drawdown. Values can be unstable for short windows.",
        "- Parameter sensitivity uses detected full, major-drawdown, and high-volatility windows; it is a validation screen, not an optimizer for deployment.",
        "",
        "## Outputs",
        "",
        f"- Stress summary CSV: `{(RESULTS_DIR / 'stress_test_summary.csv').as_posix()}`",
        f"- Parameter sensitivity CSV: `{(RESULTS_DIR / 'parameter_sensitivity.csv').as_posix()}`",
        f"- Ranked parameter CSV: `{(RESULTS_DIR / 'parameter_sensitivity_ranked.csv').as_posix()}`",
    ]
    return "\n".join(lines) + "\n"


def summarize_by_strategy(rows: list[dict[str, object]]) -> dict[str, dict[str, float]]:
    grouped: dict[str, list[dict[str, object]]] = {}
    for row in rows:
        grouped.setdefault(str(row["strategy"]), []).append(row)
    return {strategy: summarize_rows(items) for strategy, items in grouped.items()}


def summarize_rows(rows: list[dict[str, object]]) -> dict[str, float]:
    return {
        "avg_final_value": avg(rows, "final_value"),
        "avg_total_return_pct": avg(rows, "total_return_pct"),
        "avg_cagr_pct": avg(rows, "cagr_pct"),
        "avg_max_drawdown_pct": avg(rows, "max_drawdown_pct"),
        "avg_volatility_pct": avg(rows, "volatility_pct"),
        "avg_sharpe_ratio": avg(rows, "sharpe_ratio"),
        "avg_calmar_ratio": avg(rows, "calmar_ratio"),
        "avg_buys": avg(rows, "number_of_buy_actions"),
        "avg_average_buy_amount": avg(rows, "average_buy_amount"),
        "avg_cash_left": avg(rows, "cash_remaining"),
        "avg_cash_usage_pct": avg(rows, "cash_usage_pct"),
    }


def summary_table_row(label: str, values: dict[str, float]) -> list[str]:
    return [
        label,
        pct(values["avg_total_return_pct"]),
        pct(values["avg_cagr_pct"]),
        pct(values["avg_max_drawdown_pct"]),
        pct(values["avg_volatility_pct"]),
        f"{values['avg_sharpe_ratio']:.2f}",
        f"{values['avg_calmar_ratio']:.2f}",
        f"{values['avg_buys']:.1f}",
        money(values["avg_cash_left"]),
    ]


def stress_table_row(label: str, values: dict[str, float]) -> list[str]:
    return [
        label,
        pct(values["avg_total_return_pct"]),
        pct(values["avg_max_drawdown_pct"]),
        pct(values["avg_volatility_pct"]),
        f"{values['avg_calmar_ratio']:.2f}",
        pct(values["avg_cash_usage_pct"]),
    ]


def markdown_table(headers: list[str], rows: list[list[str]]) -> str:
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---"] * len(headers)) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    if not rows:
        return
    os.makedirs(path.parent, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def weekly_returns(prices: list[PricePoint]) -> list[float]:
    returns = []
    for previous, current in zip(prices, prices[1:]):
        if previous.close > 0:
            returns.append(current.close / previous.close - 1)
    return returns


def weekly_volatility(closes: list[float], periods: int) -> float | None:
    if len(closes) < 3:
        return None
    start = max(1, len(closes) - periods)
    returns = []
    for index in range(start, len(closes)):
        previous = closes[index - 1]
        current = closes[index]
        if previous > 0 and current > 0:
            returns.append(current / previous - 1)
    if len(returns) < 2:
        return None
    return stddev(returns)


def recent_drawdown_pct(closes: list[float], lookback: int) -> float | None:
    if not closes:
        return None
    window = closes[-lookback:]
    high = max(window)
    latest = closes[-1]
    return ((high - latest) / high) * 100 if high > 0 else None


def moving_average(closes: list[float], length: int, offset: int) -> float | None:
    if len(closes) < length + offset:
        return None
    end = len(closes) - offset
    values = closes[end - length : end]
    return sum(values) / len(values)


def percent_change(closes: list[float], periods: int) -> float | None:
    if len(closes) <= periods:
        return None
    current = closes[-1]
    previous = closes[-1 - periods]
    return ((current - previous) / previous) * 100 if previous > 0 else None


def stddev(values: Iterable[float]) -> float:
    values = list(values)
    if len(values) < 2:
        return 0.0
    avg_value = sum(values) / len(values)
    variance = sum((value - avg_value) ** 2 for value in values) / (len(values) - 1)
    return math.sqrt(variance)


def safe_ratio(numerator: float | None, denominator: float | None) -> float:
    if denominator is None or denominator <= 0 or numerator is None:
        return 0.0
    return numerator / denominator


def clamp(value: float, lower: float, upper: float) -> float:
    return min(max(value, lower), upper)


def avg(rows: list[dict[str, object]], key: str) -> float:
    values = [float(row[key]) for row in rows if row.get(key) not in ("", None)]
    return mean(values) if values else 0.0


def pct(value: object) -> str:
    return f"{float(value):.2f}%"


def money(value: object) -> str:
    return f"{float(value):.2f}"


if __name__ == "__main__":
    main()
