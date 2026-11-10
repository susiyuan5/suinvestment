"""Build the frozen research fixture for the TQQQ moving-average backtest.

One-off research helper, not a live-data task. Fetches Yahoo daily bars for SPY,
QQQ and TQQQ with both the plain close (used for the signal, as on the live
page) and the dividend-adjusted close (used for returns).
"""
from __future__ import annotations

import argparse
import json
import math
import time
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_FILE = ROOT / "tests" / "fixtures" / "tqqq-backtest-daily-research-v1.json"
SCHEMA = "tqqq-backtest-daily-research-v1"
START = int(datetime(1999, 1, 1, tzinfo=timezone.utc).timestamp())
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SuInvestmentResearch/1.0"


def parse(payload: dict) -> dict[date, tuple[float, float]]:
    """Return {session date: (close, adjusted close)} for valid bars."""
    result = ((payload.get("chart") or {}).get("result") or [None])[0]
    if not result:
        raise ValueError("Yahoo payload missing result")
    stamps = result.get("timestamp") or []
    indicators = result.get("indicators") or {}
    closes = ((indicators.get("quote") or [{}])[0]).get("close") or []
    adjusted = ((indicators.get("adjclose") or [{}])[0]).get("adjclose") or []
    if not (len(stamps) == len(closes) == len(adjusted)):
        raise ValueError("Yahoo timestamp/close/adjclose length mismatch")
    rows = {}
    for stamp, close, adj in zip(stamps, closes, adjusted):
        if close is None or adj is None:
            continue
        if not (math.isfinite(close) and math.isfinite(adj) and close > 0 and adj > 0):
            continue
        rows[datetime.fromtimestamp(int(stamp), timezone.utc).date()] = (float(close), float(adj))
    return rows


def fetch(symbol: str, end: int) -> dict[date, tuple[float, float]]:
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?period1={START}&period2={end}&interval=1d&events=div%2Csplits"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        return parse(json.loads(response.read().decode("utf-8")))


def build(series: dict[str, dict[date, tuple[float, float]]], last: date) -> dict:
    spy, qqq, tqqq = series["SPY"], series["QQQ"], series["TQQQ"]
    rows = []
    for day in sorted(set(spy) & set(qqq)):
        if day > last:
            continue
        leveraged = tqqq.get(day)
        rows.append([
            day.isoformat(),
            round(spy[day][0], 4), round(qqq[day][0], 4),
            round(spy[day][1], 4), round(qqq[day][1], 4),
            round(leveraged[1], 6) if leveraged else None,
        ])
    return {
        "schema": SCHEMA,
        "source": "Yahoo Finance Chart API daily bars; close = split-adjusted close, adj = dividend-adjusted close",
        "columns": ["date", "spyClose", "qqqClose", "spyAdj", "qqqAdj", "tqqqAdj"],
        "note": "tqqqAdj is null before TQQQ began trading (2010-02-11)",
        "last": rows[-1][0],
        "researchOnly": True,
        "rows": rows,
    }


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=OUT_FILE)
    parser.add_argument("--last", type=date.fromisoformat, required=True, help="last completed session to include")
    args = parser.parse_args(argv)
    end = int(time.time()) + 86400
    payload = build({symbol: fetch(symbol, end) for symbol in ("SPY", "QQQ", "TQQQ")}, args.last)
    args.out.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{len(payload['rows'])} sessions, {payload['rows'][0][0]} to {payload['last']}")


if __name__ == "__main__":
    main()
