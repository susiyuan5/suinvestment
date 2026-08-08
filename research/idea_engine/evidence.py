"""Evidence hashing and lineage de-duplication."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from .contracts import validate_evidence


def content_hash(content: str | bytes) -> str:
    payload = content.encode("utf-8") if isinstance(content, str) else content
    return hashlib.sha256(payload).hexdigest()


def make_evidence(*, source: str, url: str, published_at: str, retrieved_at: str, as_of: str, content: str, lineage_id: str, freshness: str, first_party: bool, supports: list[str], confidence: float, missing_fields: list[str]) -> dict[str, Any]:
    item = {"source": source, "url": url, "published_at": published_at, "retrieved_at": retrieved_at, "as_of": as_of, "content_hash": content_hash(content), "lineage_id": lineage_id, "freshness": freshness, "first_party": first_party, "supports": supports, "confidence": confidence, "missing_fields": missing_fields}
    validate_evidence(item)
    return item


def deduplicate_evidence(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    unique: dict[str, dict[str, Any]] = {}
    for item in items:
        validate_evidence(item)
        lineage = item["lineage_id"]
        previous = unique.get(lineage)
        if previous is None or float(item["confidence"]) > float(previous["confidence"]):
            unique[lineage] = item
    return list(unique.values())


def input_hash(payload: Any) -> str:
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
