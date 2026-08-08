"""Run a safe, versioned, Shadow-only Idea Engine freeze."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from .arbitration import arbitrate
from .contracts import SCHEMA_VERSION, validate_candidate
from .evidence import input_hash
from .universe import filter_universe


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


def run(input_path: Path | None, output_dir: Path, as_of: str | None = None) -> dict:
    config = load(ROOT / "research" / "idea_engine" / "config.v1.json", {})
    existing = load(output_dir / "latest-candidates.json", None)
    if input_path is None and isinstance(existing, dict) and existing.get("schema_version") == SCHEMA_VERSION:
        # A scheduled run without a freshly audited provider payload is a no-op;
        # do not rewrite timestamps or pretend that stale data is current.
        return existing
    payload = load(input_path, {}) if input_path else {}
    frozen_at = as_of or datetime.now(timezone.utc).isoformat()
    candidates = []
    rejected = []
    if isinstance(payload, dict) and payload.get("universe_rows"):
        accepted, rejected = filter_universe(payload["universe_rows"], config)
        by_ticker = {row.get("ticker"): row for row in payload.get("candidates", [])}
        for row in accepted:
            raw = by_ticker.get(row.get("ticker"))
            if raw:
                candidates.append(arbitrate(raw, config, as_of=frozen_at))
    for candidate in candidates:
        validate_candidate(candidate)
    result = {"schema_version": SCHEMA_VERSION, "generated_at": frozen_at, "as_of": frozen_at, "research_only": True, "universe": config["universe"], "input_hash": input_hash(payload), "candidates": sorted(candidates, key=lambda item: (-item["composite_score"], item["ticker"])), "status": "ready" if candidates else "blocked", "manual_review_only": True}
    output_dir.mkdir(parents=True, exist_ok=True)
    atomic_json(output_dir / "latest-candidates.json", result)
    atomic_json(output_dir / "rejected-candidates.json", {"schema_version": SCHEMA_VERSION, "as_of": frozen_at, "research_only": True, "items": rejected})
    atomic_json(output_dir / "provider-status.json", {"schema_version": SCHEMA_VERSION, "as_of": frozen_at, "research_only": True, "status": "manual_import_required", "providers": {"anthropic": "recall_only_not_configured", "serenity": "not_configured", "juglar": "not_configured", "octagon": "manual_schema_validated_json_only"}})
    shadow_dir = output_dir / "shadow"
    atomic_json(shadow_dir / "observations.json", {"schema_version": SCHEMA_VERSION, "research_only": True, "observations": []})
    atomic_json(shadow_dir / "outcomes.json", {"schema_version": SCHEMA_VERSION, "research_only": True, "outcomes": [], "maturity": {"status": "not_mature", "minimum_observations": config["shadow"]["min_observations"], "minimum_calendar_weeks": config["shadow"]["min_calendar_weeks"], "minimum_complete": config["shadow"]["min_complete_matured"]}})
    atomic_json(shadow_dir / "governance-report.json", {"schema_version": SCHEMA_VERSION, "research_only": True, "status": "not_mature", "live_promotion_eligible": False, "reason": "Shadow 观察样本不足"})
    (output_dir / "latest-candidates.md").write_text("# 潜力股研究\n\n仅供候选研究，不代表买入建议，不参与本周定投计算。\n\n当前无可用的正式候选数据；请人工复核数据源。\n", encoding="utf-8")
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path, default=RESULTS)
    parser.add_argument("--as-of", default="")
    args = parser.parse_args()
    result = run(args.input, args.output, args.as_of or None)
    print(f"idea_engine_status={result['status']}")


if __name__ == "__main__":
    main()
