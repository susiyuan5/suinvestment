"""Build the BTC weekly-close snapshot used by the BTC 20-week trend panel.

Weekly bars follow the common crypto convention: UTC weeks Monday-Sunday, the
close is the Sunday UTC daily close. Only complete weeks enter ``weeks``; the
in-progress week is reported separately as ``partial`` and never drives a signal.

The snapshot is validated before writing. Any validation failure raises and the
previous snapshot is left untouched (live-data publication then skips the task).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import tempfile
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Iterable

ROOT = Path(__file__).resolve().parents[1]
OUT_FILE = ROOT / "data" / "btc-weekly-v1.json"
SCHEMA = "btc-weekly-v1"
SYMBOL = "BTC-USD"
MIN_WEEKS = 60
MAX_COMPLETE_WEEK_AGE_DAYS = 14
MAX_WEEKLY_MOVE = 0.9  # a >90% single-week jump/drop is treated as bad data
REQUEST_TIMEOUT_SECONDS = 20
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SuInvestmentBtcWeekly/1.0"
YAHOO_HOSTS = ("query1.finance.yahoo.com", "query2.finance.yahoo.com")


def fetch_yahoo_daily(symbol: str = SYMBOL, opener: Callable = urllib.request.urlopen) -> list[tuple[date, float]]:
    errors = []
    encoded = urllib.parse.quote(symbol)
    for host in YAHOO_HOSTS:
        # range=max silently coarsens the interval; an explicit period keeps daily bars.
        period2 = int(time.time()) + 86400
        url = f"https://{host}/v8/finance/chart/{encoded}?period1=1410912000&period2={period2}&interval=1d"
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with opener(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                payload = json.loads(response.read().decode("utf-8"))
            return parse_yahoo_chart(payload)
        except Exception as error:  # noqa: BLE001 - try the next host, report all
            errors.append(f"{host}: {error}")
            time.sleep(0.5)
    raise RuntimeError("Yahoo BTC daily fetch failed: " + "; ".join(errors))


def parse_yahoo_chart(payload: dict) -> list[tuple[date, float]]:
    result = ((payload.get("chart") or {}).get("result") or [None])[0]
    if not result:
        raise ValueError("Yahoo payload missing result")
    stamps = result.get("timestamp") or []
    closes = (((result.get("indicators") or {}).get("quote") or [{}])[0]).get("close") or []
    if len(stamps) != len(closes):
        raise ValueError("Yahoo timestamp/close length mismatch")
    rows: dict[date, float] = {}
    for stamp, close in zip(stamps, closes):
        if close is None:
            continue
        value = float(close)
        if not math.isfinite(value) or value <= 0:
            continue
        # Yahoo crypto daily bars are stamped at 00:00 UTC of the bar's day.
        rows[datetime.fromtimestamp(int(stamp), timezone.utc).date()] = value
    return sorted(rows.items())


def weekly_closes(daily: Iterable[tuple[date, float]], today: date) -> tuple[list[dict], dict | None]:
    """Group UTC daily closes into Monday-Sunday weeks.

    A week is complete only when its Sunday bar exists and that Sunday is before
    ``today`` (UTC). The latest incomplete week is returned as ``partial``.
    """
    weeks: dict[date, tuple[date, float]] = {}
    for day, close in daily:
        week_end = day + timedelta(days=6 - day.weekday())
        current = weeks.get(week_end)
        if current is None or day > current[0]:
            weeks[week_end] = (day, close)
    complete, partial = [], None
    for week_end in sorted(weeks):
        last_day, close = weeks[week_end]
        if last_day == week_end and week_end < today:
            complete.append({"week_end": week_end.isoformat(), "close": round(close, 2)})
        elif week_end >= today and partial is None:
            partial = {"week_end": week_end.isoformat(), "date": last_day.isoformat(), "close": round(close, 2)}
    return complete, partial


def validate(weeks: list[dict], today: date) -> None:
    if len(weeks) < MIN_WEEKS:
        raise ValueError(f"only {len(weeks)} complete weeks; need {MIN_WEEKS}")
    previous_end = None
    previous_close = None
    for row in weeks:
        end = date.fromisoformat(row["week_end"])
        if end.weekday() != 6:
            raise ValueError(f"week_end {end} is not a Sunday")
        if previous_end is not None and (end - previous_end).days != 7:
            raise ValueError(f"gap in weekly closes between {previous_end} and {end}")
        close = row["close"]
        if not (isinstance(close, (int, float)) and math.isfinite(close) and close > 0):
            raise ValueError(f"invalid close on {end}")
        if previous_close is not None and abs(close / previous_close - 1) > MAX_WEEKLY_MOVE:
            raise ValueError(f"implausible weekly move on {end}")
        previous_end, previous_close = end, close
    age = (today - previous_end).days
    if age > MAX_COMPLETE_WEEK_AGE_DAYS:
        raise ValueError(f"latest complete week {previous_end} is {age} days old")


def build(daily: list[tuple[date, float]], now: datetime) -> dict:
    today = now.astimezone(timezone.utc).date()
    weeks, partial = weekly_closes(daily, today)
    validate(weeks, today)
    return {
        "schema": SCHEMA,
        "symbol": SYMBOL,
        "source": "Yahoo Finance Chart API (BTC-USD daily, UTC)",
        "weekRule": "UTC Monday-Sunday weeks; close = Sunday UTC daily close; only complete weeks",
        "generatedAt": now.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "lastCompleteWeek": weeks[-1]["week_end"],
        "weeks": weeks,
        "partial": partial,
        "researchOnly": True,
    }


def write_json_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temp = tempfile.mkstemp(dir=path.parent, prefix=path.name, suffix=".tmp")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            json.dump(payload, stream, ensure_ascii=False, separators=(",", ":"))
            stream.write("\n")
        os.replace(temp, path)
    except BaseException:
        if os.path.exists(temp):
            os.unlink(temp)
        raise


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=OUT_FILE)
    args = parser.parse_args(argv)
    payload = build(fetch_yahoo_daily(), datetime.now(timezone.utc))
    write_json_atomic(args.out, payload)
    print(f"BTC weekly snapshot: {len(payload['weeks'])} complete weeks, last {payload['lastCompleteWeek']}")


if __name__ == "__main__":
    main()
