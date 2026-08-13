"""Build a compact same-origin price-trend fallback for stock detail pages."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "data" / "research-prices-sector-balanced-80.json"
DEFAULT_OUTPUT = ROOT / "data" / "idea-engine-v3" / "price-trends.json"


def _valid_row(row: Any) -> bool:
    if not isinstance(row, dict) or not isinstance(row.get("date"), str):
        return False
    close = row.get("close")
    return isinstance(close, (int, float)) and not isinstance(close, bool) and math.isfinite(close) and close > 0


def build_payload(source: dict[str, Any], *, lookback_points: int = 53) -> dict[str, Any]:
    if lookback_points < 2:
        raise ValueError("lookback_points must be at least 2")
    symbols = source.get("symbols")
    if not isinstance(symbols, dict):
        raise ValueError("source symbols must be an object")

    compact_symbols: dict[str, Any] = {}
    for raw_ticker, record in sorted(symbols.items()):
        ticker = str(raw_ticker).strip().upper()
        if not ticker or not isinstance(record, dict):
            continue
        rows = [row for row in record.get("rows", []) if _valid_row(row)]
        if len(rows) < 2:
            continue
        rows.sort(key=lambda row: row["date"])
        rows = rows[-lookback_points:]
        compact_symbols[ticker] = {
            "currency": "USD",
            "as_of": rows[-1]["date"],
            "points": [{"date": row["date"], "close": round(float(row["close"]), 6)} for row in rows],
        }

    if not compact_symbols:
        raise ValueError("source contains no valid price histories")

    canonical_source = json.dumps(source, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return {
        "schema_version": "idea-price-trends-v1",
        "generated_at": source.get("generatedAt"),
        "source_file": "data/research-prices-sector-balanced-80.json",
        "source_sha256": hashlib.sha256(canonical_source).hexdigest(),
        "research_only": True,
        "interval": "1wk",
        "lookback_points": lookback_points,
        "symbols": compact_symbols,
    }


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False, newline="\n") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")
        temporary = Path(handle.name)
    os.replace(temporary, path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--lookback-points", type=int, default=53)
    args = parser.parse_args()

    source = json.loads(args.input.read_text(encoding="utf-8"))
    payload = build_payload(source, lookback_points=args.lookback_points)
    atomic_write_json(args.output, payload)
    print(f"price_trends_symbols={len(payload['symbols'])}")
    print(f"price_trends_output={args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
