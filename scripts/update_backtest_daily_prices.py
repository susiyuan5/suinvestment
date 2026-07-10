from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from data_loader import load_yahoo_daily_prices
from scripts.update_backtest_prices import SYMBOLS, write_json_atomic


OUT_FILE = Path("data/backtest-daily-prices.json")
DEFAULT_START = "2021-06-01"
MIN_ROWS = 260


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate separate daily history for DCA-L2 validation.")
    parser.add_argument("--start", default=DEFAULT_START)
    parser.add_argument("--end", default="")
    args = parser.parse_args()
    end = args.end or datetime.now(timezone.utc).date().isoformat()
    previous = json.loads(OUT_FILE.read_text(encoding="utf-8")) if OUT_FILE.exists() else {"symbols": {}}
    result = {"generatedAt": datetime.now(timezone.utc).isoformat(), "source": "Yahoo Finance chart daily data", "symbols": {}, "metadata": {}, "errors": {}}
    for symbol in SYMBOLS:
        try:
            points = load_yahoo_daily_prices(symbol, args.start, end)
            rows = [{"date": point.date.isoformat(), "close": round(point.close, 6)} for point in points]
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
    write_json_atomic(OUT_FILE, result)
    print(f"Wrote {OUT_FILE} with {len(result['symbols'])} symbols")


if __name__ == "__main__":
    main()
