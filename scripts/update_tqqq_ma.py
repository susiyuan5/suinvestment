"""Build the SPY/QQQ daily-close snapshot used by the TQQQ moving-average signal view.

Only completed regular sessions enter ``days``: a bar dated today (New York) is
kept only once the session has had time to close. Both symbols must have a close
on a date for it to be included.

The snapshot is validated before writing. Any validation failure raises and the
previous snapshot is left untouched (live-data publication then skips the task).
"""
from __future__ import annotations

import argparse
import json
import math
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Callable
from zoneinfo import ZoneInfo

try:
    from scripts.update_btc_weekly import parse_yahoo_chart, write_json_atomic
except ModuleNotFoundError:  # executed as a script: python scripts/update_tqqq_ma.py
    from update_btc_weekly import parse_yahoo_chart, write_json_atomic

ROOT = Path(__file__).resolve().parents[1]
OUT_FILE = ROOT / "data" / "tqqq-ma-daily-v1.json"
SCHEMA = "tqqq-ma-daily-v1"
SYMBOLS = ("SPY", "QQQ")
HISTORY_DAYS = 2600  # calendar days requested, about seven years
MIN_DAYS = 460  # 200-day average plus a year of deviations
MAX_AGE_DAYS = 7
MAX_DAILY_MOVE = 0.25  # a >25% one-day move in SPY/QQQ is treated as bad data
MAX_GAP_DAYS = 7  # longest plausible break between sessions
CLOSE_SETTLE = (16, 20)  # New York time after which today's bar counts as complete
NEW_YORK = ZoneInfo("America/New_York")
REQUEST_TIMEOUT_SECONDS = 20
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SuInvestmentTqqqMa/1.0"
YAHOO_HOSTS = ("query1.finance.yahoo.com", "query2.finance.yahoo.com")


def fetch_yahoo_daily(symbol: str, now: datetime, opener: Callable = urllib.request.urlopen) -> list[tuple[date, float]]:
    errors = []
    encoded = urllib.parse.quote(symbol)
    period2 = int(now.timestamp()) + 86400
    period1 = period2 - HISTORY_DAYS * 86400
    for host in YAHOO_HOSTS:
        url = f"https://{host}/v8/finance/chart/{encoded}?period1={period1}&period2={period2}&interval=1d"
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with opener(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                payload = json.loads(response.read().decode("utf-8"))
            return parse_yahoo_chart(payload)
        except Exception as error:  # noqa: BLE001 - try the next host, report all
            errors.append(f"{host}: {error}")
            time.sleep(0.5)
    raise RuntimeError(f"Yahoo {symbol} daily fetch failed: " + "; ".join(errors))


def last_complete_session(now: datetime) -> date:
    """Latest date whose regular session can be treated as closed."""
    local = now.astimezone(NEW_YORK)
    if (local.hour, local.minute) >= CLOSE_SETTLE:
        return local.date()
    return local.date() - timedelta(days=1)


def merge_days(series: dict[str, list[tuple[date, float]]], now: datetime) -> list[dict]:
    cutoff = last_complete_session(now)
    spy = dict(series["SPY"])
    qqq = dict(series["QQQ"])
    return [
        {"date": day.isoformat(), "spy": round(spy[day], 4), "qqq": round(qqq[day], 4)}
        for day in sorted(set(spy) & set(qqq))
        if day <= cutoff
    ]


def validate(days: list[dict], now: datetime) -> None:
    if len(days) < MIN_DAYS:
        raise ValueError(f"only {len(days)} complete sessions; need {MIN_DAYS}")
    previous = None
    for row in days:
        day = date.fromisoformat(row["date"])
        if day.weekday() > 4:
            raise ValueError(f"{day} is not a weekday")
        for key in ("spy", "qqq"):
            close = row[key]
            if not (isinstance(close, (int, float)) and math.isfinite(close) and close > 0):
                raise ValueError(f"invalid {key} close on {day}")
        if previous is not None:
            gap = (day - date.fromisoformat(previous["date"])).days
            if gap <= 0:
                raise ValueError(f"dates out of order at {day}")
            if gap > MAX_GAP_DAYS:
                raise ValueError(f"gap of {gap} days before {day}")
            for key in ("spy", "qqq"):
                if abs(row[key] / previous[key] - 1) > MAX_DAILY_MOVE:
                    raise ValueError(f"implausible {key} move on {day}")
        previous = row
    age = (last_complete_session(now) - date.fromisoformat(previous["date"])).days
    if age > MAX_AGE_DAYS:
        raise ValueError(f"latest session {previous['date']} is {age} days old")


def build(series: dict[str, list[tuple[date, float]]], now: datetime) -> dict:
    days = merge_days(series, now)
    validate(days, now)
    return {
        "schema": SCHEMA,
        "symbols": list(SYMBOLS),
        "source": "Yahoo Finance Chart API (SPY, QQQ daily close, not adjusted)",
        "dayRule": "completed regular sessions only; both symbols must have a close",
        "generatedAt": now.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "asof": days[-1]["date"],
        "days": days,
        "researchOnly": True,
    }


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=OUT_FILE)
    args = parser.parse_args(argv)
    now = datetime.now(timezone.utc)
    payload = build({symbol: fetch_yahoo_daily(symbol, now) for symbol in SYMBOLS}, now)
    write_json_atomic(args.out, payload)
    print(f"TQQQ MA snapshot: {len(payload['days'])} sessions, last {payload['asof']}")


if __name__ == "__main__":
    main()
