"""Refresh the strict daily OHLCV snapshot without partial or fabricated writes."""
from __future__ import annotations
import argparse, json
from datetime import datetime, timezone
from pathlib import Path
from data_loader import load_yahoo_daily_prices
from research.idea_engine.v3.short_term_daily_bars import validate_snapshot


def main() -> None:
    parser = argparse.ArgumentParser(); parser.add_argument("--output", type=Path, default=Path("data/short-term-daily-bars-v1.json")); parser.add_argument("--universe", type=Path, default=Path("data/research-universe-sector-balanced-80.json")); parser.add_argument("--start", default="2024-01-01"); parser.add_argument("--end", default=""); args = parser.parse_args()
    universe = json.loads(args.universe.read_text(encoding="utf-8")); symbols = list(universe["research_universe_symbols"]) + ["QQQ"]
    end = args.end or datetime.now(timezone.utc).date().isoformat(); payload = {"schema_version": "short-term-daily-bars-v1", "research_only": True, "status": "ready", "frequency": "1d", "adjustment": "split_and_dividend_adjusted", "timezone": "America/New_York", "currency": "USD", "source": "Yahoo Finance chart adapter via data_loader.load_yahoo_daily_prices", "as_of": end, "symbols": {}}
    failures = {}
    for symbol in symbols:
        try:
            points = load_yahoo_daily_prices(symbol, args.start, end)
            payload["symbols"][symbol] = [{"date": point.date.isoformat(), "open": point.open, "high": point.high, "low": point.low, "close": point.close, "volume": None, "adjusted": point.adjusted_close} for point in points]
            failures[symbol] = "volume_not_provided_by_existing_adapter"
        except Exception as error:
            failures[symbol] = str(error)
    check = validate_snapshot(payload, symbols[:-1], as_of=end)
    if not check["valid"]:
        print(json.dumps({"status": "blocked", "errors": check["errors"][:20], "preserved": args.output.exists()}, ensure_ascii=False))
        return
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote={args.output} symbols={len(payload['symbols'])}")


if __name__ == "__main__": main()
