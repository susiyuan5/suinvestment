"""Freeze an isolated v3 Idea Engine result from existing free public inputs.

This runner never writes v1/v2 results and never accepts credentials or holdings.
"""

from __future__ import annotations

import argparse
import json
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .contracts import SCHEMA_VERSION, validate_payload
from .evidence import deduplicate_evidence, input_hash, make_evidence, mark_stale
from .funnel import classify_candidate, funnel_summary
from .scoring import score_candidate
from .shadow import maturity, model_statistics

ROOT = Path(__file__).resolve().parents[3]
V2 = ROOT / "research" / "results" / "v2" / "idea-engine"
DEFAULT_OUTPUT = ROOT / "research" / "results" / "v3" / "idea-engine"
CONFIG_PATH = Path(__file__).with_name("config.v3.json")


def load(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return fallback


def atomic_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False, suffix=".tmp") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        temporary = Path(handle.name)
    temporary.replace(path)


def _as_of(value: str | None) -> str:
    if value:
        return value
    return datetime.now(timezone.utc).isoformat()


def _string_list(value: Any) -> list[str]:
    return [str(item) for item in value] if isinstance(value, list) else []


def _evidence(old: dict[str, Any], as_of: str) -> list[dict[str, Any]]:
    output = []
    for index, item in enumerate(old.get("evidence", [])):
        url = item.get("url")
        if not isinstance(url, str) or not url.lower().startswith("https://"):
            continue
        source = str(item.get("source", "公开来源"))
        output.append(make_evidence(
            evidence_id=str(item.get("lineage_id") or f"v2-{index}-{old.get('ticker', 'unknown')}"), source_name=source, url=url,
            document_type="公开研究资料", published_at=str(item.get("published_at", as_of)), accessed_at=str(item.get("retrieved_at", as_of)), as_of=as_of,
            claim="原 v2 证据链，进入 v3 后重新执行来源、日期和去重门禁", metric="", value=None, unit="", period="", confidence=float(item.get("confidence", 0.0)),
            content=str(item.get("content_hash", "")), supports_or_contradicts={"supports": _string_list(item.get("supports")), "contradicts": []}, stale=False,
            source_family=None,
        ))
    return deduplicate_evidence(mark_stale(output, as_of=as_of, max_age_days=45))


def _research_type(old: dict[str, Any]) -> str:
    text = " ".join(_string_list(old.get("what_makes_investable"))).lower()
    if any(token in text for token in ("cycle", "周期", "recovery", "复苏")):
        return "CYCLICAL_RECOVERY"
    if any(token in text for token in ("catalyst", "催化", "event", "事件")):
        return "CATALYST"
    return "QUALITY_COMPOUNDER"


