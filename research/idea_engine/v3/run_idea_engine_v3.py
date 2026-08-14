"""Run the independent, free-public-data, Shadow-only Idea Engine v3.1."""

from __future__ import annotations

import argparse
import json
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from research.idea_engine.providers.free_public_data import fetch_research_payload
from research.idea_engine.universe import filter_universe
from research.update_shadow_outcomes import horizon_outcome, normalized_rows

from .contracts import SCHEMA_VERSION, validate_payload
from .evidence import deduplicate_evidence, input_hash, make_evidence, mark_stale
from .funnel import classify_candidate, funnel_summary
from .scoring import score_candidate
from .shadow import maturity, model_statistics


ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OUTPUT = ROOT / "research" / "results" / "v3_1" / "idea-engine"
CONFIG_PATH = Path(__file__).with_name("config.v3.json")
UNIVERSE_PATH = ROOT / "data" / "research-universe-sector-balanced-80.json"
PRICES_PATH = ROOT / "data" / "research-prices-sector-balanced-80.json"
HISTORICAL_OOS_PATH = ROOT / "research" / "results" / "v3_1" / "historical-oos-price-timing" / "latest.json"


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
    return value or datetime.now(timezone.utc).isoformat()


def _historical_reference(payload: dict[str, Any], ticker: str, as_of: str) -> dict[str, Any] | None:
    """Return a safe past-only price-timing reference for research ranking."""
    if not isinstance(payload, dict) or any((
        payload.get("schema_version") != "historical-oos-price-timing-v1",
        payload.get("research_only") is not True,
        payload.get("no_trade") is not True,
        payload.get("scope") != "price_timing_layer_only",
        payload.get("composite_score_calibrated") is not False,
    )):
        return None
    mapping = (payload.get("current_mappings") or {}).get(str(ticker).upper())
    if not isinstance(mapping, dict):
        return None
    reference_as_of = str(mapping.get("as_of") or payload.get("as_of") or "")[:10]
    if not reference_as_of or reference_as_of > str(as_of)[:10]:
        return None
    allowed = {
        "as_of", "timing_score", "calibration_bin", "oos_samples", "oos_origin_dates",
        "oos_cost_adjusted_hit_rate", "oos_hit_rate_ci_low", "oos_hit_rate_ci_high",
        "mean_oos_net_relative_return", "evidence_status",
    }
    return {key: mapping.get(key) for key in allowed}


def _historical_priority(candidate: dict[str, Any]) -> tuple[float, float, float, float, str]:
    reference = candidate.get("historical_oos_reference") or {}
    status_rank = {
        "preliminary_reliable_edge": 3,
        "positive_skew_unconfirmed": 2,
        "no_historical_edge": 1,
    }.get(str(reference.get("evidence_status") or ""), 0)
    return (
        -float(status_rank),
        -float(reference.get("mean_oos_net_relative_return") or -1),
        -float(reference.get("timing_score") or 0),
        -float(candidate.get("composite_score") or 0),
        str(candidate.get("ticker") or ""),
    )


def research_symbols() -> list[str]:
    universe = load(UNIVERSE_PATH, {})
    return list(dict.fromkeys(str(item).upper() for item in universe.get("research_universe_symbols", []) if item))


def _provider_payload(as_of: str, provider_fetcher: Callable[..., dict[str, Any]] | None = None) -> dict[str, Any]:
    fetcher = provider_fetcher or fetch_research_payload
    return fetcher(research_symbols(), as_of=as_of)


def _v3_evidence(items: list[dict[str, Any]], as_of: str, max_age_days: int) -> list[dict[str, Any]]:
    output = []
    for index, item in enumerate(items):
        url = item.get("url")
        if not isinstance(url, str) or not url.startswith("https://"):
            continue
        output.append(make_evidence(
            evidence_id=str(item.get("lineage_id") or f"public-{index}"),
            source_name=str(item.get("source") or "公开来源"),
            url=url,
            document_type="公开研究资料",
            published_at=str(item.get("published_at") or as_of),
            accessed_at=str(item.get("retrieved_at") or as_of),
            as_of=as_of,
            claim="公开数据直接生成的可追溯研究输入",
            confidence=float(item.get("confidence", 0.0)),
            content=str(item.get("content_hash") or item.get("lineage_id") or url),
            supports_or_contradicts={"supports": list(item.get("supports") or []), "contradicts": []},
            stale=str(item.get("freshness", "fresh")) == "stale",
        ))
    return deduplicate_evidence(mark_stale(output, as_of=as_of, max_age_days=max_age_days))


