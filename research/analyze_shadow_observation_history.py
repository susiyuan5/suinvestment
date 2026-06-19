"""Phase 6T governance review for shadow observation history.

The review is research-only. It never outputs live promotion eligibility and
does not modify dashboard, portfolio, or trade-plan data.
"""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
GOVERNANCE_FILE = ROOT / "research" / "shadow_observation_governance.json"
OBSERVATION_FILE = ROOT / "research" / "results" / "phase6s" / "shadow-observation-log.json"
VALIDATION_FILE = ROOT / "research" / "results" / "phase6s" / "shadow-observation-validation-report.json"
OUT_DIR = ROOT / "research" / "results" / "phase6s"
HISTORY_MANIFEST_FILE = OUT_DIR / "history" / "shadow-observation-history-manifest.json"


def load_json(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"Missing required file: {path}")
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    normalized = value.replace("Z", "+00:00")
    return datetime.fromisoformat(normalized)


def load_history_manifest() -> dict:
    if HISTORY_MANIFEST_FILE.exists():
        return load_json(HISTORY_MANIFEST_FILE)
    return {"entries": [], "warnings": [], "duplicateObservationTimestamps": []}


def candidate_status(
    observation_count: int,
    calendar_weeks: float,
    risk_warnings: int,
    missing_data: int,
    degraded: int,
    governance: dict,
) -> str:
    if observation_count < int(governance["minimum_observation_runs_before_review"]):
        return "not_enough_observation_history"
    if calendar_weeks < float(governance["minimum_calendar_weeks_before_review"]):
        return "not_enough_calendar_history"
    if risk_warnings > int(governance["maximum_allowed_risk_warning_count"]):
        return "blocked_by_risk_warning"
    if degraded > int(governance["maximum_allowed_candidate_degraded_count"]):
        return "blocked_by_degradation"
    if missing_data > int(governance["maximum_allowed_missing_data_count"]):
        return "blocked_by_missing_data"
    return "eligible_for_human_review_only"


