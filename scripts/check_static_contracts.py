"""Fast static contracts for the dashboard shell and shipped JavaScript files."""

from __future__ import annotations

import re
import subprocess
import sys
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / "index.html"
JS_FILES = tuple(path.name for path in sorted(ROOT.glob("*.js")))
REQUIRED_IDS = {
    "cards",
    "dataQualityPanel",
    "dataQualityWarning",
    "watchlist",
    "watchlistCards",
    "watchlistTickerStrip",
    "watchlistChartSummary",
    "projectHealthStatus",
    "projectHealthDetails",
    "watchlistHealthStatus",
    "decisionSummary",
    "decisionAction",
    "healthHistoryMetrics",
}


def main() -> int:
    source = HTML.read_text(encoding="utf-8")
    identifiers = re.findall(r'\bid=["\']([^"\']+)', source)
    duplicates = sorted(identifier for identifier, count in Counter(identifiers).items() if count > 1)
    missing = sorted(REQUIRED_IDS - set(identifiers))
    problems: list[str] = []

    if source.lower().count("<!doctype html>") != 1:
        problems.append("index.html must contain exactly one HTML doctype")
    if source.lower().count("<html") != 1 or source.lower().count("</html>") != 1:
        problems.append("index.html must contain exactly one html element")
    if duplicates:
        problems.append(f"duplicate ids: {', '.join(duplicates)}")
    if missing:
        problems.append(f"missing required ids: {', '.join(missing)}")

    for file_name in JS_FILES:
        completed = subprocess.run(["node", "--check", file_name], cwd=ROOT, text=True, capture_output=True)
        if completed.returncode:
            problems.append(f"{file_name} syntax failed: {completed.stderr.strip()}")

    if problems:
        print("Static contract check failed:", file=sys.stderr)
        print("\n".join(f"- {problem}" for problem in problems), file=sys.stderr)
        return 1

    print(f"Static contracts passed: {len(identifiers)} unique ids; {len(JS_FILES)} JavaScript files checked.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