def _research_type(raw: dict[str, Any]) -> str:
    if "industry_cycle" in raw.get("dimensions", {}):
        return "CYCLICAL_RECOVERY"
    return "QUALITY_COMPOUNDER"


CRITICAL_EVIDENCE = (
    ("company_filings", "公司申报与财务数据", ("SEC", "ISSUER_DISCLOSURE", "COMPANY_FILINGS")),
    ("market_price", "价格与成交量", ("PUBLIC_PRICE", "MARKET_PRICE", "PRICE")),
    ("analyst_consensus", "一致预期", ("ANALYST_CONSENSUS", "CONSENSUS")),
    ("earnings_transcript", "财报电话会", ("EARNINGS_TRANSCRIPT", "TRANSCRIPT", "QUARTR")),
    ("news_catalyst", "事件催化", ("NEWS", "CATALYST", "EVENT")),
)


def _evidence_coverage(evidence: list[dict[str, Any]], missing: list[str], scores: dict[str, Any], gates_failed: list[str]) -> dict[str, Any]:
    """Expose coverage semantics without changing the scoring calculation."""
    lineages = {str(item.get("lineage_group") or item.get("source_family") or "").upper() for item in evidence}
    missing_set = {str(item) for item in missing}
    available: list[str] = []
    critical_missing: list[str] = []
    for key, label, aliases in CRITICAL_EVIDENCE:
        present = any(any(alias in lineage for alias in aliases) for lineage in lineages)
        if key in missing_set or any(key in str(gate) for gate in gates_failed):
            present = False
        (available if present else critical_missing).append(label)
    required = len(CRITICAL_EVIDENCE)
    independent_count = int(scores.get("independent_lineage_count") or 0)
    return {
        "score_dimension_coverage": {
            "covered": 6 - len(scores.get("missing_dimensions") or []),
            "required": 6,
            "percent": round(float(scores.get("evidence_coverage_score") or 0), 6),
        },
        "critical_evidence_coverage": {
            "covered": len(available),
            "required": required,
            "percent": round(len(available) / required * 100, 6),
            "available": available,
            "missing": critical_missing,
        },
        "independent_evidence": {
            "count": independent_count,
            "target": 3,
            "percent": round(min(100.0, independent_count / 3 * 100), 6),
            "lineages": sorted(lineages - {""}),
        },
    }


