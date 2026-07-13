"""Phase 6S shadow observation log for monitored research-only symbols.

This script creates monitoring observations for the 12 Phase 6Q/6O symbols.
It does not create trading recommendations, position sizing, orders, or live
dashboard inputs.
"""

from __future__ import annotations

import csv
import hashlib
import json
import math
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from statistics import pstdev


ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "research" / "results"
OUT_DIR = RESULTS / "phase6s"

CANDIDATE_REVIEW = RESULTS / "phase6q" / "shadow-candidate-review-table.csv"
EXECUTIVE_REVIEW = RESULTS / "phase6q" / "phase6q-executive-review.json"
MONITORING_FRAMEWORK = RESULTS / "phase6o" / "monitoring-framework.json"
MONITORING_METRICS = RESULTS / "phase6o" / "promoted-symbol-monitoring-metrics.json"
PRICE_FILE = ROOT / "data" / "research-prices-sector-balanced-80.json"


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def load_candidates() -> list[dict]:
    if not CANDIDATE_REVIEW.exists():
        raise FileNotFoundError(f"Missing required Phase 6Q candidate table: {CANDIDATE_REVIEW}")
    with CANDIDATE_REVIEW.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    if not rows:
        raise ValueError("No monitored symbols found in Phase 6Q candidate table.")
    return rows


def pct(value: float | None) -> float | None:
    if value is None:
        return None
    return round(value, 6)


def weekly_returns(rows: list[dict]) -> list[float]:
    closes = [float(row["close"]) for row in rows if row.get("close") is not None]
    returns: list[float] = []
    for previous, current in zip(closes, closes[1:]):
        if previous:
            returns.append(current / previous - 1)
    return returns


def compute_observation(
    candidate: dict,
    price_entry: dict | None,
    risk_config: dict,
    metric_entry: dict,
    generated_at: str,
    input_hash: str,
    as_of_rank: int,
) -> dict:
    symbol = candidate["symbol"]
    rows = price_entry.get("rows", []) if price_entry else []
    row_count = int(price_entry.get("rowCount", len(rows))) if price_entry else 0
    latest_price_date = price_entry.get("latestDate") if price_entry else None
    price_available = bool(rows and latest_price_date)
    missing_price_warning = not price_available
    returns = weekly_returns(rows)
    recent_return_proxy = returns[-1] if returns else None
    recent_12w_returns = returns[-12:]
    volatility_proxy = pstdev(recent_12w_returns) if len(recent_12w_returns) >= 2 else None

    min_rows = int(risk_config.get("minimum_price_coverage_rows", 260))
    volatility_ceiling = float(risk_config.get("volatility_ceiling_12w", 0.12))
    warnings: list[str] = []
    if row_count < min_rows:
        warnings.append("minimum_price_coverage_rows")
    if missing_price_warning:
        warnings.append("missing_price_fallback")
    if volatility_proxy is not None and volatility_proxy > volatility_ceiling:
        warnings.append("volatility_ceiling")

    ranking_proxy = metric_entry.get("ranking_stability", "pending")
    signal_available = metric_entry.get("signal_contribution", "pending") != "pending"
    risk_gate_status = "pass" if not warnings else "warning"

    if missing_price_warning or row_count < min_rows:
        monitoring_status = "needs_more_data"
    elif warnings:
        monitoring_status = "risk_warning"
    elif ranking_proxy in {"strong", "improving"}:
        monitoring_status = "candidate_improved"
    elif ranking_proxy in {"weak", "degrading"}:
        monitoring_status = "candidate_degraded"
    else:
        monitoring_status = "keep_watching"

    return {
        "symbol": symbol,
        "input_hash": input_hash,
        "code_version": "phase6s-shadow-v2",
        "model_version": "phase6s-candidate-ranking-v1",
        "as_of_rank": as_of_rank,
        "as_of_signal": {
            "factor_usefulness": candidate.get("factor_usefulness", "pending"),
            "regime_usefulness": candidate.get("regime_usefulness", "pending"),
            "activation_readiness": candidate.get("activation_readiness", "shadow_only"),
        },
        "category": candidate.get("sector_category", ""),
        "observation_date": generated_at,
        "latest_price_date": latest_price_date,
        "price_available": price_available,
        "missing_price_warning": missing_price_warning,
        "price_coverage_rows": row_count,
        "recent_return_proxy": pct(recent_return_proxy),
        "volatility_proxy": pct(volatility_proxy),
        "ranking_persistence_proxy": ranking_proxy,
        "signal_available": signal_available,
        "risk_gate_status": risk_gate_status,
        "risk_gate_warnings": warnings,
        "monitoring_status": monitoring_status,
        "monitoring_requirement": candidate.get("monitoring_requirement", ""),
        "rollback_trigger": candidate.get("rollback_trigger", ""),
    }


def write_csv(path: Path, rows: list[dict]) -> None:
    fieldnames = [
        "symbol",
        "input_hash",
        "code_version",
        "model_version",
        "as_of_rank",
        "as_of_signal",
        "category",
        "observation_date",
        "latest_price_date",
        "price_available",
        "missing_price_warning",
        "price_coverage_rows",
        "recent_return_proxy",
        "volatility_proxy",
        "ranking_persistence_proxy",
        "signal_available",
        "risk_gate_status",
        "risk_gate_warnings",
        "monitoring_status",
        "monitoring_requirement",
        "rollback_trigger",
    ]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            csv_row = row.copy()
            csv_row["risk_gate_warnings"] = ";".join(row["risk_gate_warnings"])
            csv_row["as_of_signal"] = json.dumps(row["as_of_signal"], sort_keys=True)
            writer.writerow(csv_row)


