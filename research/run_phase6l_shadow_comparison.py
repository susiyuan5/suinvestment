from __future__ import annotations

import json

from phase6_expansion_utils import ROOT, category_counts, coverage_summary, load_json, load_universe_pair, write_json


OUT_DIR = ROOT / "research" / "results" / "phase6l"
PHASE6K_CANDIDATES = ROOT / "research" / "results" / "phase6k" / "promotion-candidates.json"


def main() -> int:
    active, expanded = load_universe_pair()
    candidates = load_json(PHASE6K_CANDIDATES).get("candidates", [])
    candidate_symbols = [row["symbol"] for row in candidates]
    shadow_symbols = list(active.symbols) + [symbol for symbol in candidate_symbols if symbol not in active.symbols]
    shadow_counts = shadow_category_counts(active, expanded, shadow_symbols)
    active_counts = category_counts(active)
    signal_diff = signal_difference(active_counts, shadow_counts, len(active.symbols), len(shadow_symbols))
    risk_diff = risk_difference(active_counts, shadow_counts, len(active.symbols), len(shadow_symbols))
    recommendation_diff = {
        "status": "shadow_only",
        "defaultRecommendationsChanged": False,
        "manualTradePlanChanged": False,
        "newSymbolsInShadowOnly": candidate_symbols,
        "note": "No dashboard recommendation output is changed by this comparison.",
    }
    definition = {
        "activeSymbolCount": len(active.symbols),
        "shadowSymbolCount": len(shadow_symbols),
        "candidateCount": len(candidate_symbols),
        "shadowSymbols": shadow_symbols,
        "candidateSymbols": candidate_symbols,
        "categoryCounts": shadow_counts,
        "disabledByDefault": True,
    }
    report = {
        "shadowUniverseDefinition": definition,
        "signalDifference": signal_diff,
        "recommendationDifference": recommendation_diff,
        "riskExposureDifference": risk_diff,
        "priceCoverage": coverage_summary(expanded),
    }
    validation = {
        "shadowOnly": True,
        "defaultDashboardChanged": False,
        "manualTradePlanChanged": False,
        "activeUniverseChanged": False,
        "shadowSymbolCount": len(shadow_symbols),
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    write_json(OUT_DIR / "shadow-universe-definition.json", definition)
    write_json(OUT_DIR / "signal-difference-38-vs-shadow.json", signal_diff)
    write_json(OUT_DIR / "recommendation-difference-38-vs-shadow.json", recommendation_diff)
    write_json(OUT_DIR / "risk-exposure-difference.json", risk_diff)
    write_json(OUT_DIR / "shadow-comparison-report.json", report)
    write_json(OUT_DIR / "phase6l-validation-report.json", validation)
    (OUT_DIR / "shadow-comparison-report.md").write_text(markdown(report), encoding="utf-8")
    print(f"shadow_symbol_count={len(shadow_symbols)}")
    print(f"candidate_count={len(candidate_symbols)}")
    print(f"Wrote {OUT_DIR}")
    return 0


def shadow_category_counts(active: object, expanded: object, symbols: list[str]) -> dict[str, int]:
    lookup = {**active.category_by_symbol, **expanded.category_by_symbol}
    counts: dict[str, int] = {}
    for symbol in symbols:
        category = lookup[symbol]
        counts[category] = counts.get(category, 0) + 1
    return dict(sorted(counts.items()))


def signal_difference(active_counts: dict[str, int], shadow_counts: dict[str, int], active_total: int, shadow_total: int) -> dict:
    rows = []
    for category in sorted(set(active_counts) | set(shadow_counts)):
        active_share = active_counts.get(category, 0) / active_total
        shadow_share = shadow_counts.get(category, 0) / shadow_total
        rows.append({"category": category, "activeShare": round(active_share, 6), "shadowShare": round(shadow_share, 6), "shareDelta": round(shadow_share - active_share, 6)})
    return {"rows": rows, "interpretation": "Shadow universe improves sector breadth but remains disabled by default."}


def risk_difference(active_counts: dict[str, int], shadow_counts: dict[str, int], active_total: int, shadow_total: int) -> dict:
    return {
        "activeLargestCategoryShare": round(max(active_counts.values()) / active_total, 6),
        "shadowLargestCategoryShare": round(max(shadow_counts.values()) / shadow_total, 6),
        "activeTechSemiShare": round((active_counts.get("core_technology", 0) + active_counts.get("semiconductors", 0)) / active_total, 6),
        "shadowTechSemiShare": round((shadow_counts.get("core_technology", 0) + shadow_counts.get("semiconductors", 0)) / shadow_total, 6),
    }


def markdown(report: dict) -> str:
    return "# Phase 6L Shadow Comparison Report\n\nShadow-only. Default dashboard and Manual Trade Plan are unchanged.\n\n```json\n" + json.dumps(report, indent=2) + "\n```\n"


if __name__ == "__main__":
    raise SystemExit(main())
