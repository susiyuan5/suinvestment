"""Build validated, lazy per-symbol browser data without touching live snapshots.

The entire source is checked before a compact replacement directory is staged.
An invalid, missing, or lagging requested symbol blocks publication; old data is
preserved. A refresh replaces historical adjusted values rather than merging
potentially incompatible corporate-action revisions from different snapshots.
"""
from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
import shutil
import sys
import tempfile
from typing import Any
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.market_calendar import CALENDAR, EASTERN, session_close

DEFAULT_PRICES = ROOT / "data" / "short-term-daily-bars-v1.json"
DEFAULT_OUTPUT = ROOT / "data" / "take-profit-v1"
UNIVERSE = ROOT / "data" / "research-universe-sector-balanced-80.json"
REFERENCE_SYMBOLS = ("SPY", "QQQ", "DIA", "IWM")
EXCLUDED_OTC = frozenset({"BYDDY", "TCEHY"})
KNOWN_SCHEMAS = {"short-term-daily-bars-v1", "take-profit-research-daily-prices-v1"}
PRICE_FIELDS = ("open", "high", "low", "close", "adjusted_close")


class BuildBlocked(ValueError):
    def __init__(self, coverage: dict[str, Any]):
        self.coverage = coverage
        super().__init__("take-profit data publication blocked; see coverage failures")


def public_symbols(universe: Path = UNIVERSE) -> list[str]:
    payload = json.loads(universe.read_text(encoding="utf-8"))
    symbols = payload.get("research_universe_symbols")
    if not isinstance(symbols, list) or not symbols:
        raise ValueError("research universe is missing")
    if any(not isinstance(symbol, str) or not symbol or not symbol.isalnum() or symbol != symbol.upper() for symbol in symbols):
        raise ValueError("research universe contains an unsafe symbol")
    if len(symbols) != len(set(symbols)):
        raise ValueError("research universe contains duplicate symbols")
    return sorted((set(symbols) - EXCLUDED_OTC) | set(REFERENCE_SYMBOLS))


def cutoff_date(payload: dict[str, Any], as_of: str | None) -> str:
    supplied = as_of or payload.get("as_of") or payload.get("requested_end")
    if not isinstance(supplied, str) or len(supplied) != 10:
        raise ValueError("an explicit ISO as-of date or source cutoff is required")
    parsed = date.fromisoformat(supplied)
    if parsed.isoformat() != supplied:
        raise ValueError("as-of date must use YYYY-MM-DD")
    return supplied


def latest_session(cutoff: str) -> str:
    day = date.fromisoformat(cutoff)
    if not CALENDAR or not CALENDAR["validFrom"] <= cutoff <= CALENDAR["validThrough"]:
        raise ValueError("as-of date is outside the pinned US equity calendar")
    for offset in range(10):
        candidate = day - timedelta(days=offset)
        if session_close(candidate) is not None:
            return candidate.isoformat()
    raise ValueError("latest US equity session is unavailable")


def latest_completed_session(now: datetime | None = None) -> str:
    local = (now or datetime.now(timezone.utc)).astimezone(EASTERN)
    if not CALENDAR or not CALENDAR["validFrom"] <= local.date().isoformat() <= CALENDAR["validThrough"]:
        raise ValueError("current date is outside the pinned US equity calendar")
    for offset in range(10):
        candidate = local.date() - timedelta(days=offset)
        close = session_close(candidate)
        if close is not None and close <= local:
            return candidate.isoformat()
    raise ValueError("latest completed US equity session is unavailable")


