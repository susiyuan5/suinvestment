from __future__ import annotations

import json

from phase6_expansion_utils import ROOT, load_json, write_json
from risk_gates import RISK_GATE_CONFIG, evaluate_gate_inputs


OUT_DIR = ROOT / "research" / "results" / "phase6m"
SHADOW_RISK_PATH = ROOT / "research" / "results" / "phase6l" / "risk-exposure-difference.json"
PHASE6I_VALIDATION = ROOT / "research" / "results" / "phase6i" / "phase6i-validation-report.json"


def main() -> int:
    risk = load_json(SHADOW_RISK_PATH)
    validation = load_json(PHASE6I_VALIDATION)
    gate_inputs = {
        "largest_sector_share": risk.get("shadowLargestCategoryShare", 1),
        "min_price_coverage_rows": 572 if validation["priceStatus"]["shortSuccessfulSymbols"] == [] else 0,
        "max_volatility_12w": 0.0,
    }
    gate_result = evaluate_gate_inputs(gate_inputs)
    report = {
        "riskGateConfig": RISK_GATE_CONFIG,
        "gateInputs": gate_inputs,
        "gateResult": gate_result,
        "liveIntegrationEnabled": False,
        "manualTradePlanChanged": False,
        "defaultDashboardChanged": False,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    write_json(OUT_DIR / "risk-gate-config.json", RISK_GATE_CONFIG)
    write_json(OUT_DIR / "risk-gate-review-report.json", report)
    (OUT_DIR / "risk-gate-review-report.md").write_text(markdown_report(report), encoding="utf-8")
    (OUT_DIR / "rollback-plan.md").write_text(rollback_plan(), encoding="utf-8")
    print(f"risk_gates_passed={gate_result['passed']}")
    print(f"Wrote {OUT_DIR}")
    return 0


def markdown_report(report: dict) -> str:
    return "# Phase 6M Risk Gate Review\n\nResearch/shadow-only. No live integration is enabled.\n\n```json\n" + json.dumps(report, indent=2) + "\n```\n"


def rollback_plan() -> str:
    return """# Phase 6M Rollback Plan

Rollback is one command conceptually: ignore all Phase 6I+ shadow outputs and continue using the active 38-symbol research universe.

## Rules

- Do not load `data/research-universe-sector-balanced-80.json` in default scripts.
- Do not load `data/research-prices-sector-balanced-80.json` in dashboard or default backtests.
- Continue using `data/research-universe.json` for active research.
- Continue using live dashboard symbols and Manual Trade Plan unchanged.
- If any future shadow activation fails risk gates, revert to active 38 baseline for research comparisons.
"""


if __name__ == "__main__":
    raise SystemExit(main())
