"""Causal, research-only trailing take-profit indicator for one long position.

Create a position with its adjusted execution price and the ATR from the
preceding completed bar, then call ``update_take_profit`` once per completed
close. The returned line is a signal threshold, not a guaranteed fill price.
Execution gaps, commissions, slippage and taxes can consume the retained gain.
The caller owns execution and must create a new state after each new entry;
pyramiding, initial stops and re-entry rules are deliberately outside this API.

``normalize_adjusted_bars`` accepts either a complete adjusted OHLC set, or
raw OHLC plus an ``adjusted`` or ``adjusted_close`` close. ``wilder_atr`` consumes that standardized
adjusted series. No missing adjustment fields are silently replaced by raw
prices. Backward-adjusted history must keep one price basis for the position.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field, replace
from datetime import date as calendar_date
from typing import Any


def _number(value: Any, name: str, *, allow_zero: bool = False) -> float:
    if isinstance(value, bool):
        raise ValueError(f"{name} must be a finite number")
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError) as error:
        raise ValueError(f"{name} must be a finite number") from error
    if not math.isfinite(number) or number < 0 or (number == 0 and not allow_zero):
        raise ValueError(f"{name} must be finite and {'nonnegative' if allow_zero else 'positive'}")
    return number


def _iso_date(value: Any, name: str = "date") -> str:
    if not isinstance(value, str):
        raise ValueError(f"{name} must be an ISO date string (YYYY-MM-DD)")
    try:
        parsed = calendar_date.fromisoformat(value)
    except ValueError as error:
        raise ValueError(f"{name} must be an ISO date string (YYYY-MM-DD)") from error
    if parsed.isoformat() != value:
        raise ValueError(f"{name} must use YYYY-MM-DD")
    return value


def _ohlc(values: Mapping[str, Any], prefix: str = "") -> dict[str, float]:
    output = {}
    for key in ("open", "high", "low", "close"):
        name = prefix + key
        if name not in values:
            raise ValueError(f"missing required {name}")
        output[key] = _number(values[name], name)
    if not output["low"] <= min(output["open"], output["close"]) <= max(output["open"], output["close"]) <= output["high"]:
        raise ValueError("OHLC must satisfy low <= open/close <= high")
    return output


def normalize_adjusted_bars(rows: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Return validated, strictly date-ordered adjusted OHLC dictionaries.

    Any ``adjusted_open/high/low`` key selects the full adjusted format
    and requires all four fields. Otherwise raw OHLC and an adjusted close are
    mandatory; all raw prices are multiplied by adjusted/raw close. Existing
    full adjusted fields take precedence over raw fields. ``adjusted`` and
    ``adjusted_close`` are aliases and must agree whenever both are present.
    No sorting, duplicate removal, imputing or adjustment fallback is used.
    """
    output = []
    previous_date = None
    adjusted_keys = ("adjusted_open", "adjusted_high", "adjusted_low")
    for row in rows:
        if not isinstance(row, Mapping):
            raise ValueError("each bar must be a mapping")
        bar_date = _iso_date(row.get("date"))
        if previous_date is not None and bar_date <= previous_date:
            raise ValueError("bar dates must be strictly increasing")
        if "adjusted" in row and "adjusted_close" in row:
            if _number(row["adjusted"], "adjusted") != _number(row["adjusted_close"], "adjusted_close"):
                raise ValueError("adjusted and adjusted_close must agree")
        if any(key in row for key in adjusted_keys):
            values = _ohlc(row, "adjusted_")
        else:
            raw = _ohlc(row)
            if "adjusted" not in row and "adjusted_close" not in row:
                raise ValueError("missing required adjusted close")
            adjusted_key = "adjusted_close" if "adjusted_close" in row else "adjusted"
            adjusted_close = _number(row[adjusted_key], adjusted_key)
            factor = adjusted_close / raw["close"]
            values = {key: _number(value * factor, f"adjusted {key}") for key, value in raw.items()}
            values["close"] = adjusted_close
            for key in ("open", "high", "low"):
                if raw[key] == raw["close"]:
                    values[key] = adjusted_close
        output.append({"date": bar_date, **values})
        previous_date = bar_date
    return output


