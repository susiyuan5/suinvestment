"""Regular US equity sessions shared with the browser through a pinned JSON config."""
import json
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

EASTERN = ZoneInfo("America/New_York")


def load_calendar():
    try:
        c = json.loads((Path(__file__).resolve().parents[1] / "data/us-equity-calendar.json").read_text(encoding="utf-8"))
        if (c["version"] != "us-equity-sessions-2026-2028-v1" or c["timezone"] != "America/New_York"
                or c["validFrom"] != "2026-01-01" or c["validThrough"] != "2028-12-31"
                or c["previousSession"] != "2025-12-31" or c["open"] != "09:30" or c["close"] != "16:00"
                or c["officialCloseToleranceSeconds"] != 300 or len(c["holidays"]) != 29
                or len(set(c["holidays"])) != 29 or len(c["earlyCloses"]) != 5
                or not isinstance(c["exchangeAliases"], dict) or not isinstance(c["symbolExchanges"], dict)
                or any(t != "13:00" for t in c["earlyCloses"].values())):
            return None
        return c
    except (OSError, ValueError, KeyError, TypeError):
        return None


CALENDAR = load_calendar()


def session_close(day, calendar=CALENDAR):
    if not calendar:
        return None
    text = day.isoformat()
    if (text < calendar["validFrom"] and text != calendar["previousSession"]) or text > calendar["validThrough"]:
        return None
    if day.weekday() >= 5 or text in calendar["holidays"]:
        return None
    time = calendar["earlyCloses"].get(text, calendar["close"])
    return datetime.fromisoformat(text + "T" + time).replace(tzinfo=EASTERN)


def assess(quote, now, calendar=CALENDAR):
    def empty(reason):
        return dict(known=False, closed=False, eligible=False, missedSession=False, expectedClose=None, reason=reason)
    if not calendar:
        return empty("calendar_unavailable")
    exchange = quote.get("exchange") or calendar["symbolExchanges"].get(str(quote.get("symbol", "")).upper())
    if str(exchange or "").upper() not in calendar["exchangeAliases"]:
        return empty("unknown_exchange")
    local = now.astimezone(EASTERN)
    day = local.date()
    if not calendar["validFrom"] <= day.isoformat() <= calendar["validThrough"]:
        return empty("calendar_out_of_range")
    today_close = session_close(day, calendar)
    opening = datetime.fromisoformat(day.isoformat() + "T" + calendar["open"]).replace(tzinfo=EASTERN)
    closed = today_close is None or local < opening or local >= today_close
    expected = next((end for n in range(10) if (end := session_close(day - timedelta(days=n), calendar)) is not None and end <= local), None)
    if expected is None:
        return empty("calendar_out_of_range")
    try:
        ts = datetime.fromisoformat(quote["quoteTimestamp"].replace("Z", "+00:00")).astimezone(EASTERN)
    except (KeyError, TypeError, ValueError, AttributeError):
        ts = None
    official = ts is not None and ts <= local and expected <= ts <= expected + timedelta(seconds=calendar["officialCloseToleranceSeconds"])
    eligible = closed and official and quote.get("trustedSource") is True
    missed = ts is not None and ts.date() < expected.date()
    return dict(known=True, closed=closed, eligible=eligible, missedSession=missed,
                expectedClose=expected.astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z"),
                reason="latest_official_close" if eligible else "missing_latest_session" if missed else "no_closed_market_exemption")
