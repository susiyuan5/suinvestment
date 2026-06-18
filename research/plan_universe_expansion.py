from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

from universe import load_research_universe


ROOT = Path(__file__).resolve().parents[1]
PLAN_PATH = ROOT / "data" / "research-universe-expansion-plan.json"


def main() -> int:
    active = load_research_universe()
    plan = json.loads(PLAN_PATH.read_text(encoding="utf-8"))

    validate_plan(active, plan)
    print_summary(active, plan)
    return 0


def validate_plan(active: Any, plan: dict[str, Any]) -> None:
    if plan.get("status") != "planning_only":
        raise ValueError("Expansion plan status must be planning_only")

    current_live = normalize(plan.get("current_live_portfolio_symbols", []))
    current_research = normalize(plan.get("current_research_universe_symbols", []))
    current_refs = normalize(plan.get("current_reference_symbols", []))
    proposed_additions = normalize(plan.get("proposed_addition_symbols", []))
    proposed_research = normalize(plan.get("proposed_research_universe_symbols", []))
    proposed_refs = normalize(plan.get("proposed_reference_symbols", []))

    ensure_unique("current_live_portfolio_symbols", current_live)
    ensure_unique("current_research_universe_symbols", current_research)
    ensure_unique("current_reference_symbols", current_refs)
    ensure_unique("proposed_addition_symbols", proposed_additions)
    ensure_unique("proposed_research_universe_symbols", proposed_research)
    ensure_unique("proposed_reference_symbols", proposed_refs)

    if tuple(current_live) != active.live_portfolio_symbols:
        raise ValueError("Plan current live portfolio symbols do not match active universe")
    if tuple(current_research) != active.research_universe_symbols:
        raise ValueError("Plan current research symbols do not match active universe")
    if tuple(current_refs) != active.reference_symbols:
        raise ValueError("Plan current reference symbols do not match active universe")
    if tuple(proposed_refs) != active.reference_symbols:
        raise ValueError("Proposed references must remain unchanged")

    overlap_refs = sorted(set(proposed_research) & set(proposed_refs))
    if overlap_refs:
        raise ValueError(f"Proposed references must stay separate from research symbols: {', '.join(overlap_refs)}")

    overlap_existing = sorted(set(proposed_additions) & set(current_research))
    if overlap_existing:
        raise ValueError(f"Proposed additions already exist in current universe: {', '.join(overlap_existing)}")

    expected_proposed = set(current_research) | set(proposed_additions)
    if set(proposed_research) != expected_proposed:
        raise ValueError("Proposed research universe must equal current research symbols plus proposed additions")

    if not 75 <= len(proposed_research) <= 85:
        raise ValueError(f"Proposed research universe should be around 80 symbols, got {len(proposed_research)}")

    category_targets = plan.get("category_targets", {})
    counts_before = plan.get("category_counts_before", {})
    counts_after = plan.get("category_counts_after", {})
    if not isinstance(category_targets, dict) or not isinstance(counts_before, dict) or not isinstance(counts_after, dict):
        raise ValueError("Category targets and counts must be objects")

    computed_before = Counter(active.category_by_symbol[symbol] for symbol in current_research)
    computed_after = compute_after_counts(active, plan, proposed_research)
    all_categories = set(category_targets) | set(counts_before) | set(counts_after)
    normalized_before = {category: computed_before.get(category, 0) for category in all_categories}
    normalized_after = {category: computed_after.get(category, 0) for category in all_categories}

    if normalized_before != counts_before:
        raise ValueError(f"category_counts_before mismatch: computed {normalized_before}")
    if normalized_after != counts_after:
        raise ValueError(f"category_counts_after mismatch: computed {normalized_after}")
    if counts_after != category_targets:
        raise ValueError("category_counts_after should match category_targets in this plan")

    max_category = max(computed_after.values())
    if max_category / len(proposed_research) > 0.15:
        raise ValueError("A proposed category exceeds the 15% concentration warning threshold")

    tech_plus_semi = computed_after["core_technology"] + computed_after["semiconductors"]
    if tech_plus_semi / len(proposed_research) > 0.30:
        raise ValueError("Core technology plus semiconductors exceeds 30% of proposed universe")


def compute_after_counts(active: Any, plan: dict[str, Any], proposed_research: list[str]) -> Counter[str]:
    metadata = plan.get("symbol_metadata", {})
    if not isinstance(metadata, dict):
        raise ValueError("symbol_metadata must be an object")
    counts: Counter[str] = Counter()
    for symbol in proposed_research:
        if symbol in active.category_by_symbol:
            counts[active.category_by_symbol[symbol]] += 1
            continue
        symbol_meta = metadata.get(symbol)
        if not isinstance(symbol_meta, dict) or not symbol_meta.get("category"):
            raise ValueError(f"Missing category metadata for proposed addition: {symbol}")
        counts[str(symbol_meta["category"])] += 1
    return counts


def print_summary(active: Any, plan: dict[str, Any]) -> None:
    current_research = normalize(plan["current_research_universe_symbols"])
    proposed_research = normalize(plan["proposed_research_universe_symbols"])
    proposed_refs = normalize(plan["proposed_reference_symbols"])
    before = plan["category_counts_before"]
    after = plan["category_counts_after"]

    print("Research universe expansion plan validation: OK")
    print(f"active_live_symbols={len(active.live_portfolio_symbols)}")
    print(f"active_research_symbols={len(current_research)}")
    print(f"proposed_research_symbols={len(proposed_research)}")
    print(f"active_reference_symbols={len(active.reference_symbols)}")
    print(f"proposed_reference_symbols={len(proposed_refs)}")
    print("")
    print("category,before,after,target")
    for category in sorted(after):
        print(f"{category},{before.get(category, 0)},{after[category]},{plan['category_targets'].get(category, '')}")
    print("")
    print("This is a planning-only file. No prices were fetched and no active universe file was modified.")


def normalize(symbols: object) -> list[str]:
    if not isinstance(symbols, list):
        raise ValueError("Symbol groups must be lists")
    return [str(symbol).strip().upper() for symbol in symbols]


def ensure_unique(label: str, symbols: list[str]) -> None:
    duplicates = sorted({symbol for symbol in symbols if symbols.count(symbol) > 1})
    if duplicates:
        raise ValueError(f"{label} contains duplicates: {', '.join(duplicates)}")


if __name__ == "__main__":
    raise SystemExit(main())
