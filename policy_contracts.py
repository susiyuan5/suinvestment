"""Python reference implementations for browser/Python golden contracts."""

from __future__ import annotations

import math
import re
from statistics import mean


def freshness(timestamp, options=None, now_ms=None, default_max_age_hours=24):
    options = options or {}
    if options.get("missing"):
        return "missing"
    if options.get("stale"):
        return "stale"
    if not isinstance(timestamp, (int, float)) or not math.isfinite(timestamp):
        return "missing"
    if timestamp > now_ms + 300_000:
        return "stale"
    max_age = options.get("maxAgeHours") or default_max_age_hours
    return "stale" if (now_ms - timestamp) / 3_600_000 > max_age else "fresh"


def decision_change(*values):
    finite = [value for value in values if isinstance(value, (int, float)) and math.isfinite(value)]
    return min(finite) if finite else None


def market_signals(closes):
    if len(closes) < 2 or any(not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0 for value in closes):
        raise ValueError("market_signals requires at least two finite positive closes")
    latest, previous = closes[-1], closes[-2]
    lookback = min(5, len(closes) - 1)
    week_ago = closes[-1 - lookback]
    daily = round((latest - previous) / previous * 100 + 1e-12, 2)
    weekly = round((latest - week_ago) / week_ago * 100 + 1e-12, 2)
    return {"latestClose": latest, "previousClose": previous, "weekAgoClose": week_ago, "dailyChange": daily, "weeklyChange": weekly, "decisionChange": decision_change(weekly, daily)}


def signal_score(data, params):
    move = data.get("decisionChange")
    if not isinstance(move, (int, float)) or not math.isfinite(move):
        return 10
    score = 50
    score += min(36, abs(move) * 2.4) if move < 0 else -min(36, move * 2.8)
    weekly, daily = data.get("weeklyChange"), data.get("dailyChange")
    if isinstance(weekly, (int, float)) and weekly <= -20:
        score += 4
    if isinstance(daily, (int, float)) and daily <= -8:
        score += 3
    if isinstance(weekly, (int, float)) and abs(weekly) >= params["extremeWeeklyThreshold"]:
        score -= 12
    if isinstance(daily, (int, float)) and abs(daily) >= params["volatilityDailyThreshold"]:
        score -= 5
    algorithm = data.get("algorithm") or {}
    trend, regime = algorithm.get("trend") or {}, algorithm.get("market_regime") or {}
    if trend.get("status") == "healthy_pullback": score += 9
    if trend.get("status") == "strong_downtrend": score -= 18 if trend.get("severe") else 12
    volatility, drawdown = algorithm.get("realized_weekly_volatility"), algorithm.get("drawdown")
    if isinstance(volatility, (int, float)) and volatility >= 6: score -= 8
    if isinstance(drawdown, (int, float)):
        score -= 20 if drawdown > 35 else 10 if drawdown >= 20 else 3 if drawdown >= 10 else 0
    score += 4 if regime.get("type") == "Bull" else -7 if regime.get("type") == "Correction" else -15 if regime.get("type") == "Bear" else 0
    age = data.get("dataAgeHours")
    score -= 20 if isinstance(age, (int, float)) and age > 24 else 8 if isinstance(age, (int, float)) and age > 6 else 0 if isinstance(age, (int, float)) else 25
    source = str(data.get("dataSource") or "")
    if re.search("cache", source, re.I): score -= 15
    if re.search("manual", source, re.I) or data.get("manualOverrideActive"): score -= 10
    if re.search("unavailable", source, re.I): score -= 45
    if data.get("panicActive"): score += 6
    score += (data.get("multiplier", 1) - 1) * 18
    return min(100, max(0, round(score)))


def normalize_symbol(value):
    symbol = str(value or "").strip().upper()
    return symbol if re.fullmatch(r"[A-Z0-9.-]{1,12}", symbol) else ""


def normalize_portfolio(items, defaults, allow_custom=False):
    supported, seen, output = {row["symbol"] for row in defaults}, set(), []
    for item in items or []:
        symbol, allocation = normalize_symbol(item.get("symbol")), item.get("allocation")
        if not symbol or (symbol not in supported and not allow_custom) or symbol in seen or not isinstance(allocation, (int, float)) or not math.isfinite(allocation) or allocation < 0:
            continue
        seen.add(symbol)
        output.append({"symbol": symbol, "name": str(item.get("name") or symbol).strip() or symbol, "allocation": round(allocation * 100 + 1e-12, 2) / 100})
    return output


def cagr(final_value, invested, weeks):
    return None if invested <= 0 or weeks < 1 else (final_value / invested) ** (1 / (weeks / 52)) - 1


def annualized_volatility(returns):
    if len(returns) < 2: return None
    variance = sum((value - mean(returns)) ** 2 for value in returns) / (len(returns) - 1)
    return math.sqrt(variance) * math.sqrt(52) if variance > 0 else None


def downside_deviation(returns):
    if len(returns) < 2: return None
    negative = [value for value in returns if value < 0]
    if len(negative) < 2: return 0
    variance = sum((value - mean(negative)) ** 2 for value in negative) / (len(negative) - 1)
    return math.sqrt(variance) * math.sqrt(52) if variance > 0 else 0


def return_volatility(returns):
    if len(returns) < 2: return 0
    return math.sqrt(sum((value - mean(returns)) ** 2 for value in returns) / (len(returns) - 1))


def simulate_fixed_dca(prices, weekly_amount, friction_rate):
    shares = invested = friction = 0.0
    buys = 0
    for current in prices[1:]:
        effective = weekly_amount * (1 - friction_rate)
        shares += effective / current
        invested += weekly_amount
        friction += weekly_amount - effective
        buys += 1
    final_value = shares * prices[-1]
    return {
        "final_value": round(final_value + 1e-12, 2),
        "total_invested": round(invested + 1e-12, 2),
        "total_return": round((final_value - invested) / invested * 100 + 1e-12, 2),
        "number_of_buys": buys,
        "total_friction_cost": round(friction + 1e-12, 2),
    }
