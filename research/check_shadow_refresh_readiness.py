"""Read-only Phase 6 shadow observation readiness check.

This helper prints the current governance state. It does not fetch prices,
run observations, write files, or change dashboard data.
"""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
GOVERNANCE_FILE = ROOT / "research" / "shadow_observation_governance.json"
REPORT_FILE = ROOT / "research" / "results" / "phase6s" / "shadow-observation-governance-report.json"


def load_json(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"Missing required file: {path}")
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def main() -> None:
    governance = load_json(GOVERNANCE_FILE)
    report = load_json(REPORT_FILE)

    runs = report.get("observationRunsAvailable", 0)
    minimum_runs = governance.get("minimum_observation_runs_before_review", 8)
    human_gate = bool(report.get("anyCandidateEligibleForHumanReview", False))
    live_blocked = not bool(report.get("eligibleForLivePromotion", False))

    print(f"observation_runs_available={runs}")
    print(f"minimum_observation_runs_required={minimum_runs}")
    print(f"human_review_gate_met={human_gate}")
    print(f"live_promotion_blocked={live_blocked}")
    print("read_only_helper=True")
    print("files_modified=False")


if __name__ == "__main__":
    main()
