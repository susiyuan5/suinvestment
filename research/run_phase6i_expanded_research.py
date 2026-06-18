from __future__ import annotations

import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.update_research_prices import (
    DEFAULT_START,
    MIN_WEEKS,
    coverage_row,
    fetch_weekly_rows_with_retries,
    symbol_payload,
    validate_research_prices,
    write_coverage,
)
from research.universe import load_active_research_universe, load_expanded_research_universe


ROOT = Path(__file__).resolve().parents[1]
ACTIVE_PRICES_PATH = ROOT / "data" / "research-prices.json"
EXPANDED_PRICES_PATH = ROOT / "data" / "research-prices-sector-balanced-80.json"
OUT_DIR = ROOT / "research" / "results" / "phase6i"
COMPARISON_JSON = OUT_DIR / "universe-comparison-38-vs-80.json"
COMPARISON_MD = OUT_DIR / "universe-comparison-38-vs-80.md"
SECTOR_DISTRIBUTION_JSON = OUT_DIR / "sector-distribution-38-vs-80.json"
VALIDATION_REPORT_JSON = OUT_DIR / "phase6i-validation-report.json"
COVERAGE_CSV = OUT_DIR / "expanded-80-price-coverage.csv"


def main() -> int:
    active = load_active_research_universe()
    expanded = load_expanded_research_universe()
    validate_safety(active, expanded)

    generated_at = datetime.now(timezone.utc).isoformat()
    comparison = build_comparison(active, expanded)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    price_status = build_expanded_price_snapshot(active, expanded, generated_at)
    validation = build_validation_report(active, expanded, comparison, price_status, generated_at)

    COMPARISON_JSON.write_text(json.dumps(comparison, indent=2) + "\n", encoding="utf-8")
    SECTOR_DISTRIBUTION_JSON.write_text(json.dumps(comparison["categoryDistribution"], indent=2) + "\n", encoding="utf-8")
    VALIDATION_REPORT_JSON.write_text(json.dumps(validation, indent=2) + "\n", encoding="utf-8")
    COMPARISON_MD.write_text(markdown_report(comparison, price_status, validation), encoding="utf-8")

    print(f"active_research_symbols={comparison['activeResearchSymbolCount']}")
    print(f"expanded_research_symbols={comparison['expandedResearchSymbolCount']}")
    print(f"active_reference_symbols={comparison['activeReferenceSymbolCount']}")
    print(f"expanded_reference_symbols={comparison['expandedReferenceSymbolCount']}")
    print(f"new_symbols_added={len(comparison['newSymbolsAdded'])}")
    print(f"removed_symbols={len(comparison['removedSymbols'])}")
    print(f"price_successful_symbols={price_status['successfulSymbols']}")
    print(f"price_failed_symbols={price_status['failedSymbols']}")
    print(f"short_successful_symbols={len(price_status['shortSuccessfulSymbols'])}")
    print(f"Wrote {EXPANDED_PRICES_PATH}")
    print(f"Wrote {COMPARISON_JSON}")
    print(f"Wrote {COMPARISON_MD}")
    print(f"Wrote {SECTOR_DISTRIBUTION_JSON}")
    print(f"Wrote {VALIDATION_REPORT_JSON}")
    return 0


def validate_safety(active: Any, expanded: Any) -> None:
    if len(active.research_universe_symbols) != 38:
        raise RuntimeError("Active research universe must remain 38 symbols")
    if len(expanded.research_universe_symbols) != 80:
        raise RuntimeError("Expanded research universe must contain 80 symbols")
    if active.live_portfolio_symbols != expanded.live_portfolio_symbols:
        raise RuntimeError("Expanded universe must not change live portfolio symbols")
    if active.reference_symbols != expanded.reference_symbols:
        raise RuntimeError("Expanded universe must not change reference symbols")
    if set(expanded.reference_symbols) & set(expanded.research_universe_symbols):
        raise RuntimeError("Expanded reference symbols must stay separate from research symbols")


def build_comparison(active: Any, expanded: Any) -> dict[str, Any]:
    active_set = set(active.research_universe_symbols)
    expanded_set = set(expanded.research_universe_symbols)
    return {
        "activeResearchSymbolCount": len(active.research_universe_symbols),
        "expandedResearchSymbolCount": len(expanded.research_universe_symbols),
        "activeReferenceSymbolCount": len(active.reference_symbols),
        "expandedReferenceSymbolCount": len(expanded.reference_symbols),
        "activeReferenceSymbols": list(active.reference_symbols),
        "expandedReferenceSymbols": list(expanded.reference_symbols),
        "newSymbolsAdded": sorted(expanded_set - active_set),
        "removedSymbols": sorted(active_set - expanded_set),
        "categoryDistribution": {
            "active": category_counts(active),
            "expanded": category_counts(expanded),
        },
        "concentration": concentration_summary(active, expanded),
        "safety": {
            "livePortfolioSymbolsUnchanged": active.live_portfolio_symbols == expanded.live_portfolio_symbols,
            "referenceSymbolsUnchanged": active.reference_symbols == expanded.reference_symbols,
            "referenceSymbolsSeparate": not bool(set(expanded.reference_symbols) & set(expanded.research_universe_symbols)),
            "manualTradePlanUnchangedByDesign": True,
            "defaultDashboardUnchangedByDesign": True,
            "pyPortfolioOptDeferred": True,
        },
    }


