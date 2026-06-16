from __future__ import annotations

import argparse
import csv
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from research.universe import load_research_universe


ROOT = Path(__file__).resolve().parents[1]
PHASE5_FACTOR_PATH = ROOT / "results" / "phase5" / "factor_report.csv"
PHASE6_FACTOR_PATH = ROOT / "results" / "phase6" / "research_factor_report.csv"
PHASE5_OUT_DIR = ROOT / "results" / "phase5"
PHASE6_OUT_DIR = ROOT / "results" / "phase6"
LIVE_REPORT_PATH = ROOT / "FACTOR_VALIDATION_REPORT.md"
RESEARCH_REPORT_PATH = ROOT / "RESEARCH_FACTOR_VALIDATION_REPORT.md"
PORTFOLIO_SYMBOLS = ("BYDDY", "MSFT", "NVDA", "AAPL", "ASML", "KO")
REFERENCE_SYMBOLS = ("QQQ", "SPY", "DIA", "IWM")
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


@dataclass(frozen=True)
class ValidationConfig:
    universe: str
    factor_path: Path
    symbols: tuple[str, ...]
    out_dir: Path
    ic_path: Path
    quantile_path: Path
    summary_path: Path
    report_path: Path
    report_title: str
    method_scope: str
    universe_note: str
    comparison_note: str


def main() -> int:
    args = parse_args()
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

    config = build_config(args.universe)
    frame = load_factor_table(pd, config)
    ic_rows = calculate_ic_rows(frame, scipy_stats)
    quantile_rows = calculate_quantile_rows(frame, pd, config)
    summary_rows = calculate_summary_rows(frame, ic_rows, quantile_rows, pd)
    comparison_rows = calculate_phase_comparison(pd, summary_rows, config)

    config.out_dir.mkdir(parents=True, exist_ok=True)
    write_csv(config.ic_path, ic_rows)
    write_csv(config.quantile_path, quantile_rows)
    write_csv(config.summary_path, summary_rows)
    write_report(summary_rows, ic_rows, quantile_rows, comparison_rows, config)

    print(f"Wrote {config.ic_path}")
    print(f"Wrote {config.quantile_path}")
    print(f"Wrote {config.summary_path}")
    print(f"Wrote {config.report_path}")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Alphalens-style factor validation.")
    parser.add_argument(
        "--universe",
        choices=("live", "research"),
        default="live",
        help="live preserves Phase 5D outputs; research validates the Phase 6 research-universe factor table.",
    )
    return parser.parse_args()


def build_config(universe: str) -> ValidationConfig:
    if universe == "live":
        return ValidationConfig(
            universe="live",
            factor_path=PHASE5_FACTOR_PATH,
            symbols=PORTFOLIO_SYMBOLS,
            out_dir=PHASE5_OUT_DIR,
            ic_path=PHASE5_OUT_DIR / "factor_validation_ic.csv",
            quantile_path=PHASE5_OUT_DIR / "factor_validation_quantiles.csv",
            summary_path=PHASE5_OUT_DIR / "factor_validation_summary.csv",
            report_path=LIVE_REPORT_PATH,
            report_title="Phase 5D Factor Validation Report",
            method_scope="Uses the Phase 5A factor table for BYDDY, MSFT, NVDA, AAPL, ASML, and KO only.",
            universe_note="The stock universe is very small, so IC and quantile results are preliminary.",
            comparison_note="This is the baseline six-symbol validation path.",
        )

    research_universe = load_research_universe()
    return ValidationConfig(
        universe="research",
        factor_path=PHASE6_FACTOR_PATH,
        symbols=research_universe.research_universe_symbols,
        out_dir=PHASE6_OUT_DIR,
        ic_path=PHASE6_OUT_DIR / "research_factor_validation_ic.csv",
        quantile_path=PHASE6_OUT_DIR / "research_factor_validation_quantiles.csv",
        summary_path=PHASE6_OUT_DIR / "research_factor_validation_summary.csv",
        report_path=RESEARCH_REPORT_PATH,
        report_title="Phase 6D Research Universe Factor Validation Report",
        method_scope="Uses the Phase 6C research-universe factor table for 38 research symbols.",
        universe_note="The 38-symbol research universe is broader than Phase 5, but still not a professional-scale universe.",
        comparison_note="Compares research-universe mean rank IC against the existing Phase 5 six-symbol validation summary where available.",
    )


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


