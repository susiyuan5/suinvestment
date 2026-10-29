from __future__ import annotations

import argparse
import json
import math
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from data_loader import daily_to_weekly, load_yahoo_daily_prices


SYMBOLS = ("BYDDY", "MSFT", "NVDA", "AAPL", "ASML", "KO", "QQQ", "SPY")
OUT_FILE = Path("data/backtest-prices.json")
EXTRA_SYMBOLS_FILE = Path("data/weekly-history-symbols.json")
DEFAULT_START = "2021-06-01"
MIN_WEEKS = 50
# Stocks Su adds to the weekly plan only need enough weeks for the dashboard's
# trend/volatility/drawdown checks (WeeklySignalModel.riskDataStatus needs 21).
MIN_EXTRA_WEEKS = 21
MAX_EXTRA_SYMBOLS = 40
SYMBOL_PATTERN = re.compile(r"^[A-Z][A-Z0-9.-]{0,9}$")


def load_extra_symbols(path: Path = EXTRA_SYMBOLS_FILE) -> tuple[str, ...]:
    """Owner-maintained extra symbols; core SYMBOLS stay fixed and strict."""
    if not path.exists():
        return ()
    payload = json.loads(path.read_text(encoding="utf-8"))
    symbols = payload.get("symbols") if isinstance(payload, dict) else None
    if not isinstance(symbols, list):
        raise ValueError(f"{path} must contain a symbols list")
    cleaned: list[str] = []
    for symbol in symbols:
        if not isinstance(symbol, str) or not SYMBOL_PATTERN.match(symbol):
            raise ValueError(f"{path} contains an invalid symbol: {symbol!r}")
        if symbol not in SYMBOLS and symbol not in cleaned:
            cleaned.append(symbol)
    if len(cleaned) > MAX_EXTRA_SYMBOLS:
        raise ValueError(f"{path} lists more than {MAX_EXTRA_SYMBOLS} symbols")
    return tuple(cleaned)


def main() -> None:
    args = parse_args()
    previous = load_previous_snapshot(OUT_FILE)
    end = args.end or datetime.now(timezone.utc).date().isoformat()

    result = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "Yahoo Finance chart weekly data generated locally",
        "symbols": {},
        "metadata": {},
        "errors": {},
    }

    for symbol in SYMBOLS:
        existing_rows = previous.get("symbols", {}).get(symbol)
        should_fetch = args.refresh_all or not args.reuse_complete or not enough_rows(existing_rows)

        if should_fetch:
            try:
                rows = fetch_weekly_rows(symbol, args.start, end)
                result["symbols"][symbol] = rows
                result["metadata"][symbol] = build_metadata(rows, "Yahoo Finance chart API", "validated")
            except Exception as error:
                if not enough_rows(existing_rows):
                    raise
                result["symbols"][symbol] = existing_rows
                result["metadata"][symbol] = build_metadata(existing_rows, "Previous historical snapshot", "stale_fallback", str(error))
                result["errors"][symbol] = str(error)
        else:
            result["symbols"][symbol] = existing_rows
            result["metadata"][symbol] = build_metadata(existing_rows, "Previous historical snapshot", "reused")

    validate_snapshot(result, previous=previous, max_lag_days=args.max_lag_days, as_of=end)
    add_extra_symbols(result, previous, load_extra_symbols(), args.start, end, args.max_lag_days)
    write_json_atomic(OUT_FILE, result)
    print(f"Wrote {OUT_FILE} with {len(result['symbols'])} symbols")
    if result["errors"]:
        print("Symbols with errors (kept previous rows or skipped): " + ", ".join(sorted(result["errors"])))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate dashboard historical weekly price snapshot.")
    parser.add_argument("--start", default=DEFAULT_START, help="Start date in YYYY-MM-DD format.")
    parser.add_argument("--end", default="", help="End date in YYYY-MM-DD format; defaults to today UTC.")
    parser.add_argument("--refresh-all", action="store_true", help="Refresh all symbols instead of only missing/short histories.")
    parser.add_argument("--reuse-complete", action="store_true", help="Reuse complete histories; default behavior refreshes every symbol.")
    parser.add_argument("--max-lag-days", type=int, default=10, help="Maximum allowed lag from requested end date for validated rows.")
    return parser.parse_args()


def load_previous_snapshot(path: Path) -> dict:
    if not path.exists():
        return {"symbols": {}}
    return json.loads(path.read_text(encoding="utf-8"))


