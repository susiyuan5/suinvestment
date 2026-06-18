from __future__ import annotations

import csv
import json
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
ACTIVE_UNIVERSE_PATH = ROOT / "data" / "research-universe.json"
EXPANDED_UNIVERSE_PATH = ROOT / "data" / "research-universe-sector-balanced-80.json"
ACTIVE_PRICES_PATH = ROOT / "data" / "research-prices.json"
EXPANDED_PRICES_PATH = ROOT / "data" / "research-prices-sector-balanced-80.json"
PHASE6I_COMPARISON_PATH = ROOT / "research" / "results" / "phase6i" / "universe-comparison-38-vs-80.json"
REFERENCE_SYMBOLS = {"QQQ", "SPY", "DIA", "IWM"}
FACTORS = (
    "weekly_return",
    "momentum_4w",
    "momentum_12w",
    "volatility_12w",
    "drawdown_from_52w_high",
    "sma_10_distance",
    "sma_20_distance",
    "rsi_14",
    "macd",
)
HORIZONS = (1, 4, 12)


@dataclass(frozen=True)
class UniverseData:
    label: str
    universe: dict[str, Any]
    prices: dict[str, Any]

    @property
    def symbols(self) -> list[str]:
        return list(self.universe["research_universe_symbols"])

    @property
    def references(self) -> list[str]:
        return list(self.universe["reference_symbols"])

    @property
    def category_by_symbol(self) -> dict[str, str]:
        lookup: dict[str, str] = {}
        for category, symbols in self.universe.get("category_metadata", {}).items():
            for symbol in symbols:
                lookup[symbol] = category
        return lookup


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def load_universe_pair() -> tuple[UniverseData, UniverseData]:
    return (
        UniverseData("active_38", load_json(ACTIVE_UNIVERSE_PATH), load_json(ACTIVE_PRICES_PATH)),
        UniverseData("expanded_80", load_json(EXPANDED_UNIVERSE_PATH), load_json(EXPANDED_PRICES_PATH)),
    )


def category_counts(data: UniverseData) -> dict[str, int]:
    counts: dict[str, int] = {}
    lookup = data.category_by_symbol
    for symbol in data.symbols:
        category = lookup[symbol]
        counts[category] = counts.get(category, 0) + 1
    return dict(sorted(counts.items()))


def coverage_summary(data: UniverseData) -> dict[str, Any]:
    symbols_payload = data.prices.get("symbols", {})
    expected = set(data.symbols) | set(data.references)
    present = expected & set(symbols_payload)
    failures = data.prices.get("failures", [])
    short = [
        symbol
        for symbol in present
        if int(symbols_payload[symbol].get("rowCount", len(symbols_payload[symbol].get("rows", [])))) < 50
    ]
    latest = [symbols_payload[s].get("latestDate") for s in present if symbols_payload[s].get("latestDate")]
    first = [symbols_payload[s].get("firstDate") for s in present if symbols_payload[s].get("firstDate")]
    return {
        "expectedSymbolsWithReferences": len(expected),
        "presentSymbols": len(present),
        "researchSymbols": len(data.symbols),
        "referenceSymbols": len(data.references),
        "failures": len(failures),
        "shortHistories": len(short),
        "latestDateMin": min(latest) if latest else "",
        "latestDateMax": max(latest) if latest else "",
        "firstDateMin": min(first) if first else "",
        "firstDateMax": max(first) if first else "",
    }


def build_factor_records(data: UniverseData) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    lookup = data.category_by_symbol
    for symbol in data.symbols:
        payload = data.prices.get("symbols", {}).get(symbol, {})
        rows = payload.get("rows", [])
        closes = [float(row["close"]) for row in rows]
        dates = [str(row["date"]) for row in rows]
        weekly_returns = pct_change(closes, 1)
        sma10 = rolling_mean(closes, 10)
        sma20 = rolling_mean(closes, 20)
        macd_line = macd(closes)
        for idx, close in enumerate(closes):
            high_52 = max(closes[max(0, idx - 51) : idx + 1])
            record = {
                "ticker": symbol,
                "date": dates[idx],
                "category": lookup[symbol],
                "close": close,
                "weekly_return": weekly_returns[idx],
                "momentum_4w": ratio_change(closes, idx, 4),
                "momentum_12w": ratio_change(closes, idx, 12),
                "volatility_12w": rolling_std(weekly_returns, idx, 12),
                "drawdown_from_52w_high": 1 - close / high_52 if high_52 else None,
                "sma_10_distance": close / sma10[idx] - 1 if sma10[idx] else None,
                "sma_20_distance": close / sma20[idx] - 1 if sma20[idx] else None,
                "rsi_14": rsi(closes, idx, 14),
                "macd": macd_line[idx],
            }
            for horizon in HORIZONS:
                record[f"forward_{horizon}w_return"] = ratio_change(closes, idx + horizon, horizon, base_index=idx)
            records.append(record)
    return records


def summarize_factor_quality(records: list[dict[str, Any]]) -> dict[str, Any]:
    rows = []
    for factor in FACTORS:
        values = [row[factor] for row in records if is_number(row.get(factor))]
        rows.append(
            {
                "factor": factor,
                "coverage": round(len(values) / len(records), 8) if records else 0,
                "observations": len(values),
                "mean_abs_value": round(mean(abs(v) for v in values), 8) if values else "",
            }
        )
    return {"rows": rows}


