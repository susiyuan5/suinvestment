from __future__ import annotations

import json
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, timezone


@dataclass(frozen=True)
class PricePoint:
    date: date
    close: float


def load_yahoo_daily_prices(ticker: str, start: str, end: str) -> list[PricePoint]:
    start_ts = _to_unix(start)
    end_ts = _to_unix(end) + 24 * 60 * 60
    symbol = urllib.parse.quote(ticker.upper())
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
        f"?period1={start_ts}&period2={end_ts}&interval=1d"
    )
    request = urllib.request.Request(
        url,
        headers={
            "accept": "application/json",
            "user-agent": "Mozilla/5.0 SuInvestmentBacktest/1.0",
        },
    )

    with urllib.request.urlopen(request, timeout=20) as response:
        payload = json.loads(response.read().decode("utf-8"))

    chart = payload.get("chart", {})
    if chart.get("error"):
        description = chart["error"].get("description", "Yahoo returned an error")
        raise RuntimeError(description)

    result = chart.get("result", [None])[0]
    if not result:
        raise RuntimeError("Yahoo payload missing result")

    timestamps = result.get("timestamp") or []
    quote = (result.get("indicators", {}).get("quote") or [{}])[0]
    closes = quote.get("close") or []
    points: list[PricePoint] = []

    for timestamp, close in zip(timestamps, closes):
        if isinstance(close, (int, float)) and close > 0:
            point_date = datetime.fromtimestamp(timestamp, tz=timezone.utc).date()
            points.append(PricePoint(point_date, float(close)))

    if len(points) < 2:
        raise RuntimeError("Not enough daily price data")

    return points


def daily_to_weekly(daily_prices: list[PricePoint]) -> list[PricePoint]:
    weekly: dict[tuple[int, int], PricePoint] = {}
    for point in sorted(daily_prices, key=lambda item: item.date):
        iso_year, iso_week, _ = point.date.isocalendar()
        weekly[(iso_year, iso_week)] = point
    return list(weekly.values())


def _to_unix(value: str) -> int:
    dt = datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return int(dt.timestamp())