def main() -> None:
    governance = load_json(GOVERNANCE_FILE)
    observation_log = load_json(OBSERVATION_FILE)
    validation = load_json(VALIDATION_FILE) if VALIDATION_FILE.exists() else {}
    history_manifest = load_history_manifest()

    observations = observation_log.get("observations", [])
    if not observations:
        raise ValueError("No Phase 6S observations found.")

    generated_at = observation_log.get("generatedAt")
    latest_observation_date = generated_at
    latest_snapshot_timestamps = {row.get("observation_date") for row in observations if row.get("observation_date")}
    archived_timestamps = {
        entry.get("observationTimestamp")
        for entry in history_manifest.get("entries", [])
        if entry.get("observationTimestamp")
    }
    observation_dates = sorted(archived_timestamps | latest_snapshot_timestamps)
    observation_runs_available = len(observation_dates)
    unique_symbols = sorted({row["symbol"] for row in observations})
    status_counts = Counter(row.get("monitoring_status", "unknown") for row in observations)
    risk_warning_count = sum(1 for row in observations if row.get("risk_gate_status") == "warning")
    degraded_count = status_counts.get("candidate_degraded", 0)
    improved_count = status_counts.get("candidate_improved", 0)
    missing_data_count = sum(1 for row in observations if row.get("missing_price_warning") or not row.get("price_available"))
    latest_already_archived = generated_at in archived_timestamps

    first_dt = parse_date(observation_dates[0]) if observation_dates else None
    latest_dt = parse_date(observation_dates[-1]) if observation_dates else None
    calendar_weeks = 0.0
    if first_dt and latest_dt:
        calendar_weeks = max(0.0, (latest_dt - first_dt).days / 7)

    symbol_statuses = {}
    status_summary = Counter()
    for symbol in unique_symbols:
        rows = [row for row in observations if row["symbol"] == symbol]
        symbol_risk = sum(1 for row in rows if row.get("risk_gate_status") == "warning")
        symbol_missing = sum(1 for row in rows if row.get("missing_price_warning") or not row.get("price_available"))
        symbol_degraded = sum(1 for row in rows if row.get("monitoring_status") == "candidate_degraded")
        status = candidate_status(
            observation_count=observation_runs_available,
            calendar_weeks=calendar_weeks,
            risk_warnings=symbol_risk,
            missing_data=symbol_missing,
            degraded=symbol_degraded,
            governance=governance,
        )
        symbol_statuses[symbol] = {
            "candidate_review_status": status,
            "observation_runs_available": observation_runs_available,
            "risk_warning_count": symbol_risk,
            "missing_data_count": symbol_missing,
            "candidate_degraded_count": symbol_degraded,
            "eligible_for_live_promotion": False,
        }
        status_summary[status] += 1

    minimum_runs_met = observation_runs_available >= int(governance["minimum_observation_runs_before_review"])
    minimum_weeks_met = calendar_weeks >= float(governance["minimum_calendar_weeks_before_review"])
    eligible_human_review = [
        symbol for symbol, data in symbol_statuses.items()
        if data["candidate_review_status"] == "eligible_for_human_review_only"
    ]

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "Phase 6T shadow observation governance review",
        "researchOnly": True,
        "liveDefaultChanged": False,
        "manualTradePlanChanged": False,
        "eligibleForLivePromotion": False,
        "governance": governance,
        "observationRunsAvailable": observation_runs_available,
        "uniqueMonitoredSymbolCount": len(unique_symbols),
        "latestObservationDate": latest_observation_date,
        "calendarWeeksAvailable": round(calendar_weeks, 4),
        "statusCounts": dict(status_counts),
        "riskWarningCount": risk_warning_count,
        "candidateDegradedCount": degraded_count,
        "candidateImprovedCount": improved_count,
        "missingDataCount": missing_data_count,
        "minimumRunCountMet": minimum_runs_met,
        "minimumCalendarWeeksMet": minimum_weeks_met,
        "anyCandidateEligibleForHumanReview": bool(eligible_human_review),
        "eligibleHumanReviewSymbols": eligible_human_review,
        "candidateReviewStatusCounts": dict(status_summary),
        "candidateStatuses": symbol_statuses,
        "validationSourcePassed": validation.get("passed"),
        "historyManifestFound": HISTORY_MANIFEST_FILE.exists(),
        "archivedObservationCount": len(history_manifest.get("entries", [])),
        "uniqueArchivedObservationTimestampCount": len(archived_timestamps),
        "latestSnapshotAlreadyArchived": latest_already_archived,
        "historyWarnings": history_manifest.get("warnings", []),
        "duplicateObservationTimestamps": history_manifest.get("duplicateObservationTimestamps", []),
        "explicitStatement": "No candidate is eligible for human review with only one observation run. No candidate is eligible for live promotion from this report.",
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    report_path = OUT_DIR / "shadow-observation-governance-report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    lines = [
        "# Phase 6T Shadow Observation Governance Summary",
        "",
        "Shadow observation is research-only. No live promotion is allowed from this report or from the sandbox screen.",
        "",
        "## Governance Gates",
        "",
        f"- Observation runs available: `{observation_runs_available}`",
        f"- Archived observation snapshots: `{len(history_manifest.get('entries', []))}`",
        f"- Latest snapshot already archived: `{latest_already_archived}`",
        f"- Minimum required runs before human review: `{governance['minimum_observation_runs_before_review']}`",
        f"- Calendar weeks available: `{round(calendar_weeks, 2)}`",
        f"- Minimum required calendar weeks: `{governance['minimum_calendar_weeks_before_review']}`",
        f"- Minimum run count met: `{minimum_runs_met}`",
        f"- Minimum calendar weeks met: `{minimum_weeks_met}`",
        f"- Risk warning count: `{risk_warning_count}`",
        f"- Missing data count: `{missing_data_count}`",
        f"- Candidate degraded count: `{degraded_count}`",
        f"- History warnings: `{', '.join(history_manifest.get('warnings', [])) or 'none'}`",
        "",
        "## Review Eligibility",
        "",
        f"- Any candidate eligible for human review: `{bool(eligible_human_review)}`",
        "- Any candidate eligible for live promotion: `False`",
        "",
        "## Candidate Review Status Counts",
        "",
    ]
    for status, count in sorted(status_summary.items()):
        lines.append(f"- `{status}`: `{count}`")
    lines += [
        "",
        "## Interpretation",
        "",
        "A single clean observation is not enough. Candidates require longitudinal evidence across multiple runs and calendar weeks before they can even be considered for human review.",
    ]
    summary_path = OUT_DIR / "shadow-observation-governance-summary.md"
    summary_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"observation_runs_available={observation_runs_available}")
    print(f"minimum_required_runs={governance['minimum_observation_runs_before_review']}")
    print(f"unique_monitored_symbols={len(unique_symbols)}")
    print(f"latest_observation_date={latest_observation_date}")
    print(f"candidate_review_status_counts={dict(status_summary)}")
    print(f"any_candidate_eligible_for_human_review={bool(eligible_human_review)}")
    print("any_candidate_eligible_for_live_promotion=False")


if __name__ == "__main__":
    main()
