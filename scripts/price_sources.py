from __future__ import annotations

import csv
import io
import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable


SYMBOLS = ("BYDDY", "MSFT", "NVDA", "AAPL", "ASML", "KO", "QQQ", "SPY")
OUT_FILE = Path("data/market-data.json")
REPORT_FILE = Path("results/data_freshness/market_price_freshness.json")
MAX_FRESH_AGE_HOURS = 24.0
FUTURE_TOLERANCE = timedelta(minutes=5)
REQUEST_TIMEOUT_SECONDS = 20
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SuInvestmentPriceRefresh/1.0"


def main() -> None:
    previous = load_json(OUT_FILE, {"symbols": {}})
    generated_at = utc_now()
    result = {
        "generatedAt": isoformat(generated_at),
        "source": "Validated multi-source market snapshot",
        "sourcePriority": [
            "Yahoo Finance Chart API",
            "Stooq daily CSV API",
            "Previous weekly snapshot",
        ],
        "comparison": "decision signal uses the lower of latest close vs previous close and latest close vs 5 trading sessions earlier",
        "symbols": {},
        "errors": {},
    }

    for symbol in SYMBOLS:
        snapshot, errors = fetch_best_snapshot(
            symbol,
            previous.get("symbols", {}).get(symbol),
            previous.get("generatedAt"),
            now=generated_at,
        )
        result["symbols"][symbol] = snapshot
        if errors:
            result["errors"][symbol] = errors
        time.sleep(0.15)

    summary = summarize_snapshot(result)
    result["summary"] = summary
    publishable, publish_reason = is_publishable(result, previous)
    result["publishStatus"] = "published" if publishable else "skipped"
    result["publishReason"] = publish_reason
    if publishable:
        write_json_atomic(OUT_FILE, result)
    write_json_atomic(
        REPORT_FILE,
        {
            "generatedAt": result["generatedAt"],
            "publishStatus": result["publishStatus"],
            "publishReason": publish_reason,
            **summary,
            "symbols": result["symbols"],
            "errors": result["errors"],
        },
    )
    print(
        f"{result['publishStatus'].title()} market snapshot: {summary['freshSymbols']}/{summary['totalSymbols']} "
        "fresh validated symbols"
    )
    if summary["staleSymbols"]:
        print(
            f"{summary['staleSymbols']} symbols remain stale/fallback and cannot "
            "enable an extra DCA buy."
        )


def is_publishable(result: dict, previous: dict) -> tuple[bool, str]:
    symbols = result.get("symbols", {})
    prior_symbols = previous.get("symbols", {})
    required = ("QQQ", "SPY")
    if any(symbols.get(symbol, {}).get("validationStatus") != "validated" for symbol in required):
        return False, "QQQ and SPY must both be validated before publishing"
    if not any(item.get("validationStatus") == "validated" for item in symbols.values()):
        return False, "No validated symbols were available"
    for symbol, current in symbols.items():
        old = prior_symbols.get(symbol, {})
        current_time = parse_timestamp(current.get("quoteTimestamp"))
        previous_time = parse_timestamp(old.get("quoteTimestamp"))
        if current.get("validationStatus") == "validated" and previous_time and current_time and current_time < previous_time:
            return False, f"{symbol} would regress the previous validated quote timestamp"
    return True, "Validated references and monotonic quote timestamps"


def fetch_best_snapshot(
    symbol: str,
    previous: dict | None,
    previous_generated_at: str | None,
    *,
    now: datetime | None = None,
    providers: tuple[Callable[[str], dict], ...] | None = None,
) -> tuple[dict, list[str]]:
    current_time = now or utc_now()
    source_functions = providers or (fetch_yahoo_daily, fetch_stooq_daily)
    errors: list[str] = []
    stale_candidates: list[dict] = []

    for provider in source_functions:
        source_name = getattr(provider, "source_name", provider.__name__)
        try:
            candidate = validate_snapshot(provider(symbol), now=current_time)
            if candidate["validationStatus"] == "validated":
                return candidate, errors
            stale_candidates.append(candidate)
            errors.append(f"{source_name}: {candidate['validationReason']}")
        except Exception as error:  # one source must not stop the remaining symbols
            errors.append(f"{source_name}: {error}")

    if is_currently_validated(previous, now=current_time):
        return dict(previous), errors

    if stale_candidates:
        newest = max(
            stale_candidates,
            key=lambda item: parse_timestamp(item.get("quoteTimestamp"))
            or datetime.min.replace(tzinfo=timezone.utc),
        )
        previous_time = parse_timestamp(previous.get("quoteTimestamp")) if previous else None
        newest_time = parse_timestamp(newest.get("quoteTimestamp"))
        if not previous or (newest_time and (not previous_time or newest_time >= previous_time)):
            return newest, errors

    if previous:
        return mark_previous_fallback(previous, previous_generated_at, errors, now=current_time), errors
    return unavailable_snapshot(symbol, errors, now=current_time), errors


