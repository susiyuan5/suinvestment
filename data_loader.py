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
    open: float | None = None
    high: float | None = None
    low: float | None = None
    adjusted_close: float | None = None


@dataclass(frozen=True)
class WeeklyBar:
    week_end: date
    open: float
    high: float
    low: float
    close: float
    adjusted_open: float
    adjusted_high: float
    adjusted_low: float
    adjusted_close: float


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
    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    adjusted_closes = ((result.get("indicators", {}).get("adjclose") or [{}])[0].get("adjclose") or [])
    points: list[PricePoint] = []

    for index, (timestamp, close) in enumerate(zip(timestamps, closes)):
        if isinstance(close, (int, float)) and close > 0:
            point_date = datetime.fromtimestamp(timestamp, tz=timezone.utc).date()
            open_price = opens[index] if index < len(opens) else None
            high_price = highs[index] if index < len(highs) else None
            low_price = lows[index] if index < len(lows) else None
            adjusted_close = adjusted_closes[index] if index < len(adjusted_closes) else None
            points.append(
                PricePoint(
                    point_date,
                    float(close),
                    float(open_price) if isinstance(open_price, (int, float)) and open_price > 0 else None,
                    float(high_price) if isinstance(high_price, (int, float)) and high_price > 0 else None,
                    float(low_price) if isinstance(low_price, (int, float)) and low_price > 0 else None,
                    float(adjusted_close) if isinstance(adjusted_close, (int, float)) and adjusted_close > 0 else None,
                )
            )

    if len(points) < 2:
        raise RuntimeError("Not enough daily price data")

    return points


def daily_to_weekly(daily_prices: list[PricePoint]) -> list[PricePoint]:
    weekly: dict[tuple[int, int], PricePoint] = {}
    for point in sorted(daily_prices, key=lambda item: item.date):
        iso_year, iso_week, _ = point.date.isocalendar()
        weekly[(iso_year, iso_week)] = point
    return list(weekly.values())


def daily_to_weekly_bars(daily_prices: list[PricePoint]) -> list[WeeklyBar]:
    grouped: dict[tuple[int, int], list[PricePoint]] = {}
    for point in sorted(daily_prices, key=lambda item: item.date):
        iso_year, iso_week, _ = point.date.isocalendar()
        grouped.setdefault((iso_year, iso_week), []).append(point)

    bars: list[WeeklyBar] = []
    for points in grouped.values():
        first, last = points[0], points[-1]
        def adjusted(value: float, point: PricePoint) -> float:
            factor = (point.adjusted_close or point.close) / point.close
            return value * factor

        raw_opens = [point.open for point in points if point.open is not None]
        raw_highs = [point.high for point in points if point.high is not None]
        raw_lows = [point.low for point in points if point.low is not None]
        open_price = raw_opens[0] if raw_opens else first.close
        high_price = max(raw_highs) if raw_highs else max(point.close for point in points)
        low_price = min(raw_lows) if raw_lows else min(point.close for point in points)
        adjusted_open = adjusted(open_price, first)
        adjusted_high = max(adjusted(point.high if point.high is not None else point.close, point) for point in points)
        adjusted_low = min(adjusted(point.low if point.low is not None else point.close, point) for point in points)
        bars.append(
            WeeklyBar(
                week_end=last.date,
                open=open_price,
                high=high_price,
                low=low_price,
                close=last.close,
                adjusted_open=adjusted_open,
                adjusted_high=adjusted_high,
                adjusted_low=adjusted_low,
                adjusted_close=last.adjusted_close or last.close,
            )
        )
    return bars


def _to_unix(value: str) -> int:
    dt = datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return int(dt.timestamp())
