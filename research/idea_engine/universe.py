"""Deterministic universe gate; it never fetches market data itself."""

from __future__ import annotations

from typing import Any


def eligible_security(row: dict[str, Any], config: dict[str, Any]) -> tuple[bool, list[str]]:
    rules = config["universe"]
    reasons: list[str] = []
    if row.get("exchange", "").upper() in {"OTC", "PINK", "OTCQX", "OTCQB"}:
        reasons.append("otc_excluded")
    if row.get("asset_type") not in {"stock", "adr"}:
        reasons.append("not_equity")
    if not row.get("is_us_listed", False):
        reasons.append("not_us_listed")
    if not rules.get("allow_adr", True) and row.get("asset_type") == "adr":
        reasons.append("adr_not_allowed")
    if float(row.get("market_cap_usd", 0) or 0) < float(rules["min_market_cap_usd"]):
        reasons.append("market_cap_below_minimum")
    if float(row.get("average_dollar_volume_20d_usd", 0) or 0) < float(rules["min_average_dollar_volume_20d_usd"]):
        reasons.append("liquidity_below_minimum")
    return not reasons, reasons


def filter_universe(rows: list[dict[str, Any]], config: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    accepted, rejected = [], []
    for row in rows:
        ok, reasons = eligible_security(row, config)
        (accepted if ok else rejected).append({**row, "rejection_reasons": reasons})
    return accepted, rejected
