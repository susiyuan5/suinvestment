from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from data_loader import daily_to_weekly, load_yahoo_daily_prices


SYMBOLS = ("BYDDY", "MSFT", "NVDA", "AAPL", "ASML", "KO", "QQQ", "SPY")
OUT_FILE = Path("data/backtest-prices.json")
DEFAULT_START = "2021-06-01"
MIN_WEEKS = 50


def main() -> None:
    args = parse_args()
    previous = load_previous_snapshot(OUT_FILE)
    end = args.end or datetime.now(timezone.utc).date().isoformat()

    result = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "Yahoo Finance chart weekly data generated locally",
        "symbols": {},
        "metadata": {},
        "errors": {},
    }

    for symbol in SYMBOLS:
        existing_rows = previous.get("symbols", {}).get(symbol)
        should_fetch = args.refresh_all or not args.reuse_complete or not enough_rows(existing_rows)

        if should_fetch:
            try:
                rows = fetch_weekly_rows(symbol, args.start, end)
                result["symbols"][symbol] = rows
                result["metadata"][symbol] = build_metadata(rows, "Yahoo Finance chart API", "validated")
            except Exception as error:
                if not enough_rows(existing_rows):
                    raise
                result["symbols"][symbol] = existing_rows
                result["metadata"][symbol] = build_metadata(existing_rows, "Previous historical snapshot", "stale_fallback", str(error))
                result["errors"][symbol] = str(error)
        else:
            result["symbols"][symbol] = existing_rows
            result["metadata"][symbol] = build_metadata(existing_rows, "Previous historical snapshot", "reused")

    validate_snapshot(result)
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT_FILE} with {len(result['symbols'])} symbols")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate dashboard historical weekly price snapshot.")
    parser.add_argument("--start", default=DEFAULT_START, help="Start date in YYYY-MM-DD format.")
    parser.add_argument("--end", default="", help="End date in YYYY-MM-DD format; defaults to today UTC.")
    parser.add_argument("--refresh-all", action="store_true", help="Refresh all symbols instead of only missing/short histories.")
    parser.add_argument("--reuse-complete", action="store_true", help="Reuse complete histories; default behavior refreshes every symbol.")
    return parser.parse_args()


def load_previous_snapshot(path: Path) -> dict:
    if not path.exists():
        return {"symbols": {}}
    return json.loads(path.read_text(encoding="utf-8"))


def fetch_weekly_rows(symbol: str, start: str, end: str) -> list[dict[str, float | str]]:
    daily = load_yahoo_daily_prices(symbol, start, end)
    weekly = daily_to_weekly(daily)
    rows = [
        {
            "date": point.date.isoformat(),
            "close": round(point.close, 6),
        }
        for point in weekly
    ]
    if len(rows) < MIN_WEEKS:
        raise RuntimeError(f"{symbol} has only {len(rows)} weekly rows")
    return rows


def enough_rows(rows: object) -> bool:
    return isinstance(rows, list) and len(rows) >= MIN_WEEKS


def build_metadata(rows: list[dict], source: str, status: str, error: str = "") -> dict:
    return {
        "rowCount": len(rows),
        "firstDate": rows[0].get("date") if rows else None,
        "latestDate": rows[-1].get("date") if rows else None,
        "source": source,
        "sourceType": "api" if status == "validated" else "fallback",
        "validationStatus": status,
        "errorReason": error,
    }


def validate_snapshot(snapshot: dict) -> None:
    missing = []
    for symbol in SYMBOLS:
        rows = snapshot.get("symbols", {}).get(symbol)
        if not enough_rows(rows):
            missing.append(symbol)
    if missing:
        raise RuntimeError(f"Missing or short histories: {', '.join(missing)}")


if __name__ == "__main__":
    main()
