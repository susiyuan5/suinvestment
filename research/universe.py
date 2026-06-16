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


def load_research_universe(path: Path = DEFAULT_UNIVERSE_PATH) -> ResearchUniverse:
    payload = json.loads(path.read_text(encoding="utf-8"))
    universe = ResearchUniverse(
        live_portfolio_symbols=tuple(_normalize_symbols(payload.get("live_portfolio_symbols", []))),
        research_universe_symbols=tuple(_normalize_symbols(payload.get("research_universe_symbols", []))),
        reference_symbols=tuple(_normalize_symbols(payload.get("reference_symbols", []))),
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


def _normalize_symbols(symbols: object) -> list[str]:
    if not isinstance(symbols, list):
        raise ValueError("Universe symbol groups must be lists")
    normalized = []
    for symbol in symbols:
        if not isinstance(symbol, str) or not symbol.strip():
            raise ValueError("Universe symbols must be non-empty strings")
        normalized.append(symbol.strip().upper())
    return normalized


def _ensure_unique(label: str, symbols: tuple[str, ...]) -> None:
    duplicates = sorted({symbol for symbol in symbols if symbols.count(symbol) > 1})
    if duplicates:
        raise ValueError(f"{label} contains duplicate symbols: {', '.join(duplicates)}")


if __name__ == "__main__":
    loaded = load_research_universe()
    print(f"live_portfolio_symbols={len(loaded.live_portfolio_symbols)}")
    print(f"research_universe_symbols={len(loaded.research_universe_symbols)}")
    print(f"reference_symbols={len(loaded.reference_symbols)}")
