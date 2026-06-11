from __future__ import annotations

import csv
import os
from dataclasses import asdict, dataclass
from datetime import datetime, timezone

from config import AnalysisConfig, BacktestConfig, StrategyConfig
from data_loader import PricePoint, daily_to_weekly, load_yahoo_daily_prices
from portfolio import (
    PortfolioHolding,
    ticker_exposure_pct,
    total_equity_exposure_pct,
)
from strategy import calculate_buy_amount, calculate_risk_adjusted_buy_amount, calculate_weekly_return


MANUAL_TRADE_NOTE = (
    "This is not an automatic order. Review the analysis and place any trade manually only if you decide to do so."
)

MANUAL_CHECKLIST = [
    "Confirm the ticker is correct.",
    "Confirm the latest price.",
    "Confirm available cash.",
    "Confirm suggested buy amount.",
    "Confirm portfolio concentration.",
    "Confirm current market risk.",
    "Confirm this is not financial advice.",
    "Place the order manually only if I decide to do so.",
]


@dataclass
class AnalysisResult:
    date: str
    ticker: str
    latest_price: float
    weekly_return: float
    strategy_mode: str
    buy_multiplier: float
    suggested_buy_amount: float
    suggested_sell_amount: float
    suggested_action: str
    risk_level: str
    reason: str
    warning: str
    manual_trade_note: str


def run_analysis(
    tickers: list[str],
    strategy_config: StrategyConfig,
    analysis_config: AnalysisConfig,
    portfolio: dict[str, PortfolioHolding] | None = None,
    results_dir: str = "results",
) -> list[AnalysisResult]:
    portfolio = portfolio or {}
    results = [
        analyze_ticker(ticker, strategy_config, analysis_config, portfolio)
        for ticker in _unique_tickers(tickers)
    ]
    save_analysis_outputs(results, results_dir)
    return results


def analyze_ticker(
    ticker: str,
    strategy_config: StrategyConfig,
    analysis_config: AnalysisConfig,
    portfolio: dict[str, PortfolioHolding],
) -> AnalysisResult:
    ticker = ticker.upper()
    now = datetime.now(timezone.utc)

    if ticker not in {item.upper() for item in analysis_config.allowed_tickers}:
        return _blocked_result(ticker, strategy_config, "Ticker is not in allowed_tickers.")

    try:
        daily_prices = load_yahoo_daily_prices(ticker, _lookback_start_year(), now.date().isoformat())
        weekly_prices = daily_to_weekly(daily_prices)
    except Exception as error:
        return _blocked_result(ticker, strategy_config, f"Market data is missing: {error}")

    if len(weekly_prices) < 2:
        return _blocked_result(ticker, strategy_config, "Market data is insufficient for weekly_return.")

    latest = weekly_prices[-1]
    previous = weekly_prices[-2]
    weekly_return = calculate_weekly_return(latest.close, previous.close)
    age_hours = (now.date() - latest.date).days * 24
    if age_hours > analysis_config.stale_data_limit_hours:
        return _blocked_result(ticker, strategy_config, "Market data is stale.")

    # Build list of weekly returns for risk adjustment
    weekly_returns_list: list[float] = []
    for idx in range(1, len(weekly_prices)):
        r = calculate_weekly_return(weekly_prices[idx].close, weekly_prices[idx - 1].close)
        weekly_returns_list.append(r)

    consecutive_declines = _consecutive_declines(weekly_prices)
    _recent_high = max(p.close for p in weekly_prices[-52:]) if weekly_prices else latest.close
    _dd = 1 - latest.close / _recent_high if _recent_high else 0.0

    desired_amount, buy_multiplier = calculate_risk_adjusted_buy_amount(
        weekly_return,
        strategy_config,
        recent_returns=weekly_returns_list[-12:],
        consecutive_declines=consecutive_declines,
        drawdown=_dd,
    )
    suggested_buy_amount = min(
        desired_amount,
        analysis_config.available_cash * analysis_config.max_cash_usage_per_trade,
        analysis_config.max_single_trade_amount,
    )

    warnings = []
    if _dd > analysis_config.large_drawdown_threshold:
        warnings.append(f"Price is down {_dd:.1%} from recent high.")

    if consecutive_declines > analysis_config.consecutive_decline_weeks_limit:
        warnings.append(f"{consecutive_declines} consecutive weekly declines detected.")

    ticker_exposure = ticker_exposure_pct(ticker, portfolio, analysis_config.available_cash)
    if ticker_exposure > analysis_config.max_position_pct_per_ticker:
        warnings.append(f"Ticker exposure is high at {ticker_exposure:.1%}.")

    total_exposure = total_equity_exposure_pct(portfolio, analysis_config.available_cash)
    if total_exposure > analysis_config.max_total_equity_exposure:
        warnings.append(f"Total equity exposure is high at {total_exposure:.1%}.")

    if analysis_config.available_cash < strategy_config.base_buy_amount:
        warnings.append("Available cash is below the base buy amount.")

    volatility = _average_abs_return(weekly_prices[-8:])
    if volatility > analysis_config.high_volatility_weekly_threshold:
        warnings.append(f"Recent weekly volatility is unusually high at {volatility:.1%}.")

    action, sell_amount = _suggest_action(weekly_return, buy_multiplier, suggested_buy_amount, warnings)
    risk_level = _risk_level(warnings, weekly_return, _dd, volatility)
    reason = _reason(ticker, weekly_return, strategy_config.strategy_mode, action)

    return AnalysisResult(
        date=now.isoformat(),
        ticker=ticker,
        latest_price=round(latest.close, 6),
        weekly_return=round(weekly_return, 8),
        strategy_mode=strategy_config.strategy_mode,
        buy_multiplier=round(buy_multiplier, 6),
        suggested_buy_amount=round(suggested_buy_amount if action in {"BUY", "REDUCE_BUY"} else 0.0, 6),
        suggested_sell_amount=round(sell_amount, 6),
        suggested_action=action,
        risk_level=risk_level,
        reason=reason,
        warning="; ".join(warnings),
        manual_trade_note=MANUAL_TRADE_NOTE,
    )