def _candidate(raw: dict[str, Any], universe_row: dict[str, Any], as_of: str, config: dict[str, Any], calibration: float | None) -> dict[str, Any]:
    evidence = _v3_evidence(raw.get("evidence", []), as_of, int(config["limits"]["max_evidence_age_days"]))
    dimensions = dict(raw.get("dimensions") or raw.get("family_scores") or {})
    quality = dict(raw.get("data_quality") or {})
    gates_failed = list(raw.get("gates_failed") or [])
    scores = score_candidate(dimensions, evidence, config, gates_failed=gates_failed, model_calibration_score=calibration)
    if scores["independent_lineage_count"] < 2:
        gates_failed.append("insufficient_independent_evidence")
    if scores["model_calibration_score"] is None:
        gates_failed.append("model_not_calibrated")
    missing = sorted(set(list(quality.get("missing_fields") or []) + scores["missing_dimensions"]))
    if missing:
        gates_failed.append("missing_evidence_fields")
    coverage = _evidence_coverage(evidence, missing, scores, gates_failed)
    exposure = list(raw.get("exposure_proof") or [])
    valuation_verified = "valuation" in dimensions and "valuation" not in missing
    status, passed, workflow = classify_candidate(
        scores,
        gates_failed=sorted(set(gates_failed)),
        research_type=_research_type(raw),
        exposure_proof=exposure,
        valuation_verified=valuation_verified,
        config=config,
    )
    ticker = str(raw.get("ticker") or universe_row.get("ticker") or "").upper()
    company_name = str(universe_row.get("company_name") or raw.get("company_name") or ticker)
    research_limitations = sorted(set(gates_failed))
    thesis_kill_risks = list(raw.get("what_kills_thesis") or [])
    first_thesis_risk = thesis_kill_risks[0] if thesis_kill_risks else "尚未识别明确的公司假设失效条件"
    return {
        "schema_version": SCHEMA_VERSION,
        "ticker": ticker,
        "company_name": company_name,
        "exchange": universe_row.get("exchange", ""),
        "security_type": "adr" if universe_row.get("asset_type") == "adr" else "stock",
        "adr": universe_row.get("asset_type") == "adr",
        "sector": str(universe_row.get("category") or "mixed"),
        "industry": str(universe_row.get("category") or ""),
        "category_metadata": {"category": universe_row.get("category")},
        "listing_currency": "USD",
        "market_cap": universe_row.get("market_cap_usd"),
        "liquidity_status": "verified",
        "benchmark_membership": ["QQQ", "SPY"],
        "research_type": _research_type(raw),
        "as_of": as_of,
        "research_only": True,
        "status": status,
        "raw_score": scores["raw_score"],
        "composite_score": scores["composite_score"],
        "leave_one_dimension_out_floor": scores["leave_one_dimension_out_floor"],
        "leave_one_source_out_floor": scores["leave_one_source_out_floor"],
        "robust_score_raw": scores["robust_score_raw"],
        "robust_score_ceiling": scores["robust_score_ceiling"],
        "robust_score_normalized": scores["robust_score_normalized"],
        "evidence_coverage_score": scores["evidence_coverage_score"],
        "evidence_independence_score": scores["evidence_independence_score"],
        "model_calibration_score": scores["model_calibration_score"],
        "confidence_score": scores["confidence_score"],
        "sector_percentile": scores["sector_percentile"],
        "independent_lineages": scores["independent_lineages"],
        "penalties": scores["penalties"],
        "score_contributions": scores["score_contributions"],
        "family_scores": dimensions,
        "gates_passed": passed,
        "gates_failed": sorted(set(gates_failed)),
        "evidence": evidence,
        **coverage,
        "why_now": list(raw.get("what_makes_investable") or []),
        "variant_wedge": "尚未获得一致预期证据，当前仅能作为研究优先级候选。",
        "exposure_proof": exposure,
        "expectations_risk": "缺少免费、可审计的一致预期与持仓拥挤度数据。",
        "first_rejection": first_thesis_risk,
        "research_limitations": research_limitations,
        "thesis_kill_risks": thesis_kill_risks,
        "what_makes_investable": list(raw.get("what_makes_investable") or []),
        "what_kills_thesis": thesis_kill_risks,
        "next_workflow": workflow,
        "data_quality": {
            **quality,
            "status": "limited_free_sources" if missing or gates_failed else "complete",
            "missing_fields": missing,
            "gates_failed": sorted(set(gates_failed)),
            "reliability_labels": {
                "data_completeness": scores["evidence_coverage_score"],
                "evidence_independence": scores["evidence_independence_score"],
                "model_calibration": scores["model_calibration_score"],
            },
            **coverage,
        },
        "portfolio_fit_status": "UNKNOWN",
        "portfolio_relation": {"computed_in_browser": True, "direct_position": False, "watchlist": False},
        "catalysts": [],
        "method_versions": {"v3_1": config["methodology_version"], **dict(raw.get("method_versions") or {})},
    }


def _backfill(observations: list[dict[str, Any]], prices_payload: dict[str, Any]) -> list[dict[str, Any]]:
    prices = prices_payload.get("symbols", {}) if isinstance(prices_payload, dict) else {}
    benchmark_rows = normalized_rows(prices.get("QQQ", {}))
    outcomes = []
    for observation in observations:
        for rank, ticker in enumerate(observation.get("ranking", []), start=1):
            score = float(observation.get("scores", {}).get(ticker, 0))
            rows = normalized_rows(prices.get(ticker, {}))
            horizon_rows = {}
            for week in (1, 4, 12):
                outcome = horizon_outcome(rows, benchmark_rows, observation.get("as_of", ""), week)
                horizon_rows[str(week)] = {**outcome, "baseline_relative_return": 0.0 if outcome.get("status") == "matured" else None}
            outcomes.append({
                "observation_id": observation.get("observation_id"),
                "observation_as_of": observation.get("as_of"),
                "ticker": ticker,
                "as_of_rank": rank,
                "score": score,
                "horizons": horizon_rows,
            })
    return outcomes


