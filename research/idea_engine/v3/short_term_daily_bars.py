"""Strict validator for the short-term research daily-bar snapshot.

This module intentionally does not manufacture missing OHLCV fields.  A
missing or stale snapshot is a research block, not a signal.
"""
from __future__ import annotations

from datetime import date
import math
from typing import Any


REQUIRED_FIELDS = ("open", "high", "low", "close", "volume", "adjusted")
MIN_ROWS = 252


def _number(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def validate_rows(rows: Any, *, as_of: str | None = None, minimum_rows: int = MIN_ROWS) -> tuple[list[dict[str, Any]], list[str]]:
    if not isinstance(rows, list):
        return [], ["rows_missing"]
    errors: list[str] = []
    normalized: list[dict[str, Any]] = []
    previous = ""
    for index, raw in enumerate(rows):
        if not isinstance(raw, dict):
            errors.append(f"row_{index}_invalid")
            continue
        raw_date = str(raw.get("date") or "")[:10]
        try:
            parsed = date.fromisoformat(raw_date)
        except ValueError:
            errors.append(f"row_{index}_date_invalid")
            continue
        if previous and raw_date <= previous:
            errors.append("dates_not_strictly_increasing")
        if as_of and raw_date > str(as_of)[:10]:
            errors.append("future_data_detected")
        previous = raw_date
        values = {field: _number(raw.get(field)) for field in REQUIRED_FIELDS}
        if any(values[field] is None for field in REQUIRED_FIELDS):
            errors.append(f"row_{index}_ohlcv_missing")
            continue
        if any(values[field] <= 0 for field in REQUIRED_FIELDS):
            errors.append(f"row_{index}_non_positive")
        if values["high"] < max(values["open"], values["close"]) or values["low"] > min(values["open"], values["close"]):
            errors.append(f"row_{index}_ohlc_inconsistent")
        normalized.append({"date": raw_date, **values})
    if len(normalized) < minimum_rows:
        errors.append("insufficient_daily_history")
    return normalized, list(dict.fromkeys(errors))


def validate_snapshot(payload: Any, symbols: list[str], *, benchmark: str = "QQQ", as_of: str | None = None) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {"valid": False, "errors": ["snapshot_invalid"], "coverage": {}}
    if payload.get("schema_version") != "short-term-daily-bars-v1" or payload.get("research_only") is not True:
        return {"valid": False, "errors": ["snapshot_schema_invalid"], "coverage": {}}
    if payload.get("frequency") != "1d" or payload.get("adjustment") != "split_and_dividend_adjusted":
        return {"valid": False, "errors": ["snapshot_adjustment_or_frequency_invalid"], "coverage": {}}
    source = payload.get("symbols")
    if not isinstance(source, dict):
        return {"valid": False, "errors": ["symbols_missing"], "coverage": {}}
    errors: list[str] = []
    coverage: dict[str, Any] = {}
    normalized: dict[str, list[dict[str, Any]]] = {}
    for symbol in [*symbols, benchmark]:
        rows, row_errors = validate_rows(source.get(symbol), as_of=as_of)
        normalized[symbol] = rows
        errors.extend(f"{symbol}:{error}" for error in row_errors)
        coverage[symbol] = {"rows": len(rows), "latest_date": rows[-1]["date"] if rows else None, "valid": not row_errors}
    common = set(row["date"] for row in normalized.get(benchmark, []))
    for symbol in symbols:
        common &= {row["date"] for row in normalized.get(symbol, [])}
    if len(common) < 60:
        errors.append("common_trading_date_alignment_insufficient")
    return {"valid": not errors, "errors": list(dict.fromkeys(errors)), "coverage": coverage, "common_dates": len(common), "normalized": normalized}