def category_counts(universe: Any) -> dict[str, int]:
    counts: dict[str, int] = {}
    for symbol in universe.research_universe_symbols:
        category = universe.category_by_symbol[symbol]
        counts[category] = counts.get(category, 0) + 1
    return dict(sorted(counts.items()))


def concentration_summary(active: Any, expanded: Any) -> dict[str, Any]:
    active_counts = category_counts(active)
    expanded_counts = category_counts(expanded)
    tech_active = active_counts.get("core_technology", 0) + active_counts.get("semiconductors", 0)
    tech_expanded = expanded_counts.get("core_technology", 0) + expanded_counts.get("semiconductors", 0)
    return {
        "activeLargestCategoryShare": round(max(active_counts.values()) / len(active.research_universe_symbols), 6),
        "expandedLargestCategoryShare": round(max(expanded_counts.values()) / len(expanded.research_universe_symbols), 6),
        "activeTechSemiconductorShare": round(tech_active / len(active.research_universe_symbols), 6),
        "expandedTechSemiconductorShare": round(tech_expanded / len(expanded.research_universe_symbols), 6),
        "energyMaterialsAdded": expanded_counts.get("energy_materials", 0),
        "utilitiesRealAssetsAdded": expanded_counts.get("utilities_real_assets", 0),
        "internationalCount": expanded_counts.get("international", 0),
    }


def build_expanded_price_snapshot(active: Any, expanded: Any, generated_at: str) -> dict[str, Any]:
    active_prices = json.loads(ACTIVE_PRICES_PATH.read_text(encoding="utf-8")) if ACTIVE_PRICES_PATH.exists() else {"symbols": {}}
    active_symbol_payloads = active_prices.get("symbols", {})
    symbols = list(expanded.research_universe_symbols) + list(expanded.reference_symbols)
    result: dict[str, Any] = {
        "generatedAt": generated_at,
        "source": "Yahoo Finance chart weekly data generated locally for explicit Phase 6I research only",
        "description": "Sector-balanced 80-symbol research-only historical weekly close data. Not used by live dashboard recommendations.",
        "universeFile": "data/research-universe-sector-balanced-80.json",
        "start": DEFAULT_START,
        "end": datetime.now(timezone.utc).date().isoformat(),
        "minWeeks": MIN_WEEKS,
        "includeReferenceSymbols": True,
        "live_portfolio_symbols": list(expanded.live_portfolio_symbols),
        "research_universe_symbols": list(expanded.research_universe_symbols),
        "reference_symbols": list(expanded.reference_symbols),
        "symbols": {},
        "failures": [],
    }
    coverage_rows: list[dict[str, Any]] = []

    for symbol in symbols:
        role = "reference" if symbol in expanded.reference_symbols else "research"
        if symbol in active_symbol_payloads:
            payload = dict(active_symbol_payloads[symbol])
            payload["role"] = role
            result["symbols"][symbol] = payload
            coverage_rows.append(coverage_row(symbol, role, "success_reused", payload.get("rows", []), ""))
            continue
        try:
            rows = fetch_weekly_rows_with_retries(symbol, DEFAULT_START, result["end"], retries=2)
            result["symbols"][symbol] = symbol_payload(symbol, role, generated_at, rows)
            coverage_rows.append(coverage_row(symbol, role, "success_fetched", rows, ""))
            print(f"{symbol}: fetched {len(rows)} weekly rows")
        except Exception as error:
            reason = str(error)
            result["failures"].append({"symbol": symbol, "role": role, "generatedAt": generated_at, "reason": reason})
            coverage_rows.append(coverage_row(symbol, role, "failed", [], reason))
            print(f"{symbol}: failed - {reason}")

    validate_research_prices(result, expanded, require_all_success=False)
    result["validation"] = price_validation_summary(result, expanded)
    EXPANDED_PRICES_PATH.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    write_coverage(COVERAGE_CSV, coverage_rows)
    return result["validation"] | {"coverageCsv": str(COVERAGE_CSV.relative_to(ROOT)).replace("\\", "/")}


def price_validation_summary(snapshot: dict[str, Any], expanded: Any) -> dict[str, Any]:
    symbols = snapshot.get("symbols", {})
    failures = snapshot.get("failures", [])
    short = sorted(
        symbol for symbol, payload in symbols.items() if int(payload.get("rowCount", len(payload.get("rows", [])))) < MIN_WEEKS
    )
    latest_dates = [payload.get("latestDate") for payload in symbols.values() if payload.get("latestDate")]
    first_dates = [payload.get("firstDate") for payload in symbols.values() if payload.get("firstDate")]
    return {
        "successfulSymbols": len(symbols),
        "failedSymbols": len(failures),
        "shortSuccessfulSymbols": short,
        "latestDateMin": min(latest_dates) if latest_dates else "",
        "latestDateMax": max(latest_dates) if latest_dates else "",
        "firstDateMin": min(first_dates) if first_dates else "",
        "firstDateMax": max(first_dates) if first_dates else "",
        "expandedResearchSymbolsPresent": len(set(expanded.research_universe_symbols) & set(symbols)),
        "expandedReferenceSymbolsPresent": len(set(expanded.reference_symbols) & set(symbols)),
        "researchOnlyPriceFile": str(EXPANDED_PRICES_PATH.relative_to(ROOT)).replace("\\", "/"),
    }


