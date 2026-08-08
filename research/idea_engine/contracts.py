"""Validation and normalization for the versioned Idea Engine contract."""

from __future__ import annotations

from datetime import datetime, timezone
from math import isfinite
from typing import Any

SCHEMA_VERSION = "idea-engine-v1"
STATUSES = {"A", "B", "C", "blocked", "rejected"}
DIMENSIONS = (
    "financial_quality", "valuation", "demand_catalyst",
    "expectations_confirmation", "industry_cycle", "risk_liquidity_health",
)


def _number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and isfinite(float(value))


def validate_as_of(as_of: str, *, now: datetime | None = None) -> None:
    try:
        parsed = datetime.fromisoformat(as_of.replace("Z", "+00:00"))
    except (AttributeError, ValueError) as error:
        raise ValueError("as_of must be ISO-8601") from error
    if parsed.tzinfo is None:
        raise ValueError("as_of must include timezone")
    if parsed.astimezone(timezone.utc) > (now or datetime.now(timezone.utc)).astimezone(timezone.utc):
        raise ValueError("future as_of is forbidden")


def validate_evidence(item: dict[str, Any]) -> None:
    required = ("source", "url", "published_at", "retrieved_at", "as_of", "content_hash", "lineage_id", "freshness", "first_party", "supports", "confidence", "missing_fields")
    missing = [key for key in required if key not in item]
    if missing:
        raise ValueError(f"evidence missing fields: {','.join(missing)}")
    for key in ("published_at", "retrieved_at", "as_of"):
        validate_as_of(str(item[key]))
    if not item["lineage_id"] or not item["content_hash"] or not isinstance(item["missing_fields"], list):
        raise ValueError("invalid evidence lineage or missing_fields")
    if not _number(item["confidence"]) or not 0 <= float(item["confidence"]) <= 1:
        raise ValueError("confidence must be between 0 and 1")


def validate_candidate(candidate: dict[str, Any]) -> dict[str, Any]:
    required = ("schema_version", "ticker", "as_of", "research_only", "universe", "method_versions", "evidence", "family_scores", "composite_score", "leave_one_out_floor", "status", "conflicts", "first_rejection", "what_makes_investable", "what_kills_thesis", "data_quality")
    missing = [key for key in required if key not in candidate]
    if missing:
        raise ValueError(f"candidate missing fields: {','.join(missing)}")
    if candidate["schema_version"] != SCHEMA_VERSION or candidate["research_only"] is not True:
        raise ValueError("candidate version or research_only contract invalid")
    validate_as_of(candidate["as_of"])
    if not isinstance(candidate["ticker"], str) or not candidate["ticker"].strip():
        raise ValueError("ticker is required")
    if candidate["status"] not in STATUSES:
        raise ValueError("invalid candidate status")
    if not _number(candidate["composite_score"]) or not _number(candidate["leave_one_out_floor"]):
        raise ValueError("scores must be finite numbers")
    if not isinstance(candidate["evidence"], list) or not isinstance(candidate["family_scores"], dict):
        raise ValueError("evidence and family_scores must be containers")
    for item in candidate["evidence"]:
        validate_evidence(item)
    return candidate


def empty_candidate(ticker: str, as_of: str, *, status: str = "blocked", reason: str = "数据不可用") -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION, "ticker": ticker, "as_of": as_of,
        "research_only": True, "universe": "us-listed-technology", "method_versions": {},
        "evidence": [], "family_scores": {}, "composite_score": 0,
        "leave_one_out_floor": 0, "status": status, "conflicts": [],
        "first_rejection": reason, "what_makes_investable": [], "what_kills_thesis": [],
        "data_quality": {"status": "blocked", "missing_fields": ["provider_payload"]},
    }