def mean_rank_ic_by_factor(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_date: dict[str, list[dict[str, Any]]] = {}
    for row in records:
        by_date.setdefault(row["date"], []).append(row)
    output = []
    for factor in FACTORS:
        for horizon in HORIZONS:
            target = f"forward_{horizon}w_return"
            ics = []
            for rows in by_date.values():
                clean = [row for row in rows if is_number(row.get(factor)) and is_number(row.get(target))]
                if len(clean) < 6:
                    continue
                corr = spearman([row[factor] for row in clean], [row[target] for row in clean])
                if is_number(corr):
                    ics.append(corr)
            output.append(
                {
                    "factor": factor,
                    "horizon": f"{horizon}w",
                    "mean_rank_ic": round(mean(ics), 8) if ics else "",
                    "ic_periods": len(ics),
                    "positive_rate": round(sum(1 for value in ics if value > 0) / len(ics), 8) if ics else "",
                }
            )
    return output


def sector_factor_summary(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    output = []
    categories = sorted({row["category"] for row in records})
    for category in categories:
        selected = [row for row in records if row["category"] == category]
        for row in mean_rank_ic_by_factor(selected):
            row = dict(row)
            row["category"] = category
            output.append(row)
    return output


def top_rank_stability(records: list[dict[str, Any]], factor: str = "volatility_12w", horizon: str = "12w") -> dict[str, Any]:
    target = f"forward_{horizon}_return" if not horizon.endswith("w") else f"forward_{horizon[:-1]}w_return"
    by_date: dict[str, list[dict[str, Any]]] = {}
    for row in records:
        if is_number(row.get(factor)) and is_number(row.get(target)):
            by_date.setdefault(row["date"], []).append(row)
    hit_counts: dict[str, int] = {}
    periods = 0
    for rows in by_date.values():
        if len(rows) < 10:
            continue
        periods += 1
        ranked = sorted(rows, key=lambda row: row[factor], reverse=True)[: max(1, len(rows) // 5)]
        for row in ranked:
            hit_counts[row["ticker"]] = hit_counts.get(row["ticker"], 0) + 1
    leaders = sorted(hit_counts.items(), key=lambda item: item[1], reverse=True)[:10]
    return {"periods": periods, "leaders": [{"symbol": symbol, "top_rank_count": count} for symbol, count in leaders]}


def pct_change(values: list[float], lag: int) -> list[float | None]:
    return [ratio_change(values, idx, lag) for idx in range(len(values))]


def ratio_change(values: list[float], idx: int, lag: int, base_index: int | None = None) -> float | None:
    base = idx - lag if base_index is None else base_index
    if idx < 0 or idx >= len(values) or base < 0 or base >= len(values) or values[base] == 0:
        return None
    return values[idx] / values[base] - 1


def rolling_mean(values: list[float], window: int) -> list[float | None]:
    output: list[float | None] = []
    for idx in range(len(values)):
        if idx + 1 < window:
            output.append(None)
        else:
            output.append(mean(values[idx - window + 1 : idx + 1]))
    return output


def rolling_std(values: list[float | None], idx: int, window: int) -> float | None:
    if idx + 1 < window:
        return None
    clean = [value for value in values[idx - window + 1 : idx + 1] if is_number(value)]
    if len(clean) < window:
        return None
    avg = mean(clean)
    return math.sqrt(sum((value - avg) ** 2 for value in clean) / len(clean))


def rsi(values: list[float], idx: int, window: int) -> float | None:
    if idx < window:
        return None
    gains = []
    losses = []
    for pos in range(idx - window + 1, idx + 1):
        change = values[pos] - values[pos - 1]
        gains.append(max(change, 0))
        losses.append(abs(min(change, 0)))
    avg_gain = mean(gains)
    avg_loss = mean(losses)
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - 100 / (1 + rs)


def macd(values: list[float]) -> list[float | None]:
    ema12 = ema(values, 12)
    ema26 = ema(values, 26)
    return [a - b if is_number(a) and is_number(b) else None for a, b in zip(ema12, ema26)]


def ema(values: list[float], span: int) -> list[float | None]:
    output: list[float | None] = []
    alpha = 2 / (span + 1)
    current = None
    for value in values:
        current = value if current is None else alpha * value + (1 - alpha) * current
        output.append(current)
    return output


def spearman(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) != len(ys) or len(xs) < 2:
        return None
    return pearson(rank(xs), rank(ys))


def pearson(xs: list[float], ys: list[float]) -> float | None:
    avg_x = mean(xs)
    avg_y = mean(ys)
    num = sum((x - avg_x) * (y - avg_y) for x, y in zip(xs, ys))
    den_x = math.sqrt(sum((x - avg_x) ** 2 for x in xs))
    den_y = math.sqrt(sum((y - avg_y) ** 2 for y in ys))
    if den_x == 0 or den_y == 0:
        return None
    return num / (den_x * den_y)


def rank(values: list[float]) -> list[float]:
    sorted_pairs = sorted((value, idx) for idx, value in enumerate(values))
    ranks = [0.0] * len(values)
    pos = 0
    while pos < len(sorted_pairs):
        end = pos
        while end + 1 < len(sorted_pairs) and sorted_pairs[end + 1][0] == sorted_pairs[pos][0]:
            end += 1
        avg_rank = (pos + end + 2) / 2
        for item in range(pos, end + 1):
            ranks[sorted_pairs[item][1]] = avg_rank
        pos = end + 1
    return ranks


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value == value
