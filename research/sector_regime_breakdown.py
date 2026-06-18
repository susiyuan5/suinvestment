from __future__ import annotations

import sys
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from research.universe import load_research_universe


ROOT = Path(__file__).resolve().parents[1]
FACTOR_PATH = ROOT / "results" / "phase6" / "research_factor_report.csv"
VALIDATION_SUMMARY_PATH = ROOT / "results" / "phase6" / "research_factor_validation_summary.csv"
RESEARCH_PRICES_PATH = ROOT / "data" / "research-prices.json"
OUT_DIR = ROOT / "results" / "phase6"
IC_PATH = OUT_DIR / "sector_regime_factor_ic.csv"
SECTOR_SUMMARY_PATH = OUT_DIR / "sector_factor_summary.csv"
REGIME_SUMMARY_PATH = OUT_DIR / "regime_factor_summary.csv"
REPORT_PATH = ROOT / "SECTOR_REGIME_BREAKDOWN_REPORT.md"
HORIZONS = (1, 4, 12)
FACTORS = (
    "volatility_12w",
    "sma_20_distance",
    "sma_10_distance",
    "momentum_12w",
    "weekly_return",
    "macd",
    "drawdown_from_52w_high",
    "rsi_14",
)
REFERENCE_SYMBOLS = {"QQQ", "SPY", "DIA", "IWM"}


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

    universe = load_research_universe()
    frame = load_factor_frame(pd, universe)
    regime_frame = build_research_regime_frame(pd)
    frame = attach_research_regime(pd, frame, regime_frame)
    validation_summary = load_validation_summary(pd)

    ic_rows = []
    ic_rows.extend(calculate_breakdown_ic(frame, scipy_stats, "category", "category", min_group_size=3))
    ic_rows.extend(calculate_breakdown_ic(frame, scipy_stats, "regime", "research_regime", min_group_size=8))

    ic_frame = pd.DataFrame(ic_rows)
    sector_summary = summarize_breakdown(pd, ic_frame, "category", validation_summary)
    regime_summary = summarize_breakdown(pd, ic_frame, "regime", validation_summary)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ic_frame.to_csv(IC_PATH, index=False)
    sector_summary.to_csv(SECTOR_SUMMARY_PATH, index=False)
    regime_summary.to_csv(REGIME_SUMMARY_PATH, index=False)
    write_report(pd, sector_summary, regime_summary, regime_frame)

    print(f"Wrote {IC_PATH}")
    print(f"Wrote {SECTOR_SUMMARY_PATH}")
    print(f"Wrote {REGIME_SUMMARY_PATH}")
    print(f"Wrote {REPORT_PATH}")
    return 0


def load_dependencies() -> tuple[Any, Any]:
    try:
        import pandas as pd
    except ImportError as error:
        raise ImportError("pandas is required for sector/regime breakdown") from error
    try:
        from scipy import stats as scipy_stats
    except ImportError as error:
        raise ImportError("scipy is required for sector/regime breakdown") from error
    return pd, scipy_stats


def load_factor_frame(pd: Any, universe: Any) -> Any:
    frame = pd.read_csv(FACTOR_PATH)
    frame = frame[frame["ticker"].isin(universe.research_universe_symbols)].copy()
    overlap = sorted(REFERENCE_SYMBOLS & set(frame["ticker"].unique()))
    if overlap:
        raise RuntimeError(f"Reference symbols should not appear in research factor table: {', '.join(overlap)}")
    frame["date"] = pd.to_datetime(frame["date"])
    frame["category"] = frame["ticker"].map(universe.category_by_symbol)
    if frame["category"].isna().any():
        missing = sorted(frame.loc[frame["category"].isna(), "ticker"].unique())
        raise RuntimeError(f"Missing category metadata for symbols: {', '.join(missing)}")
    for horizon in HORIZONS:
        frame[f"forward_{horizon}w_return"] = frame.groupby("ticker")["close"].shift(-horizon) / frame["close"] - 1
    return frame.sort_values(["ticker", "date"]).reset_index(drop=True)


def build_research_regime_frame(pd: Any) -> Any:
    payload = json.loads(RESEARCH_PRICES_PATH.read_text(encoding="utf-8"))
    qqq_payload = payload.get("symbols", {}).get("QQQ", {})
    rows = qqq_payload.get("rows", [])
    if not rows:
        raise RuntimeError("QQQ rows are required for research-only regime breakdown")
    frame = pd.DataFrame(rows)
    frame["date"] = pd.to_datetime(frame["date"])
    frame = frame.sort_values("date").reset_index(drop=True)
    frame["sma_20"] = frame["close"].rolling(20, min_periods=20).mean()
    high_52w = frame["close"].rolling(52, min_periods=20).max()
    frame["drawdown_52w"] = 1 - frame["close"] / high_52w
    frame["research_regime"] = frame.apply(classify_research_regime, axis=1)
    return frame[["date", "close", "sma_20", "drawdown_52w", "research_regime"]]


