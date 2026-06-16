from __future__ import annotations

import csv
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

OUT_DIR = ROOT / "results" / "phase5" / "quantstats"
SUMMARY_PATH = OUT_DIR / "quantstats_summary.csv"
REPORT_PATH = ROOT / "QUANTSTATS_REPORT.md"


def main() -> int:
    try:
        pd, qs = load_dependencies()
        bt = load_backtrader()
    except ImportError as error:
        print(
            "Missing optional research dependency. Install the research stack with:\n"
            "  python -m pip install -r requirements-research.txt\n\n"
            f"Import error: {error}",
            file=sys.stderr,
        )
        return 2

    from config import BacktestConfig
    from research.backtrader_sandbox import STRATEGIES, portfolio_summary_rows

    config = BacktestConfig()
    equity_by_strategy = build_portfolio_equity_series(pd, bt, config)
    summary_rows = []
    html_status: dict[str, str] = {}
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for strategy_name in STRATEGIES:
        equity = equity_by_strategy[strategy_name]
        returns = equity.pct_change().dropna()
        summary_rows.append(calculate_metrics(strategy_name, equity, returns, pd))
        html_path = OUT_DIR / f"{strategy_name}_report.html"
        html_status[strategy_name] = write_quantstats_html(qs, returns, html_path, strategy_name)

    write_csv(SUMMARY_PATH, summary_rows)
    write_markdown_report(summary_rows, html_status, portfolio_summary_rows)

    print(f"Wrote {SUMMARY_PATH}")
    for strategy_name, status in html_status.items():
        print(f"{strategy_name}: {status}")
    print(f"Wrote {REPORT_PATH}")
    return 0


def load_dependencies() -> tuple[Any, Any]:
    try:
        import pandas as pd
    except ImportError as error:
        raise ImportError("pandas is required for research/quantstats_report.py") from error
    try:
        import quantstats as qs
    except ImportError as error:
        raise ImportError("quantstats is required for research/quantstats_report.py") from error
    return pd, qs


def load_backtrader() -> Any:
    try:
        import backtrader as bt
    except ImportError as error:
        raise ImportError("backtrader is required for research/quantstats_report.py") from error
    return bt


def build_portfolio_equity_series(pd: Any, bt: Any, config: Any) -> dict[str, Any]:
    from research.backtrader_sandbox import DATA_PATH, PORTFOLIO_SYMBOLS, STRATEGIES, load_prices, run_symbol_backtest

    prices_by_symbol = load_prices(DATA_PATH)
    equity_by_strategy: dict[str, Any] = {}
    for strategy_name in STRATEGIES:
        frames = []
        for ticker in PORTFOLIO_SYMBOLS:
            result = run_symbol_backtest(bt, ticker, prices_by_symbol[ticker], strategy_name, config)
            frame = pd.DataFrame(result["equity_curve"])
            frame["date"] = pd.to_datetime(frame["date"])
            frame = frame.set_index("date").sort_index()
            frame = frame.rename(columns={"value": ticker})
            frames.append(frame[[ticker]])
        combined = pd.concat(frames, axis=1).sort_index()
        combined = combined.ffill().dropna(how="any")
        equity_by_strategy[strategy_name] = combined.sum(axis=1)
    return equity_by_strategy


def calculate_metrics(strategy_name: str, equity: Any, returns: Any, pd: Any) -> dict[str, Any]:
    total_return = equity.iloc[-1] / equity.iloc[0] - 1
    years = max((equity.index[-1] - equity.index[0]).days / 365.25, 1 / 365.25)
    cagr = (equity.iloc[-1] / equity.iloc[0]) ** (1 / years) - 1
    volatility = returns.std() * (52 ** 0.5) if len(returns) > 1 else 0.0
    sharpe = returns.mean() / returns.std() * (52 ** 0.5) if len(returns) > 1 and returns.std() else 0.0
    downside = returns[returns < 0]
    sortino = returns.mean() / downside.std() * (52 ** 0.5) if len(downside) > 1 and downside.std() else 0.0
    drawdown = equity / equity.cummax() - 1
    max_dd = drawdown.min()
    calmar = cagr / abs(max_dd) if max_dd < 0 else 0.0
    monthly = returns.resample("ME").apply(lambda values: (1 + values).prod() - 1)
    annual = returns.resample("YE").apply(lambda values: (1 + values).prod() - 1)

    return {
        "strategy": strategy_name,
        "start_date": equity.index[0].date().isoformat(),
        "end_date": equity.index[-1].date().isoformat(),
        "weeks": len(equity),
        "starting_value": round(float(equity.iloc[0]), 6),
        "final_value": round(float(equity.iloc[-1]), 6),
        "total_return": round(float(total_return), 8),
        "cagr": round(float(cagr), 8),
        "volatility": round(float(volatility), 8),
        "sharpe_ratio": round(float(sharpe), 8),
        "sortino_ratio": round(float(sortino), 8),
        "max_drawdown": round(float(abs(max_dd)), 8),
        "calmar_ratio": round(float(calmar), 8),
        "win_rate": round(float((returns > 0).mean()), 8),
        "best_week": round(float(returns.max()), 8),
        "worst_week": round(float(returns.min()), 8),
        "best_month": round(float(monthly.max()), 8) if not monthly.empty else 0.0,
        "worst_month": round(float(monthly.min()), 8) if not monthly.empty else 0.0,
        "best_year": round(float(annual.max()), 8) if not annual.empty else 0.0,
        "worst_year": round(float(annual.min()), 8) if not annual.empty else 0.0,
    }