def save_analysis_outputs(results: list[AnalysisResult], results_dir: str) -> None:
    os.makedirs(results_dir, exist_ok=True)
    _write_analysis_csv(os.path.join(results_dir, "live_analysis.csv"), results)
    _write_checklist_csv(os.path.join(results_dir, "manual_trade_checklist.csv"))
    _write_report(os.path.join(results_dir, "analysis_report.txt"), results)


def _write_analysis_csv(path: str, results: list[AnalysisResult]) -> None:
    if not results:
        return
    with open(path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(asdict(results[0]).keys()))
        writer.writeheader()
        for result in results:
            writer.writerow(asdict(result))


def _write_checklist_csv(path: str) -> None:
    with open(path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["step", "check_item"])
        writer.writeheader()
        for index, item in enumerate(MANUAL_CHECKLIST, start=1):
            writer.writerow({"step": index, "check_item": item})


def _write_report(path: str, results: list[AnalysisResult]) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("Su Investment Pro Analysis Report\n")
        handle.write("Decision-support only. No automatic orders are placed.\n\n")
        handle.write("Manual checklist:\n")
        for index, item in enumerate(MANUAL_CHECKLIST, start=1):
            handle.write(f"{index}. {item}\n")
        handle.write("\nSignals:\n")
        for result in results:
            handle.write(
                f"- {result.ticker}: {result.suggested_action}, "
                f"buy {result.suggested_buy_amount:.2f}, sell {result.suggested_sell_amount:.2f}, "
                f"risk {result.risk_level}. {result.reason}"
            )
            if result.warning:
                handle.write(f" Warning: {result.warning}")
            handle.write("\n")


def _blocked_result(ticker: str, strategy_config: StrategyConfig, warning: str) -> AnalysisResult:
    now = datetime.now(timezone.utc).isoformat()
    return AnalysisResult(
        date=now,
        ticker=ticker.upper(),
        latest_price=0.0,
        weekly_return=0.0,
        strategy_mode=strategy_config.strategy_mode,
        buy_multiplier=0.0,
        suggested_buy_amount=0.0,
        suggested_sell_amount=0.0,
        suggested_action="DO_NOT_BUY",
        risk_level="High",
        reason="Analysis blocked by risk or data rule.",
        warning=warning,
        manual_trade_note=MANUAL_TRADE_NOTE,
    )


def _suggest_action(
    weekly_return: float,
    buy_multiplier: float,
    suggested_buy_amount: float,
    warnings: list[str],
) -> tuple[str, float]:
    if suggested_buy_amount <= 0:
        return "DO_NOT_BUY", 0.0
    if any("exposure is high" in warning for warning in warnings):
        return "CONSIDER_SELL", suggested_buy_amount
    if any("Available cash" in warning or "stale" in warning for warning in warnings):
        return "DO_NOT_BUY", 0.0
    if buy_multiplier > 1.05:
        return "BUY", 0.0
    if buy_multiplier < 0.75 or weekly_return > 0.08:
        return "REDUCE_BUY", 0.0
    return "HOLD", 0.0


def _risk_level(warnings: list[str], weekly_return: float, drawdown: float, volatility: float) -> str:
    if len(warnings) >= 2 or drawdown > 0.30 or volatility > 0.12:
        return "High"
    if warnings or abs(weekly_return) > 0.04 or volatility > 0.08:
        return "Medium"
    return "Low"


def _reason(ticker: str, weekly_return: float, strategy_mode: str, action: str) -> str:
    move = f"{ticker} moved {weekly_return:.1%} this week"
    if action == "BUY":
        return f"{move}; {strategy_mode} mode increases the buy amount."
    if action == "REDUCE_BUY":
        return f"{move}; {strategy_mode} mode reduces the buy amount."
    if action == "CONSIDER_SELL":
        return f"{move}; portfolio exposure is high, so consider trimming manually."
    if action == "DO_NOT_BUY":
        return f"{move}; risk or data rules block a buy suggestion."
    return f"{move}; no strong buy or sell signal."


def _consecutive_declines(prices: list[PricePoint]) -> int:
    count = 0
    for previous, current in reversed(list(zip(prices, prices[1:]))):
        if current.close < previous.close:
            count += 1
        else:
            break
    return count


def _average_abs_return(prices: list[PricePoint]) -> float:
    returns = []
    for previous, current in zip(prices, prices[1:]):
        returns.append(abs(calculate_weekly_return(current.close, previous.close)))
    return sum(returns) / len(returns) if returns else 0.0


def _lookback_start_year() -> str:
    year = datetime.now(timezone.utc).year - 2
    return f"{year}-01-01"


def _unique_tickers(tickers: list[str]) -> list[str]:
    seen = set()
    result = []
    for ticker in tickers:
        normalized = ticker.upper()
        if normalized and normalized not in seen:
            seen.add(normalized)
            result.append(normalized)
    return result
