from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from research.universe import load_research_universe


ROOT = Path(__file__).resolve().parents[1]
LIVE_DATA_PATH = ROOT / "data" / "backtest-prices.json"
RESEARCH_DATA_PATH = ROOT / "data" / "research-prices.json"
PHASE5_OUT_DIR = ROOT / "results" / "phase5"
PHASE6_OUT_DIR = ROOT / "results" / "phase6"
LIVE_REPORT_PATH = ROOT / "FACTOR_REPORT.md"
RESEARCH_REPORT_PATH = ROOT / "RESEARCH_FACTOR_REPORT.md"
PORTFOLIO_SYMBOLS = ("BYDDY", "MSFT", "NVDA", "AAPL", "ASML", "KO")


@dataclass(frozen=True)
class FactorReportConfig:
    universe: str
    data_path: Path
    symbols: tuple[str, ...]
    out_dir: Path
    factor_report_path: Path
    factor_latest_path: Path
    markdown_path: Path
    title: str
    scope_note: str
    source_note: str
    exclude_reference_note: str
    interpretation_scope_note: str
    planned_followups: tuple[str, ...]


def main() -> int:
    args = parse_args()
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

    config = build_config(args.universe)
    factor_table = build_factor_table(pd, ta, config.data_path, config.symbols, config.universe)
    validate_factor_table(factor_table, config)
    config.out_dir.mkdir(parents=True, exist_ok=True)
    factor_report_path = config.factor_report_path
    factor_latest_path = config.factor_latest_path
    factor_table.to_csv(factor_report_path, index=False)

    latest = factor_table.sort_values("date").groupby("ticker", as_index=False).tail(1)
    latest.to_csv(factor_latest_path, index=False)
    write_markdown_report(latest, len(factor_table), config)

    print(f"Wrote {factor_report_path}")
    print(f"Wrote {factor_latest_path}")
    print(f"Wrote {config.markdown_path}")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate research-only weekly factor reports.")
    parser.add_argument(
        "--universe",
        choices=("live", "research"),
        default="live",
        help="live preserves Phase 5A default outputs; research uses data/research-prices.json.",
    )
    return parser.parse_args()


def build_config(universe: str) -> FactorReportConfig:
    if universe == "live":
        return FactorReportConfig(
            universe="live",
            data_path=LIVE_DATA_PATH,
            symbols=PORTFOLIO_SYMBOLS,
            out_dir=PHASE5_OUT_DIR,
            factor_report_path=PHASE5_OUT_DIR / "factor_report.csv",
            factor_latest_path=PHASE5_OUT_DIR / "factor_latest.csv",
            markdown_path=LIVE_REPORT_PATH,
            title="Phase 5A Factor Report",
            scope_note="Symbols: BYDDY, MSFT, NVDA, AAPL, ASML, KO",
            source_note="Source: `data/backtest-prices.json` weekly close snapshot",
            exclude_reference_note="Excludes QQQ/SPY because Phase 5A is focused on current portfolio symbols, not market-regime proxies.",
            interpretation_scope_note="The portfolio universe is small, so any apparent factor relationship is preliminary.",
            planned_followups=(
                "Phase 5B: stabilize the research Backtrader comparison workflow.",
                "Phase 5C: add QuantStats performance reports for sandbox backtests.",
                "Later Phase 5: add Alphalens factor validation and scikit-learn ML sandbox experiments.",
                "Phase 6: evaluate PyPortfolioOpt for portfolio construction; it is intentionally not implemented in Phase 5A.",
            ),
        )

    research_universe = load_research_universe()
    return FactorReportConfig(
        universe="research",
        data_path=RESEARCH_DATA_PATH,
        symbols=research_universe.research_universe_symbols,
        out_dir=PHASE6_OUT_DIR,
        factor_report_path=PHASE6_OUT_DIR / "research_factor_report.csv",
        factor_latest_path=PHASE6_OUT_DIR / "research_factor_latest.csv",
        markdown_path=RESEARCH_REPORT_PATH,
        title="Phase 6C Research Universe Factor Report",
        scope_note=f"Symbols: {len(research_universe.research_universe_symbols)} research universe symbols",
        source_note="Source: `data/research-prices.json` weekly close snapshot",
        exclude_reference_note="Excludes QQQ/SPY/DIA/IWM reference symbols from the trade-factor table by default.",
        interpretation_scope_note="Any apparent factor relationship is preliminary.",
        planned_followups=(
            "Research-universe factor validation remains a later phase.",
            "PyPortfolioOpt remains deferred.",
        ),
    )


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