def normalized_rows(raw_rows: Any, *, as_of: str, keep_rows: int) -> list[dict[str, Any]]:
    if not isinstance(raw_rows, list) or len(raw_rows) < 15:
        raise ValueError("at least 15 daily OHLC rows are required")
    result = []
    previous = ""
    for row in raw_rows:
        if not isinstance(row, dict):
            raise ValueError("bar is not an object")
        text = row.get("date")
        if not isinstance(text, str) or len(text) != 10 or date.fromisoformat(text).isoformat() != text:
            raise ValueError("bar date must use YYYY-MM-DD")
        if previous and text <= previous:
            raise ValueError("bar dates must be unique and strictly increasing")
        if text > as_of:
            raise ValueError("bar occurs after the latest completed source session")
        parsed = date.fromisoformat(text)
        if parsed.weekday() >= 5 or (CALENDAR and text >= CALENDAR["validFrom"] and session_close(parsed) is None):
            raise ValueError("bar occurs outside a regular US equity session")
        previous = text
        values = {field: row.get(field) for field in PRICE_FIELDS}
        if values["adjusted_close"] is None:
            values["adjusted_close"] = row.get("adjusted")
        if any(not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) or value <= 0 for value in values.values()):
            raise ValueError("missing or invalid raw OHLC/adjusted close")
        if values["high"] < max(values["open"], values["close"]) or values["low"] > min(values["open"], values["close"]):
            raise ValueError("inconsistent raw OHLC")
        rounded = {field: round(float(value), 8) for field, value in values.items()}
        if any(value <= 0 for value in rounded.values()):
            raise ValueError("price precision is insufficient")
        result.append({"date": text, **rounded})
    if result[-1]["date"] != as_of:
        raise ValueError(f"latest row {result[-1]['date']} misses expected session {as_of}")
    return result[-keep_rows:]


def build_snapshot(payload: dict[str, Any], *, symbols: list[str] | None = None, as_of: str | None = None,
                   keep_rows: int = 600, url_prefix: str = "data/take-profit-v1", now: datetime | None = None) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    if not isinstance(payload, dict) or not isinstance(payload.get("symbols"), dict):
        raise ValueError("source must contain a symbols object")
    if not isinstance(keep_rows, int) or keep_rows < 15:
        raise ValueError("retained rows must be at least 15")
    if payload.get("currency") != "USD":
        raise ValueError("source must explicitly declare USD currency")
    schema = payload.get("schema_version")
    if schema not in KNOWN_SCHEMAS and as_of is None:
        raise ValueError("unknown offline source requires an explicit --as-of date")
    if schema in KNOWN_SCHEMAS and payload.get("research_only") is not True:
        raise ValueError("known source must retain its research-only flag")
    if payload.get("frequency") != "1d":
        raise ValueError("source must contain daily bars")
    expected_adjustment = {"short-term-daily-bars-v1": "split_and_dividend_adjusted",
                           "take-profit-research-daily-prices-v1": "raw_ohlc_plus_yahoo_adjusted_close"}
    if schema in KNOWN_SCHEMAS and payload.get("adjustment") != expected_adjustment[schema]:
        raise ValueError("known source adjustment metadata is missing or inconsistent")
    completed = latest_completed_session(now)
    expected = latest_session(cutoff_date(payload, as_of)) if as_of is not None else completed
    if expected > completed:
        raise ValueError("explicit as-of date exceeds the latest completed US equity session")
    source_cutoff = payload.get("as_of") or payload.get("requested_end")
    requested = public_symbols() if symbols is None else sorted(symbols)
    if not requested or len(requested) != len(set(requested)) or any(not symbol.isalnum() or symbol != symbol.upper() or symbol in EXCLUDED_OTC for symbol in requested):
        raise ValueError("requested public symbols are invalid")
    source = payload.get("source") or "User-supplied offline historical dataset (unverified source)"
    if not isinstance(source, str):
        raise ValueError("source description must be text")
    if schema in KNOWN_SCHEMAS and not payload.get("source"):
        raise ValueError("known source provenance is missing")
    normalized = {}
    failures = {}
    source_symbols = payload["symbols"]
    for symbol in requested:
        try:
            raw = source_symbols.get(symbol)
            if isinstance(raw, dict):
                raw = raw.get("rows")
            normalized[symbol] = normalized_rows(raw, as_of=expected, keep_rows=keep_rows)
        except (ValueError, TypeError, OverflowError) as error:
            failures[symbol] = str(error)
    coverage = {
        "schema_version": "take-profit-browser-coverage-v1", "research_only": True,
        "source": source, "source_as_of": source_cutoff, "as_of": expected,
        "requested_symbols": requested, "requested_symbol_count": len(requested),
        "valid_symbol_count": len(normalized), "failures": failures,
        "excluded_symbols": sorted(set(source_symbols) - set(requested)),
        "published": not failures,
    }
    if not failures:
        benchmark = normalized.get("SPY") or normalized[requested[0]]
        benchmark_dates = {row["date"] for row in benchmark}
        for symbol, rows in normalized.items():
            row_dates = {row["date"] for row in rows}
            required_dates = {day for day in benchmark_dates if rows[0]["date"] <= day <= expected}
            if CALENDAR:
                day = date.fromisoformat(max(rows[0]["date"], CALENDAR["validFrom"]))
                end = date.fromisoformat(expected)
                while day <= end:
                    if session_close(day) is not None:
                        required_dates.add(day.isoformat())
                    day += timedelta(days=1)
            missing = sorted(required_dates - row_dates)
            if missing:
                failures[symbol] = f"missing {len(missing)} benchmark trading dates or pinned calendar sessions; first {missing[0]}"
        coverage["published"] = not failures
    coverage["valid_symbol_count"] = len(requested) - len(failures)
    if failures:
        raise BuildBlocked(coverage)
    metadata = {"research_only": True, "currency": "USD", "source": source, "as_of": expected}
    bars = {symbol: {"schema_version": "take-profit-browser-bars-v1", **metadata, "symbol": symbol, "rows": rows}
            for symbol, rows in normalized.items()}
    entries = {symbol: {"path": f"{url_prefix.rstrip('/')}/symbols/{symbol}.json",
                         "first_date": rows[0]["date"], "last_date": rows[-1]["date"], "rows": len(rows)}
               for symbol, rows in normalized.items()}
    index = {"schema_version": "take-profit-browser-index-v1", **metadata, "source_as_of": source_cutoff,
             "source_generated_at": payload.get("generated_at") or payload.get("generatedAt"),
             "symbol_count": len(entries), "max_retained_rows": keep_rows,
             "first_date_min": min(entry["first_date"] for entry in entries.values()),
             "first_date_max": max(entry["first_date"] for entry in entries.values()),
             "minimum_rows": min(entry["rows"] for entry in entries.values()), "symbols": entries}
    return index, bars, coverage


