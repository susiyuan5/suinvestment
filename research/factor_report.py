from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "backtest-prices.json"
OUT_DIR = ROOT / "results" / "phase5"
REPORT_PATH = ROOT / "FACTOR_REPORT.md"
PORTFOLIO_SYMBOLS = ("BYDDY", "MSFT", "NVDA", "AAPL", "ASML", "KO")


def main() -> int:
    try:
        pd, ta = load_research_dependencies()
    except ImportError as error:
        print(
            "Missing optional research dependency. Install the research stack with:\n"
            "  python -m pip install -r requirements-research.txt\n\n"
            f"Import error: {error}",
            file=sys.stderr,
        )
        return 2

    factor_table = build_factor_table(pd, ta, DATA_PATH)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    factor_report_path = OUT_DIR / "factor_report.csv"
    factor_latest_path = OUT_DIR / "factor_latest.csv"
    factor_table.to_csv(factor_report_path, index=False)

    latest = factor_table.sort_values("date").groupby("ticker", as_index=False).tail(1)
    latest.to_csv(factor_latest_path, index=False)
    write_markdown_report(latest, len(factor_table), factor_report_path, factor_latest_path)

    print(f"Wrote {factor_report_path}")
    print(f"Wrote {factor_latest_path}")
    print(f"Wrote {REPORT_PATH}")
    return 0


def load_research_dependencies() -> tuple[Any, Any]:
    try:
        import pandas as pd
    except ImportError as error:
        raise ImportError("pandas is required for research/factor_report.py") from error

    try:
        import pandas_ta_classic as ta
    except ImportError as error:
        raise ImportError("pandas-ta-classic is required for research/factor_report.py") from error

    return pd, ta


def build_factor_table(pd: Any, ta: Any, data_path: Path) -> Any:
    payload = json.loads(data_path.read_text(encoding="utf-8"))
    frames = []
    for ticker in PORTFOLIO_SYMBOLS:
        rows = payload.get("symbols", {}).get(ticker, [])
        if not rows:
            continue

        frame = pd.DataFrame(rows)
        frame["ticker"] = ticker
        frame["date"] = pd.to_datetime(frame["date"])
        frame["close"] = pd.to_numeric(frame["close"], errors="coerce")
        frame = frame.dropna(subset=["date", "close"]).sort_values("date").reset_index(drop=True)
        if frame.empty:
            continue

        frame["weekly_return"] = frame["close"].pct_change()
        frame["momentum_4w"] = frame["close"] / frame["close"].shift(4) - 1
        frame["momentum_12w"] = frame["close"] / frame["close"].shift(12) - 1
        frame["volatility_12w"] = frame["weekly_return"].rolling(12).std()
        high_52w = frame["close"].rolling(52, min_periods=1).max()
        frame["drawdown_from_52w_high"] = 1 - frame["close"] / high_52w
        frame["sma_10"] = ta.sma(frame["close"], length=10)
        frame["sma_20"] = ta.sma(frame["close"], length=20)
        frame["rsi_14"] = ta.rsi(frame["close"], length=14)
        macd = ta.macd(frame["close"])
        if macd is not None and not macd.empty:
            frame["macd"] = macd.iloc[:, 0]
            frame["macd_signal"] = macd.iloc[:, 2] if macd.shape[1] > 2 else None
            frame["macd_histogram"] = macd.iloc[:, 1] if macd.shape[1] > 1 else None

        frames.append(frame)

    if not frames:
        raise RuntimeError(f"No portfolio symbols were found in {data_path}")

    output = pd.concat(frames, ignore_index=True)
    output["date"] = output["date"].dt.strftime("%Y-%m-%d")
    columns = [
        "ticker",
        "date",
        "close",
        "weekly_return",
        "momentum_4w",
        "momentum_12w",
        "volatility_12w",
        "drawdown_from_52w_high",
        "sma_10",
        "sma_20",
        "rsi_14",
        "macd",
        "macd_signal",
        "macd_histogram",
    ]
    return output[[column for column in columns if column in output.columns]].round(8)


def write_markdown_report(latest: Any, row_count: int, factor_report_path: Path, factor_latest_path: Path) -> None:
    generated_at = datetime.now(timezone.utc).isoformat()
    display = latest[
        [
            "ticker",
            "date",
            "close",
            "weekly_return",
            "momentum_4w",
            "momentum_12w",
            "volatility_12w",
            "drawdown_from_52w_high",
            "rsi_14",
            "macd",
        ]
    ].copy()

    body = [
        "# Phase 5A Factor Report",
        "",
        f"Generated at: `{generated_at}`",
        "",
        "This report is research-only. It does not affect live dashboard recommendations, buy amounts, signal scores, multipliers, risk levels, action thresholds, the default Python strategy, or the market regime formula.",
        "",
        "## Scope",
        "",
        "- Symbols: BYDDY, MSFT, NVDA, AAPL, ASML, KO",
        "- Source: `data/backtest-prices.json` weekly close snapshot",
        "- Excludes QQQ/SPY because Phase 5A is focused on current portfolio symbols, not market-regime proxies.",
        "- ATR is skipped because the current snapshot stores weekly close only, without high/low data.",
        "",
        "## Outputs",
        "",
        f"- `{factor_report_path.relative_to(ROOT).as_posix()}`: full weekly factor table",
        f"- `{factor_latest_path.relative_to(ROOT).as_posix()}`: latest factor row per symbol",
        f"- Rows written: `{row_count}`",
        "",
        "## Latest Factors",
        "",
        display.to_markdown(index=False),
        "",
        "## Interpretation Notes",
        "",
        "- These factors are candidate research inputs only.",
        "- No factor should be used in live logic until it passes out-of-sample validation.",
        "- The portfolio universe is small, so any apparent factor relationship is preliminary.",
        "- Later phases should validate predictive value with walk-forward tests and factor-specific performance diagnostics.",
        "",
        "## Planned Follow-Ups",
        "",
        "- Phase 5B: stabilize the research Backtrader comparison workflow.",
        "- Phase 5C: add QuantStats performance reports for sandbox backtests.",
        "- Later Phase 5: add Alphalens factor validation and scikit-learn ML sandbox experiments.",
        "- Phase 6: evaluate PyPortfolioOpt for portfolio construction; it is intentionally not implemented in Phase 5A.",
        "",
    ]
    REPORT_PATH.write_text("\n".join(body), encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
