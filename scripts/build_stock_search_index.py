from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from datetime import datetime, time as datetime_time
from pathlib import Path
from zoneinfo import ZoneInfo


ROOT = Path(__file__).parents[1]
UNIVERSE = ROOT / "data" / "research-universe-sector-balanced-80.json"
BARS = ROOT / "data" / "short-term-daily-bars-v1.json"
OUTPUT = ROOT / "data" / "us-equity-search-index.json"
EXTRAS = ROOT / "data" / "weekly-search-symbols.json"
NY = ZoneInfo("America/New_York")


def load(path: Path, fallback=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def lookup(symbol: str) -> dict:
    url = "https://query1.finance.yahoo.com/v1/finance/search?" + urllib.parse.urlencode(
        {"q": symbol, "quotesCount": 8, "newsCount": 0}
    )
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 SuInvestmentSearchIndex/1.0"})
    with urllib.request.urlopen(request, timeout=20) as response:
        rows = json.loads(response.read().decode("utf-8")).get("quotes", [])
    return next((row for row in rows if str(row.get("symbol", "")).upper() == symbol), {})


def latest_quote(symbol: str) -> dict:
    url = "https://query1.finance.yahoo.com/v8/finance/chart/" + urllib.parse.quote(symbol) + "?range=14d&interval=1d"
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 SuInvestmentSearchIndex/1.0"})
    with urllib.request.urlopen(request, timeout=20) as response:
        chart = json.loads(response.read().decode("utf-8")).get("chart", {}).get("result", [None])[0]
    if not chart:
        return {}
    closes = chart.get("indicators", {}).get("quote", [{}])[0].get("close", [])
    timestamps = chart.get("timestamp", [])
    for index in range(min(len(closes), len(timestamps)) - 1, -1, -1):
        if closes[index] is not None and float(closes[index]) > 0:
            date = datetime.fromtimestamp(int(timestamps[index]), NY).date()
            return {"close": float(closes[index]), "date": date.isoformat()}
    return {}


def main() -> None:
    research_symbols = load(UNIVERSE, {}).get("research_universe_symbols", [])
    extra_symbols = load(EXTRAS, {}).get("symbols", [])
    universe = list(dict.fromkeys([*research_symbols, *extra_symbols]))
    bars_payload = load(BARS, {})
    bars = bars_payload.get("symbols", {})
    previous = {row.get("symbol"): row for row in load(OUTPUT, {}).get("symbols", [])}
    result = []
    for symbol in universe:
        old = previous.get(symbol, {})
        meta = old
        if not old.get("name") or not old.get("exchange"):
            try:
                meta = lookup(symbol)
                time.sleep(0.08)
            except Exception:
                meta = old
        rows = bars.get(symbol, [])
        latest = next((row for row in reversed(rows) if row.get("date") and float(row.get("close") or 0) > 0), {})
        if not latest and symbol in extra_symbols:
            try:
                latest = latest_quote(symbol)
            except Exception:
                latest = {}
        quote_timestamp = None
        if latest:
            quote_timestamp = datetime.combine(
                datetime.fromisoformat(latest["date"]).date(), datetime_time(16, 0), NY
            ).isoformat()
        result.append({
            "symbol": symbol,
            "name": meta.get("longname") or meta.get("shortname") or meta.get("name") or symbol,
            "exchange": meta.get("exchange") or meta.get("exchDisp") or "",
            "instrumentType": meta.get("quoteType") or meta.get("instrumentType") or "EQUITY",
            "currency": "USD",
            "price": latest.get("close"),
            "quoteTimestamp": quote_timestamp,
            "source": "Published weekly search index",
        })
    payload = {
        "formatVersion": 1,
        "generatedAt": datetime.now().astimezone().isoformat(),
        "priceAsOf": bars_payload.get("as_of"),
        "symbols": result,
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(result)} searchable USD equities to {OUTPUT}")


if __name__ == "__main__":
    main()
