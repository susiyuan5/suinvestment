from __future__ import annotations

import csv
import json

from phase6_expansion_utils import ROOT, load_json, write_json


OUT_DIR = ROOT / "research" / "results" / "phase6n"
CANDIDATES_PATH = ROOT / "research" / "results" / "phase6k" / "promotion-candidates.json"
RISK_CONFIG_PATH = ROOT / "research" / "results" / "phase6m" / "risk-gate-config.json"


def main() -> int:
    candidates = load_json(CANDIDATES_PATH).get("candidates", [])
    risk_config = load_json(RISK_CONFIG_PATH)
    plan_rows = [activation_row(row, risk_config) for row in candidates]
    plan = {
        "disabled_by_default": True,
        "eligibleSymbolCount": len(plan_rows),
        "eligibleSymbols": plan_rows,
        "riskGatesApplied": list(risk_config.keys()),
        "liveDefaultChanged": False,
        "manualTradePlanChanged": False,
    }
    readiness = {
        "readyForLive": False,
        "readyForShadowOnlyReview": bool(plan_rows),
        "requiredBeforeActivation": [
            "monthly monitoring history",
            "out-of-sample factor validation",
            "regime-specific stability",
            "human review",
        ],
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    write_json(OUT_DIR / "partial-activation-plan.json", plan)
    write_json(OUT_DIR / "activation-readiness-report.json", readiness)
    write_review_table(OUT_DIR / "promoted-symbol-review-table.csv", plan_rows)
    (OUT_DIR / "partial-activation-plan.md").write_text(markdown_plan(plan), encoding="utf-8")
    (OUT_DIR / "activation-readiness-report.md").write_text(markdown_readiness(readiness), encoding="utf-8")
    print(f"eligible_symbols={len(plan_rows)}")
    print("disabled_by_default=True")
    print(f"Wrote {OUT_DIR}")
    return 0


def activation_row(candidate: dict, risk_config: dict) -> dict:
    return {
        "symbol": candidate["symbol"],
        "category": candidate["category"],
        "eligible_future_partial_activation": True,
        "why_eligible": candidate["reason"],
        "risk_gates": "max_sector_concentration; minimum_price_coverage_rows; new_symbol_cooldown_weeks; low_confidence_no_action_rule",
        "monitor_before_activation": "coverage, volatility, ranking stability, sector concentration, missing prices",
        "rollback_trigger": "failed risk gate, stale price data, unstable ranking, sector concentration breach",
        "disabled_by_default": True,
    }


def write_review_table(path, rows: list[dict]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def markdown_plan(plan: dict) -> str:
    return "# Phase 6N Partial Activation Plan\n\nDisabled by default. Future plan only, not live behavior.\n\n```json\n" + json.dumps(plan, indent=2) + "\n```\n"


def markdown_readiness(readiness: dict) -> str:
    return "# Phase 6N Activation Readiness Report\n\n```json\n" + json.dumps(readiness, indent=2) + "\n```\n"


if __name__ == "__main__":
    raise SystemExit(main())