def classify_research_regime(row: Any) -> str:
    close = row["close"]
    sma_20 = row["sma_20"]
    drawdown = row["drawdown_52w"]
    if not _is_number(sma_20) or not _is_number(drawdown):
        return "Neutral"
    if drawdown >= 0.25 or close < sma_20 * 0.90:
        return "Bear"
    if drawdown >= 0.10 or close < sma_20:
        return "Correction"
    if close >= sma_20 and drawdown <= 0.10:
        return "Bull"
    return "Neutral"


def attach_research_regime(pd: Any, frame: Any, regime_frame: Any) -> Any:
    sorted_frame = frame.sort_values("date")
    sorted_regime = regime_frame.sort_values("date")
    merged = pd.merge_asof(sorted_frame, sorted_regime[["date", "research_regime"]], on="date", direction="backward")
    merged["research_regime"] = merged["research_regime"].fillna("Neutral")
    return merged.sort_values(["ticker", "date"]).reset_index(drop=True)


def load_validation_summary(pd: Any) -> Any:
    summary = pd.read_csv(VALIDATION_SUMMARY_PATH)
    return summary[["factor", "horizon", "mean_rank_ic"]].copy()


def calculate_breakdown_ic(frame: Any, scipy_stats: Any, breakdown_type: str, column: str, min_group_size: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for factor in FACTORS:
        if factor not in frame.columns:
            continue
        for horizon in HORIZONS:
            target = f"forward_{horizon}w_return"
            for (date_value, group_value), group in frame.groupby(["date", column]):
                total_rows = len(group)
                clean = group[["ticker", factor, target]].dropna()
                if len(clean) < min_group_size or clean[factor].nunique() < 2 or clean[target].nunique() < 2:
                    continue
                rank_ic = scipy_stats.spearmanr(clean[factor], clean[target]).correlation
                pearson = scipy_stats.pearsonr(clean[factor], clean[target])[0]
                rows.append(
                    {
                        "date": date_value.date().isoformat(),
                        "breakdown_type": breakdown_type,
                        "group": group_value,
                        "factor": factor,
                        "horizon": f"{horizon}w",
                        "n": int(len(clean)),
                        "total_rows": int(total_rows),
                        "coverage": round(float(len(clean) / total_rows), 8) if total_rows else 0.0,
                        "rank_ic": round(float(rank_ic), 8),
                        "pearson_corr": round(float(pearson), 8),
                    }
                )
    return rows


def summarize_breakdown(pd: Any, ic_frame: Any, breakdown_type: str, validation_summary: Any) -> Any:
    selected = ic_frame[ic_frame["breakdown_type"] == breakdown_type].copy()
    if selected.empty:
        return pd.DataFrame()
    grouped = (
        selected.groupby(["group", "factor", "horizon"], as_index=False)
        .agg(
            ic_periods=("rank_ic", "size"),
            sample_count=("n", "sum"),
            average_group_n=("n", "mean"),
            mean_coverage=("coverage", "mean"),
            mean_rank_ic=("rank_ic", "mean"),
            median_rank_ic=("rank_ic", "median"),
            positive_rank_ic_rate=("rank_ic", lambda values: float((values > 0).mean())),
            mean_pearson_corr=("pearson_corr", "mean"),
        )
    )
    grouped = grouped.merge(validation_summary, on=["factor", "horizon"], how="left", suffixes=("", "_overall"))
    grouped.rename(columns={"mean_rank_ic_overall": "overall_mean_rank_ic"}, inplace=True)
    grouped["direction_vs_overall"] = grouped.apply(direction_vs_overall, axis=1)
    numeric_columns = [
        "average_group_n",
        "mean_coverage",
        "mean_rank_ic",
        "median_rank_ic",
        "positive_rank_ic_rate",
        "mean_pearson_corr",
        "overall_mean_rank_ic",
    ]
    for column in numeric_columns:
        grouped[column] = grouped[column].round(8)
    return grouped.sort_values(["factor", "horizon", "mean_rank_ic"], ascending=[True, True, False])


def direction_vs_overall(row: Any) -> str:
    group_ic = row.get("mean_rank_ic")
    overall_ic = row.get("overall_mean_rank_ic")
    if not _is_number(group_ic) or not _is_number(overall_ic) or overall_ic == 0 or group_ic == 0:
        return "flat_or_missing"
    if (group_ic > 0 and overall_ic > 0) or (group_ic < 0 and overall_ic < 0):
        if abs(group_ic) < abs(overall_ic):
            return "same_direction_weaker"
        return "same_direction_stronger"
    return "reversed"


def write_report(pd: Any, sector_summary: Any, regime_summary: Any, regime_frame: Any) -> None:
    generated_at = datetime.now(timezone.utc).isoformat()
    sector_positive = top_rows(sector_summary, ascending=False)
    sector_negative = top_rows(sector_summary, ascending=True)
    regime_positive = top_rows(regime_summary, ascending=False)
    regime_negative = top_rows(regime_summary, ascending=True)
    regime_counts = regime_frame["research_regime"].value_counts().to_dict()

    lines = [
        "# Sector and Market-Regime Breakdown Report",
        "",
        f"Generated at: `{generated_at}`",
        "",
        "This report is research-only. It does not affect live dashboard recommendations, buy amounts, signal scores, multipliers, risk levels, action thresholds, the default Python strategy, or the market regime formula.",
        "",
        "## Method",
        "",
        "- Uses `results/phase6/research_factor_report.csv` for the 38-symbol research universe.",
        "- Uses category metadata in `data/research-universe.json`.",
        "- Excludes reference symbols QQQ/SPY/DIA/IWM from trade-factor IC calculations.",
        "- Reconstructs a simple QQQ-based research-only regime from `data/research-prices.json`.",
        "- The research-only regime is for diagnostics and does not change the live market regime formula.",
        "",
        "## Outputs",
        "",
        "- `results/phase6/sector_regime_factor_ic.csv`",
        "- `results/phase6/sector_factor_summary.csv`",
        "- `results/phase6/regime_factor_summary.csv`",
        "",
        "## Research Regime Mix",
        "",
    ]
    for regime, count in sorted(regime_counts.items()):
        lines.append(f"- `{regime}`: `{count}` QQQ weekly observations")

    lines.extend(["", "## Strongest Sector/Category Results", "", summary_table(sector_positive)])
    lines.extend(["", "## Weakest or Reversed Sector/Category Results", "", summary_table(sector_negative)])
    lines.extend(["", "## Strongest Regime Results", "", summary_table(regime_positive)])
    lines.extend(["", "## Weakest or Reversed Regime Results", "", summary_table(regime_negative)])

    lines.extend(
        [
            "",
            "## Concentration Notes",
            "",
            f"- volatility_12w 12w: {factor_concentration_note(sector_summary, 'volatility_12w', '12w', 'category')}",
            f"- momentum_12w 12w: {factor_concentration_note(sector_summary, 'momentum_12w', '12w', 'category')}",
            f"- sma_20_distance 12w: {factor_concentration_note(sector_summary, 'sma_20_distance', '12w', 'category')}",
            f"- volatility_12w by regime: {factor_concentration_note(regime_summary, 'volatility_12w', '12w', 'regime')}",
            "",
            "## Interpretation Notes",
            "",
            "- Sector/category results may be noisy because some groups are small.",
            "- Regime results may be noisy if one regime dominates the sample.",
            "- A factor should not be promoted unless it is stable across sectors, regimes, out-of-sample windows, and transaction-cost assumptions.",
            "- This phase does not add research symbols to the dashboard or Manual Trade Plan.",
            "- PyPortfolioOpt remains deferred.",
            "",
        ]
    )
    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")


def top_rows(summary: Any, ascending: bool) -> Any:
    if summary.empty:
        return summary
    return summary.sort_values("mean_rank_ic", ascending=ascending).head(8)


def summary_table(rows: Any) -> str:
    if rows.empty:
        return "- No rows generated."
    lines = [
        "| group | factor | horizon | mean_rank_ic | periods | direction_vs_overall |",
        "|:--|:--|:--|--:|--:|:--|",
    ]
    for _, row in rows.iterrows():
        lines.append(
            f"| {row['group']} | {row['factor']} | {row['horizon']} | {row['mean_rank_ic']:.4f} | "
            f"{int(row['ic_periods'])} | {row['direction_vs_overall']} |"
        )
    return "\n".join(lines)


def factor_concentration_note(summary: Any, factor: str, horizon: str, label: str) -> str:
    selected = summary[(summary["factor"] == factor) & (summary["horizon"] == horizon)].copy()
    if selected.empty:
        return f"no {label} rows generated"
    positive = selected[selected["mean_rank_ic"] > 0]
    reversed_rows = selected[selected["direction_vs_overall"] == "reversed"]
    strongest = selected.sort_values("mean_rank_ic", ascending=False).iloc[0]
    weakest = selected.sort_values("mean_rank_ic", ascending=True).iloc[0]
    return (
        f"{len(positive)}/{len(selected)} {label} groups are positive; strongest is "
        f"{strongest['group']} ({strongest['mean_rank_ic']:.4f}), weakest is "
        f"{weakest['group']} ({weakest['mean_rank_ic']:.4f}), reversed groups: {len(reversed_rows)}"
    )


def _is_number(value: Any) -> bool:
    try:
        return value == value and value is not None
    except TypeError:
        return False


if __name__ == "__main__":
    raise SystemExit(main())
