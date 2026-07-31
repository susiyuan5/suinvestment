from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from data_loader import load_yahoo_daily_prices
from scripts.update_backtest_prices import SYMBOLS, write_json_atomic


OUT_FILE = Path("data/v2/backtest-adjusted-daily.json")
DEFAULT_START = "2021-06-01"
MIN_ROWS = 260
FIELDS = ("open", "high", "low", "close", "adjusted_open", "adjusted_high", "adjusted_low", "adjusted_close")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate separate daily history for DCA-L2 validation.")
    parser.add_argument("--start", default=DEFAULT_START)
    parser.add_argument("--end", default="")
    parser.add_argument("--max-lag-days", type=int, default=10)
    args = parser.parse_args()
    end = args.end or datetime.now(timezone.utc).date().isoformat()
    previous = json.loads(OUT_FILE.read_text(encoding="utf-8")) if OUT_FILE.exists() else {"symbols": {}}
    result = {"version": "adjusted-daily-v2", "research_only": True, "generatedAt": datetime.now(timezone.utc).isoformat(), "source": "Yahoo Finance chart adjusted daily OHLC", "symbols": {}, "metadata": {}, "errors": {}}
    for symbol in SYMBOLS:
        try:
            points = load_yahoo_daily_prices(symbol, args.start, end)
            rows = [adjusted_row(point) for point in points]
            if len(rows) < MIN_ROWS:
                raise RuntimeError(f"{symbol} has fewer than {MIN_ROWS} daily rows")
            result["symbols"][symbol] = rows
            result["metadata"][symbol] = {"rowCount": len(rows), "latestDate": rows[-1]["date"], "validationStatus": "validated"}
        except Exception as error:
            existing = previous.get("symbols", {}).get(symbol, [])
            if len(existing) < MIN_ROWS:
                raise
            result["symbols"][symbol] = existing
            result["metadata"][symbol] = {"rowCount": len(existing), "latestDate": existing[-1]["date"], "validationStatus": "stale_fallback"}
            result["errors"][symbol] = str(error)
    validate_adjusted_snapshot(result, previous=previous, max_lag_days=args.max_lag_days, as_of=end)
    write_json_atomic(OUT_FILE, result)
    print(f"Wrote {OUT_FILE} with {len(result['symbols'])} symbols")


def adjusted_row(point) -> dict:
    if point.open is None or point.high is None or point.low is None or point.adjusted_close is None:
        raise RuntimeError(f"{point.date.isoformat()} is missing adjusted OHLC input")
    factor = point.adjusted_close / point.close
    return {
        "date": point.date.isoformat(),
        "open": round(point.open, 6),
        "high": round(point.high, 6),
        "low": round(point.low, 6),
        "close": round(point.close, 6),
        "adjusted_open": round(point.open * factor, 6),
        "adjusted_high": round(point.high * factor, 6),
        "adjusted_low": round(point.low * factor, 6),
        "adjusted_close": round(point.adjusted_close, 6),
    }


def validate_adjusted_snapshot(snapshot: dict, *, previous: dict, max_lag_days: int, as_of: str) -> None:
    if snapshot.get("version") != "adjusted-daily-v2" or snapshot.get("research_only") is not True:
        raise RuntimeError("adjusted daily v2 metadata is missing")
    for symbol in SYMBOLS:
        rows = snapshot.get("symbols", {}).get(symbol)
        if not isinstance(rows, list) or len(rows) < MIN_ROWS:
            raise RuntimeError(f"{symbol} has fewer than {MIN_ROWS} adjusted daily rows")
        dates = [str(row.get("date", "")) for row in rows]
        if dates != sorted(set(dates)):
            raise RuntimeError(f"{symbol} dates must be strictly increasing and unique")
        for row in rows:
            if any(not isinstance(row.get(field), (int, float)) or not math.isfinite(row[field]) or row[field] <= 0 for field in FIELDS):
                raise RuntimeError(f"{symbol} contains invalid adjusted OHLC")
            if row["high"] < max(row["open"], row["close"]) or row["low"] > min(row["open"], row["close"]):
                raise RuntimeError(f"{symbol} contains inconsistent raw OHLC")
            if row["adjusted_high"] < max(row["adjusted_open"], row["adjusted_close"]) or row["adjusted_low"] > min(row["adjusted_open"], row["adjusted_close"]):
                raise RuntimeError(f"{symbol} contains inconsistent adjusted OHLC")
        previous_rows = previous.get("symbols", {}).get(symbol, [])
        if previous_rows and dates[-1] < str(previous_rows[-1].get("date", "")):
            raise RuntimeError(f"{symbol} adjusted history regressed")
        if snapshot.get("metadata", {}).get(symbol, {}).get("validationStatus") == "validated":
            lag = (date.fromisoformat(as_of) - date.fromisoformat(dates[-1])).days
            if lag > max_lag_days:
                raise RuntimeError(f"{symbol} adjusted history is {lag} days behind")


if __name__ == "__main__":
    main()
