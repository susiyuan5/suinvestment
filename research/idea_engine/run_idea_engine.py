"""Run a safe, versioned, Shadow-only Idea Engine freeze."""

from __future__ import annotations

import argparse
import json
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from .arbitration import arbitrate
from .contracts import SCHEMA_VERSION, validate_candidate
from .evidence import input_hash
from .shadow import maturity
from .universe import filter_universe
from research.update_shadow_outcomes import horizon_outcome, normalized_rows


ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "research" / "results" / "v2" / "idea-engine"


def load(path: Path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return fallback


def atomic_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False, suffix=".tmp") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        temporary = Path(handle.name)
    temporary.replace(path)


def atomic_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False, suffix=".tmp") as handle:
        handle.write(content)
        temporary = Path(handle.name)
    temporary.replace(path)


def technology_symbols() -> list[str]:
    universe = load(ROOT / "data" / "research-universe-sector-balanced-80.json", {})
    categories = universe.get("category_metadata", {})
    return list(dict.fromkeys(categories.get("core_technology", []) + categories.get("semiconductors", [])))


def _provider_payload(as_of: str, provider_fetcher: Callable | None = None, *, provider_name: str = "free") -> dict:
    if provider_fetcher is None:
        if provider_name == "octagon":
            from .providers.octagon_data import fetch_research_payload
        else:
            from .providers.free_public_data import fetch_research_payload
        provider_fetcher = fetch_research_payload
    return provider_fetcher(technology_symbols(), as_of=as_of)


def _shadow_snapshot(result: dict) -> dict:
    return {
        "as_of": result["as_of"],
        "input_hash": result["input_hash"],
        "candidate_count": len(result["candidates"]),
        "candidates": [
            {
                "ticker": candidate["ticker"],
                "status": candidate["status"],
                "composite_score": candidate["composite_score"],
                "leave_one_out_floor": candidate["leave_one_out_floor"],
            }
            for candidate in result["candidates"]
        ],
    }


def backfill_outcomes(observations: list[dict], prices_payload: dict) -> list[dict]:
    prices = prices_payload.get("symbols", {}) if isinstance(prices_payload, dict) else {}
    benchmark_rows = normalized_rows(prices.get("QQQ", {}))
    output = []
    for observation in observations:
        as_of = observation.get("as_of", "")
        for position, candidate in enumerate(observation.get("candidates", []), start=1):
            ticker = str(candidate.get("ticker", ""))
            rows = normalized_rows(prices.get(ticker, {}))
            output.append({
                "observation_as_of": as_of,
                "ticker": ticker,
                "as_of_rank": position,
                "status": candidate.get("status"),
                "input_hash": observation.get("input_hash"),
                "horizons": {str(week): horizon_outcome(rows, benchmark_rows, as_of, week) for week in (1, 4, 12)},
            })
    return output


def _write_shadow(output_dir: Path, result: dict, config: dict) -> dict:
    shadow_dir = output_dir / "shadow"
    observations_payload = load(shadow_dir / "observations.json", {"schema_version": SCHEMA_VERSION, "research_only": True, "observations": []})
    observations = list(observations_payload.get("observations", []))
    snapshot = _shadow_snapshot(result)
    if not any(str(row.get("as_of", ""))[:10] == str(snapshot["as_of"])[:10] for row in observations):
        observations.append(snapshot)
    prices_payload = load(ROOT / "data" / "research-prices-sector-balanced-80.json", {})
    outcomes = backfill_outcomes(observations, prices_payload)
    gate = maturity(
        observations,
        outcomes,
        min_observations=config["shadow"]["min_observations"],
        min_calendar_weeks=config["shadow"]["min_calendar_weeks"],
        min_complete=config["shadow"]["min_complete_matured"],
    )
    atomic_json(shadow_dir / "observations.json", {"schema_version": SCHEMA_VERSION, "research_only": True, "observations": observations})
    atomic_json(shadow_dir / "outcomes.json", {
        "schema_version": SCHEMA_VERSION, "research_only": True, "benchmark": "QQQ",
        "false_positive_definition": "成熟候选相对 QQQ 收益不大于 0",
        "outcomes": outcomes, "maturity": gate,
    })
    governance = {
        "schema_version": SCHEMA_VERSION,
        "research_only": True,
        **gate,
        "live_promotion_eligible": False,
        "manual_review_eligible": gate["status"] == "mature",
        "reason": "Shadow 样本尚未满足人工复核门槛" if gate["status"] != "mature" else "仅可进入人工复核，永不自动晋级",
    }
    atomic_json(shadow_dir / "governance-report.json", governance)
    return governance


