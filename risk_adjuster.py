"""
Risk-adjusted multiplier for weekly dip-buy strategies (v2 - less conservative).

v2 changes from v1:
  - target_weekly_vol raised to 0.07 (less volatility suppression)
  - Removed standalone 20% drawdown cap (kept 35%+ extreme cap only)
  - Removed standalone 4-week decline cap (kept 8+ only)
  - Combined stress (high vol + deep drawdown + long decline) reduces multiplier
"""

from __future__ import annotations

import math

DEFAULT_SENSITIVITY = 4.0
DEFAULT_MIN_MULTIPLIER = 0.3
DEFAULT_MAX_MULTIPLIER = 2.0
DEFAULT_TARGET_VOL = 0.07          # Increased from 0.04 — less suppression
VOL_CLAMP_LOW = 0.8                # Narrower range (was 0.7-1.1)
VOL_CLAMP_HIGH = 1.05
DRAWDOWN_35_CAP = 1.1
DECLINE_8_CAP = 1.2
VALID_MODES = {"dip_buy", "momentum"}


def calculate_risk_adjusted_multiplier_v2(
    weekly_return: float,
    recent_returns: list[float] | None = None,
    consecutive_declines: int = 0,
    drawdown: float = 0.0,
    sensitivity: float = DEFAULT_SENSITIVITY,
    min_multiplier: float = DEFAULT_MIN_MULTIPLIER,
    max_multiplier: float = DEFAULT_MAX_MULTIPLIER,
    target_weekly_vol: float = DEFAULT_TARGET_VOL,
    strategy_mode: str = "dip_buy",
) -> float:
    """Compute a less conservative risk-adjusted buy multiplier in [min, max]."""
    if strategy_mode not in VALID_MODES:
        raise ValueError(f"Unsupported strategy_mode: {strategy_mode}")

    # Step 1: Smooth strategy baseline
    decision_change = weekly_return * 100
    direction = -1 if strategy_mode == "dip_buy" else 1
    multiplier = 1.0 + direction * sensitivity * decision_change / 100.0

    # Step 2: Milder volatility adjustment
    if recent_returns and len(recent_returns) >= 4:
        realized_vol = _stddev(recent_returns)
        if realized_vol > 0 and target_weekly_vol > 0:
            adj = target_weekly_vol / realized_vol
            adj = max(VOL_CLAMP_LOW, min(VOL_CLAMP_HIGH, adj))
            multiplier *= adj

    # Step 3: Only extreme consecutive decline cap (8+ weeks)
    if consecutive_declines >= 8:
        multiplier = min(multiplier, DECLINE_8_CAP)

    # Step 4: Only extreme drawdown cap (35%+)
    if drawdown > 0.35:
        multiplier = min(multiplier, DRAWDOWN_35_CAP)

    # Step 5: Combined stress signal — high vol AND deep drawdown AND long decline
    if consecutive_declines >= 6 and drawdown > 0.20 and recent_returns and len(recent_returns) >= 4:
        realized_vol = _stddev(recent_returns)
        if realized_vol > target_weekly_vol * 1.5:
            multiplier = min(multiplier, 1.3)

    # Step 6: Safety clamps
    return _round2(max(min_multiplier, min(max_multiplier, multiplier)))


def _stddev(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    var = sum((v - mean) ** 2 for v in values) / (len(values) - 1)
    return math.sqrt(var)


def _round2(value: float) -> float:
    return round(value + 1e-9, 2)