def load_factor_table(pd: Any, config: ValidationConfig) -> Any:
    frame = pd.read_csv(config.factor_path)
    if len(config.symbols) != len(set(config.symbols)):
        raise RuntimeError("Duplicate symbols detected in validation configuration")
    frame = frame[frame["ticker"].isin(config.symbols)].copy()
    missing = sorted(set(config.symbols) - set(frame["ticker"].unique()))
    if missing:
        raise RuntimeError(f"Missing symbols from factor validation input: {', '.join(missing)}")
    if config.universe == "research":
        overlap = sorted(set(REFERENCE_SYMBOLS) & set(frame["ticker"].unique()))
        if overlap:
            raise RuntimeError(f"Reference symbols should be excluded from research validation: {', '.join(overlap)}")
    frame["date"] = pd.to_datetime(frame["date"])
    frame = frame.sort_values(["ticker", "date"]).reset_index(drop=True)
    if "sma_10_distance" not in frame.columns and "sma_10" in frame.columns:
        frame["sma_10_distance"] = frame["close"] / frame["sma_10"] - 1
    if "sma_20_distance" not in frame.columns and "sma_20" in frame.columns:
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


def calculate_quantile_rows(frame: Any, pd: Any, config: ValidationConfig) -> list[dict[str, Any]]:
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
                bucket_count = 5 if len(clean) >= 15 and clean[factor].nunique() >= 5 else 3
                labels = ("q1", "q2", "q3", "q4", "q5") if bucket_count == 5 else ("low", "middle", "high")
                try:
                    clean["bucket"] = pd.qcut(clean[factor].rank(method="first"), bucket_count, labels=labels)
                except ValueError:
                    continue
                grouped = clean.groupby("bucket", observed=False)[target].mean()
                low_label = labels[0]
                high_label = labels[-1]
                low = grouped.get(low_label)
                middle = grouped.get("middle") if bucket_count == 3 else grouped.get("q3")
                high = grouped.get(high_label)
                if pd.isna(low) or pd.isna(high):
                    continue
                row = {
                    "date": date_value.date().isoformat(),
                    "factor": factor,
                    "horizon": f"{horizon}w",
                    "low_return": round(float(low), 8),
                    "middle_return": round(float(middle), 8) if not pd.isna(middle) else "",
                    "high_return": round(float(high), 8),
                    "long_short_spread": round(float(high - low), 8),
                }
                if config.universe == "research":
                    row["bucket_count"] = bucket_count
                rows.append(row)
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


