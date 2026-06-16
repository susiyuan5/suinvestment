from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from data_loader import daily_to_weekly, load_yahoo_daily_prices
from research.universe import ResearchUniverse, load_research_universe, validate_research_universe


ROOT = Path(__file__).resolve().parents[1]
UNIVERSE_PATH = ROOT / "data" / "research-universe.json"
OUT_FILE = ROOT / "data" / "research-prices.json"
COVERAGE_FILE = ROOT / "results" / "phase6" / "research_price_coverage.csv"
DEFAULT_START = "2015-01-01"
MIN_WEEKS = 50


def main() -> int:
    args = parse_args()
    universe = load_research_universe(UNIVERSE_PATH)
    end = args.end or datetime.now(timezone.utc).date().isoformat()
    generated_at = datetime.now(timezone.utc).isoformat()
    symbols = list(universe.research_universe_symbols)
    if args.include_references:
        symbols.extend(universe.reference_symbols)

    result: dict[str, Any] = {
        "generatedAt": generated_at,
        "source": "Yahoo Finance chart weekly data generated locally for research only",
        "description": "Research-only historical weekly close data. Not used by live dashboard recommendations.",
        "universeFile": str(UNIVERSE_PATH.relative_to(ROOT)).replace("\\", "/"),
        "start": args.start,
        "end": end,
        "minWeeks": MIN_WEEKS,
        "includeReferenceSymbols": args.include_references,
        "live_portfolio_symbols": list(universe.live_portfolio_symbols),
        "research_universe_symbols": list(universe.research_universe_symbols),
        "reference_symbols": list(universe.reference_symbols),
        "symbols": {},
        "failures": [],
    }

    coverage_rows: list[dict[str, Any]] = []
    for symbol in symbols:
        role = "reference" if symbol in universe.reference_symbols else "research"
        try:
            rows = fetch_weekly_rows_with_retries(symbol, args.start, end, args.retries)
            result["symbols"][symbol] = symbol_payload(symbol, role, generated_at, rows)
            coverage_rows.append(coverage_row(symbol, role, "success", rows, ""))
            print(f"{symbol}: {len(rows)} weekly rows")
        except Exception as error:
            reason = str(error)
            result["failures"].append(
                {
                    "symbol": symbol,
                    "role": role,
                    "generatedAt": generated_at,
                    "reason": reason,
                }
            )
            coverage_rows.append(coverage_row(symbol, role, "failed", [], reason))
            print(f"{symbol}: failed - {reason}")

    validate_research_prices(result, universe, require_all_success=False)
    result["validation"] = validation_summary(result, universe)
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    COVERAGE_FILE.parent.mkdir(parents=True, exist_ok=True)
    write_coverage(COVERAGE_FILE, coverage_rows)
    print(f"Wrote {OUT_FILE}")
    print(f"Wrote {COVERAGE_FILE}")
    print(f"successful_symbols={len(result['symbols'])}")
    print(f"failed_symbols={len(result['failures'])}")
    print(f"short_successful_symbols={len([row for row in coverage_rows if row['status'] == 'success' and int(row['row_count']) < MIN_WEEKS])}")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate research-only historical weekly price snapshot.")
    parser.add_argument("--start", default=DEFAULT_START, help="Start date in YYYY-MM-DD format.")
    parser.add_argument("--end", default="", help="End date in YYYY-MM-DD format; defaults to today UTC.")
    parser.add_argument(
        "--exclude-references",
        dest="include_references",
        action="store_false",
        help="Do not fetch reference symbols such as QQQ/SPY/DIA/IWM.",
    )
    parser.add_argument("--retries", type=int, default=2, help="Retry count per symbol after transient fetch failures.")
    parser.set_defaults(include_references=True)
    return parser.parse_args()


def fetch_weekly_rows_with_retries(symbol: str, start: str, end: str, retries: int) -> list[dict[str, float | str]]:
    last_error: Exception | None = None
    for _attempt in range(max(retries, 0) + 1):
        try:
            return fetch_weekly_rows(symbol, start, end)
        except Exception as error:
            last_error = error
    raise RuntimeError(str(last_error))


