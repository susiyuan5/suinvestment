from __future__ import annotations

import csv
import json
import math
import os
import sys
import tempfile
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

try:
    import backtrader as bt
except ImportError:
    bt = None


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
DATA_PATH = ROOT / "data" / "backtest-prices.json"
OUT_DIR = ROOT / "results" / "phase5"
SUMMARY_PATH = OUT_DIR / "backtrader_summary.csv"
TRADES_PATH = OUT_DIR / "backtrader_trades.csv"
REPORT_PATH = ROOT / "BACKTRADER_SANDBOX_REPORT.md"
PORTFOLIO_SYMBOLS = ("BYDDY", "MSFT", "NVDA", "AAPL", "ASML", "KO")
STRATEGIES = ("fixed_weekly_dca", "simple_dip_buy", "risk_adjusted_v2")


@dataclass(frozen=True)
class WeeklyPrice:
    date: date
    close: float


def main() -> int:
    try:
        backtrader_module = load_backtrader()
    except ImportError as error:
        print(
            "Missing optional research dependency. Install the research stack with:\n"
            "  python -m pip install -r requirements-research.txt\n\n"
            f"Import error: {error}",
            file=sys.stderr,
        )
        return 2

    from config import BacktestConfig

    config = BacktestConfig()
    prices_by_symbol = load_prices(DATA_PATH)
    summaries: list[dict[str, Any]] = []
    trades: list[dict[str, Any]] = []

    for strategy_name in STRATEGIES:
        for ticker in PORTFOLIO_SYMBOLS:
            result = run_symbol_backtest(backtrader_module, ticker, prices_by_symbol[ticker], strategy_name, config)
            summaries.append(result["summary"])
            trades.extend(result["trades"])

    portfolio_rows = portfolio_summary_rows(summaries)
    all_summary_rows = summaries + portfolio_rows
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    write_csv(SUMMARY_PATH, all_summary_rows)
    write_csv(TRADES_PATH, trades)
    write_report(all_summary_rows, trades, config)

    print(f"Wrote {SUMMARY_PATH}")
    print(f"Wrote {TRADES_PATH}")
    print(f"Wrote {REPORT_PATH}")
    return 0


def load_backtrader() -> Any:
    if bt is None:
        raise ImportError("backtrader is required for research/backtrader_sandbox.py")
    return bt