def fetch_yahoo_daily(symbol: str) -> dict:
    encoded = urllib.parse.quote(symbol.upper())
    errors = []
    for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
        url = f"https://{host}/v8/finance/chart/{encoded}?range=1mo&interval=1d"
        try:
            payload = fetch_json(url)
            result = ((payload.get("chart") or {}).get("result") or [None])[0]
            if not result:
                chart_error = (payload.get("chart") or {}).get("error") or {}
                raise RuntimeError(chart_error.get("description") or "Yahoo payload missing result")
            timestamps = result.get("timestamp") or []
            quote = ((result.get("indicators") or {}).get("quote") or [{}])[0]
            closes = quote.get("close") or []
            points = [
                (datetime.fromtimestamp(timestamp, tz=timezone.utc), float(close))
                for timestamp, close in zip(timestamps, closes)
                if isinstance(close, (int, float)) and math.isfinite(close) and close > 0
            ]
            regular_market_price = (result.get("meta") or {}).get("regularMarketPrice")
            return build_snapshot(
                symbol,
                points,
                source="Yahoo Finance Chart API",
                source_type="api",
                trusted=True,
                regular_market_price=regular_market_price,
            )
        except Exception as error:
            errors.append(f"{host}: {error}")
    raise RuntimeError(" | ".join(errors))


fetch_yahoo_daily.source_name = "Yahoo Finance Chart API"


def fetch_stooq_daily(symbol: str) -> dict:
    end = utc_now().date()
    start = end - timedelta(days=45)
    stooq_symbol = f"{symbol.lower()}.us"
    query = urllib.parse.urlencode(
        {"s": stooq_symbol, "d1": start.strftime("%Y%m%d"), "d2": end.strftime("%Y%m%d"), "i": "d"}
    )
    content = fetch_text(f"https://stooq.com/q/d/l/?{query}")
    reader = csv.DictReader(io.StringIO(content))
    points = []
    for row in reader:
        try:
            close = float(row.get("Close", ""))
            day = datetime.strptime(row.get("Date", ""), "%Y-%m-%d").replace(
                hour=21, tzinfo=timezone.utc
            )
        except (TypeError, ValueError):
            continue
        if math.isfinite(close) and close > 0:
            points.append((day, close))
    return build_snapshot(
        symbol,
        points,
        source="Stooq daily CSV API",
        source_type="api",
        trusted=True,
    )


fetch_stooq_daily.source_name = "Stooq daily CSV API"


def build_snapshot(
    symbol: str,
    points: list[tuple[datetime, float]],
    *,
    source: str,
    source_type: str,
    trusted: bool,
    regular_market_price: object = None,
) -> dict:
    if len(points) < 6:
        raise RuntimeError(f"{source} returned fewer than 6 valid closes")
    points = sorted(points, key=lambda item: item[0])
    latest, previous, week_ago = points[-1], points[-2], points[-6]
    market_price = float(regular_market_price) if is_positive_number(regular_market_price) else latest[1]
    daily_change = round2(((latest[1] - previous[1]) / previous[1]) * 100)
    weekly_change = round2(((latest[1] - week_ago[1]) / week_ago[1]) * 100)
    return {
        "symbol": symbol,
        "price": round2(market_price),
        "latestClose": round2(latest[1]),
        "latestDate": latest[0].date().isoformat(),
        "previousClose": round2(previous[1]),
        "previousDate": previous[0].date().isoformat(),
        "weekAgoClose": round2(week_ago[1]),
        "weekAgoDate": week_ago[0].date().isoformat(),
        "dailyChange": daily_change,
        "weeklyChange": weekly_change,
        "decisionChange": min(weekly_change, daily_change),
        "quoteTimestamp": isoformat(latest[0]),
        "fetchTimestamp": isoformat(utc_now()),
        "source": source,
        "sourceType": source_type,
        "trustedSource": trusted,
    }


def validate_snapshot(snapshot: dict, *, now: datetime | None = None) -> dict:
    current_time = now or utc_now()
    price = snapshot.get("price")
    quote_time = parse_timestamp(snapshot.get("quoteTimestamp"))
    if not is_positive_number(price):
        return invalid_snapshot(snapshot, "Price is missing, non-numeric, or non-positive")
    if not quote_time:
        return invalid_snapshot(snapshot, "Quote timestamp is missing")
    if quote_time > current_time + FUTURE_TOLERANCE:
        return invalid_snapshot(snapshot, "Quote timestamp is in the future")

    age_hours = round2(max(0.0, (current_time - quote_time).total_seconds() / 3600))
    previous_close = snapshot.get("previousClose")
    move_pct = (
        abs((float(price) - float(previous_close)) / float(previous_close) * 100)
        if is_positive_number(previous_close)
        else None
    )
    warnings = []
    if move_pct is not None and move_pct > 40:
        warnings.append(f"Price differs {round2(move_pct)}% from prior close")
    implausible_move = move_pct is not None and move_pct > 80
    untrusted_large_move = (
        move_pct is not None and move_pct > 40 and snapshot.get("trustedSource") is not True
    )
    stale = age_hours > MAX_FRESH_AGE_HOURS
    if implausible_move:
        status, reason = "manual_review", "Implausible price move requires manual review"
    elif untrusted_large_move:
        status, reason = "manual_review", "Large move from an untrusted source requires manual review"
    elif stale:
        status, reason = "stale", f"Quote age {age_hours}h exceeds 24h"
    else:
        status, reason = "validated", "Price and timestamp validated"

    return {
        **snapshot,
        "freshnessAgeHours": age_hours,
        "validationStatus": status,
        "validationReason": reason,
        "validationWarnings": warnings,
        "stale": status != "validated",
        "staleReason": "" if status == "validated" else reason,
    }