def build_factor_table(pd: Any, ta: Any, data_path: Path, symbols: tuple[str, ...], universe: str) -> Any:
    payload = json.loads(data_path.read_text(encoding="utf-8"))
    frames = []
    for ticker in symbols:
        rows = extract_rows(payload, ticker, universe)
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
        frame["sma_10_distance"] = frame["close"] / frame["sma_10"] - 1
        frame["sma_20_distance"] = frame["close"] / frame["sma_20"] - 1
        frame["rsi_14"] = ta.rsi(frame["close"], length=14)
        macd = ta.macd(frame["close"])
        if macd is not None and not macd.empty:
            frame["macd"] = macd.iloc[:, 0]
            frame["macd_signal"] = macd.iloc[:, 2] if macd.shape[1] > 2 else None
            frame["macd_histogram"] = macd.iloc[:, 1] if macd.shape[1] > 1 else None
        if {"high", "low"}.issubset(frame.columns):
            atr = ta.atr(frame["high"], frame["low"], frame["close"], length=14)
            if atr is not None:
                frame["atr_14"] = atr

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
    if universe == "research":
        columns[columns.index("rsi_14"):columns.index("rsi_14")] = ["sma_10_distance", "sma_20_distance"]
        columns.append("atr_14")
    return output[[column for column in columns if column in output.columns]].round(8)


def extract_rows(payload: dict[str, Any], ticker: str, universe: str) -> list[dict[str, Any]]:
    symbol_payload = payload.get("symbols", {}).get(ticker)
    if isinstance(symbol_payload, list):
        return symbol_payload
    if isinstance(symbol_payload, dict):
        return symbol_payload.get("rows", [])
    return []


def validate_factor_table(factor_table: Any, config: FactorReportConfig) -> None:
    if len(config.symbols) != len(set(config.symbols)):
        raise RuntimeError("Duplicate symbols detected in factor report configuration")
    symbols = set(factor_table["ticker"].unique())
    missing = sorted(set(config.symbols) - symbols)
    if missing:
        raise RuntimeError(f"Missing symbols from factor table: {', '.join(missing)}")
    counts = factor_table.groupby("ticker").size()
    short = counts[counts < 50]
    if not short.empty:
        names = ", ".join(f"{symbol}({count})" for symbol, count in short.items())
        raise RuntimeError(f"Symbols with fewer than 50 rows: {names}")
    if config.universe == "research":
        reference_symbols = {"QQQ", "SPY", "DIA", "IWM"}
        overlap = sorted(reference_symbols & symbols)
        if overlap:
            raise RuntimeError(f"Reference symbols should be excluded from research factor table: {', '.join(overlap)}")


def write_markdown_report(latest: Any, row_count: int, config: FactorReportConfig) -> None:
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
        f"# {config.title}",
        "",
        f"Generated at: `{generated_at}`",
        "",
        "This report is research-only. It does not affect live dashboard recommendations, buy amounts, signal scores, multipliers, risk levels, action thresholds, the default Python strategy, or the market regime formula.",
        "",
        "## Scope",
        "",
        f"- {config.scope_note}",
        f"- {config.source_note}",
        f"- {config.exclude_reference_note}",
        "- ATR is skipped because the current snapshot stores weekly close only, without high/low data.",
        "",
        "## Outputs",
        "",
        f"- `{config.factor_report_path.relative_to(ROOT).as_posix()}`: full weekly factor table",
        f"- `{config.factor_latest_path.relative_to(ROOT).as_posix()}`: latest factor row per symbol",
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
        f"- {config.interpretation_scope_note}",
        "- Later phases should validate predictive value with walk-forward tests and factor-specific performance diagnostics.",
        "",
        "## Planned Follow-Ups",
        "",
    ]
    body.extend(f"- {item}" for item in config.planned_followups)
    body.append("")
    config.markdown_path.write_text("\n".join(body), encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
