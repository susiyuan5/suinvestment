"""Validate Phase 6 shadow observation archive integrity.

This command is research-only. It checks archive files and counts without
rerunning observations, fetching prices, promoting symbols, or changing live
dashboard behavior.
"""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HISTORY_DIR = ROOT / "research" / "results" / "phase6s" / "history"
MANIFEST_FILE = HISTORY_DIR / "shadow-observation-history-manifest.json"
GOVERNANCE_REPORT = ROOT / "research" / "results" / "phase6s" / "shadow-observation-governance-report.json"
REPORT_FILE = HISTORY_DIR / "shadow-observation-archive-validation-report.json"
SUMMARY_FILE = HISTORY_DIR / "shadow-observation-archive-validation-summary.md"

REQUIRED_ARCHIVE_FILES = [
    "shadow-observation-log.json",
    "shadow-observation-log.csv",
    "shadow-observation-validation-report.json",
    "shadow-observation-governance-report.json",
    "shadow-observation-governance-summary.md",
]


def load_json(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"Missing required file: {path}")
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def main() -> None:
    manifest = load_json(MANIFEST_FILE)
    governance = load_json(GOVERNANCE_REPORT) if GOVERNANCE_REPORT.exists() else {}
    entries = manifest.get("entries", [])
    folders = [
        path for path in HISTORY_DIR.iterdir()
        if path.is_dir()
    ] if HISTORY_DIR.exists() else []

    timestamps = [entry.get("observationTimestamp") for entry in entries if entry.get("observationTimestamp")]
    timestamp_counts = Counter(timestamps)
    actual_duplicate_timestamps = sorted([timestamp for timestamp, count in timestamp_counts.items() if count > 1])
    manifest_duplicate_timestamps = sorted(set(manifest.get("duplicateObservationTimestamps", [])))
    unique_timestamps = sorted(set(timestamps))
    latest_timestamp = unique_timestamps[-1] if unique_timestamps else None

    missing_files: list[str] = []
    folder_mismatches: list[str] = []
    invalid_entries: list[str] = []
    for entry in entries:
        folder = ROOT / entry.get("archiveFolder", "")
        if not folder.exists() or not folder.is_dir():
            folder_mismatches.append(str(folder.relative_to(ROOT)) if folder.exists() else entry.get("archiveFolder", "missing"))
            continue
        for filename in REQUIRED_ARCHIVE_FILES:
            required = folder / filename
            if not required.exists():
                missing_files.append(str(required.relative_to(ROOT)).replace("\\", "/"))
        for label, rel_path in entry.get("files", {}).items():
            if not (ROOT / rel_path).exists():
                missing_files.append(f"{label}:{rel_path}")
        observation_file = folder / "shadow-observation-log.json"
        if observation_file.exists():
            observation = load_json(observation_file)
            if observation.get("generatedAt") != entry.get("observationTimestamp"):
                invalid_entries.append(f"timestamp_mismatch:{entry.get('archiveFolder')}")
            if observation.get("monitoredSymbolCount") != entry.get("monitoredSymbolCount"):
                invalid_entries.append(f"symbol_count_mismatch:{entry.get('archiveFolder')}")

    entry_folders = {entry.get("archiveFolder") for entry in entries}
    untracked_folders = sorted(
        str(folder.relative_to(ROOT)).replace("\\", "/")
        for folder in folders
        if str(folder.relative_to(ROOT)).replace("\\", "/") not in entry_folders
    )

    governance_runs = governance.get("observationRunsAvailable", 0)
    minimum_runs = governance.get("governance", {}).get("minimum_observation_runs_before_review", 8)
    governance_count_valid = governance_runs <= len(unique_timestamps) or (
        governance.get("latestSnapshotAlreadyArchived") is False
        and governance_runs <= len(unique_timestamps) + 1
    )
    fake_run_detected = not governance_count_valid or bool(actual_duplicate_timestamps)
    archive_valid = not any([missing_files, folder_mismatches, invalid_entries, untracked_folders, fake_run_detected])

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "researchOnly": True,
        "liveDefaultChanged": False,
        "manualTradePlanChanged": False,
        "archiveValid": archive_valid,
        "archivedObservationCount": len(entries),
        "uniqueObservationTimestampCount": len(unique_timestamps),
        "latestArchivedObservationTimestamp": latest_timestamp,
        "actualDuplicateTimestampCount": len(actual_duplicate_timestamps),
        "actualDuplicateTimestamps": actual_duplicate_timestamps,
        "preventedDuplicateTimestampCount": len(manifest_duplicate_timestamps),
        "preventedDuplicateTimestamps": manifest_duplicate_timestamps,
        "missingArchiveFileCount": len(set(missing_files)),
        "missingArchiveFiles": sorted(set(missing_files)),
        "folderMismatchCount": len(folder_mismatches),
        "folderMismatches": folder_mismatches,
        "untrackedArchiveFolderCount": len(untracked_folders),
        "untrackedArchiveFolders": untracked_folders,
        "invalidEntryCount": len(invalid_entries),
        "invalidEntries": invalid_entries,
        "governanceObservationRuns": governance_runs,
        "minimumObservationRunsRequired": minimum_runs,
        "governanceCountDoesNotExceedRealTimestamps": governance_count_valid,
        "fakeRunDetected": fake_run_detected,
        "humanReviewGateMet": governance.get("anyCandidateEligibleForHumanReview", False),
        "livePromotionBlocked": not bool(governance.get("eligibleForLivePromotion", False)),
    }
    REPORT_FILE.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    lines = [
        "# Shadow Observation Archive Validation Summary",
        "",
        "This validation is research-only. It does not rerun observations, fetch prices, promote symbols, or change live/default behavior.",
        "",
        f"- Archive valid: `{archive_valid}`",
        f"- Archived observation count: `{len(entries)}`",
        f"- Unique observation timestamp count: `{len(unique_timestamps)}`",
        f"- Latest archived observation timestamp: `{latest_timestamp}`",
        f"- Actual duplicate timestamp count: `{len(actual_duplicate_timestamps)}`",
        f"- Prevented duplicate timestamp count: `{len(manifest_duplicate_timestamps)}`",
        f"- Missing archive file count: `{len(set(missing_files))}`",
        f"- Governance observation runs: `{governance_runs}`",
        f"- Minimum observation runs required: `{minimum_runs}`",
        f"- Fake run detected: `{fake_run_detected}`",
        f"- Human-review gate met: `{report['humanReviewGateMet']}`",
        f"- Live promotion blocked: `{report['livePromotionBlocked']}`",
        "",
        "Archive validation is not a promotion signal. Minimum longitudinal evidence and human review remain required.",
    ]
    SUMMARY_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"archive_valid={archive_valid}")
    print(f"archived_observation_count={len(entries)}")
    print(f"unique_observation_timestamp_count={len(unique_timestamps)}")
    print(f"duplicate_timestamp_count={len(actual_duplicate_timestamps)}")
    print(f"prevented_duplicate_timestamp_count={len(manifest_duplicate_timestamps)}")
    print(f"missing_archive_file_count={len(set(missing_files))}")
    print(f"latest_archived_observation_timestamp={latest_timestamp}")
    print(f"governance_observation_runs={governance_runs}")
    print(f"live_promotion_blocked={report['livePromotionBlocked']}")


if __name__ == "__main__":
    main()