def _validated_bars(bars: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    result = []
    previous_date = None
    for bar in bars:
        if not isinstance(bar, Mapping):
            raise ValueError("each standardized bar must be a mapping")
        bar_date = _iso_date(bar.get("date"))
        if previous_date is not None and bar_date <= previous_date:
            raise ValueError("bar dates must be strictly increasing")
        result.append({"date": bar_date, **_ohlc(bar)})
        previous_date = bar_date
    return result


def wilder_atr(bars: Iterable[Mapping[str, Any]], period: int = 14) -> list[float | None]:
    """Calculate causal Wilder ATR on standardized adjusted OHLC bars.

    First true range is first high minus first low. Subsequent true ranges
    include gaps from the previous close. The first ATR is the arithmetic
    mean of ``period`` true ranges at index ``period - 1``; earlier entries
    are None. Thereafter ATR[t] = ((period - 1)*ATR[t-1] + TR[t])/period.
    Prefixes produce identical values: no future bars enter the calculation.
    """
    if isinstance(period, bool) or not isinstance(period, int) or period < 1:
        raise ValueError("period must be a positive integer")
    validated = _validated_bars(bars)
    result: list[float | None] = [None] * len(validated)
    ranges = []
    previous_close = None
    previous_atr = None
    for index, bar in enumerate(validated):
        true_range = bar["high"] - bar["low"]
        if previous_close is not None:
            true_range = max(true_range, abs(bar["high"] - previous_close), abs(bar["low"] - previous_close))
        if index < period:
            ranges.append(true_range)
            if index == period - 1:
                previous_atr = math.fsum(value / period for value in ranges)
                result[index] = previous_atr
        else:
            # Equivalent Wilder recursion with weighted terms avoiding overflow.
            previous_atr = previous_atr * ((period - 1) / period) + true_range / period
            result[index] = previous_atr
        previous_close = bar["close"]
    return result


@dataclass(frozen=True)
class TakeProfitParameters:
    """Fixed candidate parameters; defaults were specified before evaluation."""

    atr_multiple: float = 3.0
    activation_pct: float = 0.05
    activation_atr: float = 2.0
    retain_profit: float = 0.5

    def __post_init__(self) -> None:
        for name in ("atr_multiple", "activation_pct", "activation_atr", "retain_profit"):
            object.__setattr__(self, name, _number(getattr(self, name), name))
        if not 0 < self.retain_profit < 1:
            raise ValueError("retain_profit must be strictly between 0 and 1")


@dataclass(frozen=True)
class TakeProfitState:
    """Immutable state for a single long entry; score is not a probability."""

    entry_price: float
    entry_atr: float
    peak_close: float
    parameters: TakeProfitParameters = field(default_factory=TakeProfitParameters)
    active: bool = False
    line: float | None = None
    signal: bool = False
    score: float | None = None
    entry_date: str | None = None
    last_date: str | None = None

    def __post_init__(self) -> None:
        for name in ("entry_price", "entry_atr", "peak_close"):
            object.__setattr__(self, name, _number(getattr(self, name), name))
        if not isinstance(self.parameters, TakeProfitParameters):
            raise ValueError("parameters must be TakeProfitParameters")
        if self.peak_close < self.entry_price:
            raise ValueError("peak_close cannot be below entry_price")
        if not isinstance(self.active, bool) or not isinstance(self.signal, bool):
            raise ValueError("active and signal must be booleans")
        if self.active:
            object.__setattr__(self, "line", _number(self.line, "line"))
            object.__setattr__(self, "score", _number(self.score, "score", allow_zero=True))
            if self.line > self.peak_close or self.score > 100:
                raise ValueError("active line cannot exceed peak; score must be 0..100")
        elif self.line is not None or self.score is not None or self.signal:
            raise ValueError("inactive states cannot have a line, score or signal")
        for name in ("entry_date", "last_date"):
            value = getattr(self, name)
            if value is not None:
                _iso_date(value, name)
        if self.entry_date is not None and self.last_date is not None and self.last_date < self.entry_date:
            raise ValueError("last_date cannot precede entry_date")


def new_position(
    entry_price: float,
    entry_atr: float,
    *,
    parameters: TakeProfitParameters | None = None,
    entry_date: str | None = None,
) -> TakeProfitState:
    """Initialize/reset at adjusted entry; entry_atr must be known before entry."""
    entry_price = _number(entry_price, "entry_price")
    return TakeProfitState(
        entry_price=entry_price,
        entry_atr=entry_atr,
        peak_close=entry_price,
        parameters=TakeProfitParameters() if parameters is None else parameters,
        entry_date=entry_date,
    )


def update_take_profit(
    state: TakeProfitState,
    close: float,
    current_atr: float,
    *,
    date: str | None = None,
) -> TakeProfitState:
    """Update at a completed adjusted close and its completed current ATR.

    H=max(old H, close). Activation latches once H-E >= max(.05E, 2ATR_entry).
    Thereafter L=max(old L, H-3ATR_current, E+.5(H-E)); L never declines.
    Signal iff close<=L. Score=clamp(100*(H-close)/(H-L), 0, 100).
    Inactive score/line are None. Supplying dates also prevents duplicate or
    out-of-order updates; same entry day is allowed for its completed close.
    """
    if not isinstance(state, TakeProfitState):
        raise ValueError("state must be TakeProfitState")
    close = _number(close, "close")
    current_atr = _number(current_atr, "current_atr", allow_zero=True)
    if date is not None:
        _iso_date(date)
        if state.entry_date is not None and date < state.entry_date:
            raise ValueError("update date cannot precede entry date")
        if state.last_date is not None and date <= state.last_date:
            raise ValueError("update dates must be strictly increasing")
    elif state.last_date is not None or state.entry_date is not None:
        raise ValueError("dated positions require a date for every update")
    parameters = state.parameters
    peak = max(state.peak_close, close)
    threshold = max(parameters.activation_pct * state.entry_price, parameters.activation_atr * state.entry_atr)
    if not math.isfinite(threshold):
        raise ValueError("activation threshold exceeds finite numeric range")
    active = state.active or peak - state.entry_price >= threshold
    if not active:
        return replace(state, peak_close=peak, last_date=date)
    retained_line = state.entry_price + parameters.retain_profit * (peak - state.entry_price)
    line = max(peak - parameters.atr_multiple * current_atr, retained_line)
    if state.line is not None:
        line = max(line, state.line)
    signal = close <= line
    gap = peak - line
    score = min(100.0, max(0.0, 100.0 * ((peak - close) / gap))) if gap > 0 else (100.0 if signal else 0.0)
    return replace(state, peak_close=peak, active=True, line=line, signal=signal, score=score, last_date=date)