def checked_child(path: Path, root: Path) -> Path:
    resolved, allowed = path.resolve(), root.resolve()
    if resolved == allowed or not resolved.is_relative_to(allowed):
        raise ValueError("publication or cleanup path must remain beneath its allowed data root")
    return resolved


def remove_staging(path: Path, root: Path) -> None:
    checked = checked_child(path, root)
    if checked.exists():
        shutil.rmtree(checked)


def compact_write(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")


def publish_snapshot(output: Path, index: dict[str, Any], bars: dict[str, Any], coverage: dict[str, Any], *, allowed_root: Path = ROOT / "data") -> None:
    output = checked_child(output, allowed_root)
    if coverage.get("published") is not True or coverage.get("failures"):
        raise ValueError("invalid coverage cannot be published")
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = checked_child(Path(tempfile.mkdtemp(prefix=f".{output.name}.stage-", dir=output.parent)), allowed_root)
    backup = checked_child(output.parent / f".{output.name}.backup-{uuid.uuid4().hex}", allowed_root)
    moved_old = False
    try:
        (staging / "symbols").mkdir()
        for symbol, payload in bars.items():
            if not symbol.isalnum() or symbol != symbol.upper():
                raise ValueError("unsafe output symbol")
            compact_write(staging / "symbols" / f"{symbol}.json", payload)
        compact_write(staging / "coverage.json", coverage)
        compact_write(staging / "index.json", index)
        if output.exists():
            checked_child(output, allowed_root)
            os.replace(output, backup)
            moved_old = True
        try:
            os.replace(staging, output)
        except Exception:
            if moved_old:
                os.replace(backup, output)
                moved_old = False
            raise
        if moved_old:
            remove_staging(backup, allowed_root)
    finally:
        remove_staging(staging, allowed_root)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prices", type=Path, default=DEFAULT_PRICES)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--as-of", help="Explicit historical cutoff; otherwise require the latest completed US session")
    parser.add_argument("--keep-rows", type=int, default=600)
    args = parser.parse_args()
    try:
        output = checked_child(args.output, ROOT / "data")
        payload = json.loads(args.prices.read_text(encoding="utf-8"))
        index, bars, coverage = build_snapshot(payload, as_of=args.as_of, keep_rows=args.keep_rows,
                                              url_prefix=output.relative_to(ROOT).as_posix())
        publish_snapshot(output, index, bars, coverage)
    except BuildBlocked as error:
        print(json.dumps(error.coverage, ensure_ascii=False))
        return 1
    except (OSError, ValueError) as error:
        print(json.dumps({"published": False, "error": str(error)}, ensure_ascii=False))
        return 1
    print(json.dumps({"published": True, "symbols": index["symbol_count"], "as_of": index["as_of"],
                      "earliest_retained_date": index["first_date_min"], "minimum_rows": index["minimum_rows"],
                      "output": str(output)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
