"""Archive the latest Phase 6S shadow observation snapshot.

This is research-only append/archive support. The script copies the latest
observation files into a timestamped history folder, updates a manifest, and
does not fetch prices, run observations, promote symbols, or modify live data.
"""

from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PHASE6S_DIR = ROOT / "research" / "results" / "phase6s"
HISTORY_DIR = PHASE6S_DIR / "history"
MANIFEST_FILE = HISTORY_DIR / "shadow-observation-history-manifest.json"
SUMMARY_FILE = HISTORY_DIR / "shadow-observation-history-summary.md"

LATEST_FILES = {
    "observation_json": "shadow-observation-log.json",
    "observation_csv": "shadow-observation-log.csv",
    "validation_json": "shadow-observation-validation-report.json",
    "governance_json": "shadow-observation-governance-report.json",
    "governance_summary": "shadow-observation-governance-summary.md",
}


def load_json(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"Missing required file: {path}")
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def safe_timestamp(value: str) -> str:
    return (
        value.replace(":", "")
        .replace("-", "")
        .replace(".", "")
        .replace("+", "Z")
        .replace("T", "-")
    )


def load_manifest() -> dict:
    if MANIFEST_FILE.exists():
        return load_json(MANIFEST_FILE)
    return {
        "generatedAt": None,
        "researchOnly": True,
        "liveDefaultChanged": False,
        "manualTradePlanChanged": False,
        "entries": [],
        "duplicateObservationTimestamps": [],
        "warnings": [],
    }


def write_manifest(manifest: dict) -> None:
    manifest["generatedAt"] = datetime.now(timezone.utc).isoformat()
    MANIFEST_FILE.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def validate_entry_files(entry: dict) -> list[str]:
    warnings: list[str] = []
    for label, rel_path in entry.get("files", {}).items():
        if not (ROOT / rel_path).exists():
            warnings.append(f"missing_archive_file:{label}:{rel_path}")
    return warnings


def write_summary(manifest: dict) -> None:
    entries = manifest.get("entries", [])
    unique_timestamps = sorted({entry["observationTimestamp"] for entry in entries})
    latest_timestamp = unique_timestamps[-1] if unique_timestamps else "none"
    lines = [
        "# Shadow Observation History Summary",
        "",
        "This archive is research-only longitudinal evidence. It is not a promotion signal and does not affect live/default behavior.",
        "",
        f"- Archived observation count: `{len(entries)}`",
        f"- Unique observation timestamp count: `{len(unique_timestamps)}`",
        f"- Latest archived observation timestamp: `{latest_timestamp}`",
        f"- Duplicate observation timestamps: `{', '.join(manifest.get('duplicateObservationTimestamps', [])) or 'none'}`",
        f"- Warnings: `{', '.join(manifest.get('warnings', [])) or 'none'}`",
        "",
        "## Entries",
        "",
    ]
    for entry in entries:
        lines.append(
            f"- `{entry['observationTimestamp']}`: {entry['monitoredSymbolCount']} symbols, "
            f"folder `{entry['archiveFolder']}`"
        )
    lines += [
        "",
        "Minimum 8 real observation runs and 8 calendar weeks are still required before human review. Live promotion is never automatic.",
    ]
    SUMMARY_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    observation = load_json(PHASE6S_DIR / LATEST_FILES["observation_json"])
    governance = load_json(PHASE6S_DIR / LATEST_FILES["governance_json"])
    validation = load_json(PHASE6S_DIR / LATEST_FILES["validation_json"])

    observation_timestamp = observation.get("generatedAt")
    if not observation_timestamp:
        raise ValueError("Latest observation log is missing generatedAt.")

    manifest = load_manifest()
    existing = {
        entry["observationTimestamp"]: entry
        for entry in manifest.get("entries", [])
    }

    duplicate_prevented = False
    if observation_timestamp in existing:
        duplicate_prevented = True
        if observation_timestamp not in manifest.setdefault("duplicateObservationTimestamps", []):
            manifest["duplicateObservationTimestamps"].append(observation_timestamp)
    else:
        archive_folder = HISTORY_DIR / safe_timestamp(observation_timestamp)
        archive_folder.mkdir(parents=True, exist_ok=True)
        copied_files: dict[str, str] = {}
        for label, filename in LATEST_FILES.items():
            source = PHASE6S_DIR / filename
            if not source.exists():
                raise FileNotFoundError(f"Missing required latest snapshot file: {source}")
            target = archive_folder / filename
            shutil.copy2(source, target)
            copied_files[label] = str(target.relative_to(ROOT)).replace("\\", "/")

        entry = {
            "archivedAt": datetime.now(timezone.utc).isoformat(),
            "observationTimestamp": observation_timestamp,
            "latestObservationDate": governance.get("latestObservationDate"),
            "monitoredSymbolCount": observation.get("monitoredSymbolCount"),
            "statusCounts": observation.get("statusCounts", {}),
            "candidateReviewStatusCounts": governance.get("candidateReviewStatusCounts", {}),
            "anyCandidateEligibleForHumanReview": governance.get("anyCandidateEligibleForHumanReview", False),
            "eligibleForLivePromotion": False,
            "validationPassed": validation.get("passed"),
            "archiveFolder": str(archive_folder.relative_to(ROOT)).replace("\\", "/"),
            "files": copied_files,
        }
        manifest.setdefault("entries", []).append(entry)

    warnings: list[str] = []
    seen: set[str] = set()
    duplicates: set[str] = set()
    symbol_counts: set[int] = set()
    for entry in manifest.get("entries", []):
        timestamp = entry.get("observationTimestamp")
        if timestamp in seen:
            duplicates.add(timestamp)
        seen.add(timestamp)
        if entry.get("monitoredSymbolCount") is not None:
            symbol_counts.add(int(entry["monitoredSymbolCount"]))
        warnings.extend(validate_entry_files(entry))
    if len(symbol_counts) > 1:
        warnings.append(f"inconsistent_monitored_symbol_counts:{sorted(symbol_counts)}")
    manifest["duplicateObservationTimestamps"] = sorted(set(manifest.get("duplicateObservationTimestamps", [])) | duplicates)
    manifest["warnings"] = sorted(set(warnings))

    write_manifest(manifest)
    write_summary(manifest)

    print(f"archived_observation_count={len(manifest.get('entries', []))}")
    print(f"unique_observation_timestamp_count={len({entry['observationTimestamp'] for entry in manifest.get('entries', [])})}")
    print(f"latest_observation_timestamp={observation_timestamp}")
    print(f"duplicate_archive_prevented={duplicate_prevented}")
    print(f"warnings={manifest['warnings']}")
    print("live_default_changed=False")


if __name__ == "__main__":
    main()
