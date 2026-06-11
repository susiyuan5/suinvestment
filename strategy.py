from __future__ import annotations

from dataclasses import replace

from config import StrategyConfig


VALID_MODES = {"dip_buy", "momentum"}


def calculate_weekly_return(current_week_close: float, previous_week_close: float) -> float:
    if previous_week_close <= 0:
        raise ValueError("previous_week_close must be positive")
    return current_week_close / previous_week_close - 1


def clamp(value: float, lower: float, upper: float) -> float:
    return min(max(value, lower), upper)


def calculate_buy_multiplier(weekly_return: float, config: StrategyConfig) -> float:
    if config.strategy_mode not in VALID_MODES:
        raise ValueError(f"Unsupported strategy_mode: {config.strategy_mode}")

    direction = -1 if config.strategy_mode == "dip_buy" else 1
    adjustment = direction * config.sensitivity * weekly_return
    raw_multiplier = 1 + adjustment
    return clamp(raw_multiplier, config.min_multiplier, config.max_multiplier)


def calculate_buy_amount(
    weekly_return: float,
    config: StrategyConfig,
    conservative_mode: bool = False,
) -> tuple[float, float]:
    multiplier = calculate_buy_multiplier(weekly_return, config)
    amount = config.base_buy_amount * multiplier

    if conservative_mode:
        amount = min(amount, config.base_buy_amount)
        multiplier = amount / config.base_buy_amount if config.base_buy_amount else 0

    return amount, multiplier


def with_strategy_overrides(config: StrategyConfig, **overrides: object) -> StrategyConfig:
    return replace(config, **overrides)

def calculate_risk_adjusted_buy_amount(
    weekly_return: float,
    config: StrategyConfig,
    recent_returns: list[float] | None = None,
    consecutive_declines: int = 0,
    drawdown: float = 0.0,
) -> tuple[float, float]:
    """Calculate buy amount using the risk-adjusted multiplier from risk_adjuster.py."""
    from risk_adjuster import calculate_risk_adjusted_multiplier_v2 as calculate_risk_adjusted_multiplier

    multiplier = calculate_risk_adjusted_multiplier(
        weekly_return=weekly_return,
        recent_returns=recent_returns,
        consecutive_declines=consecutive_declines,
        drawdown=drawdown,
        sensitivity=config.sensitivity,
        min_multiplier=config.min_multiplier,
        max_multiplier=config.max_multiplier,
        strategy_mode=config.strategy_mode,
    )
    amount = config.base_buy_amount * multiplier
    return round(amount, 2), multiplier