def write_quantstats_html(qs: Any, returns: Any, path: Path, strategy_name: str) -> str:
    try:
        qs.reports.html(
            returns,
            output=str(path),
            title=f"Phase 5C QuantStats - {strategy_name}",
            download_filename=str(path),
        )
    except Exception as error:
        return f"html_failed: {error}"
    return f"html_written: {path.as_posix()}"


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def write_markdown_report(
    summary_rows: list[dict[str, Any]],
    html_status: dict[str, str],
    _portfolio_summary_rows: Any,
) -> None:
    generated_at = datetime.now(timezone.utc).isoformat()
    ranked = sorted(summary_rows, key=lambda row: float(row["final_value"]), reverse=True)
    lines = [
        "# Phase 5C QuantStats Report",
        "",
        f"Generated at: `{generated_at}`",
        "",
        "QuantStats reports are research-only. They do not affect live dashboard recommendations, buy amounts, signal scores, multipliers, risk levels, action thresholds, the default Python strategy, or the market regime formula.",
        "",
        "## Scope",
        "",
        "- Source engine: Phase 5B Backtrader sandbox strategy logic",
        "- Portfolio series: six independent ticker equity curves summed by strategy",
        "- Strategies: Fixed Weekly DCA, Simple Dip-Buy, Risk-Adjusted v2",
        "- Reports are for performance diagnosis, not strategy promotion.",
        "",
        "## Outputs",
        "",
        "- `results/phase5/quantstats/quantstats_summary.csv`",
        "- `results/phase5/quantstats/fixed_weekly_dca_report.html`",
        "- `results/phase5/quantstats/simple_dip_buy_report.html`",
        "- `results/phase5/quantstats/risk_adjusted_v2_report.html`",
        "",
        "## HTML Status",
        "",
    ]
    for strategy_name, status in html_status.items():
        lines.append(f"- `{strategy_name}`: {status}")

    lines.extend(
        [
            "",
            "## Summary Metrics",
            "",
            "| strategy | final_value | total_return | CAGR | volatility | Sharpe | Sortino | max_drawdown | Calmar | win_rate |",
            "|:--|--:|--:|--:|--:|--:|--:|--:|--:|--:|",
        ]
    )
    for row in ranked:
        lines.append(
            f"| {row['strategy']} | {float(row['final_value']):.2f} | {float(row['total_return']):.4f} | "
            f"{float(row['cagr']):.4f} | {float(row['volatility']):.4f} | {float(row['sharpe_ratio']):.4f} | "
            f"{float(row['sortino_ratio']):.4f} | {float(row['max_drawdown']):.4f} | "
            f"{float(row['calmar_ratio']):.4f} | {float(row['win_rate']):.4f} |"
        )

    lines.extend(
        [
            "",
            "## Interpretation Notes",
            "",
            "- Higher final value alone is not enough to promote a strategy.",
            "- Results may differ from the existing custom backtest because Backtrader execution assumptions differ.",
            "- QuantStats is used here for diagnostics such as return distribution, drawdown, and risk-adjusted performance.",
            "- No live dashboard behavior changes are justified by this report alone.",
            "",
            "## Known Limits",
            "",
            "- Weekly close-only data limits path-level and intraperiod drawdown analysis.",
            "- Portfolio equity is reconstructed by summing independent ticker sandbox runs, not by using one combined broker account.",
            "- No Alphalens, scikit-learn, or PyPortfolioOpt work is implemented in Phase 5C.",
            "",
        ]
    )
    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
