"""Attach mature 1/4/12-week outcomes to frozen shadow observations.

The output is research-only and is a hard input to governance. Missing future
prices remain pending; pending records never count as review evidence.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HISTORY = ROOT / "research" / "results" / "phase6s" / "history" / "shadow-observation-history-manifest.json"
PRICES = ROOT / "data" / "research-prices-sector-balanced-80.json"
OUT = ROOT / "research" / "results" / "phase6s" / "shadow-observation-outcomes.json"


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def outcome_for(rows: list[dict], as_of: str, horizon: int) -> dict:
    as_of_day = datetime.fromisoformat(as_of.replace("Z", "+00:00")).date().isoformat()
    eligible = [row for row in rows if row.get("date") and row["date"] <= as_of_day]
    if not eligible:
        return {"status": "pending", "reason": "no price at observation date"}
    start_index = len(eligible) - 1
    target_index = start_index + horizon
    if target_index >= len(rows):
        return {"status": "pending", "reason": "future horizon has not matured"}
    start = float(rows[start_index]["close"])
    end = float(rows[target_index]["close"])
    return {
        "status": "matured",
        "start_date": rows[start_index]["date"],
        "end_date": rows[target_index]["date"],
        "return": round(end / start - 1, 8),
    }


def main() -> None:
    manifest = load(HISTORY)
    price_symbols = load(PRICES).get("symbols", {})
    outcomes = []
    for entry in manifest.get("entries", []):
        folder = ROOT / entry["archiveFolder"]
        log_path = folder / "shadow-observation-log.json"
        if not log_path.exists():
            continue
        payload = load(log_path)
        for observation in payload.get("observations", []):
            symbol = observation["symbol"]
            rows = price_symbols.get(symbol, {}).get("rows", [])
            outcomes.append(
                {
                    "observation_timestamp": observation.get("observation_date"),
                    "symbol": symbol,
                    "input_hash": observation.get("input_hash"),
                    "code_version": observation.get("code_version"),
                    "model_version": observation.get("model_version"),
                    "outcomes": {str(horizon): outcome_for(rows, observation["observation_date"], horizon) for horizon in (1, 4, 12)},
                }
            )
    OUT.write_text(json.dumps({"research_only": True, "outcomes": outcomes}, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT} with {len(outcomes)} frozen observations")


if __name__ == "__main__":
    main()
