from __future__ import annotations

import json

from phase6_expansion_utils import ROOT, load_json, write_json


OUT_DIR = ROOT / "research" / "results" / "phase6o"
PLAN_PATH = ROOT / "research" / "results" / "phase6n" / "partial-activation-plan.json"


def main() -> int:
    plan = load_json(PLAN_PATH)
    symbols = [row["symbol"] for row in plan.get("eligibleSymbols", [])]
    framework = {
        "status": "future_monitoring_framework_only",
        "disabled_by_default": True,
        "symbols": symbols,
        "metrics": [
            "signal_contribution",
            "false_positive_rate_proxy",
            "sector_diversification_benefit",
            "volatility_impact",
            "missing_price_frequency",
            "regime_usefulness",
            "ranking_stability",
            "stay_watch_remove_decision",
        ],
        "reviewCadence": "monthly",
        "liveDefaultChanged": False,
    }
    metrics = {
        symbol: {
            "signal_contribution": "pending",
            "false_positive_rate_proxy": "pending",
            "sector_diversification_benefit": "pending",
            "volatility_impact": "pending",
            "missing_price_frequency": "pending",
            "regime_usefulness": "pending",
            "ranking_stability": "pending",
            "decision": "watch",
        }
        for symbol in symbols
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    write_json(OUT_DIR / "monitoring-framework.json", framework)
    write_json(OUT_DIR / "promoted-symbol-monitoring-metrics.json", metrics)
    (OUT_DIR / "monthly-review-template.md").write_text(monthly_template(symbols), encoding="utf-8")
    (OUT_DIR / "removal-rules.md").write_text(removal_rules(), encoding="utf-8")
    (OUT_DIR / "phase6o-report.md").write_text(report(framework), encoding="utf-8")
    print(f"monitoring_symbols={len(symbols)}")
    print(f"Wrote {OUT_DIR}")
    return 0


def monthly_template(symbols: list[str]) -> str:
    lines = [
        "# Monthly Shadow Symbol Review Template",
        "",
        "This template is for future research/shadow review only.",
        "",
        "## Checklist",
        "",
        "- Review missing price frequency.",
        "- Review ranking stability.",
        "- Review regime usefulness.",
        "- Review volatility impact.",
        "- Decide: stay, watch, or remove.",
        "",
        "## Symbols",
        "",
    ]
    lines.extend(f"- {symbol}: stay / watch / remove" for symbol in symbols)
    return "\n".join(lines) + "\n"


def removal_rules() -> str:
    return """# Removal Rules

Remove or downgrade a shadow candidate if any of these conditions persist:

- Price data missing repeatedly.
- Ranking stability deteriorates for two review cycles.
- Volatility contribution breaches risk gates.
- Sector concentration benefit disappears.
- Regime usefulness is negative across review windows.
- Human review flags duplicate exposure or low confidence.
"""


def report(framework: dict) -> str:
    return "# Phase 6O Monitoring Framework\n\nFuture monitoring only. No live activation.\n\n```json\n" + json.dumps(framework, indent=2) + "\n```\n"


if __name__ == "__main__":
    raise SystemExit(main())