def _candidate(old: dict[str, Any], as_of: str, config: dict[str, Any]) -> dict[str, Any]:
    evidence = _evidence(old, as_of)
    quality = old.get("data_quality", {}) if isinstance(old.get("data_quality"), dict) else {}
    dimensions = old.get("family_scores", {}) if isinstance(old.get("family_scores"), dict) else {}
    scores = score_candidate(dimensions, evidence, config, gates_failed=_string_list(quality.get("gates_failed")))
    missing = _string_list(quality.get("missing_fields")) + scores["missing_dimensions"]
    exposure = _string_list(old.get("exposure_proof"))
    if not exposure and any("demand_catalyst" in item.get("supports_or_contradicts", {}).get("supports", []) for item in evidence):
        exposure = ["公开财务资料包含需求或收入相关证据，仍需公司披露进一步确认"]
    gates_failed = _string_list(quality.get("gates_failed"))
    if missing:
        gates_failed.append("missing_evidence_fields")
    valuation_verified = "valuation" in dimensions and not any(key in missing for key in ("valuation", "valuation_data"))
    status, gates_passed, workflow = classify_candidate(scores, gates_failed=gates_failed, research_type=_research_type(old), exposure_proof=exposure, valuation_verified=valuation_verified, config=config)
    company_name = str(old.get("company_name") or old.get("ticker") or "未知公司")
    candidate = {
        "schema_version": SCHEMA_VERSION, "ticker": str(old.get("ticker", "")).upper(), "company_name": company_name, "exchange": old.get("exchange", ""),
        "security_type": old.get("security_type", "stock"), "adr": bool(old.get("adr", False)), "sector": old.get("sector", "technology"), "industry": old.get("industry", ""),
        "category_metadata": old.get("category_metadata", {}), "listing_currency": old.get("listing_currency", "USD"), "market_cap": old.get("market_cap"), "liquidity_status": old.get("liquidity_status", "unknown"),
        "benchmark_membership": old.get("benchmark_membership", ["QQQ"]), "research_type": _research_type(old), "as_of": as_of, "research_only": True, "status": status,
        "raw_score": scores["raw_score"], "composite_score": scores["composite_score"], "leave_one_dimension_out_floor": scores["leave_one_dimension_out_floor"], "leave_one_source_out_floor": scores["leave_one_source_out_floor"],
        "evidence_coverage_score": scores["evidence_coverage_score"], "confidence_score": scores["confidence_score"], "sector_percentile": scores["sector_percentile"], "penalties": scores["penalties"], "score_contributions": scores["score_contributions"],
        "family_scores": dimensions, "gates_passed": gates_passed, "gates_failed": sorted(set(gates_failed)), "evidence": evidence,
        "why_now": old.get("why_now") or _string_list(old.get("what_makes_investable")), "variant_wedge": old.get("variant_wedge") or "尚未形成可验证的市场预期差异。", "exposure_proof": exposure,
        "expectations_risk": old.get("expectations_risk") or ("市场预期尚未充分验证" if "analyst_consensus" in missing else "需要复核估值与增长匹配程度。"), "first_rejection": old.get("first_rejection") or (gates_failed[0] if gates_failed else "等待下一轮财务与估值核验"),
        "what_makes_investable": old.get("what_makes_investable", []), "what_kills_thesis": old.get("what_kills_thesis", []), "next_workflow": workflow,
        "data_quality": {**quality, "missing_fields": sorted(set(missing)), "gates_failed": sorted(set(gates_failed)), "latest_filing": quality.get("latest_filing"), "latest_price": quality.get("latest_price"), "status": "limited_free_sources" if missing else "complete"},
        "portfolio_fit_status": "UNKNOWN", "portfolio_relation": {"computed_in_browser": True, "direct_position": False, "watchlist": False, "spy_overlap": None, "sector_overlap": None, "fx_warning": None},
        "catalysts": _string_list(old.get("catalysts")), "method_versions": {"v3": config["methodology_version"], **(old.get("method_versions", {}) if isinstance(old.get("method_versions"), dict) else {})},
    }
    return candidate


def _shadow(output_dir: Path, candidates: list[dict[str, Any]], as_of: str, config: dict[str, Any]) -> dict[str, Any]:
    shadow_dir = output_dir / "shadow"
    old = load(shadow_dir / "observations.json", {"schema_version": SCHEMA_VERSION, "research_only": True, "observations": []})
    observations = list(old.get("observations", [])) if isinstance(old, dict) else []
    observation_id = input_hash({"as_of": as_of, "tickers": [item["ticker"] for item in candidates]})[:20]
    if not any(item.get("observation_id") == observation_id for item in observations):
        observations.append({"observation_id": observation_id, "as_of": as_of, "ranking": [item["ticker"] for item in candidates], "funnel_status": {item["ticker"]: item["status"] for item in candidates}, "scores": {item["ticker"]: item["composite_score"] for item in candidates}, "input_hash": input_hash(candidates), "evidence_hash": input_hash([item["evidence"] for item in candidates]), "code_version": "idea-engine-v3", "model_version": config["methodology_version"], "universe_version": config["universe"]["version"], "benchmark": config["universe"]["benchmark_symbols"], "market_regime": "unknown", "sector": "technology", "industry": "mixed"})
    outcomes = list(load(shadow_dir / "outcomes.json", {"schema_version": SCHEMA_VERSION, "research_only": True, "outcomes": []}).get("outcomes", []))
    stats = model_statistics(outcomes, config)
    gate = maturity(observations, outcomes, min_observations=config["shadow"]["min_observations"], min_calendar_weeks=config["shadow"]["min_calendar_weeks"], min_complete=config["shadow"]["min_complete_matured"], degraded=stats["degraded"])
    atomic_json(shadow_dir / "observations.json", {"schema_version": SCHEMA_VERSION, "research_only": True, "observations": observations})
    atomic_json(shadow_dir / "history" / "observations-history.json", {"schema_version": SCHEMA_VERSION, "research_only": True, "entries": observations})
    atomic_json(shadow_dir / "outcomes.json", {"schema_version": SCHEMA_VERSION, "research_only": True, "benchmark": ["QQQ", "SPY"], "outcomes": outcomes, "statistics": stats})
    governance = {"schema_version": SCHEMA_VERSION, "research_only": True, **gate, "model_statistics": stats}
    atomic_json(shadow_dir / "governance-report.json", governance)
    return governance