def invalid_snapshot(snapshot: dict, reason: str) -> dict:
    return {
        **snapshot,
        "freshnessAgeHours": None,
        "validationStatus": "invalid",
        "validationReason": reason,
        "validationWarnings": [reason],
        "stale": True,
        "staleReason": reason,
    }


def is_currently_validated(snapshot: dict | None, *, now: datetime | None = None) -> bool:
    if not snapshot or snapshot.get("validationStatus") != "validated":
        return False
    quote_time = parse_timestamp(snapshot.get("quoteTimestamp"))
    current_time = now or utc_now()
    return bool(
        quote_time
        and quote_time <= current_time + FUTURE_TOLERANCE
        and (current_time - quote_time).total_seconds() / 3600 <= MAX_FRESH_AGE_HOURS
    )


def mark_previous_fallback(
    previous: dict,
    previous_generated_at: str | None,
    errors: list[str],
    *,
    now: datetime | None = None,
) -> dict:
    current_time = now or utc_now()
    upstream_source = previous.get("source") or "Previous weekly snapshot"
    quote_timestamp = previous.get("quoteTimestamp")
    if not quote_timestamp and previous.get("latestDate"):
        quote_timestamp = f"{previous['latestDate']}T21:00:00+00:00"
    quote_time = parse_timestamp(quote_timestamp)
    age_hours = (
        round2(max(0.0, (current_time - quote_time).total_seconds() / 3600))
        if quote_time
        else None
    )
    reason = " | ".join(errors) or "All live quote sources failed"
    return {
        **previous,
        "source": "Previous weekly snapshot",
        "sourceType": "fallback",
        "upstreamSource": upstream_source,
        "quoteTimestamp": quote_timestamp or previous_generated_at,
        "fetchTimestamp": isoformat(current_time),
        "freshnessAgeHours": age_hours,
        "validationStatus": "stale_fallback",
        "validationReason": reason,
        "validationWarnings": errors,
        "stale": True,
        "staleReason": reason,
        "staleFrom": previous_generated_at or previous.get("staleFrom"),
    }


def unavailable_snapshot(symbol: str, errors: list[str], *, now: datetime | None = None) -> dict:
    reason = " | ".join(errors) or "All live quote sources failed"
    return {
        "symbol": symbol,
        "price": None,
        "latestClose": None,
        "latestDate": None,
        "previousClose": None,
        "previousDate": None,
        "weekAgoClose": None,
        "weekAgoDate": None,
        "dailyChange": None,
        "weeklyChange": None,
        "decisionChange": None,
        "quoteTimestamp": None,
        "fetchTimestamp": isoformat(now or utc_now()),
        "source": "Unavailable",
        "sourceType": "fallback",
        "trustedSource": False,
        "freshnessAgeHours": None,
        "validationStatus": "unavailable",
        "validationReason": reason,
        "validationWarnings": errors,
        "stale": True,
        "staleReason": reason,
    }


def summarize_snapshot(result: dict) -> dict:
    items = list(result.get("symbols", {}).values())
    fresh = [item for item in items if item.get("validationStatus") == "validated"]
    counts: dict[str, int] = {}
    for item in items:
        source = item.get("source") or "Unknown"
        counts[source] = counts.get(source, 0) + 1
    return {
        "totalSymbols": len(items),
        "freshSymbols": len(fresh),
        "staleSymbols": len(items) - len(fresh),
        "freshSymbolNames": [item.get("symbol") for item in fresh],
        "staleSymbolNames": [
            item.get("symbol") for item in items if item.get("validationStatus") != "validated"
        ],
        "sourceCounts": counts,
    }


def fetch_json(url: str) -> dict:
    return json.loads(fetch_text(url))


def fetch_text(url: str) -> str:
    request = urllib.request.Request(
        url,
        headers={"accept": "application/json,text/csv;q=0.9,*/*;q=0.8", "user-agent": USER_AGENT},
    )
    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        return response.read().decode("utf-8")


def load_json(path: Path, fallback: dict) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return fallback


def write_json_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def parse_timestamp(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def is_positive_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def isoformat(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def round2(value: float) -> float:
    return round(float(value) + 1e-12, 2)


if __name__ == "__main__":
    main()