def _shadow(output_dir: Path, candidates: list[dict[str, Any]], as_of: str, config: dict[str, Any], raw_input_hash: str) -> dict[str, Any]:
    shadow_dir = output_dir / "shadow"
    previous = load(shadow_dir / "observations.json", {"observations": []})
    observations = []
    seen_as_of_dates = set()
    for item in previous.get("observations", []):
        frozen_as_of = str(item.get("as_of", ""))
        frozen_date = frozen_as_of[:10]
        if frozen_date in seen_as_of_dates:
            continue
        seen_as_of_dates.add(frozen_date)
        observations.append(item)
    observation_id = input_hash({"as_of": as_of, "input_hash": raw_input_hash})[:20]
    # One immutable observation per as-of instant. A retry can fetch slightly
    # different public data, but it must not rewrite or double-count the freeze.
    if as_of[:10] not in seen_as_of_dates:
        observations.append({
            "observation_id": observation_id,
            "as_of": as_of,
            "ranking": [item["ticker"] for item in candidates],
            "funnel_status": {item["ticker"]: item["status"] for item in candidates},
            "scores": {item["ticker"]: item["composite_score"] for item in candidates},
            "input_hash": raw_input_hash,
            "evidence_hash": input_hash([item["evidence"] for item in candidates]),
            "code_version": "idea-engine-v3.1",
            "model_version": config["methodology_version"],
            "universe_version": config["universe"]["version"],
            "benchmark": ["QQQ", "SPY"],
        })
    outcomes = _backfill(observations, load(PRICES_PATH, {}))
    stats = model_statistics(outcomes, config)
    gate = maturity(
        observations, outcomes,
        preliminary_observations=config["shadow"].get("preliminary_observations", 8),
        preliminary_calendar_weeks=config["shadow"].get("preliminary_calendar_weeks", 8),
        preliminary_complete=config["shadow"].get("preliminary_complete_matured", 4),
        min_observations=config["shadow"]["min_observations"],
        min_calendar_weeks=config["shadow"]["min_calendar_weeks"],
        min_complete=config["shadow"]["min_complete_matured"],
        reliability_observations=config["shadow"]["reliability_observations"],
        reliability_calendar_weeks=config["shadow"]["reliability_calendar_weeks"],
        reliability_complete=config["shadow"]["reliability_complete_matured"],
        degraded=stats["degraded"],
    )
    atomic_json(shadow_dir / "observations.json", {"schema_version": SCHEMA_VERSION, "research_only": True, "observations": observations})
    atomic_json(shadow_dir / "outcomes.json", {"schema_version": SCHEMA_VERSION, "research_only": True, "benchmark": "QQQ", "false_positive_definition": "成熟候选 4 周相对 QQQ 收益不大于 0", "outcomes": outcomes, "statistics": stats})
    governance = {"schema_version": SCHEMA_VERSION, "research_only": True, "research_horizon": config["horizon"], **gate, "model_statistics": stats}
    atomic_json(shadow_dir / "governance-report.json", governance)
    return governance