def write_summary(path: Path, observations: list[dict], status_counts: Counter, risk_symbols: list[str]) -> None:
    review_symbols = [row["symbol"] for row in observations if row["monitoring_status"] != "keep_watching"]
    lines = [
        "# Phase 6S Shadow Observation Summary",
        "",
        "This is a research-only shadow monitoring log. It is not a trading recommendation and does not affect the live dashboard, Manual Trade Plan, or default research universe.",
        "",
        "## Overall Status",
        "",
        f"- Monitored symbols: `{len(observations)}`",
        f"- keep_watching: `{status_counts.get('keep_watching', 0)}`",
        f"- needs_more_data: `{status_counts.get('needs_more_data', 0)}`",
        f"- risk_warning: `{status_counts.get('risk_warning', 0)}`",
        f"- candidate_degraded: `{status_counts.get('candidate_degraded', 0)}`",
        f"- candidate_improved: `{status_counts.get('candidate_improved', 0)}`",
        "",
        "## Risk Warnings",
        "",
        f"- Symbols requiring risk review: `{', '.join(risk_symbols) if risk_symbols else 'none'}`",
        "",
        "## Manual Review Symbols",
        "",
        f"- Symbols needing human review before any deeper sandbox step: `{', '.join(review_symbols) if review_symbols else 'none beyond routine monthly review'}`",
        "",
        "## Next Observation Recommendation",
        "",
        "- Re-run this script after the next research price refresh.",
        "- Check whether candidates keep ranking well across refresh dates.",
        "- Review missing prices, abnormal volatility, and sector concentration before any sandbox UI discussion.",
        "- Keep all outputs shadow-only until a human reviewer approves a later sandbox-only step.",
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    candidates = load_candidates()
    executive = load_json(EXECUTIVE_REVIEW)
    framework = load_json(MONITORING_FRAMEWORK)
    metrics = load_json(MONITORING_METRICS)
    prices = load_json(PRICE_FILE)

    monitored = framework.get("symbols")
    if not monitored:
        raise ValueError("No monitored symbols found in Phase 6O monitoring framework.")
    candidate_symbols = [row["symbol"] for row in candidates]
    if sorted(monitored) != sorted(candidate_symbols):
        raise ValueError("Phase 6Q candidate table and Phase 6O monitored symbols do not match.")

    risk_config = executive.get("phase6m", {})
    generated_at = datetime.now(timezone.utc).isoformat()
    price_symbols = prices.get("symbols", {})
    price_hash = hashlib.sha256(json.dumps(prices, sort_keys=True).encode("utf-8")).hexdigest()

    observations = [
        compute_observation(
            candidate=row,
            price_entry=price_symbols.get(row["symbol"]),
            risk_config=risk_config,
            metric_entry=metrics.get(row["symbol"], {}),
            generated_at=generated_at,
            input_hash=price_hash,
            as_of_rank=index,
        )
        for index, row in enumerate(candidates, start=1)
    ]

    status_counts = Counter(row["monitoring_status"] for row in observations)
    risk_symbols = [row["symbol"] for row in observations if row["risk_gate_status"] == "warning"]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "generatedAt": generated_at,
        "source": "Phase 6S research-only shadow observation",
        "notTradingAdvice": True,
        "liveDefaultChanged": False,
        "manualTradePlanChanged": False,
        "monitoredSymbolCount": len(observations),
        "statusCounts": dict(status_counts),
        "riskWarningSymbols": risk_symbols,
        "observations": observations,
    }
    (OUT_DIR / "shadow-observation-log.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    write_csv(OUT_DIR / "shadow-observation-log.csv", observations)
    write_summary(OUT_DIR / "shadow-observation-summary.md", observations, status_counts, risk_symbols)

    validation = {
        "generatedAt": generated_at,
        "monitoredSymbolCount": len(observations),
        "expectedSymbolCount": 12,
        "symbolsFound": [row["symbol"] for row in observations],
        "priceFile": str(PRICE_FILE.relative_to(ROOT)),
        "allPricesAvailable": all(row["price_available"] for row in observations),
        "riskWarningCount": len(risk_symbols),
        "liveDefaultChanged": False,
        "manualTradePlanChanged": False,
        "dataResearchUniverseChanged": False,
        "dataResearchPricesChanged": False,
        "dataBacktestPricesChanged": False,
        "pyPortfolioOptIntroduced": False,
        "passed": len(observations) == 12 and all(row["price_available"] for row in observations),
    }
    (OUT_DIR / "shadow-observation-validation-report.json").write_text(
        json.dumps(validation, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"monitored_symbol_count={len(observations)}")
    print(f"status_counts={dict(status_counts)}")
    print(f"risk_warning_symbols={risk_symbols}")
    print(f"validation_passed={validation['passed']}")


if __name__ == "__main__":
    main()