def run(input_path: Path | None = None, output_dir: Path = DEFAULT_OUTPUT, as_of: str | None = None) -> dict[str, Any]:
    config = load(CONFIG_PATH, {})
    frozen = _as_of(as_of)
    source = load(input_path or (V2 / "latest-candidates.json"), {})
    old_candidates = source.get("candidates", []) if isinstance(source, dict) else []
    candidates = [_candidate(item, frozen, config) for item in old_candidates if isinstance(item, dict)]
    candidates.sort(key=lambda item: (-float(item["composite_score"]), item["ticker"]))
    candidates = candidates[: int(config.get("output", {}).get("max_candidates", 10) or 10)]
    result = {"schema_version": SCHEMA_VERSION, "methodology_version": config["methodology_version"], "generated_at": frozen, "as_of": frozen, "research_only": True, "active_provider": "free_public_data_reused_v2_input", "universe_version": config["universe"]["version"], "benchmark_symbols": config["universe"]["benchmark_symbols"], "source_manifest": {"input": "research/results/v2/idea-engine/latest-candidates.json", "providers": ["SEC_EDGAR", "PUBLIC_PRICE"], "api_key_required": False}, "funnel_summary": funnel_summary(candidates), "candidates": candidates, "rejected_candidates": [], "warnings": ["v3 仅使用免费公开数据；缺少一致预期、电话会或事件证据的候选会被降级。", "仅供研究，不进入本周定投，不生成买入金额。"], "input_hash": input_hash(source)}
    validate_payload(result)
    output_dir.mkdir(parents=True, exist_ok=True)
    atomic_json(output_dir / "latest-candidates.json", result)
    atomic_json(output_dir / "rejected-candidates.json", {"schema_version": SCHEMA_VERSION, "research_only": True, "as_of": frozen, "items": []})
    governance = _shadow(output_dir, candidates, frozen, config)
    atomic_json(output_dir / "provider-status.json", {"schema_version": SCHEMA_VERSION, "research_only": True, "status": "ready" if candidates else "blocked", "active_provider": result["active_provider"], "providers": {"SEC_EDGAR": "free_public_data", "PUBLIC_PRICE": "free_public_data", "paid_providers": "disabled"}, "last_successful_run": frozen})
    lines = ["# 潜力股研究 Idea Engine v3", "", "仅供候选研究，不代表买入建议，不参与本周定投计算。", "", f"- as-of：`{frozen}`", f"- Shadow：`{governance['status']}`", ""]
    lines.extend(f"- `{item['ticker']}`：{item['status']}，稳健分 {item['leave_one_source_out_floor']:.1f}，可信度 {item['confidence_score']:.1f}" for item in candidates)
    (output_dir / "latest-candidates.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--as-of", default="")
    parser.add_argument("--provider", choices=("free",), default="free", help="兼容旧工作流参数；v3 仅使用免费公开数据")
    args = parser.parse_args()
    result = run(args.input, args.output, args.as_of or None)
    print(f"idea_engine_v3_status=ready candidates={len(result['candidates'])}")


if __name__ == "__main__":
    main()