def run(
    output_dir: Path = DEFAULT_OUTPUT,
    as_of: str | None = None,
    *,
    provider_fetcher: Callable[..., dict[str, Any]] | None = None,
    historical_oos_path: Path = HISTORICAL_OOS_PATH,
) -> dict[str, Any]:
    config = load(CONFIG_PATH, {})
    frozen = _as_of(as_of)
    payload = _provider_payload(frozen, provider_fetcher)
    if payload.get("research_only") is not True:
        raise ValueError("provider payload must be research_only")
    accepted, rejected_rows = filter_universe(payload.get("universe_rows", []), config)
    accepted_by_ticker = {str(row.get("ticker", "")).upper(): row for row in accepted}
    category_map = load(UNIVERSE_PATH, {}).get("symbol_metadata", {})
    for ticker, row in accepted_by_ticker.items():
        row["category"] = (category_map.get(ticker) or {}).get("category", "mixed")

    old_stats = load(output_dir / "shadow" / "outcomes.json", {}).get("statistics", {})
    calibration = old_stats.get("model_calibration_score")
    candidates = [
        _candidate(raw, accepted_by_ticker[ticker], frozen, config, calibration)
        for raw in payload.get("candidates", [])
        if (ticker := str(raw.get("ticker", "")).upper()) in accepted_by_ticker
    ]
    historical_payload = load(historical_oos_path, {})
    for candidate in candidates:
        reference = _historical_reference(historical_payload, candidate["ticker"], frozen)
        candidate["historical_oos_reference"] = reference
        candidate["historical_screen_status"] = (
            "HISTORICAL_RESEARCH_CANDIDATE" if reference and reference.get("evidence_status") == "preliminary_reliable_edge"
            else "HISTORICAL_WATCH_CANDIDATE" if reference and reference.get("evidence_status") == "positive_skew_unconfirmed"
            else "HISTORICAL_NO_EDGE" if reference
            else "HISTORICAL_UNAVAILABLE"
        )
    candidates.sort(key=_historical_priority)
    displayed = candidates[: int(config["output"]["max_candidates"])]
    raw_hash = input_hash(payload)
    snapshot_name = f"{frozen[:10]}-{raw_hash[:12]}.json"
    atomic_json(output_dir / "input-snapshots" / snapshot_name, {
        "schema_version": SCHEMA_VERSION,
        "research_only": True,
        "research_horizon": config["horizon"],
        "as_of": frozen,
        "input_hash": raw_hash,
        "provider": payload.get("provider"),
        "requested_symbols": research_symbols(),
        "normalized_provider_payload": payload,
    })
    governance = _shadow(output_dir, displayed, frozen, config, raw_hash)
    result = {
        "schema_version": SCHEMA_VERSION,
        "methodology_version": config["methodology_version"],
        "generated_at": frozen,
        "as_of": frozen,
        "research_only": True,
        "status": "ready" if candidates else "blocked",
        "active_provider": str(payload.get("provider") or "free_public_data"),
        "universe_version": config["universe"]["version"],
        "benchmark_symbols": ["QQQ", "SPY"],
        "research_horizon": config["horizon"],
        "screened_universe_count": len(payload.get("universe_rows", [])),
        "requested_universe_count": len(research_symbols()),
        "eligible_universe_count": len(accepted),
        "scored_candidate_count": len(candidates),
        "source_manifest": {"input": "direct_free_public_data", "input_snapshot": f"input-snapshots/{snapshot_name}", "providers": ["SEC_EDGAR", "PUBLIC_PRICE"], "api_key_required": False, "failures": payload.get("failures", [])},
        "selection_policy": {
            "primary_reference": "permanent_historical_oos_price_timing",
            "tie_breakers": ["historical_evidence_status", "historical_mean_net_relative_return", "current_timing_score", "composite_research_score"],
            "shadow_role": "forward_monitoring_only",
            "shadow_blocks_historical_screen": False,
            "composite_score_calibrated": False,
            "survivorship_bias_controlled": bool(historical_payload.get("survivorship_bias_controlled")) if isinstance(historical_payload, dict) else False,
        },
        "funnel_summary": funnel_summary(candidates),
        "candidates": displayed,
        "rejected_candidates": rejected_rows,
        "warnings": ["短线定义为 1–4 周研究窗口，4 周相对 QQQ 为主要验收目标。", "12 周结果只用于监测信号衰减，不阻塞短线成熟门槛。", "稳健分以删维度和删来源压力测试的较低值为原始下限，再按当前方法的理论上限归一化到 100 分；不是上涨概率。", "仅用于候选研究优先级，不代表买入建议。", "模型校准度在 Shadow 达到 52 周和 26 条完整成熟结果前保持未验证。"],
        "input_hash": raw_hash,
        "shadow_status": governance["status"],
    }
    result["warnings"].extend([
        "历史永久 OOS 用于当前研究排序；Shadow 仅用于向前监测，不阻断历史候选展示。",
        "历史回填仍存在幸存者偏差，历史命中率和收益不能解释为未来上涨概率。",
    ])
    validate_payload(result)
    output_dir.mkdir(parents=True, exist_ok=True)
    atomic_json(output_dir / "latest-candidates.json", result)
    atomic_json(output_dir / "rejected-candidates.json", {"schema_version": SCHEMA_VERSION, "research_only": True, "as_of": frozen, "items": rejected_rows})
    atomic_json(output_dir / "provider-status.json", {"schema_version": SCHEMA_VERSION, "research_only": True, "status": result["status"], "active_provider": result["active_provider"], "last_successful_run": frozen, "screened_universe_count": result["screened_universe_count"], "research_horizon": config["horizon"], "providers": {"SEC_EDGAR": "free_public_data", "PUBLIC_PRICE": "free_public_data", "paid_providers": "disabled"}})
    robust_ceiling = displayed[0]["robust_score_ceiling"] if displayed else 0.0
    (output_dir / "latest-candidates.md").write_text(
        "# 潜力股短线研究 Idea Engine v3.1\n\n"
        "1–4 周为短线研究窗口，4 周相对 QQQ 为主要验证目标；12 周只监测信号衰减。仅供研究，不进入本周定投。\n\n"
        f"稳健分口径：min(删任一评分维度下限, 删任一证据来源下限) / {robust_ceiling:.1f} × 100。"
        "当前方法的理论上限已归一化为 100；该分数不是上涨概率。\n",
        encoding="utf-8",
    )
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--as-of", default="")
    parser.add_argument("--provider", choices=("free",), default="free")
    parser.add_argument("--historical-oos", type=Path, default=HISTORICAL_OOS_PATH)
    args = parser.parse_args()
    result = run(args.output, args.as_of or None, historical_oos_path=args.historical_oos)
    print(f"idea_engine_v3_1_status={result['status']} screened={result['screened_universe_count']} candidates={len(result['candidates'])}")


if __name__ == "__main__":
    main()
