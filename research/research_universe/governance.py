from __future__ import annotations

import hashlib
import json
import math
from datetime import date
from typing import Any

REFERENCE_SYMBOLS = {"QQQ", "SPY", "DIA", "IWM"}
QUOTAS = {
    "core_technology": 10, "semiconductors": 10, "consumer_retail": 10,
    "defensive_healthcare": 10, "financial_payments": 10,
    "industrial_diversified": 10, "international": 8,
    "energy_materials": 8, "utilities_real_assets": 4,
}


def _finite(value: Any) -> float | None:
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def validate_rows(rows: Any, *, as_of: str, minimum_rows: int = 250) -> tuple[bool, list[str], int]:
    if not isinstance(rows, list):
        return False, ["daily_rows_missing"], 0
    errors: list[str] = []
    previous = ""
    valid = 0
    for raw in rows:
        if not isinstance(raw, dict):
            errors.append("row_invalid")
            continue
        stamp = str(raw.get("date", ""))[:10]
        try:
            date.fromisoformat(stamp)
        except ValueError:
            errors.append("date_invalid")
            continue
        if previous and stamp <= previous:
            errors.append("dates_not_strictly_increasing")
        if stamp > as_of[:10]:
            errors.append("future_data")
        previous = stamp
        values = [_finite(raw.get(field)) for field in ("open", "high", "low", "close", "volume", "adjusted")]
        if any(value is None or value <= 0 for value in values):
            errors.append("ohlcv_invalid")
            continue
        opening, high, low, close = values[:4]
        if high < max(opening, close) or low > min(opening, close):
            errors.append("ohlc_inconsistent")
            continue
        valid += 1
    if valid < minimum_rows:
        errors.append("fewer_than_250_valid_trading_days")
    return not errors, sorted(set(errors)), valid


def validate_candidate(symbol: str, metadata: dict[str, Any], rows: Any, *, as_of: str, now: str | None = None) -> dict[str, Any]:
    symbol = str(symbol).upper()
    reasons: list[str] = []
    security_type = str(metadata.get("security_type", "")).lower()
    exchange = str(metadata.get("exchange", "")).upper()
    if symbol in REFERENCE_SYMBOLS:
        reasons.append("reference_symbol_not_candidate")
    if security_type not in {"common_stock", "adr"}:
        reasons.append("security_type_not_allowed")
    if any(token in exchange for token in ("OTC", "PINK", "OTCQX", "OTCQB")):
        reasons.append("otc_not_allowed")
    if exchange and exchange not in {"NYSE", "NASDAQ", "AMEX", "NYSEAMERICAN"}:
        reasons.append("major_exchange_not_confirmed")
    market_cap = _finite(metadata.get("market_cap_usd"))
    avg_dollar_volume = _finite(metadata.get("avg_dollar_volume_20d_usd"))
    if market_cap is None or market_cap < 2_000_000_000:
        reasons.append("market_cap_below_or_unverified")
    if avg_dollar_volume is None or avg_dollar_volume < 20_000_000:
        reasons.append("liquidity_below_or_unverified")
    row_ok, row_reasons, valid_rows = validate_rows(rows, as_of=as_of)
    if not row_ok:
        reasons.extend(row_reasons)
    if now and as_of[:10] > now[:10]:
        reasons.append("as_of_in_future")
    return {"ticker": symbol, "category": metadata.get("category"), "accepted": not reasons, "valid_rows": valid_rows, "data_completeness": round(valid_rows / 250 * 100, 2) if valid_rows else 0.0, "reasons": sorted(set(reasons))}


def validate_source(universe: dict[str, Any], *, expected_count: int = 80) -> dict[str, Any]:
    symbols = list(universe.get("research_universe_symbols", []))
    categories = universe.get("category_metadata", {})
    errors = []
    if len(symbols) != expected_count or len(set(symbols)) != len(symbols):
        errors.append("research_universe_must_contain_exactly_80_unique_symbols")
    if set(symbols) & REFERENCE_SYMBOLS:
        errors.append("reference_symbols_cannot_enter_candidate_pool")
    counts = {category: len(values) for category, values in categories.items() if category != "reference"}
    if counts != QUOTAS:
        errors.append("category_quotas_do_not_match_governance_policy")
    return {"valid": not errors, "errors": errors, "symbols": symbols, "counts": counts}


def input_hash(payload: Any) -> str:
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def monthly_transition(previous: dict[str, Any], current: dict[str, Any], *, max_replacements: int = 8) -> dict[str, Any]:
    old = set(previous.get("symbols", [])); new = set(current.get("symbols", []))
    added, removed = sorted(new - old), sorted(old - new)
    return {"added": added, "removed": removed, "retained": sorted(old & new), "replacement_count": max(len(added), len(removed)), "within_limit": max(len(added), len(removed)) <= max_replacements}