def add_extra_symbols(result: dict, previous: dict, extras: tuple[str, ...], start: str, end: str,
                      max_lag_days: int, fetch=None) -> None:
    """Best effort: an extra symbol that fails never blocks the core snapshot.

    A failed or invalid refresh keeps the previous valid rows when available;
    otherwise the symbol is left out and recorded in ``errors``.
    """
    fetch = fetch or fetch_weekly_rows
    for symbol in extras:
        existing = previous.get("symbols", {}).get(symbol)
        try:
            rows = fetch(symbol, start, end, min_weeks=MIN_EXTRA_WEEKS)
            check_rows(symbol, rows, previous=previous, min_weeks=MIN_EXTRA_WEEKS,
                       validated=True, max_lag_days=max_lag_days, as_of=end)
            result["symbols"][symbol] = rows
            result["metadata"][symbol] = build_metadata(rows, "Yahoo Finance chart API", "validated")
        except Exception as error:
            result["errors"][symbol] = str(error)
            try:
                check_rows(symbol, existing, previous={"symbols": {}}, min_weeks=MIN_EXTRA_WEEKS,
                           validated=False, max_lag_days=max_lag_days, as_of=end)
            except Exception:
                continue
            result["symbols"][symbol] = existing
            result["metadata"][symbol] = build_metadata(existing, "Previous historical snapshot", "stale_fallback", str(error))


def check_rows(symbol: str, rows: object, *, previous: dict, min_weeks: int, validated: bool,
               max_lag_days: int, as_of: str) -> None:
    if not isinstance(rows, list) or len(rows) < min_weeks:
        raise RuntimeError(f"{symbol} has fewer than {min_weeks} weekly rows")
    dates = [str(row.get("date", "")) for row in rows if isinstance(row, dict)]
    closes = [row.get("close") for row in rows if isinstance(row, dict)]
    if len(dates) != len(rows) or dates != sorted(dates) or len(dates) != len(set(dates)):
        raise RuntimeError(f"{symbol} dates must be strictly increasing and unique")
    if any(not isinstance(close, (int, float)) or not math.isfinite(close) or close <= 0 for close in closes):
        raise RuntimeError(f"{symbol} contains a non-positive or non-finite close")
    previous_rows = previous.get("symbols", {}).get(symbol, [])
    if isinstance(previous_rows, list) and previous_rows and dates[-1] < str(previous_rows[-1].get("date", "")):
        raise RuntimeError(f"{symbol} regressed from the previous latest date")
    if validated:
        lag = (date.fromisoformat(as_of) - date.fromisoformat(dates[-1])).days
        if lag > max_lag_days:
            raise RuntimeError(f"{symbol} latest date is {lag} days behind requested end date")


def fetch_weekly_rows(symbol: str, start: str, end: str, min_weeks: int = MIN_WEEKS) -> list[dict[str, float | str]]:
    daily = load_yahoo_daily_prices(symbol, start, end)
    weekly = daily_to_weekly(daily)
    rows = [
        {
            "date": point.date.isoformat(),
            "close": round(point.close, 6),
        }
        for point in weekly
    ]
    if len(rows) < min_weeks:
        raise RuntimeError(f"{symbol} has only {len(rows)} weekly rows")
    return rows


def enough_rows(rows: object) -> bool:
    return isinstance(rows, list) and len(rows) >= MIN_WEEKS


def build_metadata(rows: list[dict], source: str, status: str, error: str = "") -> dict:
    return {
        "rowCount": len(rows),
        "firstDate": rows[0].get("date") if rows else None,
        "latestDate": rows[-1].get("date") if rows else None,
        "source": source,
        "sourceType": "api" if status == "validated" else "fallback",
        "validationStatus": status,
        "errorReason": error,
    }


def validate_snapshot(snapshot: dict, *, previous: dict, max_lag_days: int, as_of: str) -> None:
    missing = []
    for symbol in SYMBOLS:
        rows = snapshot.get("symbols", {}).get(symbol)
        if not enough_rows(rows):
            missing.append(symbol)
            continue
        dates = [str(row.get("date", "")) for row in rows if isinstance(row, dict)]
        closes = [row.get("close") for row in rows if isinstance(row, dict)]
        if len(dates) != len(rows) or dates != sorted(dates) or len(dates) != len(set(dates)):
            raise RuntimeError(f"{symbol} dates must be strictly increasing and unique")
        if any(not isinstance(close, (int, float)) or not math.isfinite(close) or close <= 0 for close in closes):
            raise RuntimeError(f"{symbol} contains a non-positive or non-finite close")
        previous_rows = previous.get("symbols", {}).get(symbol, [])
        if enough_rows(previous_rows) and dates[-1] < str(previous_rows[-1].get("date", "")):
            raise RuntimeError(f"{symbol} regressed from the previous latest date")
        metadata = snapshot.get("metadata", {}).get(symbol, {})
        if metadata.get("validationStatus") == "validated":
            lag = (date.fromisoformat(as_of) - date.fromisoformat(dates[-1])).days
            if lag > max_lag_days:
                raise RuntimeError(f"{symbol} latest date is {lag} days behind requested end date")
    if missing:
        raise RuntimeError(f"Missing or short histories: {', '.join(missing)}")


def write_json_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


if __name__ == "__main__":
    main()
