"""Extend a frozen research snapshot without altering live or prior backtest data."""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from data_loader import load_yahoo_daily_prices
from scripts.update_backtest_daily_prices import adjusted_row, FIELDS

SYMBOLS = ("SPY", "QQQ", "NVDA", "AAPL", "ASML", "QNT", "JOBY", "PEP", "CBRS", "KO", "WMT")
# Confirmed listing months are conservative lower bounds, not invented first bars.
EARLIEST_MONTH = {"QNT": "2026-06-01", "CBRS": "2026-05-01"}


def fetch_rows(symbol: str, start: str, end: str) -> list[dict]:
    rows = [adjusted_row(point) for point in load_yahoo_daily_prices(symbol, start, end)]
    dates = [row["date"] for row in rows]
    if dates != sorted(set(dates)):
        raise ValueError("Dates must be increasing and unique")
    for row in rows:
        if not start <= row["date"] <= end:
            raise ValueError("Provider bar outside requested period")
        if any(not isinstance(row.get(field), (int, float)) or not math.isfinite(row[field]) or row[field] <= 0 for field in FIELDS):
            raise ValueError("Invalid adjusted OHLC")
        if row["high"] < max(row["open"], row["close"]) or row["low"] > min(row["open"], row["close"]):
            raise ValueError("Inconsistent raw OHLC")
        if row["adjusted_high"] < max(row["adjusted_open"], row["adjusted_close"]) or row["adjusted_low"] > min(row["adjusted_open"], row["adjusted_close"]):
            raise ValueError("Inconsistent adjusted OHLC")
        if row["date"] < EARLIEST_MONTH.get(symbol, start):
            raise ValueError("Provider history predates confirmed listing month; verify security identity")
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="data/v2/backtest-adjusted-daily.json")
    parser.add_argument("--output", default="results/weekly_dca_optimization_2026-09-30/research-prices.json")
    parser.add_argument("--start", default="2021-06-01")
    parser.add_argument("--end", default="2026-09-11")
    args = parser.parse_args()
    if Path(args.output).resolve() == Path(args.base).resolve():
        raise ValueError("Research output must not overwrite the input snapshot")
    base = json.loads(Path(args.base).read_text(encoding="utf-8"))
    result = {"version": "adjusted-daily-v2", "research_only": True,
              "generatedAt": datetime.now(timezone.utc).isoformat(),
              "source": "Frozen base plus Yahoo chart adjusted daily OHLC; no synthetic or pre-listing rows",
              "baseSnapshot": args.base, "requestedStart": args.start, "requestedEnd": args.end,
              "symbols": {}, "metadata": {}, "errors": {}}
    missing = []
    for symbol in SYMBOLS:
        rows = [row for row in base.get("symbols", {}).get(symbol, []) if args.start <= row["date"] <= args.end]
        if rows:
            result["symbols"][symbol] = rows
            result["metadata"][symbol] = {"source": "frozen_base", "firstDate": rows[0]["date"], "latestDate": rows[-1]["date"], "rowCount": len(rows)}
        else:
            missing.append(symbol)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(fetch_rows, symbol, args.start, args.end): symbol for symbol in missing}
        for future in concurrent.futures.as_completed(futures):
            symbol = futures[future]
            try:
                rows = future.result()
                result["symbols"][symbol] = rows
                result["metadata"][symbol] = {"source": "Yahoo Finance chart", "firstDate": rows[0]["date"], "latestDate": rows[-1]["date"], "rowCount": len(rows)}
                print(f"{symbol}: {len(rows)} real bars, {rows[0]['date']} to {rows[-1]['date']}", flush=True)
            except Exception as error:
                result["errors"][symbol] = str(error)
                print(f"{symbol}: unavailable: {error}", flush=True)
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote separate research snapshot: {destination}")


if __name__ == "__main__":
    main()
