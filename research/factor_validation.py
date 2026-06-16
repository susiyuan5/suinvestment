from __future__ import annotations

import csv
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FACTOR_PATH = ROOT / "results" / "phase5" / "factor_report.csv"
OUT_DIR = ROOT / "results" / "phase5"
IC_PATH = OUT_DIR / "factor_validation_ic.csv"
QUANTILE_PATH = OUT_DIR / "factor_validation_quantiles.csv"
SUMMARY_PATH = OUT_DIR / "factor_validation_summary.csv"
REPORT_PATH = ROOT / "FACTOR_VALIDATION_REPORT.md"
PORTFOLIO_SYMBOLS = ("BYDDY", "MSFT", "NVDA", "AAPL", "ASML", "KO")
HORIZONS = (1, 4, 12)
BASE_FACTORS = (
    "weekly_return",
    "momentum_4w",
    "momentum_12w",
    "volatility_12w",
    "drawdown_from_52w_high",
    "sma_10_distance",
    "sma_20_distance",
    "rsi_14",
    "macd",
)


def main() -> int:
    try:
        pd, scipy_stats = load_dependencies()
    except ImportError as error:
        print(
            "Missing optional research dependency. Install the research stack with:\n"
            "  python -m pip install -r requirements-research.txt\n\n"
            f"Import error: {error}",
            file=sys.stderr,
        )
        return 2

    frame = load_factor_table(pd, FACTOR_PATH)
    ic_rows = calculate_ic_rows(frame, scipy_stats)
    quantile_rows = calculate_quantile_rows(frame, pd)
    summary_rows = calculate_summary_rows(frame, ic_rows, quantile_rows, pd)

    write_csv(IC_PATH, ic_rows)
    write_csv(QUANTILE_PATH, quantile_rows)
    write_csv(SUMMARY_PATH, summary_rows)
    write_report(summary_rows, ic_rows, quantile_rows)

    print(f"Wrote {IC_PATH}")
    print(f"Wrote {QUANTILE_PATH}")
    print(f"Wrote {SUMMARY_PATH}")
    print(f"Wrote {REPORT_PATH}")
    return 0


def load_dependencies() -> tuple[Any, Any]:
    try:
        import pandas as pd
    except ImportError as error:
        raise ImportError("pandas is required for research/factor_validation.py") from error
    try:
        from scipy import stats as scipy_stats
    except ImportError as error:
        raise ImportError("scipy is required for research/factor_validation.py") from error
    return pd, scipy_stats


def load_factor_table(pd: Any, path: Path) -> Any:
    frame = pd.read_csv(path)
    frame = frame[frame["ticker"].isin(PORTFOLIO_SYMBOLS)].copy()
    frame["date"] = pd.to_datetime(frame["date"])
    frame = frame.sort_values(["ticker", "date"]).reset_index(drop=True)
    frame["sma_10_distance"] = frame["close"] / frame["sma_10"] - 1
    frame["sma_20_distance"] = frame["close"] / frame["sma_20"] - 1
    for horizon in HORIZONS:
        frame[f"forward_{horizon}w_return"] = frame.groupby("ticker")["close"].shift(-horizon) / frame["close"] - 1
    return frame


