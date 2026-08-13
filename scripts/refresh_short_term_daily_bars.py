"""Refresh the strict daily OHLCV snapshot without partial or fabricated writes."""
from __future__ import annotations
import argparse, json, os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from data_loader import load_yahoo_daily_prices
from research.idea_engine.v3.short_term_daily_bars import validate_snapshot


def verified_rows(points):
    rows = []
    rejected = 0
    for point in points:
        row = {"date": point.date.isoformat(), "open": point.open, "high": point.high, "low": point.low, "close": point.close, "volume": point.volume, "adjusted": point.adjusted_close}
        values = [row[key] for key in ("open", "high", "low", "close", "volume", "adjusted")]
        if any(value is None or value <= 0 for value in values) or row["high"] < max(row["open"], row["close"]) or row["low"] > min(row["open"], row["close"]):
            rejected += 1
            continue
        rows.append(row)
    return rows, rejected


def main() -> None:
    parser = argparse.ArgumentParser(); parser.add_argument("--output", type=Path, default=Path("data/short-term-daily-bars-v1.json")); parser.add_argument("--universe", type=Path, default=Path("data/research-universe-sector-balanced-80.json")); parser.add_argument("--start", default=""); parser.add_argument("--end", default=""); args = parser.parse_args()
    universe = json.loads(args.universe.read_text(encoding="utf-8")); symbols = list(universe["research_universe_symbols"]) + ["QQQ"]
    end = args.end or datetime.now(timezone.utc).date().isoformat(); start = args.start or (datetime.fromisoformat(end).date() - timedelta(days=500)).isoformat(); payload = {"schema_version": "short-term-daily-bars-v1", "research_only": True, "status": "ready", "frequency": "1d", "adjustment": "split_and_dividend_adjusted", "timezone": "America/New_York", "currency": "USD", "source": "Yahoo Finance chart adapter via data_loader.load_yahoo_daily_prices", "as_of": end, "symbols": {}, "refresh_warnings": {}}
    failures = {}
    for symbol in symbols:
        try:
            points = load_yahoo_daily_prices(symbol, start, end)
            payload["symbols"][symbol], rejected = verified_rows(points)
            if rejected:
                payload["refresh_warnings"][symbol] = {"excluded_invalid_rows": rejected}
        except Exception as error:
            failures[symbol] = str(error)
    check = validate_snapshot(payload, symbols[:-1], as_of=end)
    if not check["valid"]:
        print(json.dumps({"status": "blocked", "errors": check["errors"][:20], "preserved": args.output.exists()}, ensure_ascii=False))
        return
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile("w", encoding="utf-8", dir=args.output.parent, delete=False, suffix=".tmp") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        temporary = Path(handle.name)
    os.replace(temporary, args.output)
    print(f"wrote={args.output} symbols={len(payload['symbols'])}")


if __name__ == "__main__": main()
