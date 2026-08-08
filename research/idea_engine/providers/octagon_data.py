"""Audited Octagon OpenAI-compatible adapter for the Idea Engine.

The adapter keeps Octagon in the evidence-provider role.  Candidate status and
portfolio actions are always decided by the local deterministic arbitrator.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

from ..contracts import DIMENSIONS, validate_evidence
from ..evidence import make_evidence


BASE_URL = "https://api.octagonai.co/v1"
MODEL = "octagon-agent-market-intelligence-agent"


class OctagonProviderError(RuntimeError):
    """Raised when Octagon cannot produce a schema-valid research payload."""


def _utc(value: str | None) -> str | None:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError
        return parsed.astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError):
        return None


def _bounded(value: Any, low: float, high: float) -> float:
    try:
        return max(low, min(high, float(value)))
    except (TypeError, ValueError):
        return low


def _message_annotations(message: Any) -> list[dict[str, str]]:
    annotations = getattr(message, "annotations", None) or []
    output = []
    for item in annotations:
        if hasattr(item, "model_dump"):
            item = item.model_dump()
        if not isinstance(item, dict):
            continue
        url = item.get("url") or item.get("url_citation", {}).get("url")
        name = item.get("name") or item.get("title") or item.get("url_citation", {}).get("title") or "Octagon citation"
        if url:
            output.append({"url": str(url), "name": str(name)})
    return output


@dataclass
class OctagonGateway:
    """Small injectable wrapper around the OpenAI-compatible client."""

    api_key: str
    client_factory: Callable[..., Any] | None = None

    def __post_init__(self) -> None:
        if not self.api_key:
            raise OctagonProviderError("OCTAGON_API_KEY is not configured")
        if self.client_factory is None:
            try:
                from openai import OpenAI
            except ImportError as error:
                raise OctagonProviderError("openai package is required for Octagon") from error
            self.client_factory = OpenAI
        self.client = self.client_factory(
            api_key=self.api_key,
            base_url=BASE_URL,
            timeout=90.0,
            max_retries=2,
        )

    def query_json(self, prompt: str, *, model: str = MODEL) -> tuple[dict[str, Any], list[dict[str, str]]]:
        try:
            response = self.client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
            )
            message = response.choices[0].message
            payload = json.loads(message.content or "{}")
        except (AttributeError, IndexError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise OctagonProviderError("Octagon returned an invalid JSON response") from error
        except Exception as error:  # SDK error types are optional at import time.
            raise OctagonProviderError(f"Octagon request failed: {type(error).__name__}") from error
        if not isinstance(payload, dict):
            raise OctagonProviderError("Octagon response must be a JSON object")
        return payload, _message_annotations(message)


def build_prompt(symbols: list[str], as_of: str) -> str:
    return f"""
You are supplying research evidence to a deterministic, research-only stock candidate engine.
Analyze only these US-listed technology/semiconductor symbols: {', '.join(symbols)}.
All facts and scores must be knowable as of {as_of}; never use later information.

Use current financial statements, SEC/issuer filings, earnings transcripts, stock data and dated news.
Return one compact JSON object and no prose. Required shape:
{{
  "universe_rows": [{{
    "ticker": "AAPL", "exchange": "NASDAQ", "asset_type": "stock|adr",
    "is_us_listed": true, "market_cap_usd": 0,
    "average_dollar_volume_20d_usd": 0
  }}],
  "candidates": [{{
    "ticker": "AAPL",
    "dimensions": {{{', '.join(f'"{name}": 0' for name in DIMENSIONS)}}},
    "method_scores": {{"anthropic_screen": 0, "serenity_alpha": 0, "juglar_cycle": 0}},
    "juglar": {{"not_applicable": false, "stage_probabilities": {{"recovery": 0, "expansion": 0, "overheating": 0, "downturn": 0, "clearing": 0}}}},
    "evidence": [{{
      "source": "issuer or filing name", "url": "https://...",
      "published_at": "ISO-8601 with timezone", "lineage_id": "stable-source-id",
      "first_party": true, "supports": ["financial_quality"],
      "confidence": 0.0, "summary": "short factual evidence"
    }}],
    "conflicts": [], "gates_failed": [],
    "what_makes_investable": [], "what_kills_thesis": []
  }}]
}}

