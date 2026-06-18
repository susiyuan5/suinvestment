from __future__ import annotations

import json

from phase6_expansion_utils import ROOT, load_json, load_universe_pair, write_json


OUT_DIR = ROOT / "research" / "results" / "phase6k"
PHASE6J_DIR = ROOT / "research" / "results" / "phase6j"


def main() -> int:
    active, expanded = load_universe_pair()
    phase6j = load_json(PHASE6J_DIR / "universe-summary-38-vs-80.json")
    prices = expanded.prices.get("symbols", {})
    new_symbols = phase6j["newSymbols"]
    candidates = []
    rejected = []
    category_counts: dict[str, int] = {}
    for symbol in new_symbols:
        category = expanded.category_by_symbol[symbol]
        payload = prices.get(symbol, {})
        row_count = int(payload.get("rowCount", len(payload.get("rows", []))))
        score = candidate_score(category, row_count, category_counts.get(category, 0))
        status = status_for_score(score, row_count)
        row = {
            "symbol": symbol,
            "category": category,
            "priceCoverageRows": row_count,
            "historyLengthPass": row_count >= 50,
            "sectorContribution": symbol not in active.category_by_symbol,
            "duplicateExposureRisk": duplicate_risk(category),
            "noiseRisk": "medium" if category in {"energy_materials", "utilities_real_assets"} else "medium_low",
            "screeningScore": score,
            "classification": status,
            "reason": reason(status, category, row_count),
        }
        if status == "promote_to_shadow_candidate":
            category_counts[category] = category_counts.get(category, 0) + 1
            candidates.append(row)
        else:
            rejected.append(row)
    report = {
        "candidateCount": len(candidates),
        "rejectedOrDeferredCount": len(rejected),
        "classifications": classification_counts(candidates + rejected),
        "candidates": candidates,
        "rejectedOrDeferred": rejected,
        "defaultBehaviorChanged": False,
        "activeUniverseChanged": False,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    write_json(OUT_DIR / "promotion-candidates.json", {"candidates": candidates})
    write_json(OUT_DIR / "rejected-or-deferred-symbols.json", {"symbols": rejected})
    write_json(OUT_DIR / "promotion-screening-report.json", report)
    (OUT_DIR / "promotion-candidates.md").write_text(markdown_candidates(candidates, rejected), encoding="utf-8")
    (OUT_DIR / "promotion-screening-report.md").write_text(markdown_report(report), encoding="utf-8")
    print(f"promote_to_shadow_candidate={len(candidates)}")
    print(f"rejected_or_deferred={len(rejected)}")
    print(f"Wrote {OUT_DIR}")
    return 0


def candidate_score(category: str, row_count: int, already_selected_in_category: int) -> int:
    score = 0
    if row_count >= 500:
        score += 3
    elif row_count >= 50:
        score += 1
    if category in {"energy_materials", "utilities_real_assets"}:
        score += 3
    elif category in {"consumer_retail", "defensive_healthcare", "financial_payments", "industrial_diversified"}:
        score += 2
    elif category == "international":
        score += 1
    if already_selected_in_category >= 2:
        score -= 2
    return score


def status_for_score(score: int, row_count: int) -> str:
    if row_count < 50:
        return "defer_due_to_data"
    if score >= 5:
        return "promote_to_shadow_candidate"
    if score >= 3:
        return "continue_research"
    return "reject_for_now"


def duplicate_risk(category: str) -> str:
    if category in {"core_technology", "semiconductors"}:
        return "higher_existing_exposure"
    if category in {"energy_materials", "utilities_real_assets"}:
        return "low_new_diversifier"
    return "moderate"


def reason(status: str, category: str, row_count: int) -> str:
    if status == "promote_to_shadow_candidate":
        return f"Strong coverage ({row_count} rows) and useful {category} diversification for shadow testing."
    if status == "continue_research":
        return f"Coverage is adequate, but {category} contribution should be validated before shadow inclusion."
    if status == "defer_due_to_data":
        return f"Only {row_count} rows; below minimum history gate."
    return "Lower marginal diversification value for this screening pass."


def classification_counts(rows: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        counts[row["classification"]] = counts.get(row["classification"], 0) + 1
    return counts


def markdown_candidates(candidates: list[dict], rejected: list[dict]) -> str:
    lines = ["# Phase 6K Promotion Candidates", "", "Research-only candidate screen. Nothing is promoted to live/default behavior.", "", "| symbol | category | classification | score | reason |", "|:--|:--|:--|--:|:--|"]
    for row in candidates:
        lines.append(f"| {row['symbol']} | {row['category']} | {row['classification']} | {row['screeningScore']} | {row['reason']} |")
    lines.extend(["", f"Deferred/rejected symbols: `{len(rejected)}`", ""])
    return "\n".join(lines)


def markdown_report(report: dict) -> str:
    return "# Phase 6K Promotion Screening Report\n\n```json\n" + json.dumps(report, indent=2) + "\n```\n"


if __name__ == "__main__":
    raise SystemExit(main())
