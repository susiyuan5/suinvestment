"""Fast static contracts for the dashboard shell and shipped JavaScript files."""

from __future__ import annotations

import re
import subprocess
import sys
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / "index.html"
DETAIL_HTML = ROOT / "stock-detail.html"
JS_FILES = tuple(sorted([*ROOT.glob("*.js"), *(ROOT / "scripts").glob("*.mjs")]))
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
    "inlineHoldingsMeta",
    "inlineHoldingsSyncState",
    "inlineHoldingsAsOf",
    "inlineHoldingsAccounts",
    "inlineHoldingsCurrencies",
    "inlineHoldingsSettingsBtn",
    "displayCurrencySelect",
    "displayCurrencyNote",
    "displayCurrencyStatus",
    "ideaEnginePanel",
    "ideaEngineStatus",
    "ideaEngineMaturity",
    "ideaEngineRows",
    "ideaEngineStatusFilter",
    "ideaEngineIndustryFilter",
    "ideaEngineTypeFilter",
    "ideaEngineFitFilter",
    "ideaEngineSort",
    "ideaEngineClearFilters",
}
REQUIRED_PRE_APP_SCRIPTS = {
    "market-data.js", "market-analysis.js", "signal-engine.js", "portfolio-policy.js",
    "backtest-engine.js", "dca-policy.js", "settings-storage.js",
    "holdings-detail-model.js",
}
DETAIL_REQUIRED_IDS = {
    "stockDetailStatus", "stockDetailContent", "stockDetailTicker", "stockDetailCompanyName",
    "stockDetailPrice", "stockDetailChart", "stockDetailChartSummary", "stockDetailCompanyFacts",
    "stockDetailResearchTitle", "stockDetailEvidence", "stockDetailAddWatchlist",
    "stockDetailV3Research", "stockDetailV3Questions", "stockDetailV3Contributions", "stockDetailV3Gates",
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

    detail_source = DETAIL_HTML.read_text(encoding="utf-8") if DETAIL_HTML.exists() else ""
    detail_identifiers = re.findall(r'\bid=["\']([^"\']+)', detail_source)
    detail_duplicates = sorted(identifier for identifier, count in Counter(detail_identifiers).items() if count > 1)
    detail_missing = sorted(DETAIL_REQUIRED_IDS - set(detail_identifiers))
    if detail_source.lower().count("<!doctype html>") != 1:
        problems.append("stock-detail.html must contain exactly one HTML doctype")
    if detail_duplicates:
        problems.append(f"stock-detail.html duplicate ids: {', '.join(detail_duplicates)}")
    if detail_missing:
        problems.append(f"stock-detail.html missing required ids: {', '.join(detail_missing)}")
    detail_scripts = [value.split("?", 1)[0] for value in re.findall(r'<script[^>]+src=["\']([^"\']+)', detail_source)]
    if detail_scripts[-2:] != ["idea-engine.js", "stock-detail.js"]:
        problems.append("stock-detail.html must load idea-engine.js before stock-detail.js")
    scripts = [value.split("?", 1)[0] for value in re.findall(r'<script[^>]+src=["\']([^"\']+)', source)]
    if "app.js" not in scripts:
        problems.append("index.html must load app.js")
    else:
        app_index = scripts.index("app.js")
        missing_modules = sorted(REQUIRED_PRE_APP_SCRIPTS - set(scripts[:app_index]))
        if missing_modules:
            problems.append(f"required modules must load before app.js: {', '.join(missing_modules)}")

    for file_path in JS_FILES:
        relative = file_path.relative_to(ROOT)
        completed = subprocess.run(["node", "--check", str(relative)], cwd=ROOT, text=True, capture_output=True)
        if completed.returncode:
            problems.append(f"{relative} syntax failed: {completed.stderr.strip()}")

    if problems:
        print("Static contract check failed:", file=sys.stderr)
        print("\n".join(f"- {problem}" for problem in problems), file=sys.stderr)
        return 1

    print(f"Static contracts passed: {len(identifiers) + len(detail_identifiers)} unique ids across both pages; {len(JS_FILES)} JavaScript files checked.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