def calculate_phase_comparison(pd: Any, summary_rows: list[dict[str, Any]], config: ValidationConfig) -> list[dict[str, Any]]:
    if config.universe != "research" or not (PHASE5_OUT_DIR / "factor_validation_summary.csv").exists():
        return []
    phase5 = pd.read_csv(PHASE5_OUT_DIR / "factor_validation_summary.csv")
    current = pd.DataFrame(summary_rows)
    if phase5.empty or current.empty:
        return []
    rows: list[dict[str, Any]] = []
    for _, row in current.iterrows():
        factor = row["factor"]
        horizon = row["horizon"]
        if row["mean_rank_ic"] == "":
            continue
        prior = phase5[(phase5["factor"] == factor) & (phase5["horizon"] == horizon)]
        if prior.empty or pd.isna(prior.iloc[0].get("mean_rank_ic")):
            continue
        live_ic = float(prior.iloc[0]["mean_rank_ic"])
        research_ic = float(row["mean_rank_ic"])
        if live_ic == 0 or research_ic == 0:
            direction = "flat_or_zero"
        elif (live_ic > 0 and research_ic > 0) or (live_ic < 0 and research_ic < 0):
            direction = "consistent"
        else:
            direction = "reversed"
        rows.append(
            {
                "factor": factor,
                "horizon": horizon,
                "live_mean_rank_ic": round(live_ic, 8),
                "research_mean_rank_ic": round(research_ic, 8),
                "delta": round(research_ic - live_ic, 8),
                "direction": direction,
            }
        )
    return rows


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def write_report(
    summary_rows: list[dict[str, Any]],
    ic_rows: list[dict[str, Any]],
    quantile_rows: list[dict[str, Any]],
    comparison_rows: list[dict[str, Any]],
    config: ValidationConfig,
) -> None:
    generated_at = datetime.now(timezone.utc).isoformat()
    usable = [row for row in summary_rows if row["mean_rank_ic"] != ""]
    positive = sorted(usable, key=lambda row: float(row["mean_rank_ic"]), reverse=True)[:5]
    negative = sorted(usable, key=lambda row: float(row["mean_rank_ic"]))[:5]
    coverage_issues = [row for row in summary_rows if float(row["coverage"]) < 0.90]
    consistent = [row for row in comparison_rows if row["direction"] == "consistent"]
    reversed_rows = [row for row in comparison_rows if row["direction"] == "reversed"]
    weakened = [
        row
        for row in comparison_rows
        if row["direction"] == "consistent" and abs(float(row["research_mean_rank_ic"])) < abs(float(row["live_mean_rank_ic"]))
    ]

    lines = [
        f"# {config.report_title}",
        "",
        f"Generated at: `{generated_at}`",
        "",
        "This report is research-only. It does not affect live dashboard recommendations, buy amounts, signal scores, multipliers, risk levels, action thresholds, the default Python strategy, or the market regime formula.",
        "",
        "## Method",
        "",
        f"- {config.method_scope}",
        "- QQQ/SPY/DIA/IWM remain market-regime/reference data and are excluded when present.",
        "- Uses an Alphalens-style manual validation with pandas and scipy instead of direct Alphalens integration because the current weekly factor table is compact and does not need Alphalens' full factor/pricing pipeline.",
        "- Calculates forward 1w, 4w, and 12w returns.",
        "- Computes cross-sectional rank IC, Pearson correlation, tercile/quintile returns, long-short spread, and per-symbol robustness diagnostics.",
        "",
        "## Outputs",
        "",
        f"- `{config.ic_path.relative_to(ROOT).as_posix()}`",
        f"- `{config.quantile_path.relative_to(ROOT).as_posix()}`",
        f"- `{config.summary_path.relative_to(ROOT).as_posix()}`",
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

    lines.extend(["", "## Phase 5 Comparison", ""])
    lines.append(f"- {config.comparison_note}")
    if comparison_rows:
        lines.append(f"- Directionally consistent factor/horizon pairs: `{len(consistent)}`")
        lines.append(f"- Weakened but same-direction pairs: `{len(weakened)}`")
        lines.append(f"- Reversed factor/horizon pairs: `{len(reversed_rows)}`")
        lines.extend(["", "| factor | horizon | live_ic | research_ic | direction |", "|:--|:--|--:|--:|:--|"])
        for row in sorted(comparison_rows, key=lambda item: abs(float(item["delta"])), reverse=True)[:12]:
            lines.append(
                f"| {row['factor']} | {row['horizon']} | {float(row['live_mean_rank_ic']):.4f} | "
                f"{float(row['research_mean_rank_ic']):.4f} | {row['direction']} |"
            )
    else:
        lines.append("- No Phase 5 comparison was generated for this mode.")

    lines.extend(
        [
            "",
            "## Interpretation Notes",
            "",
            f"- {config.universe_note}",
            "- Factor validation is not enough to promote a strategy.",
            "- Any promising factor requires walk-forward, out-of-sample, regime-specific, ex-sector, and transaction-cost validation before live use.",
            "- Rank IC can be unstable when symbols share sector exposure or the universe is small.",
            f"- IC rows written: `{len(ic_rows)}`",
            f"- Quantile rows written: `{len(quantile_rows)}`",
            "",
        ]
    )
    config.report_path.write_text("\n".join(lines), encoding="utf-8")


def _fmt(value: Any) -> str:
    if value == "":
        return ""
    return f"{float(value):.4f}"


if __name__ == "__main__":
    raise SystemExit(main())