def calculate_ic_rows(frame: Any, scipy_stats: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for factor in BASE_FACTORS:
        if factor not in frame.columns:
            continue
        for horizon in HORIZONS:
            target = f"forward_{horizon}w_return"
            for date_value, group in frame.groupby("date"):
                clean = group[["ticker", factor, target]].dropna()
                if len(clean) < 3 or clean[factor].nunique() < 2 or clean[target].nunique() < 2:
                    continue
                rank_ic = scipy_stats.spearmanr(clean[factor], clean[target]).correlation
                pearson = scipy_stats.pearsonr(clean[factor], clean[target])[0]
                rows.append(
                    {
                        "date": date_value.date().isoformat(),
                        "factor": factor,
                        "horizon": f"{horizon}w",
                        "n": len(clean),
                        "rank_ic": round(float(rank_ic), 8),
                        "pearson_corr": round(float(pearson), 8),
                    }
                )
    return rows


def calculate_quantile_rows(frame: Any, pd: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for factor in BASE_FACTORS:
        if factor not in frame.columns:
            continue
        for horizon in HORIZONS:
            target = f"forward_{horizon}w_return"
            for date_value, group in frame.groupby("date"):
                clean = group[["ticker", factor, target]].dropna().copy()
                if len(clean) < 6 or clean[factor].nunique() < 3:
                    continue
                try:
                    clean["tercile"] = pd.qcut(clean[factor].rank(method="first"), 3, labels=("low", "middle", "high"))
                except ValueError:
                    continue
                grouped = clean.groupby("tercile", observed=False)[target].mean()
                low = grouped.get("low")
                middle = grouped.get("middle")
                high = grouped.get("high")
                if pd.isna(low) or pd.isna(high):
                    continue
                rows.append(
                    {
                        "date": date_value.date().isoformat(),
                        "factor": factor,
                        "horizon": f"{horizon}w",
                        "low_return": round(float(low), 8),
                        "middle_return": round(float(middle), 8) if not pd.isna(middle) else "",
                        "high_return": round(float(high), 8),
                        "long_short_spread": round(float(high - low), 8),
                    }
                )
    return rows


def calculate_summary_rows(frame: Any, ic_rows: list[dict[str, Any]], quantile_rows: list[dict[str, Any]], pd: Any) -> list[dict[str, Any]]:
    ic_frame = pd.DataFrame(ic_rows)
    quant_frame = pd.DataFrame(quantile_rows)
    rows: list[dict[str, Any]] = []
    for factor in BASE_FACTORS:
        if factor not in frame.columns:
            continue
        factor_non_null = frame[factor].notna().sum()
        coverage = factor_non_null / len(frame) if len(frame) else 0.0
        for horizon in HORIZONS:
            horizon_label = f"{horizon}w"
            selected_ic = ic_frame[(ic_frame["factor"] == factor) & (ic_frame["horizon"] == horizon_label)] if not ic_frame.empty else pd.DataFrame()
            selected_quant = quant_frame[(quant_frame["factor"] == factor) & (quant_frame["horizon"] == horizon_label)] if not quant_frame.empty else pd.DataFrame()
            symbol_corrs = per_symbol_correlations(frame, factor, f"forward_{horizon}w_return")
            rows.append(
                {
                    "factor": factor,
                    "horizon": horizon_label,
                    "coverage": round(float(coverage), 8),
                    "observations": int(factor_non_null),
                    "ic_periods": int(len(selected_ic)),
                    "mean_rank_ic": round(float(selected_ic["rank_ic"].mean()), 8) if not selected_ic.empty else "",
                    "median_rank_ic": round(float(selected_ic["rank_ic"].median()), 8) if not selected_ic.empty else "",
                    "positive_rank_ic_rate": round(float((selected_ic["rank_ic"] > 0).mean()), 8) if not selected_ic.empty else "",
                    "mean_pearson_corr": round(float(selected_ic["pearson_corr"].mean()), 8) if not selected_ic.empty else "",
                    "mean_long_short_spread": round(float(selected_quant["long_short_spread"].mean()), 8) if not selected_quant.empty else "",
                    "positive_symbol_corr_count": sum(1 for value in symbol_corrs.values() if value > 0),
                    "negative_symbol_corr_count": sum(1 for value in symbol_corrs.values() if value < 0),
                    "symbol_corrs": "; ".join(f"{symbol}:{value:.4f}" for symbol, value in symbol_corrs.items()),
                }
            )
    return rows


def per_symbol_correlations(frame: Any, factor: str, target: str) -> dict[str, float]:
    correlations: dict[str, float] = {}
    for ticker, group in frame.groupby("ticker"):
        clean = group[[factor, target]].dropna()
        if len(clean) < 12 or clean[factor].nunique() < 2 or clean[target].nunique() < 2:
            continue
        correlations[str(ticker)] = float(clean[factor].corr(clean[target], method="spearman"))
    return correlations


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def write_report(summary_rows: list[dict[str, Any]], ic_rows: list[dict[str, Any]], quantile_rows: list[dict[str, Any]]) -> None:
    generated_at = datetime.now(timezone.utc).isoformat()
    usable = [row for row in summary_rows if row["mean_rank_ic"] != ""]
    positive = sorted(usable, key=lambda row: float(row["mean_rank_ic"]), reverse=True)[:5]
    negative = sorted(usable, key=lambda row: float(row["mean_rank_ic"]))[:5]
    coverage_issues = [row for row in summary_rows if float(row["coverage"]) < 0.90]

    lines = [
        "# Phase 5D Factor Validation Report",
        "",
        f"Generated at: `{generated_at}`",
        "",
        "This report is research-only. It does not affect live dashboard recommendations, buy amounts, signal scores, multipliers, risk levels, action thresholds, the default Python strategy, or the market regime formula.",
        "",
        "## Method",
        "",
        "- Uses the Phase 5A factor table for BYDDY, MSFT, NVDA, AAPL, ASML, and KO only.",
        "- QQQ/SPY remain market-regime/reference data and are excluded.",
        "- Uses an Alphalens-style manual validation with pandas and scipy instead of direct Alphalens integration because the universe is only six weekly symbols and the current data shape is simpler than Alphalens' preferred factor/pricing pipeline.",
        "- Calculates forward 1w, 4w, and 12w returns.",
        "- Computes cross-sectional rank IC, Pearson correlation, tercile returns, long-short spread, and per-symbol robustness diagnostics.",
        "",
        "## Outputs",
        "",
        "- `results/phase5/factor_validation_ic.csv`",
        "- `results/phase5/factor_validation_quantiles.csv`",
        "- `results/phase5/factor_validation_summary.csv`",
        "",
        "## Most Positive Mean Rank IC",
        "",
        "| factor | horizon | mean_rank_ic | positive_rate | mean_spread |",
        "|:--|:--|--:|--:|--:|",
    ]
    for row in positive:
        lines.append(
            f"| {row['factor']} | {row['horizon']} | {float(row['mean_rank_ic']):.4f} | "
            f"{float(row['positive_rank_ic_rate']):.4f} | {_fmt(row['mean_long_short_spread'])} |"
        )

    lines.extend(["", "## Most Negative Mean Rank IC", "", "| factor | horizon | mean_rank_ic | positive_rate | mean_spread |", "|:--|:--|--:|--:|--:|"])
    for row in negative:
        lines.append(
            f"| {row['factor']} | {row['horizon']} | {float(row['mean_rank_ic']):.4f} | "
            f"{float(row['positive_rank_ic_rate']):.4f} | {_fmt(row['mean_long_short_spread'])} |"
        )

    lines.extend(
        [
            "",
            "## Coverage Issues",
            "",
        ]
    )
    if coverage_issues:
        for row in coverage_issues[:12]:
            lines.append(f"- `{row['factor']}` `{row['horizon']}` coverage `{float(row['coverage']):.2%}`")
    else:
        lines.append("- No factor coverage below 90%.")

    lines.extend(
        [
            "",
            "## Interpretation Notes",
            "",
            "- The stock universe is very small, so IC and quantile results are preliminary.",
            "- Factor validation is not enough to promote a strategy.",
            "- Any promising factor requires walk-forward and out-of-sample validation before live use.",
            "- Rank IC can be unstable with only six symbols per week.",
            f"- IC rows written: `{len(ic_rows)}`",
            f"- Quantile rows written: `{len(quantile_rows)}`",
            "",
        ]
    )
    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")


def _fmt(value: Any) -> str:
    if value == "":
        return ""
    return f"{float(value):.4f}"


if __name__ == "__main__":
    raise SystemExit(main())
