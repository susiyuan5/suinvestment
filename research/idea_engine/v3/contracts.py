"""Strict, versioned contracts for Idea Engine v3."""

from __future__ import annotations

from datetime import datetime, timezone
from math import isfinite
from typing import Any
from urllib.parse import urlparse

SCHEMA_VERSION = "idea-engine-v3"
STATUSES = {"A_RESEARCH", "B_WATCH", "C_SCREEN", "VALUATION_GATED", "EXPOSURE_UNPROVEN", "BLOCKED", "REJECTED"}
RESEARCH_TYPES = {"QUALITY_COMPOUNDER", "CYCLICAL_RECOVERY", "VALUATION_DISLOCATION", "CATALYST", "THEMATIC_BENEFICIARY", "RELATIVE_VALUE", "WATCH_ONLY"}
WORKFLOWS = {"COMPANY_TEARSHEET", "EARNINGS_REVIEW", "VALUATION_REVIEW", "CATALYST_TRACKER", "THESIS_TRACKER", "WATCHLIST_ONLY", "REJECT"}
DIMENSIONS = ("financial_quality", "valuation", "demand_catalyst", "expectations_confirmation", "industry_cycle", "risk_liquidity_health")
EVIDENCE_FIELDS = ("evidence_id", "source_family", "source_name", "canonical_url", "document_type", "published_at", "accessed_at", "as_of", "claim", "metric", "value", "unit", "period", "confidence", "content_hash", "supports_or_contradicts", "stale")


def _finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and isfinite(float(value))


def parse_time(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError) as exc:
        raise ValueError("时间必须是 ISO-8601") from exc
    if parsed.tzinfo is None:
        raise ValueError("时间必须包含时区")
    return parsed.astimezone(timezone.utc)


def validate_as_of(value: str, *, now: datetime | None = None) -> None:
    parsed = parse_time(value)
    if parsed > (now or datetime.now(timezone.utc)).astimezone(timezone.utc):
        raise ValueError("禁止使用未来数据")


def validate_https(url: str) -> str:
    parsed = urlparse(str(url))
    if parsed.scheme.lower() != "https" or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError("证据来源必须是安全 HTTPS 地址")
    return str(url)


def validate_evidence(item: dict[str, Any]) -> dict[str, Any]:
    missing = [key for key in EVIDENCE_FIELDS if key not in item]
    if missing:
        raise ValueError(f"证据缺少字段: {','.join(missing)}")
    validate_https(item["canonical_url"])
    for key in ("published_at", "accessed_at", "as_of"):
        validate_as_of(str(item[key]))
    published, accessed, as_of = (parse_time(item[key]) for key in ("published_at", "accessed_at", "as_of"))
    if published > as_of or accessed > as_of:
        raise ValueError("证据时间不能晚于研究 as-of")
    if item["source_family"] not in {"SEC", "COMPANY_IR", "COMPANY_EARNINGS", "PUBLIC_PRICE", "PUBLIC_MACRO", "OTHER_PUBLIC"}:
        raise ValueError("未知证据来源家族")
    if not _finite(item["confidence"]) or not 0 <= float(item["confidence"]) <= 1:
        raise ValueError("证据置信度必须在 0 到 1 之间")
    if not isinstance(item["supports_or_contradicts"], dict) or not isinstance(item["stale"], bool):
        raise ValueError("证据支持关系或新鲜度字段无效")
    return item


def validate_candidate(candidate: dict[str, Any]) -> dict[str, Any]:
    required = ("schema_version", "ticker", "company_name", "as_of", "research_only", "research_type", "status", "raw_score", "composite_score", "leave_one_dimension_out_floor", "leave_one_source_out_floor", "evidence_coverage_score", "confidence_score", "penalties", "score_contributions", "gates_passed", "gates_failed", "why_now", "variant_wedge", "exposure_proof", "expectations_risk", "first_rejection", "what_makes_investable", "what_kills_thesis", "next_workflow", "evidence", "data_quality", "portfolio_fit_status")
    missing = [key for key in required if key not in candidate]
    if missing:
        raise ValueError(f"候选缺少字段: {','.join(missing)}")
    if candidate["schema_version"] != SCHEMA_VERSION or candidate["research_only"] is not True:
        raise ValueError("候选版本或 research_only 契约无效")
    validate_as_of(candidate["as_of"])
    ticker = str(candidate["ticker"]).strip().upper()
    if not ticker or len(ticker) > 16:
        raise ValueError("股票代码无效")
    if candidate["research_type"] not in RESEARCH_TYPES or candidate["status"] not in STATUSES or candidate["next_workflow"] not in WORKFLOWS:
        raise ValueError("研究类型、漏斗状态或下一步工作流无效")
    for key in ("raw_score", "composite_score", "leave_one_dimension_out_floor", "leave_one_source_out_floor", "evidence_coverage_score", "confidence_score"):
        if not _finite(candidate[key]) or not 0 <= float(candidate[key]) <= 100:
            raise ValueError(f"{key} 必须是 0 到 100 的有限数")
    if not isinstance(candidate["evidence"], list) or not isinstance(candidate["data_quality"], dict) or not isinstance(candidate["gates_passed"], list) or not isinstance(candidate["gates_failed"], list):
        raise ValueError("候选容器字段无效")
    for evidence in candidate["evidence"]:
        validate_evidence(evidence)
    return candidate


def validate_payload(payload: dict[str, Any]) -> dict[str, Any]:
    required = ("schema_version", "methodology_version", "generated_at", "as_of", "research_only", "active_provider", "universe_version", "benchmark_symbols", "source_manifest", "funnel_summary", "candidates", "rejected_candidates", "warnings")
    missing = [key for key in required if key not in payload]
    if missing:
        raise ValueError(f"v3 结果缺少字段: {','.join(missing)}")
    if payload["schema_version"] != SCHEMA_VERSION or payload["research_only"] is not True:
        raise ValueError("v3 顶层版本或研究隔离标记无效")
    validate_as_of(payload["generated_at"])
    validate_as_of(payload["as_of"])
    if not isinstance(payload["benchmark_symbols"], list) or not {"QQQ", "SPY"}.issubset(set(payload["benchmark_symbols"])):
        raise ValueError("必须包含 QQQ 和 SPY 基准")
    if not isinstance(payload["candidates"], list) or not isinstance(payload["rejected_candidates"], list):
        raise ValueError("候选结果容器无效")
    for candidate in payload["candidates"]:
        validate_candidate(candidate)
    return payload
