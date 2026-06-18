from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_UNIVERSE_PATH = ROOT / "data" / "research-universe.json"


@dataclass(frozen=True)
class ResearchUniverse:
    live_portfolio_symbols: tuple[str, ...]
    research_universe_symbols: tuple[str, ...]
    reference_symbols: tuple[str, ...]
    category_by_symbol: dict[str, str]
    category_symbols: dict[str, tuple[str, ...]]


def load_research_universe(path: Path = DEFAULT_UNIVERSE_PATH) -> ResearchUniverse:
    payload = json.loads(path.read_text(encoding="utf-8"))
    universe = ResearchUniverse(
        live_portfolio_symbols=tuple(_normalize_symbols(payload.get("live_portfolio_symbols", []))),
        research_universe_symbols=tuple(_normalize_symbols(payload.get("research_universe_symbols", []))),
        reference_symbols=tuple(_normalize_symbols(payload.get("reference_symbols", []))),
        category_by_symbol={},
        category_symbols=_normalize_categories(payload.get("category_metadata", {})),
    )
    universe = ResearchUniverse(
        live_portfolio_symbols=universe.live_portfolio_symbols,
        research_universe_symbols=universe.research_universe_symbols,
        reference_symbols=universe.reference_symbols,
        category_by_symbol=_build_category_lookup(universe.category_symbols),
        category_symbols=universe.category_symbols,
    )
    validate_research_universe(universe)
    return universe


def validate_research_universe(universe: ResearchUniverse) -> None:
    _ensure_unique("live_portfolio_symbols", universe.live_portfolio_symbols)
    _ensure_unique("research_universe_symbols", universe.research_universe_symbols)
    _ensure_unique("reference_symbols", universe.reference_symbols)

    missing_live = sorted(set(universe.live_portfolio_symbols) - set(universe.research_universe_symbols))
    if missing_live:
        raise ValueError(f"Live portfolio symbols missing from research universe: {', '.join(missing_live)}")

    reference_overlap = sorted(set(universe.reference_symbols) & set(universe.research_universe_symbols))
    if reference_overlap:
        raise ValueError(f"Reference symbols must stay separate from research symbols: {', '.join(reference_overlap)}")

    required_references = {"QQQ", "SPY"}
    missing_references = sorted(required_references - set(universe.reference_symbols))
    if missing_references:
        raise ValueError(f"Required reference symbols missing: {', '.join(missing_references)}")

    if universe.category_symbols:
        categorized = set(universe.category_by_symbol)
        expected = set(universe.research_universe_symbols) | set(universe.reference_symbols)
        missing_categories = sorted(expected - categorized)
        if missing_categories:
            raise ValueError(f"Symbols missing category metadata: {', '.join(missing_categories)}")
        extra_categories = sorted(categorized - expected)
        if extra_categories:
            raise ValueError(f"Category metadata has unknown symbols: {', '.join(extra_categories)}")
        reference_category = {
            symbol for symbol, category in universe.category_by_symbol.items() if category == "reference"
        }
        if reference_category != set(universe.reference_symbols):
            raise ValueError("The reference category must contain exactly the reference symbols")


def _normalize_symbols(symbols: object) -> list[str]:
    if not isinstance(symbols, list):
        raise ValueError("Universe symbol groups must be lists")
    normalized = []
    for symbol in symbols:
        if not isinstance(symbol, str) or not symbol.strip():
            raise ValueError("Universe symbols must be non-empty strings")
        normalized.append(symbol.strip().upper())
    return normalized


def _normalize_categories(categories: object) -> dict[str, tuple[str, ...]]:
    if categories in ({}, None):
        return {}
    if not isinstance(categories, dict):
        raise ValueError("category_metadata must be an object")
    normalized: dict[str, tuple[str, ...]] = {}
    for category, symbols in categories.items():
        if not isinstance(category, str) or not category.strip():
            raise ValueError("Category names must be non-empty strings")
        normalized[category.strip()] = tuple(_normalize_symbols(symbols))
        _ensure_unique(f"category_metadata.{category}", normalized[category.strip()])
    return normalized


def _build_category_lookup(categories: dict[str, tuple[str, ...]]) -> dict[str, str]:
    lookup: dict[str, str] = {}
    for category, symbols in categories.items():
        for symbol in symbols:
            if symbol in lookup:
                raise ValueError(f"Symbol appears in multiple categories: {symbol}")
            lookup[symbol] = category
    return lookup


def _ensure_unique(label: str, symbols: tuple[str, ...]) -> None:
    duplicates = sorted({symbol for symbol in symbols if symbols.count(symbol) > 1})
    if duplicates:
        raise ValueError(f"{label} contains duplicate symbols: {', '.join(duplicates)}")


if __name__ == "__main__":
    loaded = load_research_universe()
    print(f"live_portfolio_symbols={len(loaded.live_portfolio_symbols)}")
    print(f"research_universe_symbols={len(loaded.research_universe_symbols)}")
    print(f"reference_symbols={len(loaded.reference_symbols)}")
    print(f"categories={len(loaded.category_symbols)}")