def fetch_weekly_rows(symbol: str, start: str, end: str) -> list[dict[str, float | str]]:
    daily = load_yahoo_daily_prices(symbol, start, end)
    weekly = daily_to_weekly(daily)
    return [
        {
            "date": point.date.isoformat(),
            "close": round(point.close, 6),
        }
        for point in weekly
    ]


def symbol_payload(symbol: str, role: str, generated_at: str, rows: list[dict[str, float | str]]) -> dict[str, Any]:
    first_date = rows[0]["date"] if rows else ""
    latest_date = rows[-1]["date"] if rows else ""
    return {
        "symbol": symbol,
        "role": role,
        "source": "Yahoo Finance chart weekly data generated locally",
        "generatedAt": generated_at,
        "rowCount": len(rows),
        "firstDate": first_date,
        "latestDate": latest_date,
        "meetsMinWeeks": len(rows) >= MIN_WEEKS,
        "rows": rows,
    }


def coverage_row(symbol: str, role: str, status: str, rows: list[dict[str, float | str]], reason: str) -> dict[str, Any]:
    return {
        "symbol": symbol,
        "role": role,
        "status": status,
        "row_count": len(rows),
        "first_date": rows[0]["date"] if rows else "",
        "latest_date": rows[-1]["date"] if rows else "",
        "meets_min_weeks": len(rows) >= MIN_WEEKS if rows else False,
        "failure_reason": reason,
    }


def validate_research_prices(snapshot: dict[str, Any], universe: ResearchUniverse, require_all_success: bool = False) -> None:
    validate_research_universe(universe)
    symbols = snapshot.get("symbols", {})
    if not isinstance(symbols, dict):
        raise RuntimeError("research-prices symbols payload must be an object")

    duplicate_check = list(symbols.keys())
    if len(duplicate_check) != len(set(duplicate_check)):
        raise RuntimeError("research-prices contains duplicate symbol keys")

    reference_overlap = sorted(set(universe.reference_symbols) & set(universe.research_universe_symbols))
    if reference_overlap:
        raise RuntimeError(f"Reference symbols overlap research universe: {', '.join(reference_overlap)}")

    if require_all_success:
        missing = sorted(set(universe.research_universe_symbols) - set(symbols.keys()))
        if missing:
            raise RuntimeError(f"Missing research symbols: {', '.join(missing)}")

    short = [
        symbol
        for symbol, payload in symbols.items()
        if payload.get("role") == "research" and int(payload.get("rowCount", 0)) < MIN_WEEKS
    ]
    if short:
        print(f"Short successful research histories: {', '.join(sorted(short))}")


def validation_summary(snapshot: dict[str, Any], universe: ResearchUniverse) -> dict[str, Any]:
    symbols = snapshot.get("symbols", {})
    successful = len(symbols)
    failed = len(snapshot.get("failures", []))
    short_success = [
        symbol
        for symbol, payload in symbols.items()
        if int(payload.get("rowCount", 0)) < MIN_WEEKS
    ]
    latest_dates = [payload.get("latestDate") for payload in symbols.values() if payload.get("latestDate")]
    return {
        "livePortfolioSymbolsUnchanged": list(universe.live_portfolio_symbols) == ["BYDDY", "MSFT", "NVDA", "AAPL", "ASML", "KO"],
        "referenceSymbolsSeparate": not bool(set(universe.reference_symbols) & set(universe.research_universe_symbols)),
        "successfulSymbols": successful,
        "failedSymbols": failed,
        "shortSuccessfulSymbols": sorted(short_success),
        "latestDateMin": min(latest_dates) if latest_dates else "",
        "latestDateMax": max(latest_dates) if latest_dates else "",
    }


def write_coverage(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


if __name__ == "__main__":
    raise SystemExit(main())
