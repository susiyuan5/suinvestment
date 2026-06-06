from __future__ import annotations

import csv
from dataclasses import dataclass


@dataclass(frozen=True)
class PortfolioHolding:
    ticker: str
    shares: float
    average_cost: float
    current_value: float
    target_allocation: float
    notes: str = ""


def load_manual_portfolio(path: str | None) -> dict[str, PortfolioHolding]:
    if not path:
        return {}

    holdings: dict[str, PortfolioHolding] = {}
    try:
        with open(path, newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                ticker = str(row.get("ticker", "")).strip().upper()
                if not ticker:
                    continue
                holdings[ticker] = PortfolioHolding(
                    ticker=ticker,
                    shares=_to_float(row.get("shares")),
                    average_cost=_to_float(row.get("average_cost")),
                    current_value=_to_float(row.get("current_value")),
                    target_allocation=_to_float(row.get("target_allocation")),
                    notes=str(row.get("notes", "")).strip(),
                )
    except FileNotFoundError:
        raise FileNotFoundError(f"Manual portfolio file not found: {path}")
    return holdings


def total_portfolio_value(holdings: dict[str, PortfolioHolding], available_cash: float) -> float:
    return available_cash + sum(item.current_value for item in holdings.values())


def ticker_exposure_pct(ticker: str, holdings: dict[str, PortfolioHolding], available_cash: float) -> float:
    total = total_portfolio_value(holdings, available_cash)
    if total <= 0:
        return 0.0
    holding = holdings.get(ticker.upper())
    return (holding.current_value if holding else 0.0) / total


def total_equity_exposure_pct(holdings: dict[str, PortfolioHolding], available_cash: float) -> float:
    total = total_portfolio_value(holdings, available_cash)
    if total <= 0:
        return 0.0
    return sum(item.current_value for item in holdings.values()) / total


def _to_float(value: object) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0
