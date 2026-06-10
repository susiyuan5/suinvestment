"""
Risk-adjusted multiplier for weekly dip-buy strategies.

Unifies the smooth dip-buy baseline with volatility reduction,
drawdown caps, and trend/consecutive-decline awareness.
"""

from __future__ import annotations

import math

DEFAULT_SENSITIVITY = 4.0
DEFAULT_MIN_MULTIPLIER = 0.3
DEFAULT_MAX_MULTIPLIER = 2.0
DEFAULT_TARGET_VOL = 0.04
VOL_CLAMP_LOW = 0.7
VOL_CLAMP_HIGH = 1.1
DRAWDOWN_20_CAP = 1.3
DRAWDOWN_35_CAP = 1.1
DECLINE_4_CAP = 1.5
DECLINE_8_CAP = 1.2


def calculate_risk_adjusted_multiplier(
    weekly_return: float,
    recent_returns: list[float] | None = None,
    consecutive_declines: int = 0,
    drawdown: float = 0.0,
    sensitivity: float = DEFAULT_SENSITIVITY,
    min_multiplier: float = DEFAULT_MIN_MULTIPLIER,
    max_multiplier: float = DEFAULT_MAX_MULTIPLIER,
    target_weekly_vol: float = DEFAULT_TARGET_VOL,
) -> float:
    """Compute a risk-adjusted buy multiplier in [min_multiplier, max_multiplier]."""

    # Step 1: Smooth dip-buy baseline
    decision_change = weekly_return * 100
    multiplier = 1.0 - sensitivity * decision_change / 100.0

    # Step 2: Volatility reduction
    if recent_returns and len(recent_returns) >= 4:
        realized_vol = _stddev(recent_returns)
        if realized_vol > 0 and target_weekly_vol > 0:
            adj = target_weekly_vol / realized_vol
            adj = max(VOL_CLAMP_LOW, min(VOL_CLAMP_HIGH, adj))
            multiplier *= adj

    # Step 3: Trend / consecutive-decline cap
    if consecutive_declines >= 8:
        multiplier = min(multiplier, DECLINE_8_CAP)
    elif consecutive_declines >= 4:
        multiplier = min(multiplier, DECLINE_4_CAP)

    # Step 4: Drawdown cap
    if drawdown > 0.35:
        multiplier = min(multiplier, DRAWDOWN_35_CAP)
    elif drawdown > 0.20:
        multiplier = min(multiplier, DRAWDOWN_20_CAP)

    # Step 5: Safety clamps
    return _round2(max(min_multiplier, min(max_multiplier, multiplier)))


def _stddev(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    var = sum((v - mean) ** 2 for v in values) / (len(values) - 1)
    return math.sqrt(var)


def _round2(value: float) -> float:
    return round(value + 1e-9, 2)
