"""Free, deterministic public-data provider for the Shadow Idea Engine.

SEC EDGAR supplies dated filing/XBRL facts and the existing Yahoo chart endpoint
supplies price/volume confirmation.  The provider never assigns a trade action;
the local arbitrator remains the only component allowed to grade candidates.
"""

from __future__ import annotations

import json
import math
import os
import re
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from statistics import mean, pstdev
from typing import Any, Callable

from ..contracts import DIMENSIONS
from ..evidence import make_evidence


SEC_BASE = "https://data.sec.gov"
SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
YAHOO_CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart"
DEFAULT_USER_AGENT = "SuInvestment susiyuan0807@gmail.com"
ELIGIBLE_FORMS = {"10-K", "10-Q", "20-F", "40-F", "6-K"}

FACT_TAGS = {
    "revenue": ("RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "Revenue"),
    "operating_income": ("OperatingIncomeLoss", "ProfitLossFromOperatingActivities"),
    "net_income": ("NetIncomeLoss", "ProfitLoss"),
    "operating_cash_flow": ("NetCashProvidedByUsedInOperatingActivities", "CashFlowsFromUsedInOperatingActivities"),
    "capex": ("PaymentsToAcquirePropertyPlantAndEquipment", "PurchaseOfPropertyPlantAndEquipment"),
    "assets": ("Assets",),
    "liabilities": ("Liabilities",),
    "inventory": ("InventoryNet", "Inventories"),
    "shares": ("EntityCommonStockSharesOutstanding", "CommonStockSharesOutstanding"),
}


class FreePublicDataError(RuntimeError):
    """Raised when the free provider cannot produce a safe payload."""


def _parse_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _iso_day(value: str) -> str:
    return f"{value[:10]}T00:00:00+00:00"


def _bounded(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return round(max(low, min(high, float(value))), 6)


def _safe_ratio(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or denominator is None or denominator == 0:
        return None
    value = numerator / denominator
    return value if math.isfinite(value) else None


def _average(values: list[float | None]) -> float | None:
    clean = [float(value) for value in values if value is not None and math.isfinite(float(value))]
    return mean(clean) if clean else None


def _first_not_none(*values: float | None) -> float | None:
    return next((value for value in values if value is not None), None)


def _request_json(url: str, *, user_agent: str, timeout: int = 30) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={"accept": "application/json", "user-agent": user_agent},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, dict):
        raise FreePublicDataError(f"JSON object required from {url}")
    return payload


@dataclass
class SecEdgarClient:
    """Small SEC client with an intentionally sub-limit request cadence."""

    fetch_json: Callable[..., dict[str, Any]] = _request_json
    user_agent: str = os.environ.get("SEC_USER_AGENT", DEFAULT_USER_AGENT)
    min_interval_seconds: float = 0.15

    def __post_init__(self) -> None:
        self._last_request = 0.0

    def _get(self, url: str) -> dict[str, Any]:
        wait = self.min_interval_seconds - (time.monotonic() - self._last_request)
        if wait > 0:
            time.sleep(wait)
        try:
            return self.fetch_json(url, user_agent=self.user_agent)
        finally:
            self._last_request = time.monotonic()

    def ticker_map(self) -> dict[str, dict[str, Any]]:
        payload = self._get(SEC_TICKERS_URL)
        return {
            str(row.get("ticker", "")).upper(): row
            for row in payload.values()
            if isinstance(row, dict) and row.get("ticker") and row.get("cik_str")
        }

    def submissions(self, cik: int) -> dict[str, Any]:
        return self._get(f"{SEC_BASE}/submissions/CIK{cik:010d}.json")

    def companyfacts(self, cik: int) -> dict[str, Any]:
        return self._get(f"{SEC_BASE}/api/xbrl/companyfacts/CIK{cik:010d}.json")


@dataclass
class YahooPriceClient:
    fetch_json: Callable[..., dict[str, Any]] = _request_json
    user_agent: str = DEFAULT_USER_AGENT

    def history(self, symbol: str, *, as_of: str) -> dict[str, Any]:
        cutoff = _parse_datetime(as_of).astimezone(timezone.utc)
        start = cutoff - timedelta(days=400)
        query = urllib.parse.urlencode({
            "period1": int(start.timestamp()),
            "period2": int((cutoff + timedelta(days=1)).timestamp()),
            "interval": "1d",
            "events": "history",
        })
        url = f"{YAHOO_CHART_BASE}/{urllib.parse.quote(symbol)}?{query}"
        payload = self.fetch_json(url, user_agent=self.user_agent)
        chart = payload.get("chart", {})
        if chart.get("error"):
            raise FreePublicDataError(str(chart["error"].get("description") or "Yahoo chart error"))
        result = (chart.get("result") or [None])[0]
        if not isinstance(result, dict):
            raise FreePublicDataError(f"No Yahoo chart result for {symbol}")
        timestamps = result.get("timestamp") or []
        quote = ((result.get("indicators") or {}).get("quote") or [{}])[0]
        closes, volumes = quote.get("close") or [], quote.get("volume") or []
        rows = []
        for index, stamp in enumerate(timestamps):
            close = closes[index] if index < len(closes) else None
            volume = volumes[index] if index < len(volumes) else None
            moment = datetime.fromtimestamp(stamp, timezone.utc)
            if moment > cutoff or not isinstance(close, (int, float)) or close <= 0:
                continue
            rows.append({
                "date": moment.date().isoformat(),
                "close": float(close),
                "volume": float(volume) if isinstance(volume, (int, float)) and volume >= 0 else None,
            })
        if len(rows) < 60:
            raise FreePublicDataError(f"Insufficient price history for {symbol}")
        return {"symbol": symbol, "url": url, "meta": result.get("meta") or {}, "rows": rows}


def _fact_series(companyfacts: dict[str, Any], tags: tuple[str, ...], *, as_of: date) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    facts = companyfacts.get("facts", {})
    for taxonomy in ("us-gaap", "ifrs-full", "dei"):
        concepts = facts.get(taxonomy, {}) if isinstance(facts, dict) else {}
        for tag in tags:
            concept = concepts.get(tag)
            if not isinstance(concept, dict):
                continue
            for unit, rows in (concept.get("units") or {}).items():
                for row in rows if isinstance(rows, list) else []:
                    if not isinstance(row, dict) or row.get("form") not in ELIGIBLE_FORMS:
                        continue
                    try:
                        filed = date.fromisoformat(str(row["filed"])[:10])
                        end = date.fromisoformat(str(row["end"])[:10])
                        value = float(row["val"])
                    except (KeyError, TypeError, ValueError):
                        continue
                    if filed > as_of or end > as_of or not math.isfinite(value):
                        continue
                    output.append({**row, "val": value, "filed": filed.isoformat(), "end": end.isoformat(), "tag": tag, "taxonomy": taxonomy, "unit": unit})
            if output:
                break
        if output:
            break
    deduplicated: dict[tuple[str, str, str], dict[str, Any]] = {}
    for row in output:
        key = (row["end"], str(row.get("frame") or row.get("fp") or ""), str(row.get("form") or ""))
        previous = deduplicated.get(key)
        if previous is None or row["filed"] > previous["filed"]:
            deduplicated[key] = row
    return sorted(deduplicated.values(), key=lambda item: (item["end"], item["filed"]))


def _duration_days(row: dict[str, Any]) -> int | None:
    try:
        return (date.fromisoformat(row["end"]) - date.fromisoformat(row["start"])).days
    except (KeyError, TypeError, ValueError):
        return None


def _quarterly(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    selected = [
        row for row in rows
        if re.fullmatch(r"CY\d{4}Q[1-4]", str(row.get("frame") or ""))
        or (_duration_days(row) is not None and 65 <= int(_duration_days(row) or 0) <= 130)
    ]
    by_end: dict[str, dict[str, Any]] = {}
    for row in selected:
        previous = by_end.get(row["end"])
        if previous is None or row["filed"] > previous["filed"]:
            by_end[row["end"]] = row
    return sorted(by_end.values(), key=lambda item: item["end"])


def _annual(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    selected = [row for row in rows if 300 <= int(_duration_days(row) or 0) <= 400]
    by_end: dict[str, dict[str, Any]] = {}
    for row in selected:
        if row["end"] not in by_end or row["filed"] > by_end[row["end"]]["filed"]:
            by_end[row["end"]] = row
    return sorted(by_end.values(), key=lambda item: item["end"])


def _yoy(rows: list[dict[str, Any]]) -> float | None:
    if len(rows) < 2:
        return None
    latest = rows[-1]
    latest_end = date.fromisoformat(latest["end"])
    comparisons = [
        row for row in rows[:-1]
        if 330 <= (latest_end - date.fromisoformat(row["end"])).days <= 400
    ]
    previous = comparisons[-1] if comparisons else (rows[-5] if len(rows) >= 5 else None)
    return _safe_ratio(latest["val"] - previous["val"], abs(previous["val"])) if previous else None


def _latest_value(series: list[dict[str, Any]]) -> float | None:
    return float(series[-1]["val"]) if series else None


def _price_metrics(payload: dict[str, Any], benchmark: dict[str, Any]) -> dict[str, float | str | None]:
    rows = payload["rows"]
    benchmark_by_date = {row["date"]: row["close"] for row in benchmark["rows"]}
    latest = rows[-1]
    closes = [row["close"] for row in rows]
    daily_returns = [closes[index] / closes[index - 1] - 1 for index in range(1, len(closes))]
    peak, drawdown = closes[0], 0.0
    for close in closes:
        peak = max(peak, close)
        drawdown = min(drawdown, close / peak - 1)

    relative = []
    for sessions in (65, 130, 252):
        if len(rows) <= sessions:
            continue
        start = rows[-sessions - 1]
        benchmark_start = benchmark_by_date.get(start["date"])
        benchmark_end = benchmark_by_date.get(latest["date"])
        if benchmark_start and benchmark_end:
            relative.append((latest["close"] / start["close"] - 1) - (benchmark_end / benchmark_start - 1))
    liquid_rows = [row for row in rows[-20:] if row.get("volume") is not None]
    adv20 = mean(row["close"] * row["volume"] for row in liquid_rows) if len(liquid_rows) >= 10 else 0.0
    return {
        "latest_price": latest["close"],
        "latest_date": latest["date"],
        "average_dollar_volume_20d_usd": adv20,
        "annualized_volatility": pstdev(daily_returns[-252:]) * math.sqrt(252) if len(daily_returns) >= 20 else None,
        "max_drawdown": drawdown,
        "relative_return_mean": mean(relative) if relative else None,
    }


def _latest_filing(submissions: dict[str, Any], *, as_of: date) -> dict[str, str] | None:
    recent = ((submissions.get("filings") or {}).get("recent") or {})
    forms = recent.get("form") or []
    for index, form in enumerate(forms):
        if form not in ELIGIBLE_FORMS:
            continue
        try:
            filing_date = str(recent["filingDate"][index])
            if date.fromisoformat(filing_date) > as_of:
                continue
            return {
                "form": form,
                "filed": filing_date,
                "accession": str(recent["accessionNumber"][index]),
                "primary_document": str(recent["primaryDocument"][index]),
            }
        except (IndexError, KeyError, ValueError):
            continue
    return None


def _filing_url(cik: int, filing: dict[str, str]) -> str:
    accession = filing["accession"].replace("-", "")
    return f"https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/{filing['primary_document']}"


def _exchange(submissions: dict[str, Any], ticker: str) -> str:
    tickers, exchanges = submissions.get("tickers") or [], submissions.get("exchanges") or []
    for index, value in enumerate(tickers):
        if str(value).upper() == ticker and index < len(exchanges):
            name = str(exchanges[index]).upper()
            return "NASDAQ" if "NASDAQ" in name else "NYSE" if "NYSE" in name else name
    return ""


def _candidate(
    ticker: str,
    cik: int,
    companyfacts: dict[str, Any],
    submissions: dict[str, Any],
    price_payload: dict[str, Any],
    benchmark_payload: dict[str, Any],
    *,
    as_of: str,
    semiconductor: bool,
) -> tuple[dict[str, Any], dict[str, Any]] | None:
    cutoff = _parse_datetime(as_of).date()
    filing = _latest_filing(submissions, as_of=cutoff)
    if not filing:
        return None
    series = {name: _fact_series(companyfacts, tags, as_of=cutoff) for name, tags in FACT_TAGS.items()}
    quarters = {name: _quarterly(rows) for name, rows in series.items()}
    annuals = {name: _annual(rows) for name, rows in series.items()}
    metrics = _price_metrics(price_payload, benchmark_payload)
    shares = _latest_value(series["shares"])
    market_cap = float(metrics["latest_price"]) * shares if shares and shares > 0 else 0.0
    universe_row = {
        "ticker": ticker,
        "exchange": _exchange(submissions, ticker),
        "asset_type": "adr" if any(form in {"20-F", "6-K", "40-F"} for form in (submissions.get("filings", {}).get("recent", {}).get("form") or [])[:20]) else "stock",
        "is_us_listed": ticker in [str(value).upper() for value in submissions.get("tickers") or []],
        "market_cap_usd": market_cap,
        "average_dollar_volume_20d_usd": metrics["average_dollar_volume_20d_usd"],
    }

    revenue_growth = _first_not_none(_yoy(quarters["revenue"]), _yoy(annuals["revenue"]))
    operating_growth = _first_not_none(_yoy(quarters["operating_income"]), _yoy(annuals["operating_income"]))
    latest_revenue = _first_not_none(_latest_value(quarters["revenue"]), _latest_value(annuals["revenue"]))
    latest_operating = _first_not_none(_latest_value(quarters["operating_income"]), _latest_value(annuals["operating_income"]))
    latest_net = _latest_value(annuals["net_income"])
    latest_ocf = _latest_value(annuals["operating_cash_flow"])
    assets = _latest_value(series["assets"])
    liabilities = _latest_value(series["liabilities"])
    operating_margin = _safe_ratio(latest_operating, latest_revenue)
    leverage = _safe_ratio(liabilities, assets)
    eps = _safe_ratio(latest_net, shares)
    pe = _safe_ratio(float(metrics["latest_price"]), eps) if eps and eps > 0 else None

    financial = _average([
        _bounded(50 + revenue_growth * 200) if revenue_growth is not None else None,
        _bounded(50 + operating_margin * 150) if operating_margin is not None else None,
        70.0 if latest_ocf and latest_ocf > 0 else 30.0 if latest_ocf is not None else None,
        _bounded(100 - leverage * 80) if leverage is not None else None,
    ])
    valuation = None
    if pe is not None:
        valuation = 80.0 if pe <= 15 else 65.0 if pe <= 25 else 50.0 if pe <= 40 else 35.0 if pe <= 60 else 20.0
    demand = _bounded(50 + (revenue_growth or 0) * 220 + (operating_growth or 0) * 60) if revenue_growth is not None else None
    confirmation = _bounded(50 + float(metrics["relative_return_mean"]) * 120) if metrics["relative_return_mean"] is not None else None
    volatility = metrics["annualized_volatility"]
    risk = _bounded(100 - (float(volatility) * 85 if volatility is not None else 35) + float(metrics["max_drawdown"]) * 30)

    cycle = None
    if semiconductor:
        inventory_growth = _yoy(series["inventory"])
        capex_growth = _yoy(annuals["capex"])
        cycle = _average([
            _bounded(50 + revenue_growth * 180) if revenue_growth is not None else None,
            _bounded(50 + operating_growth * 80) if operating_growth is not None else None,
            _bounded(55 - max(0.0, (inventory_growth or 0) - (revenue_growth or 0)) * 150) if inventory_growth is not None else None,
            _bounded(50 + capex_growth * 50) if capex_growth is not None else None,
        ])

    dimensions = {
        name: round(value, 6)
        for name, value in {
            "financial_quality": financial,
            "valuation": valuation,
            "demand_catalyst": demand,
            "expectations_confirmation": confirmation,
            "industry_cycle": cycle,
            "risk_liquidity_health": risk,
        }.items()
        if value is not None
    }
    if len(dimensions) < 4:
        return universe_row, {
            "ticker": ticker,
            "dimensions": dimensions,
            "family_scores": dimensions,
            "methods": list(dimensions),
            "method_scores": {},
            "method_adjustments": {},
            "method_versions": {"free_public_data": "sec-yahoo-v1"},
            "juglar": {"not_applicable": not semiconductor},
            "evidence": [],
            "conflicts": [],
            "gates_failed": ["insufficient_public_data", "free_source_scope_limited"],
            "what_makes_investable": [],
            "what_kills_thesis": ["免费公开数据不足，无法形成可审计的完整研究链"],
            "data_quality": {"status": "incomplete", "provider": "free_public_data"},
        }

    filing_age = (cutoff - date.fromisoformat(filing["filed"])).days
    facts_url = f"{SEC_BASE}/api/xbrl/companyfacts/CIK{cik:010d}.json"
    filing_supports = [name for name in ("financial_quality", "valuation", "demand_catalyst", "industry_cycle") if name in dimensions]
    evidence = [
        make_evidence(
            source=f"SEC EDGAR {filing['form']}", url=_filing_url(cik, filing),
            published_at=_iso_day(filing["filed"]), retrieved_at=as_of, as_of=as_of,
            content=f"{ticker} {filing['form']} {filing['accession']}",
            lineage_id=f"sec:{cik}:{filing['accession']}", freshness="fresh" if filing_age <= 180 else "stale",
            first_party=True, supports=filing_supports, confidence=0.9, missing_fields=[],
        ),
        make_evidence(
            source="SEC EDGAR companyfacts", url=facts_url,
            published_at=_iso_day(filing["filed"]), retrieved_at=as_of, as_of=as_of,
            content=json.dumps({"ticker": ticker, "dimensions": dimensions, "filing": filing["accession"]}, sort_keys=True),
            lineage_id=f"sec-companyfacts:{cik}:{filing['filed']}", freshness="fresh" if filing_age <= 180 else "stale",
            first_party=True, supports=filing_supports, confidence=0.85, missing_fields=[],
        ),
        make_evidence(
            source="Yahoo Finance chart", url=price_payload["url"],
            published_at=_iso_day(str(metrics["latest_date"])), retrieved_at=as_of, as_of=as_of,
            content=json.dumps(metrics, sort_keys=True), lineage_id=f"yahoo-chart:{ticker}:{metrics['latest_date']}",
            freshness="fresh" if (cutoff - date.fromisoformat(str(metrics["latest_date"]))).days <= 7 else "stale",
            first_party=False, supports=["expectations_confirmation", "risk_liquidity_health"], confidence=0.75,
            missing_fields=["analyst_consensus", "earnings_transcript", "news_catalyst"],
        ),
    ]
    gates = ["free_source_scope_limited", "no_consensus_estimates"]
    if filing_age > 540:
        gates.append("stale_core_data")
    if any(item["freshness"] == "stale" for item in evidence[2:]):
        gates.append("stale_price_data")
    candidate = {
        "ticker": ticker,
        "dimensions": dimensions,
        "family_scores": dimensions,
        "methods": list(dimensions),
        "method_scores": {
            "sec_fundamentals": round(_average([financial, valuation, demand]) or 0, 6),
            "price_confirmation": round(_average([confirmation, risk]) or 0, 6),
            **({"juglar_cycle": round(cycle, 6)} if cycle is not None else {}),
        },
        "method_adjustments": {},
        "method_versions": {
            "sec_edgar": "submissions-companyfacts-v1",
            "price_confirmation": "yahoo-chart-v1",
            "anthropic_screen": "reference-v1",
            "serenity_alpha": "deterministic-proxy-v1",
            "juglar_cycle": "deterministic-proxy-v1" if semiconductor else "not-applicable",
        },
        "juglar": {"not_applicable": not semiconductor},
        "evidence": evidence,
        "conflicts": [],
        "gates_failed": gates,
        "what_makes_investable": ["SEC 财务质量与相对 QQQ 趋势继续同步改善", "后续补齐一致预期或公司事件证据"],
        "what_kills_thesis": ["收入或经营利润同比转负", "相对 QQQ 趋势恶化且回撤扩大"],
        "data_quality": {
            "status": "limited_free_sources", "provider": "free_public_data",
            "latest_filing": filing["filed"], "latest_price": metrics["latest_date"],
            "missing_fields": ["analyst_consensus", "earnings_transcript", "news_catalyst"],
        },
    }
    return universe_row, candidate


def fetch_research_payload(
    symbols: list[str],
    *,
    as_of: str,
    sec_client: SecEdgarClient | None = None,
    price_client: YahooPriceClient | None = None,
) -> dict[str, Any]:
    """Build a schema-normalized payload without any paid credential."""

    _parse_datetime(as_of)
    sec_client = sec_client or SecEdgarClient()
    price_client = price_client or YahooPriceClient()
    ticker_map = sec_client.ticker_map()
    benchmark = price_client.history("QQQ", as_of=as_of)
    universe_rows, candidates, failures = [], [], []
    semiconductor_symbols = {"ASML", "AMD", "AVGO", "TSM", "QCOM", "MU", "INTC", "TXN", "AMAT", "LRCX"}
    for raw_symbol in symbols:
        ticker = str(raw_symbol).upper()
        mapping = ticker_map.get(ticker)
        if not mapping:
            failures.append({"ticker": ticker, "reason": "sec_cik_not_found"})
            continue
        try:
            cik = int(mapping["cik_str"])
            submissions = sec_client.submissions(cik)
            companyfacts = sec_client.companyfacts(cik)
            prices = price_client.history(ticker, as_of=as_of)
            built = _candidate(
                ticker, cik, companyfacts, submissions, prices, benchmark,
                as_of=as_of, semiconductor=ticker in semiconductor_symbols,
            )
            if built is None:
                failures.append({"ticker": ticker, "reason": "no_eligible_filing"})
                continue
            universe_row, candidate = built
            universe_rows.append(universe_row)
            candidates.append(candidate)
        except Exception as error:
            failures.append({"ticker": ticker, "reason": f"{type(error).__name__}: {error}"})
    if not universe_rows:
        raise FreePublicDataError("Free public sources returned no valid universe rows")
    return {
        "universe_rows": universe_rows,
        "candidates": candidates,
        "provider": "free_public_data",
        "as_of": as_of,
        "benchmark": "QQQ",
        "failures": failures,
        "research_only": True,
    }
