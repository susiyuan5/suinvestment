"""Generate a research-only monthly shadow observation review report.

This command only reads existing readiness, governance, archive, and history
files. It never runs observations, fetches prices, archives snapshots, promotes
symbols, or changes live dashboard data.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PHASE6S = ROOT / "research" / "results" / "phase6s"
HISTORY = PHASE6S / "history"

GOVERNANCE_CONFIG = ROOT / "research" / "shadow_observation_governance.json"
GOVERNANCE_REPORT = PHASE6S / "shadow-observation-governance-report.json"
ARCHIVE_VALIDATION = HISTORY / "shadow-observation-archive-validation-report.json"
HISTORY_MANIFEST = HISTORY / "shadow-observation-history-manifest.json"
OUT_JSON = PHASE6S / "shadow-monthly-review-report.json"
OUT_MD = PHASE6S / "shadow-monthly-review-summary.md"


def load_json(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"Missing required file: {path}")
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def main() -> None:
    governance_config = load_json(GOVERNANCE_CONFIG)
    governance = load_json(GOVERNANCE_REPORT)
    archive = load_json(ARCHIVE_VALIDATION)
    manifest = load_json(HISTORY_MANIFEST)

    generated_at = datetime.now(timezone.utc).isoformat()
    observation_runs = governance.get("observationRunsAvailable", 0)
    minimum_runs = governance_config.get("minimum_observation_runs_before_review", 8)
    minimum_weeks = governance_config.get("minimum_calendar_weeks_before_review", 8)
    human_review_eligible = bool(governance.get("anyCandidateEligibleForHumanReview", False))
    live_promotion_eligible = False
    live_promotion_blocked = not bool(governance.get("eligibleForLivePromotion", False))
    blockers: list[str] = []

    if observation_runs < minimum_runs:
        blockers.append("not_enough_observation_runs")
    if not governance.get("minimumCalendarWeeksMet", False):
        blockers.append("not_enough_calendar_weeks")
    if governance.get("sameDayRunCount", 0) > 0:
        blockers.append("same_day_validation_runs_detected")
    if governance.get("tooSoonRunCount", 0) > 0:
        blockers.append("too_soon_observation_runs")
    if governance.get("riskWarningCount", 0) > governance_config.get("maximum_allowed_risk_warning_count", 0):
        blockers.append("risk_warning_count")
    if governance.get("missingDataCount", 0) > governance_config.get("maximum_allowed_missing_data_count", 0):
        blockers.append("missing_data_count")
    if governance.get("candidateDegradedCount", 0) > governance_config.get("maximum_allowed_candidate_degraded_count", 0):
        blockers.append("candidate_degraded_count")
    if not archive.get("archiveValid", False):
        blockers.append("archive_integrity_not_valid")

    next_action = (
        "Continue monthly/manual observation across real calendar time until at least 8 unique observation runs "
        "and 8 calendar weeks are available. Do not treat repeated same-day runs as monthly evidence."
    )

    report = {
        "generatedAt": generated_at,
        "researchOnly": True,
        "liveDefaultChanged": False,
        "manualTradePlanChanged": False,
        "latestObservationTimestamp": governance.get("latestObservationDate"),
        "observationRunsAvailable": observation_runs,
        "minimumObservationRunsRequired": minimum_runs,
        "minimumCalendarWeeksRequired": minimum_weeks,
        "calendarWeeksAvailable": governance.get("calendarWeeksAvailable"),
        "uniqueObservationDateCount": governance.get("uniqueObservationDateCount"),
        "calendarSpanDays": governance.get("calendarSpanDays"),
        "calendarSpanWeeks": governance.get("calendarSpanWeeks"),
        "calendarRequirementMet": governance.get("calendarRequirementMet"),
        "sameDayRunCount": governance.get("sameDayRunCount"),
        "tooSoonRunCount": governance.get("tooSoonRunCount"),
        "cadenceWarningCount": governance.get("cadenceWarningCount"),
        "cadenceStatus": governance.get("cadenceStatus"),
        "sameDayRunWarning": governance.get("sameDayRunCount", 0) > 0,
        "includesSameDayValidationRuns": governance.get("sameDayRunCount", 0) > 0,
        "monitoredSymbolCount": governance.get("uniqueMonitoredSymbolCount"),
        "governanceStatusSummary": governance.get("candidateReviewStatusCounts", {}),
        "archiveValidationStatus": "valid" if archive.get("archiveValid") else "review_required",
        "archivedObservationCount": archive.get("archivedObservationCount"),
        "uniqueObservationTimestampCount": archive.get("uniqueObservationTimestampCount"),
        "duplicateTimestampCount": archive.get("actualDuplicateTimestampCount"),
        "preventedDuplicateTimestampCount": archive.get("preventedDuplicateTimestampCount"),
        "missingArchiveFileCount": archive.get("missingArchiveFileCount"),
        "humanReviewEligibility": human_review_eligible,
        "livePromotionEligibility": live_promotion_eligible,
        "livePromotionBlocked": live_promotion_blocked,
        "humanReviewBlockers": blockers,
        "nextRequiredAction": next_action,
        "historyEntryCount": len(manifest.get("entries", [])),
        "explicitStatement": "No candidate is eligible for live promotion from this report.",
    }
    OUT_JSON.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    lines = [
        "# Shadow Monthly Review Summary",
        "",
        f"Generated: `{generated_at}`",
        "",
        "This report is research-only. It does not rerun observations, fetch prices, archive snapshots, promote symbols, trade, or change live/default behavior.",
        "",
        "## Observation Readiness",
        "",
        f"- Latest observation timestamp: `{report['latestObservationTimestamp']}`",
        f"- Observation runs available: `{observation_runs}`",
        f"- Minimum observation runs required: `{minimum_runs}`",
        f"- Minimum calendar weeks required: `{minimum_weeks}`",
        f"- Calendar weeks available: `{report['calendarWeeksAvailable']}`",
        f"- Unique observation date count: `{report['uniqueObservationDateCount']}`",
        f"- Calendar span days: `{report['calendarSpanDays']}`",
        f"- Calendar span weeks: `{report['calendarSpanWeeks']}`",
        f"- Calendar requirement met: `{report['calendarRequirementMet']}`",
        f"- Same-day run warning: `{report['sameDayRunWarning']}`",
        f"- Cadence status: `{report['cadenceStatus']}`",
        f"- Monitored symbol count: `{report['monitoredSymbolCount']}`",
        "",
        "## Governance",
        "",
    ]
    for status, count in sorted(report["governanceStatusSummary"].items()):
        lines.append(f"- `{status}`: `{count}`")
    lines += [
        "",
        "## Archive Integrity",
        "",
        f"- Archive validation status: `{report['archiveValidationStatus']}`",
        f"- Archived observation count: `{report['archivedObservationCount']}`",
        f"- Unique observation timestamp count: `{report['uniqueObservationTimestampCount']}`",
        f"- Duplicate timestamp count: `{report['duplicateTimestampCount']}`",
        f"- Missing archive file count: `{report['missingArchiveFileCount']}`",
        "",
        "## Eligibility",
        "",
        f"- Human-review eligibility: `{human_review_eligible}`",
        f"- Live-promotion eligibility: `{live_promotion_eligible}`",
        "- No candidate is eligible for live promotion from this report.",
        "",
        "## Blockers",
        "",
        f"- `{', '.join(blockers) if blockers else 'none'}`",
        "",
        "## Next Required Action",
        "",
        next_action,
    ]
    OUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"monthly_review_generated={generated_at}")
    print(f"latest_observation_timestamp={report['latestObservationTimestamp']}")
    print(f"observation_runs_available={observation_runs}")
    print(f"unique_observation_date_count={report['uniqueObservationDateCount']}")
    print(f"calendar_span_days={report['calendarSpanDays']}")
    print(f"calendar_span_weeks={report['calendarSpanWeeks']}")
    print(f"cadence_status={report['cadenceStatus']}")
    print(f"minimum_observation_runs_required={minimum_runs}")
    print(f"monitored_symbol_count={report['monitoredSymbolCount']}")
    print(f"archive_validation_status={report['archiveValidationStatus']}")
    print(f"human_review_eligibility={human_review_eligible}")
    print(f"live_promotion_eligibility={live_promotion_eligible}")
    print(f"next_required_action={next_action}")


if __name__ == "__main__":
    main()
