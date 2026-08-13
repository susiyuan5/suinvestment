"""URL, hash, source-family and freshness handling for v3 evidence."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from typing import Any

from .contracts import validate_as_of, validate_evidence, validate_https


def content_hash(content: str | bytes) -> str:
    payload = content.encode("utf-8") if isinstance(content, str) else content
    return hashlib.sha256(payload).hexdigest()


def canonical_url(url: str) -> str:
    validate_https(url)
    parts = urlsplit(url)
    query = urlencode(sorted(parse_qsl(parts.query, keep_blank_values=True)))
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path, query, ""))


def source_family_for(url: str, source_name: str = "") -> str:
    host = urlsplit(url).netloc.lower()
    name = source_name.lower()
    if "sec.gov" in host or "sec" in name:
        return "SEC"
    if "earnings" in name or "transcript" in name:
        return "COMPANY_EARNINGS"
    if "ir." in host or "investor" in host:
        return "COMPANY_IR"
    if "yahoo" in host or "price" in name or "quote" in name:
        return "PUBLIC_PRICE"
    if "fred" in host or "macro" in name:
        return "PUBLIC_MACRO"
    return "OTHER_PUBLIC"


def lineage_group_for(source_family: str, url: str, source_name: str = "") -> str:
    """Collapse derivative records from the same underlying information origin."""
    family = str(source_family or source_family_for(url, source_name)).upper()
    if family in {"SEC", "COMPANY_IR", "COMPANY_EARNINGS"}:
        return "ISSUER_DISCLOSURE"
    if family == "PUBLIC_PRICE":
        return "MARKET_PRICE"
    if family == "PUBLIC_MACRO":
        return "PUBLIC_MACRO"
    return "OTHER_PUBLIC"


def make_evidence(*, evidence_id: str, source_name: str, url: str, document_type: str, published_at: str, accessed_at: str, as_of: str, claim: str, metric: str = "", value: Any = None, unit: str = "", period: str = "", confidence: float = 0.0, content: str = "", supports_or_contradicts: dict[str, Any] | None = None, stale: bool = False, source_family: str | None = None) -> dict[str, Any]:
    item = {
        "evidence_id": evidence_id, "source_family": source_family or source_family_for(url, source_name), "source_name": source_name,
        "canonical_url": canonical_url(url), "document_type": document_type, "published_at": published_at, "accessed_at": accessed_at, "as_of": as_of,
        "claim": claim, "metric": metric, "value": value, "unit": unit, "period": period, "confidence": confidence,
        "content_hash": content_hash(content), "supports_or_contradicts": supports_or_contradicts or {"supports": [], "contradicts": []}, "stale": stale,
    }
    item["lineage_group"] = lineage_group_for(item["source_family"], url, source_name)
    validate_evidence(item)
    return item


def deduplicate_evidence(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    selected: dict[str, dict[str, Any]] = {}
    hash_to_key: dict[str, str] = {}
    for item in items:
        validate_evidence(item)
        identity = str(item.get("evidence_id") or item["canonical_url"])
        key = hash_to_key.get(item["content_hash"], identity) if item["content_hash"] else identity
        if key in selected:
            previous = selected[key]
            if float(item["confidence"]) > float(previous["confidence"]):
                selected[key] = item
            continue
        selected[key] = item
        if item["content_hash"]:
            hash_to_key[item["content_hash"]] = key
    return list(selected.values())


def mark_stale(items: list[dict[str, Any]], *, as_of: str, max_age_days: int) -> list[dict[str, Any]]:
    cutoff = datetime.fromisoformat(as_of.replace("Z", "+00:00")).astimezone(timezone.utc) - timedelta(days=max_age_days)
    output = []
    for item in items:
        copied = dict(item)
        copied["stale"] = datetime.fromisoformat(str(item["published_at"]).replace("Z", "+00:00")).astimezone(timezone.utc) < cutoff
        output.append(copied)
    return output


def input_hash(payload: Any) -> str:
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
