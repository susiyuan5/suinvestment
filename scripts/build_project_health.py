"""Build an atomic, static project-health report for the dashboard and CI."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = {
    "market_update": "update-market-data.yml",
    "historical_update": "update-backtest-prices.yml",
    "quality_checks": "quality.yml",
}
HISTORY_RETENTION_DAYS = 90
HISTORY_FILENAME = "project-health-history.json"
RUNTIME_METRICS_FILENAME = "runtime-metrics.json"


def load(path: Path, fallback=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return fallback


def parse_date(value: object) -> date | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except ValueError:
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None


def workflow_statuses(repository: str | None, token: str | None) -> dict:
    if not repository or not token:
        return {key: {"status": "unknown", "conclusion": "unknown"} for key in WORKFLOWS}
    output = {}
    for key, filename in WORKFLOWS.items():
        url = f"https://api.github.com/repos/{repository}/actions/workflows/{filename}/runs?branch=main&per_page=1"
        request = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "User-Agent": "suinvestment-health/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                payload = json.loads(response.read().decode("utf-8"))
            run = (payload.get("workflow_runs") or [{}])[0]
            output[key] = {
                "status": run.get("status", "unknown"),
                "conclusion": run.get("conclusion") or "pending",
                "updated_at": run.get("updated_at"),
                "url": run.get("html_url"),
            }
        except Exception as error:
            output[key] = {"status": "unknown", "conclusion": "unknown", "error": str(error)}
    return output


def build_health(root: Path, *, now: datetime, workflows: dict) -> dict:
    market = load(root / "data" / "market-data.json")
    historical = load(root / "data" / "backtest-prices.json")
    if not isinstance(market, dict) or not isinstance(historical, dict):
        raise ValueError("required market snapshots are missing or invalid")
    issues = []
    market_summary = market.get("summary", {})
    market_generated = parse_date(market.get("generatedAt"))
    market_lag = (now.date() - market_generated).days if market_generated else None
    if market_lag is None or market_lag > 7:
        issues.append("market_snapshot_stale")

    historical_rows = {}
    for symbol in ("QQQ", "SPY"):
        rows = historical.get("symbols", {}).get(symbol, [])
        latest = parse_date(rows[-1].get("date")) if rows and isinstance(rows[-1], dict) else None
        lag = (now.date() - latest).days if latest else None
        historical_rows[symbol] = {"row_count": len(rows), "latest_date": latest.isoformat() if latest else None, "lag_days": lag}
        if len(rows) < 50 or lag is None or lag > 10:
            issues.append(f"{symbol.lower()}_history_unhealthy")

    watchlist_symbols = ("AAPL", "MSFT", "NVDA", "QQQ")
    watchlist_coverage = {}
    for symbol in watchlist_symbols:
        rows = historical.get("symbols", {}).get(symbol, [])
        watchlist_coverage[symbol] = len(rows)
    watchlist_fallback_ready = all(count >= 2 for count in watchlist_coverage.values())
    if not watchlist_fallback_ready:
        issues.append("watchlist_fallback_unavailable")

    for name, status in workflows.items():
        if status.get("conclusion") not in {"success", "neutral"}:
            issues.append(f"workflow_{name}_{status.get('conclusion', 'unknown')}")

    manifest = load(root / "research" / "results" / "phase6s" / "history" / "shadow-observation-history-manifest.json", {"entries": []})
    outcomes = load(root / "research" / "results" / "phase6s" / "shadow-observation-outcomes.json", {"outcomes": []})
    governance = load(root / "research" / "results" / "phase6s" / "shadow-observation-governance-report.json", {})
    runtime_metrics = load(root / "results" / "health" / RUNTIME_METRICS_FILENAME, {})
    if not isinstance(runtime_metrics, dict):
        runtime_metrics = {}
    complete_mature = sum(
        all(row.get("outcomes", {}).get(str(horizon), {}).get("status") == "matured" for horizon in (1, 4, 12))
        for row in outcomes.get("outcomes", [])
    )
    status = "blocked" if any("history_unhealthy" in issue or issue == "market_snapshot_stale" for issue in issues) else "warning" if issues else "healthy"
    failed_workflows = sum(1 for item in workflows.values() if item.get("conclusion") not in {"success", "neutral"})
    observation_total = max(1, int(governance.get("observationRunsAvailable", 0) or 0) * int(governance.get("uniqueMonitoredSymbolCount", 0) or 0))
    shadow_missing_count = governance.get("missingDataCount")
    if shadow_missing_count is not None:
        shadow_missing_rate = float(shadow_missing_count) / observation_total
    else:
        shadow_missing_rate = load(root / "research" / "results" / "phase6s" / "shadow-observation-outcomes.json", {}).get("metrics", {}).get("missing_price_frequency")
    return {
        "version": "project-health-v1",
        "generated_at": now.astimezone(timezone.utc).isoformat(),
        "status": status,
        "status_scope": "Operational data and workflow health only; not strategy validation or trading approval.",
        "manual_decision_only": True,
        "broker_connected": False,
        "automatic_trading": False,
        "issues": sorted(set(issues)),
        "market_snapshot": {
            "generated_at": market.get("generatedAt"), "lag_days": market_lag,
            "fresh_symbols": market_summary.get("freshSymbols"), "stale_symbols": market_summary.get("staleSymbols"),
        },
        "historical_snapshot": {"generated_at": historical.get("generatedAt"), "symbols": historical_rows},
        "watchlist": {
            "status": "ready" if watchlist_fallback_ready else "degraded",
            "runtime_primary": "Yahoo Finance chart API",
            "same_origin_fallback": "data/backtest-prices.json",
            "fallback_symbol_rows": watchlist_coverage,
            "note": "The browser reports the actual per-session source separately at runtime.",
        },
        "workflows": workflows,
        "shadow": {
            "archived_observation_count": len(manifest.get("entries", [])),
            "observation_runs_available": governance.get("observationRunsAvailable", 0),
            "complete_mature_outcome_count": complete_mature,
            "human_review_gate": bool(governance.get("anyCandidateEligibleForHumanReview", False)),
            "live_promotion_eligible": False,
        },
        "operational_metrics": {
            "data_delay_count": sum(1 for lag in [market_lag] + [row["lag_days"] for row in historical_rows.values()] if lag is None or lag > 0),
            "workflow_failure_rate": failed_workflows / max(1, len(workflows)),
            "watchlist_degradation_ratio": 0 if watchlist_fallback_ready else 1,
            "shadow_missing_rate": shadow_missing_rate,
            "page_js_error_count": runtime_metrics.get("page_js_error_count", 0),
            "data_source_response_ms": runtime_metrics.get("data_source_response_ms"),
        },
        "versions": {
            "market_input": market.get("generatedAt"), "historical_input": historical.get("generatedAt"),
            "shadow_model": "phase6s-candidate-ranking-v1", "v2_research": "v2-causal-baseline",
        },
    }


def history_entry(payload: dict) -> dict:
    metrics = payload.get("operational_metrics", {})
    return {
        "recorded_at": payload.get("generated_at"),
        "status": payload.get("status"),
        "data_delay_count": metrics.get("data_delay_count", 0),
        "workflow_failure_rate": metrics.get("workflow_failure_rate", 0),
        "watchlist_degradation_ratio": metrics.get("watchlist_degradation_ratio", 0),
        "shadow_missing_rate": metrics.get("shadow_missing_rate"),
        "page_js_error_count": metrics.get("page_js_error_count", 0),
        "data_source_response_ms": metrics.get("data_source_response_ms"),
    }


def build_history(path: Path, payload: dict, *, now: datetime, retention_days: int = HISTORY_RETENTION_DAYS) -> dict:
    current = load(path, {"version": "project-health-history-v1", "retention_days": retention_days, "entries": []})
    if not isinstance(current, dict):
        current = {"version": "project-health-history-v1", "retention_days": retention_days, "entries": []}
    entries = [item for item in current.get("entries", []) if isinstance(item, dict)]
    new_entry = history_entry(payload)
    entries = [item for item in entries if item.get("recorded_at") != new_entry.get("recorded_at")] + [new_entry]
    cutoff = now.astimezone(timezone.utc) - timedelta(days=retention_days)
    kept = []
    for item in entries:
        try:
            recorded = datetime.fromisoformat(str(item.get("recorded_at", "")).replace("Z", "+00:00"))
        except ValueError:
            continue
        if recorded >= cutoff:
            kept.append(item)
    kept.sort(key=lambda item: item.get("recorded_at", ""))
    return {"version": "project-health-history-v1", "retention_days": retention_days, "entries": kept}


def markdown(payload: dict) -> str:
    lines = [
        "# Project Health", "",
        f"- Status: **{payload['status'].upper()}**",
        f"- Generated: `{payload['generated_at']}`",
        "- Scope: operational data and workflow health only; this is not strategy validation or trading approval.", "",
        "## Issues", "",
    ]
    lines.extend(f"- `{issue}`" for issue in payload["issues"] or ["none"])
    lines += ["", "## Historical Coverage", ""]
    for symbol, row in payload["historical_snapshot"]["symbols"].items():
        lines.append(f"- {symbol}: {row['row_count']} rows; latest `{row['latest_date']}`; lag `{row['lag_days']}` days")
    lines += ["", "## Workflows", ""]
    for name, row in payload["workflows"].items():
        lines.append(f"- {name}: `{row.get('status')}` / `{row.get('conclusion')}`")
    lines += ["", "## Watchlist", "", f"- Static fallback status: `{payload['watchlist']['status']}`", f"- Runtime primary: `{payload['watchlist']['runtime_primary']}`", f"- Same-origin fallback: `{payload['watchlist']['same_origin_fallback']}`"]
    lines += ["", "## Shadow", "", f"- Observation runs: `{payload['shadow']['observation_runs_available']}`", f"- Complete mature outcomes: `{payload['shadow']['complete_mature_outcome_count']}`", f"- Human review gate: `{payload['shadow']['human_review_gate']}`", "- Live promotion eligible: `false`", ""]
    return "\n".join(lines)


def write_atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False, suffix=".tmp") as handle:
        handle.write(content)
        temporary = Path(handle.name)
    temporary.replace(path)


def generate(root: Path, output_dir: Path, *, now: datetime, workflows: dict) -> dict:
    payload = build_health(root, now=now, workflows=workflows)
    write_atomic(output_dir / "project-health.json", json.dumps(payload, indent=2) + "\n")
    write_atomic(output_dir / "project-health.md", markdown(payload))
    history = build_history(output_dir / HISTORY_FILENAME, payload, now=now)
    write_atomic(output_dir / HISTORY_FILENAME, json.dumps(history, indent=2) + "\n")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Build static project health reports.")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "results" / "health")
    parser.add_argument("--now", default="")
    args = parser.parse_args()
    now = datetime.fromisoformat(args.now.replace("Z", "+00:00")) if args.now else datetime.now(timezone.utc)
    workflows = workflow_statuses(os.getenv("GITHUB_REPOSITORY"), os.getenv("GITHUB_TOKEN"))
    payload = generate(ROOT, args.output_dir, now=now, workflows=workflows)
    print(f"project_health_status={payload['status']}")


if __name__ == "__main__":
    main()