Rules:
- Scores are 0-100 evidence-strength scores, not buy/sell recommendations.
- Do not assign status, allocation, target price or expected return.
- Anthropic screen is candidate recall only; Serenity requires observable demand-to-financial transmission.
- Juglar must distinguish industry, company and market-pricing stages and may be not_applicable.
- Include at least two independent dated evidence URLs per candidate; do not duplicate the same lineage.
- Omit a candidate rather than inventing a metric or citation.
- Include every requested symbol in universe_rows when reliable liquidity data is available.
""".strip()


def normalize_payload(raw: dict[str, Any], annotations: list[dict[str, str]], *, symbols: list[str], as_of: str) -> dict[str, Any]:
    allowed = {symbol.upper() for symbol in symbols}
    universe_rows = []
    for row in raw.get("universe_rows", []):
        if not isinstance(row, dict) or str(row.get("ticker", "")).upper() not in allowed:
            continue
        ticker = str(row["ticker"]).upper()
        universe_rows.append({
            "ticker": ticker,
            "exchange": str(row.get("exchange", "")).upper(),
            "asset_type": str(row.get("asset_type", "stock")).lower(),
            "is_us_listed": bool(row.get("is_us_listed", False)),
            "market_cap_usd": max(0.0, _bounded(row.get("market_cap_usd"), 0, 1e15)),
            "average_dollar_volume_20d_usd": max(0.0, _bounded(row.get("average_dollar_volume_20d_usd"), 0, 1e15)),
        })

    candidates = []
    for raw_candidate in raw.get("candidates", []):
        if not isinstance(raw_candidate, dict):
            continue
        ticker = str(raw_candidate.get("ticker", "")).upper()
        if ticker not in allowed:
            continue
        dimensions = {
            name: _bounded(raw_candidate.get("dimensions", {}).get(name), 0, 100)
            for name in DIMENSIONS
            if raw_candidate.get("dimensions", {}).get(name) is not None
        }
        evidence = []
        for index, item in enumerate(raw_candidate.get("evidence", [])):
            if not isinstance(item, dict) or not item.get("url"):
                continue
            published_at = _utc(item.get("published_at"))
            if published_at is None:
                continue
            summary = str(item.get("summary") or item.get("content") or item.get("source") or "Octagon evidence")
            age_days = (
                datetime.fromisoformat(as_of.replace("Z", "+00:00"))
                - datetime.fromisoformat(published_at.replace("Z", "+00:00"))
            ).days
            try:
                evidence.append(make_evidence(
                    source=str(item.get("source") or "Octagon"),
                    url=str(item["url"]),
                    published_at=published_at,
                    retrieved_at=as_of,
                    as_of=as_of,
                    content=summary,
                    lineage_id=str(item.get("lineage_id") or f"octagon:{ticker}:{index}:{item['url']}"),
                    freshness="fresh" if 0 <= age_days <= 45 else "stale",
                    first_party=bool(item.get("first_party", False)),
                    supports=[name for name in item.get("supports", []) if name in DIMENSIONS],
                    confidence=_bounded(item.get("confidence", 0.5), 0, 1),
                    missing_fields=[],
                ))
            except ValueError:
                continue
        # Annotations improve traceability but do not count as independent scoring evidence
        # unless the structured payload ties them to a specific candidate.
        method_scores = {
            str(key): _bounded(value, 0, 100)
            for key, value in raw_candidate.get("method_scores", {}).items()
            if key in {"anthropic_screen", "serenity_alpha", "juglar_cycle"}
        }
        stale_gate = ["stale_core_data"] if evidence and all(item["freshness"] == "stale" for item in evidence) else []
        candidates.append({
            "ticker": ticker,
            "dimensions": dimensions,
            "family_scores": dimensions,
            "methods": list(dimensions),
            "method_scores": method_scores,
            "method_adjustments": {},
            "method_versions": {
                "octagon_model": MODEL,
                "anthropic_screen": "reference-v1",
                "serenity_alpha": "reference-v1",
                "juglar_cycle": "reference-v1",
            },
            "juglar": raw_candidate.get("juglar", {}),
            "evidence": evidence,
            "conflicts": [str(value) for value in raw_candidate.get("conflicts", [])],
            "gates_failed": list(dict.fromkeys([str(value) for value in raw_candidate.get("gates_failed", [])] + stale_gate + ["single_provider_score_dependency"])),
            "what_makes_investable": [str(value) for value in raw_candidate.get("what_makes_investable", [])],
            "what_kills_thesis": [str(value) for value in raw_candidate.get("what_kills_thesis", [])],
            "data_quality": {"status": "ready", "provider": "octagon", "annotation_count": len(annotations)},
        })
    return {"universe_rows": universe_rows, "candidates": candidates, "provider": "octagon", "as_of": as_of}


def fetch_research_payload(symbols: list[str], *, as_of: str, gateway: OctagonGateway | None = None) -> dict[str, Any]:
    gateway = gateway or OctagonGateway(os.environ.get("OCTAGON_API_KEY", ""))
    raw, annotations = gateway.query_json(build_prompt(symbols, as_of))
    payload = normalize_payload(raw, annotations, symbols=symbols, as_of=as_of)
    if not payload["universe_rows"]:
        raise OctagonProviderError("Octagon returned no schema-valid universe rows")
    return payload


def import_manual(payload: dict) -> dict:
    """Backward-compatible schema-validated evidence import."""
    if not isinstance(payload, dict) or not isinstance(payload.get("evidence"), list):
        return {"available": False, "reason": "manual_evidence_json_required", "evidence": []}
    for item in payload["evidence"]:
        validate_evidence(item)
    return {"available": True, "evidence": payload["evidence"], "produces_trade_conclusion": False}