def _markdown(result: dict, governance: dict) -> str:
    lines = [
        "# 潜力股研究", "", "仅供候选研究，不代表买入建议，不参与本周定投计算。", "",
        f"- 生成时间：`{result['as_of']}`",
        f"- 候选数量：`{len(result['candidates'])}`",
        f"- Shadow 状态：`{governance['status']}`", "",
    ]
    for candidate in result["candidates"]:
        lines.append(f"- `{candidate['ticker']}`：{candidate['status']}，综合分 {candidate['composite_score']:.1f}，剔除单源最低 {candidate['leave_one_out_floor']:.1f}")
    if not result["candidates"]:
        lines.append("当前没有通过数据和研究门禁的候选。")
    lines.append("")
    return "\n".join(lines)


def run(
    input_path: Path | None,
    output_dir: Path,
    as_of: str | None = None,
    *,
    provider_fetcher: Callable | None = None,
    provider_name: str = "free",
) -> dict:
    config = load(ROOT / "research" / "idea_engine" / "config.v1.json", {})
    frozen_at = as_of or datetime.now(timezone.utc).isoformat()
    if input_path is not None:
        payload = load(input_path, {})
    else:
        payload = _provider_payload(frozen_at, provider_fetcher, provider_name=provider_name)

    candidates = []
    rejected = []
    if isinstance(payload, dict) and payload.get("universe_rows"):
        accepted, rejected = filter_universe(payload["universe_rows"], config)
        by_ticker = {str(row.get("ticker", "")).upper(): row for row in payload.get("candidates", [])}
        for row in accepted:
            raw = by_ticker.get(str(row.get("ticker", "")).upper())
            if raw:
                candidates.append(arbitrate(raw, config, as_of=frozen_at))
    for candidate in candidates:
        validate_candidate(candidate)

    ranked_candidates = sorted(candidates, key=lambda item: (-item["composite_score"], item["ticker"]))
    max_candidates = int(config.get("output", {}).get("max_candidates", 10))
    result = {
        "schema_version": SCHEMA_VERSION, "generated_at": frozen_at, "as_of": frozen_at,
        "research_only": True, "universe": config["universe"], "input_hash": input_hash(payload),
        "candidates": ranked_candidates[:max_candidates],
        "status": "ready" if candidates else "blocked", "manual_review_only": True,
        "screened_candidate_count": len(ranked_candidates),
        "displayed_candidate_limit": max_candidates,
        "active_provider": str(payload.get("provider", "manual_import")),
        "source_scope": "free_public_data" if payload.get("provider") == "free_public_data" else "optional_or_manual",
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    atomic_json(output_dir / "latest-candidates.json", result)
    atomic_json(output_dir / "rejected-candidates.json", {"schema_version": SCHEMA_VERSION, "as_of": frozen_at, "research_only": True, "items": rejected})
    provider = str(payload.get("provider", "manual_import"))
    atomic_json(output_dir / "provider-status.json", {
        "schema_version": SCHEMA_VERSION, "as_of": frozen_at, "research_only": True,
        "status": "ready" if payload.get("universe_rows") else "blocked",
        "active_provider": provider,
        "failure_count": len(payload.get("failures", [])),
        "providers": {
            "anthropic": "reference_method_applied", "serenity": "reference_method_applied",
            "juglar": "reference_method_applied",
            "sec_edgar": "public_api_no_key" if provider == "free_public_data" else "not_active",
            "yahoo_chart": "public_chart_no_key" if provider == "free_public_data" else "not_active",
            "octagon": "optional_paid_api_active" if provider == "octagon" else "optional_paid_api_disabled",
        },
    })
    governance = _write_shadow(output_dir, result, config)
    atomic_text(output_dir / "latest-candidates.md", _markdown(result, governance))
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path, default=RESULTS)
    parser.add_argument("--as-of", default="")
    parser.add_argument("--provider", choices=("free", "octagon"), default="free")
    args = parser.parse_args()
    result = run(args.input, args.output, args.as_of or None, provider_name=args.provider)
    print(f"idea_engine_status={result['status']}")


if __name__ == "__main__":
    main()