def build_validation_report(active: Any, expanded: Any, comparison: dict[str, Any], price_status: dict[str, Any], generated_at: str) -> dict[str, Any]:
    return {
        "generatedAt": generated_at,
        "phase": "6I",
        "status": "research_only_expanded_universe_ready_for_comparison",
        "activeUniverseStillDefault": len(active.research_universe_symbols) == 38,
        "expandedUniverseExplicitOnly": len(expanded.research_universe_symbols) == 80,
        "dataBacktestPricesUnchangedByScript": True,
        "manualTradePlanUnchangedByScript": True,
        "appJsUnchangedByScript": True,
        "pyPortfolioOptIntroduced": False,
        "liveDashboardSymbolsChanged": False,
        "comparison": comparison,
        "priceStatus": price_status,
        "factorComparisonStatus": "not_run_in_phase6i_runner; price file generated for later explicit factor pipeline comparison",
        "recommendedNextStep": "Phase 6J should run explicit 38-vs-80 factor, validation, sector/regime, and ML comparisons using the separate expanded price file.",
    }


def markdown_report(comparison: dict[str, Any], price_status: dict[str, Any], validation: dict[str, Any]) -> str:
    lines = [
        "# Phase 6I 38 vs 80 Research Universe Comparison",
        "",
        "This report is research-only. It does not affect live dashboard recommendations, Manual Trade Plan, buy amounts, signal scores, multipliers, risk levels, action thresholds, default Python strategy, or market regime formula.",
        "",
        "## Universe Counts",
        "",
        f"- Active research universe: `{comparison['activeResearchSymbolCount']}` symbols",
        f"- Expanded research universe: `{comparison['expandedResearchSymbolCount']}` symbols",
        f"- Active references: `{comparison['activeReferenceSymbolCount']}`",
        f"- Expanded references: `{comparison['expandedReferenceSymbolCount']}`",
        f"- New symbols added: `{len(comparison['newSymbolsAdded'])}`",
        f"- Removed symbols: `{len(comparison['removedSymbols'])}`",
        "",
        "## Category Distribution",
        "",
        "| category | active 38 | expanded 80 |",
        "|:--|--:|--:|",
    ]
    active_counts = comparison["categoryDistribution"]["active"]
    expanded_counts = comparison["categoryDistribution"]["expanded"]
    for category in sorted(set(active_counts) | set(expanded_counts)):
        lines.append(f"| {category} | {active_counts.get(category, 0)} | {expanded_counts.get(category, 0)} |")
    lines.extend(
        [
            "",
            "## Concentration",
            "",
            f"- Active largest category share: `{comparison['concentration']['activeLargestCategoryShare']}`",
            f"- Expanded largest category share: `{comparison['concentration']['expandedLargestCategoryShare']}`",
            f"- Active technology + semiconductors share: `{comparison['concentration']['activeTechSemiconductorShare']}`",
            f"- Expanded technology + semiconductors share: `{comparison['concentration']['expandedTechSemiconductorShare']}`",
            f"- Energy/materials coverage: `{comparison['concentration']['energyMaterialsAdded']}` symbols",
            f"- Utilities/real assets coverage: `{comparison['concentration']['utilitiesRealAssetsAdded']}` symbols",
            "",
            "## Price Data Status",
            "",
            f"- Successful symbols: `{price_status['successfulSymbols']}`",
            f"- Coverage count explanation: `{price_status['successfulSymbols']}` = `{comparison['expandedResearchSymbolCount']}` expanded research symbols + `{comparison['expandedReferenceSymbolCount']}` reference symbols.",
            f"- Failed symbols: `{price_status['failedSymbols']}`",
            f"- Short successful symbols: `{len(price_status['shortSuccessfulSymbols'])}`",
            f"- Latest date range: `{price_status['latestDateMin']}` to `{price_status['latestDateMax']}`",
            f"- Price file: `{price_status['researchOnlyPriceFile']}`",
            "",
            "## Safety Confirmation",
            "",
            f"- Active universe still default: `{validation['activeUniverseStillDefault']}`",
            f"- Expanded universe explicit only: `{validation['expandedUniverseExplicitOnly']}`",
            f"- PyPortfolioOpt introduced: `{validation['pyPortfolioOptIntroduced']}`",
            f"- Live dashboard symbols changed: `{validation['liveDashboardSymbolsChanged']}`",
            "- `data/backtest-prices.json` is not written by this runner.",
            "- Manual Trade Plan is not written by this runner.",
            "",
            "## Next Step",
            "",
            validation["recommendedNextStep"],
            "",
        ]
    )
    return "\n".join(lines)


if __name__ == "__main__":
    raise SystemExit(main())