def load_prices(path: Path) -> dict[str, list[WeeklyPrice]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    prices: dict[str, list[WeeklyPrice]] = {}
    for ticker in PORTFOLIO_SYMBOLS:
        rows = payload.get("symbols", {}).get(ticker, [])
        parsed = [
            WeeklyPrice(datetime.strptime(row["date"], "%Y-%m-%d").date(), float(row["close"]))
            for row in rows
            if row.get("date") and row.get("close")
        ]
        if len(parsed) < 2:
            raise RuntimeError(f"{ticker} has fewer than two weekly close rows in {path}")
        prices[ticker] = parsed
    return prices


def run_symbol_backtest(
    bt: Any,
    ticker: str,
    prices: list[WeeklyPrice],
    strategy_name: str,
    config: Any,
) -> dict[str, Any]:
    cerebro = bt.Cerebro(stdstats=False)
    cerebro.broker.setcash(config.strategy.initial_cash)
    cerebro.broker.setcommission(commission=config.strategy.commission_rate)
    try:
        cerebro.broker.set_slippage_perc(config.strategy.slippage_rate)
    except AttributeError:
        pass
    cerebro.broker.set_coc(True)

    csv_path = write_temp_price_csv(prices)
    try:
        data = bt.feeds.GenericCSVData(
            dataname=csv_path,
            dtformat="%Y-%m-%d",
            datetime=0,
            open=1,
            high=2,
            low=3,
            close=4,
            volume=5,
            openinterest=-1,
            timeframe=bt.TimeFrame.Weeks,
            compression=1,
            headers=True,
        )
        cerebro.adddata(data, name=ticker)
        cerebro.addstrategy(
            SandboxWeeklyStrategy,
            ticker=ticker,
            strategy_name=strategy_name,
            strategy_config=config.strategy,
            risk_config=config.risk,
        )
        strategies = cerebro.run()
    finally:
        try:
            os.remove(csv_path)
        except OSError:
            pass

    strategy = strategies[0]
    final_value = float(cerebro.broker.getvalue())
    cash = float(cerebro.broker.getcash())
    first_date = prices[0].date
    last_date = prices[-1].date
    total_return = final_value / config.strategy.initial_cash - 1
    summary = {
        "scope": "ticker",
        "strategy": strategy_name,
        "ticker": ticker,
        "start_date": first_date.isoformat(),
        "end_date": last_date.isoformat(),
        "weeks": len(prices),
        "initial_cash": round(config.strategy.initial_cash, 6),
        "weekly_budget": round(config.strategy.base_buy_amount, 6),
        "final_value": round(final_value, 6),
        "total_return": round(total_return, 8),
        "annualized_return": annualized_return(config.strategy.initial_cash, final_value, first_date, last_date),
        "max_drawdown": max_drawdown(strategy.equity_curve),
        "total_invested": round(strategy.total_invested, 6),
        "cash_remaining": round(cash, 6),
        "shares_held": round(float(strategy.position.size), 8),
        "orders": len(strategy.trades),
    }
    return {"summary": summary, "trades": strategy.trades}


class SandboxWeeklyStrategy(bt.Strategy if bt is not None else object):
    params = (
        ("ticker", ""),
        ("strategy_name", "fixed_weekly_dca"),
        ("strategy_config", None),
        ("risk_config", None),
    )

    def __init__(self) -> None:
        self.previous_close: float | None = None
        self.recent_returns: list[float] = []
        self.peak_price: float | None = None
        self.consecutive_declines = 0
        self.total_invested = 0.0
        self.trades: list[dict[str, Any]] = []
        self.equity_curve: list[dict[str, Any]] = []

    def next(self) -> None:
        from strategy import calculate_buy_amount, calculate_risk_adjusted_buy_amount, calculate_weekly_return

        current_close = float(self.data.close[0])
        current_date = self.data.datetime.date(0)
        if self.previous_close is None:
            self.previous_close = current_close
            self.peak_price = current_close
            self.record_equity(current_date)
            return

        weekly_return = calculate_weekly_return(current_close, self.previous_close)
        self.recent_returns.append(weekly_return)
        if len(self.recent_returns) > 52:
            self.recent_returns.pop(0)
        self.peak_price = max(self.peak_price or current_close, current_close)
        price_drawdown = 1 - current_close / self.peak_price if self.peak_price else 0.0
        self.consecutive_declines = self.consecutive_declines + 1 if weekly_return < 0 else 0
        conservative_mode = self.consecutive_declines > self.p.risk_config.consecutive_decline_weeks

        if self.p.strategy_name == "fixed_weekly_dca":
            desired_amount = self.p.strategy_config.base_buy_amount
            multiplier = 1.0
        elif self.p.strategy_name == "simple_dip_buy":
            desired_amount, multiplier = calculate_buy_amount(
                weekly_return,
                self.p.strategy_config,
                conservative_mode=conservative_mode,
            )
        elif self.p.strategy_name == "risk_adjusted_v2":
            desired_amount, multiplier = calculate_risk_adjusted_buy_amount(
                weekly_return,
                self.p.strategy_config,
                recent_returns=list(self.recent_returns),
                consecutive_declines=self.consecutive_declines,
                drawdown=price_drawdown,
            )
        else:
            raise ValueError(f"Unsupported strategy: {self.p.strategy_name}")

        if price_drawdown >= self.p.risk_config.drawdown_threshold:
            if self.p.risk_config.drawdown_action == "pause":
                desired_amount = 0.0
                multiplier = 0.0
            elif self.p.risk_config.drawdown_action == "reduce":
                desired_amount *= self.p.risk_config.drawdown_reduce_multiplier
                multiplier = desired_amount / self.p.strategy_config.base_buy_amount

        cash = float(self.broker.getcash())
        max_by_cash_rule = cash * self.p.risk_config.max_single_buy_pct_cash
        buy_amount = min(desired_amount, max_by_cash_rule)
        affordable_before_commission = cash / (1 + self.p.strategy_config.commission_rate)
        buy_amount = min(buy_amount, affordable_before_commission)

        submitted_size = 0.0
        if buy_amount > 0 and current_close > 0:
            submitted_size = buy_amount / current_close
            if not self.p.strategy_config.fractional_shares:
                submitted_size = math.floor(submitted_size)
            if submitted_size > 0:
                self.buy(size=submitted_size)

        self.trades.append(
            {
                "date": current_date.isoformat(),
                "strategy": self.p.strategy_name,
                "ticker": self.p.ticker,
                "price": round(current_close, 6),
                "weekly_return": round(weekly_return, 8),
                "buy_multiplier": round(multiplier, 6),
                "desired_amount": round(desired_amount, 6),
                "submitted_amount": round(buy_amount, 6),
                "submitted_size": round(submitted_size, 8),
                "cash_before_order": round(cash, 6),
            }
        )
        self.previous_close = current_close
        self.record_equity(current_date)

    def notify_order(self, order: Any) -> None:
        if order.status == order.Completed and order.isbuy():
            self.total_invested += float(order.executed.value + order.executed.comm)

    def record_equity(self, current_date: date) -> None:
        self.equity_curve.append(
            {
                "date": current_date.isoformat(),
                "value": float(self.broker.getvalue()),
            }
        )


def write_temp_price_csv(prices: list[WeeklyPrice]) -> str:
    handle = tempfile.NamedTemporaryFile("w", newline="", encoding="utf-8", delete=False, suffix=".csv")
    with handle:
        writer = csv.writer(handle)
        writer.writerow(["date", "open", "high", "low", "close", "volume"])
        for point in prices:
            writer.writerow([point.date.isoformat(), point.close, point.close, point.close, point.close, 0])
    return handle.name


def portfolio_summary_rows(summaries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for strategy_name in STRATEGIES:
        selected = [row for row in summaries if row["strategy"] == strategy_name and row["scope"] == "ticker"]
        if not selected:
            continue
        rows.append(
            {
                "scope": "portfolio_average",
                "strategy": strategy_name,
                "ticker": "PORTFOLIO_AVG",
                "start_date": min(row["start_date"] for row in selected),
                "end_date": max(row["end_date"] for row in selected),
                "weeks": round(sum(float(row["weeks"]) for row in selected) / len(selected), 2),
                "initial_cash": round(sum(float(row["initial_cash"]) for row in selected), 6),
                "weekly_budget": round(sum(float(row["weekly_budget"]) for row in selected), 6),
                "final_value": round(sum(float(row["final_value"]) for row in selected), 6),
                "total_return": round(sum(float(row["total_return"]) for row in selected) / len(selected), 8),
                "annualized_return": round(sum(float(row["annualized_return"]) for row in selected) / len(selected), 8),
                "max_drawdown": round(sum(float(row["max_drawdown"]) for row in selected) / len(selected), 8),
                "total_invested": round(sum(float(row["total_invested"]) for row in selected), 6),
                "cash_remaining": round(sum(float(row["cash_remaining"]) for row in selected), 6),
                "shares_held": "",
                "orders": sum(int(row["orders"]) for row in selected),
            }
        )
    return rows


def annualized_return(initial_value: float, final_value: float, first_date: date, last_date: date) -> float:
    if initial_value <= 0 or final_value <= 0:
        return 0.0
    years = max((last_date - first_date).days / 365.25, 1 / 365.25)
    return round((final_value / initial_value) ** (1 / years) - 1, 8)


def max_drawdown(equity_curve: list[dict[str, Any]]) -> float:
    peak = 0.0
    worst = 0.0
    for point in equity_curve:
        value = float(point["value"])
        peak = max(peak, value)
        if peak > 0:
            worst = max(worst, 1 - value / peak)
    return round(worst, 8)


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def write_report(summaries: list[dict[str, Any]], trades: list[dict[str, Any]], config: Any) -> None:
    generated_at = datetime.now(timezone.utc).isoformat()
    portfolio_rows = [row for row in summaries if row["scope"] == "portfolio_average"]
    best = sorted(portfolio_rows, key=lambda row: float(row["final_value"]), reverse=True)
    lines = [
        "# Phase 5B Backtrader Sandbox Report",
        "",
        f"Generated at: `{generated_at}`",
        "",
        "Backtrader is research-only in this project. These results do not affect live dashboard recommendations, buy amounts, signal scores, multipliers, risk levels, action thresholds, the default Python strategy, or the market regime formula.",
        "",
        "## Scope",
        "",
        "- Symbols: BYDDY, MSFT, NVDA, AAPL, ASML, KO",
        "- Source: `data/backtest-prices.json` weekly close data",
        "- Engine: Backtrader sandbox",
        "- Strategies: Fixed Weekly DCA, Simple Dip-Buy, Risk-Adjusted v2",
        "",
        "## Assumptions",
        "",
        f"- Starting cash per ticker: `{config.strategy.initial_cash}`",
        f"- Weekly budget per ticker: `{config.strategy.base_buy_amount}`",
        f"- Commission rate: `{config.strategy.commission_rate}`",
        f"- Slippage rate: `{config.strategy.slippage_rate}`",
        "- Model: initial cash pool, not new weekly cash contributions",
        "- Weekly execution timing: submitted on weekly bar using close-style sandbox execution",
        f"- Fractional shares: `{config.strategy.fractional_shares}`",
        "- Portfolio row is an aggregate of six independent single-symbol runs, not a combined broker account.",
        "",
        "## Outputs",
        "",
        "- `results/phase5/backtrader_summary.csv`",
        "- `results/phase5/backtrader_trades.csv`",
        "",
        "## Portfolio Aggregate",
        "",
        "| strategy | final_value | total_return | annualized_return | max_drawdown | total_invested | orders |",
        "|:--|--:|--:|--:|--:|--:|--:|",
    ]
    for row in best:
        lines.append(
            f"| {row['strategy']} | {float(row['final_value']):.2f} | {float(row['total_return']):.4f} | "
            f"{float(row['annualized_return']):.4f} | {float(row['max_drawdown']):.4f} | "
            f"{float(row['total_invested']):.2f} | {int(row['orders'])} |"
        )

    lines.extend(
        [
            "",
            "## Interpretation",
            "",
            "- Backtrader is used here as a standardized sandbox engine, not as a live or default engine.",
            "- Differences versus `backtest.py` may come from Backtrader broker accounting, order timing, cash handling, slippage handling, commission handling, and fractional-share treatment.",
            "- This run should not be interpreted as a promotion decision for any strategy.",
            "- Later phases can use Backtrader for more standardized rolling windows, contribution-mode tests, and report generation.",
            "",
            "## Current Limits",
            "",
            "- Uses close-only weekly data; no intraday or high/low path is available.",
            "- Portfolio aggregate is a simple sum/average across independent ticker runs.",
            "- Does not use QuantStats, Alphalens, scikit-learn, or PyPortfolioOpt in Phase 5B.",
            f"- Trade rows written: `{len(trades)}`",
            "",
        ]
    )
    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
