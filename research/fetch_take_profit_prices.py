"""Acquire a separate, validated Yahoo daily snapshot for take-profit research.

Uses the project's existing daily-price adapter. No live snapshot is read or
changed, no missing OHLC is manufactured, and every requested symbol receives
an explicit success/failure coverage record.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import sys
from tempfile import NamedTemporaryFile
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from data_loader import PricePoint, load_yahoo_daily_prices


DEFAULT_UNIVERSE = ROOT / "data" / "research-universe-sector-balanced-80.json"
DEFAULT_OUTPUT = ROOT / "research" / "results" / "take_profit_v1"
DEFAULT_START = "2015-01-01"
DEFAULT_END = "2026-10-02"
REFERENCES = ("SPY", "QQQ", "DIA", "IWM")
EXCLUDED_OTC = frozenset({"BYDDY", "TCEHY"})
SOURCE = "Yahoo Finance chart via data_loader.load_yahoo_daily_prices"


def selected_symbols(universe_path: Path) -> tuple[list[str], list[str]]:
    universe = json.loads(universe_path.read_text(encoding="utf-8"))
    research = universe.get("research_universe_symbols")
    if not isinstance(research, list) or not research:
        raise ValueError("research_universe_symbols must be a nonempty list")
    if any(not isinstance(item, str) or not item.strip() for item in research):
        raise ValueError("research symbols must be nonempty strings")
    normalized = [item.strip().upper() for item in research]
    if len(normalized) != len(set(normalized)):
        raise ValueError("duplicate research symbols")
    excluded = sorted(set(normalized) & EXCLUDED_OTC)
    symbols = [item for item in normalized if item not in EXCLUDED_OTC]
    symbols.extend(item for item in REFERENCES if item not in symbols)
    return symbols, excluded


def validated_rows(points: list[PricePoint], start: str, end: str) -> list[dict[str, Any]]:
    if len(points) < 2:
        raise ValueError("fewer than two price rows")
    rows = []
    previous_date = ""
    for point in points:
        current_date = point.date.isoformat()
        if not start <= current_date <= end:
            raise ValueError(f"{current_date}: outside requested range")
        if previous_date and current_date <= previous_date:
            raise ValueError(f"{current_date}: dates are not unique and increasing")
        previous_date = current_date
        values = {
            "open": point.open,
            "high": point.high,
            "low": point.low,
            "close": point.close,
            "adjusted_close": point.adjusted_close,
        }
        if any(
            not isinstance(value, (int, float))
            or isinstance(value, bool)
            or not math.isfinite(value)
            or value <= 0
            for value in values.values()
        ):
            raise ValueError(f"{current_date}: missing or invalid raw OHLC/adjusted close")
        if (
            values["high"] < max(values["open"], values["close"])
            or values["low"] > min(values["open"], values["close"])
            or values["high"] < values["low"]
        ):
            raise ValueError(f"{current_date}: inconsistent raw OHLC")
        volume = point.volume
        if volume is not None and (
            not isinstance(volume, (int, float))
            or not math.isfinite(volume)
            or volume <= 0
        ):
            raise ValueError(f"{current_date}: invalid supplied volume")
        rows.append({"date": current_date, **values, "volume": volume})
    return rows


def fetch_symbol(symbol: str, start: str, end: str) -> tuple[str, list[dict[str, Any]] | None, dict[str, Any]]:
    errors = []
    for attempt in range(1, 3):
        try:
            rows = validated_rows(load_yahoo_daily_prices(symbol, start, end), start, end)
            return symbol, rows, {
                "status": "success",
                "attempts": attempt,
                "row_count": len(rows),
                "first_date": rows[0]["date"],
                "latest_date": rows[-1]["date"],
                "missing_volume_rows": sum(row["volume"] is None for row in rows),
                "attempt_errors": errors,
            }
        except Exception as error:
            errors.append({"attempt": attempt, "type": type(error).__name__, "message": str(error)})
    return symbol, None, {
        "status": "failed",
        "attempts": 2,
        "row_count": 0,
        "first_date": None,
        "latest_date": None,
        "attempt_errors": errors,
    }


def atomic_write(path: Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile("wb", dir=path.parent, suffix=".tmp", delete=False) as handle:
        handle.write(raw)
        temporary_path = Path(handle.name)
    os.replace(temporary_path, path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--universe", type=Path, default=DEFAULT_UNIVERSE)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--start", default=DEFAULT_START)
    parser.add_argument("--end", default=DEFAULT_END)
    parser.add_argument("--symbols", nargs="+", help="Optional explicit subset for acquisition checks")
    args = parser.parse_args()
    start, end = date.fromisoformat(args.start).isoformat(), date.fromisoformat(args.end).isoformat()
    if start >= end:
        parser.error("start must precede end")
    symbols, excluded = selected_symbols(args.universe)
    if args.symbols:
        requested = [symbol.upper().strip() for symbol in args.symbols]
        unknown = sorted(set(requested) - set(symbols))
        if unknown or len(requested) != len(set(requested)):
            parser.error("explicit subset must contain unique symbols from the selected research universe")
        symbols = requested

    results = {}
    coverage = {}
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(fetch_symbol, symbol, start, end) for symbol in symbols]
        for index, future in enumerate(as_completed(futures), 1):
            symbol, rows, record = future.result()
            coverage[symbol] = record
            if rows is not None:
                results[symbol] = rows
            if index % 10 == 0 or index == len(symbols):
                print(f"completed={index}/{len(symbols)} successes={len(results)}", flush=True)

    generated_at = datetime.now(timezone.utc).isoformat()
    snapshot = {
        "schema_version": "take-profit-research-daily-prices-v1",
        "research_only": True,
        "generated_at": generated_at,
        "source": SOURCE,
        "frequency": "1d",
        "currency": "USD",
        "timezone": "America/New_York",
        "adjustment": "raw_ohlc_plus_yahoo_adjusted_close",
        "adjusted_ohlc_formula": "raw_field * adjusted_close / close",
        "requested_start": start,
        "requested_end": end,
        "universe_file": args.universe.resolve().as_posix(),
        "reference_symbols": [symbol for symbol in REFERENCES if symbol in symbols],
        "excluded_otc_symbols": excluded,
        "point_in_time_universe_available": False,
        "survivorship_bias_controlled": False,
        "symbols": {symbol: results[symbol] for symbol in symbols if symbol in results},
    }
    raw = (json.dumps(snapshot, indent=2, allow_nan=False) + "\n").encode("utf-8")
    checksum = hashlib.sha256(raw).hexdigest()
    successful = [record for record in coverage.values() if record["status"] == "success"]
    common_dates = (
        set.intersection(*(set(row["date"] for row in rows) for rows in results.values()))
        if results else set()
    )
    summary = {
        "schema_version": "take-profit-research-price-coverage-v1",
        "research_only": True,
        "generated_at": generated_at,
        "source": SOURCE,
        "requested_start": start,
        "requested_end": end,
        "requested_symbol_count": len(symbols),
        "successful_symbol_count": len(results),
        "failed_symbols": [symbol for symbol in symbols if coverage[symbol]["status"] == "failed"],
        "first_date_min": min((record["first_date"] for record in successful), default=None),
        "first_date_max": max((record["first_date"] for record in successful), default=None),
        "latest_date_min": min((record["latest_date"] for record in successful), default=None),
        "latest_date_max": max((record["latest_date"] for record in successful), default=None),
        "common_date_count": len(common_dates),
        "prices_sha256": checksum,
        "symbols": {symbol: coverage[symbol] for symbol in symbols},
    }
    atomic_write(args.output_dir / "prices.json", raw)
    atomic_write(args.output_dir / "coverage.json", (json.dumps(summary, indent=2, allow_nan=False) + "\n").encode("utf-8"))
    print(json.dumps({key: value for key, value in summary.items() if key != "symbols"}))
    return 0 if results else 1


if __name__ == "__main__":
    raise SystemExit(main())
