from __future__ import annotations

import json
import math
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any


CONFIG_PATH = Path(__file__).with_name("data") / "dca-l2-policy-config.json"


@dataclass(frozen=True)
class DcaL2Decision:
    state: str
    base_amount: float
    extra_amount: float
    crash_fund_amount: float
    pre_cap_amount: float
    final_amount: float
    cash_cap_amount: float | None
    reason_codes: list[str]
    factor_chain: list[dict[str, str]]
    manual_review: bool
    hard_blocked: bool
    recovery_confirmations: int
    crash_fund_balance: float
    crash_fund_weekly_limit: float
    defensive_now: bool

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def load_config(path: Path = CONFIG_PATH) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def evaluate_dca_l2_policy(
    input_data: dict[str, Any],
    policy_state: dict[str, Any] | None = None,
    config: dict[str, Any] | None = None,
) -> DcaL2Decision:
    cfg = config or load_config()
    data = input_data or {}
    state = dict(policy_state or {})
    if "crashFundInitial" not in state and number(input_data.get("crashFundInitial")) is not None:
        state["crashFundInitial"] = number(input_data.get("crashFundInitial"))
    if "crashFundBalance" not in state and number(input_data.get("crashFundBalance")) is not None:
        state["crashFundBalance"] = number(input_data.get("crashFundBalance"))
    reasons: list[str] = []
    chain: list[dict[str, str]] = []
    base_original = money(data.get("baseAmount"))
    price = number(data.get("price"))
    available_cash = number(data.get("availableCash"))
    cash_provided = data.get("availableCashProvided") is True
    data_status = str(data.get("dataStatus") or "invalid").lower()
    date = str(data.get("date") or "")

    if not positive(price):
        return blocked("HARD_BLOCK_INVALID_PRICE", "invalid price", cfg, state)
    if data_status in {"invalid", "missing", "future"}:
        return blocked("HARD_BLOCK_INVALID_DATA", "invalid or missing data", cfg, state)
    if cash_provided and (available_cash is None or available_cash <= 0):
        return blocked("HARD_BLOCK_ZERO_CASH", "available cash is zero", cfg, state)

    base = base_original
    drawdown = max(0.0, number(data.get("drawdownPct")) or 0.0)
    volatility = max(0.0, number(data.get("volatilityPct")) or 0.0)
    market = str(data.get("marketRegime") or "Unknown").lower()
    panic = data.get("panicActive") is True
    trend = str(data.get("trendStatus") or "unavailable").lower()
    concentration = number(data.get("currentAllocationPct"))
    market_closed = data_status == "market_closed_last_close"
    stale = data_status in {"stale", "fallback", "manual", "poor"}
    defensive_now = panic or market in {"bear", "weak", "risk_off"} or volatility >= cfg["volatility"]["extremePct"]

    recovery = update_recovery_state(state, date, data_status, defensive_now)
    in_defensive = defensive_now or recovery["latched"]
    if recovery["latched"] and not defensive_now:
        reasons.append("RECOVERY_LATCH_ACTIVE")

    if stale:
        reasons.append("DATA_MANUAL_REVIEW")
        chain.append(stage("data_quality", "manual_review", "base preserved; extra blocked"))
        return finish("manual_review", base, 0, 0, reasons, chain, cfg, state, recovery, available_cash, cash_provided)
    if market_closed:
        reasons.append("MARKET_CLOSED_LAST_CLOSE")
        chain.append(stage("market_session", "market_closed", "base preserved; extra blocked"))
        return finish("normal", base, 0, 0, reasons, chain, cfg, state, recovery, available_cash, cash_provided)
    if in_defensive:
        base = money(base_original * cfg["base"]["defensive"])
        reasons.append("DEFENSIVE_BASE_50")
        chain.append(stage("defensive_state", "active", "bear/panic/extreme volatility"))
        return finish("panic_bear_extreme_volatility", base, 0, 0, reasons, chain, cfg, state, recovery, available_cash, cash_provided, defensive_now=defensive_now)
    if drawdown >= cfg["drawdown"]["deepEndPct"]:
        reasons.append("EXTREME_DRAWDOWN_REVIEW")
        chain.append(stage("drawdown", "manual_review", "35%+ value-trap review"))
        return finish("extreme_drawdown_review", base, 0, 0, reasons, chain, cfg, state, recovery, available_cash, cash_provided)

    high_concentration = concentration is not None and concentration >= cfg["concentration"]["highPct"]
    strong_downtrend = trend in {"strong_downtrend", "severe_downtrend", "manual_review"}
    elevated = volatility >= cfg["volatility"]["elevatedPct"]
    if strong_downtrend:
        reasons.append("EXTRA_BLOCKED_STRONG_DOWNTREND")
    if high_concentration:
        reasons.append("EXTRA_BLOCKED_CONCENTRATION")
    if elevated:
        reasons.append("ELEVATED_VOLATILITY_EXTRA_CAP")

    extra_pct, state_name = extra_percentage(drawdown, cfg)
    if strong_downtrend or high_concentration:
        extra_pct = 0.0
    elif elevated:
        extra_pct = min(extra_pct, cfg["drawdown"]["mediumExtraEndPct"])
    extra = money(base * extra_pct)
    crash = 0.0
    if state_name == "deep_drawdown" and not strong_downtrend and not high_concentration and not elevated:
        crash_initial = number(data.get("crashFundInitial"))
        if crash_initial is None:
            crash_initial = number(state.get("crashFundInitial"))
        if crash_initial is None:
            crash_initial = number(data.get("monthlyBudget")) or 0.0
        crash_limit = min(
            money(crash_initial) * cfg["crashFund"]["weeklyReleaseInitialMonthlyBudgetPct"],
            max(0.0, money(number(data.get("crashFundBalance")) or 0.0)),
        )
        crash = money(crash_limit * max(0.0, number(data.get("crashFundWeight")) or 1.0))
        reasons.append("CRASH_FUND_PLANNED" if crash > 0 else "CRASH_FUND_EMPTY")
    if extra > 0:
        reasons.append("EXTRA_DIP_BUY")
    chain.append(stage("drawdown", state_name, f"extra {extra_pct * 100:.2f}%"))
    return finish(state_name, base, extra, crash, reasons, chain, cfg, state, recovery, available_cash, cash_provided)


def update_recovery_state(state: dict[str, Any], date: str, data_status: str, in_defensive: bool) -> dict[str, Any]:
    prior_latched = state.get("defensiveLatched") is True
    prior_count = int(state.get("recoveryConfirmations") or 0)
    prior_date = str(state.get("lastRecoveryTradingDate") or "")
    valid = data_status == "fresh" and bool(date)
    if in_defensive:
        return {"latched": True, "confirmations": 0, "last_date": ""}
    if not prior_latched:
        return {"latched": False, "confirmations": 0, "last_date": ""}
    count = prior_count + 1 if valid and date != prior_date else prior_count
    required = 2
    return {"latched": count < required, "confirmations": count, "last_date": date if valid else prior_date}


def extra_percentage(drawdown: float, cfg: dict[str, Any]) -> tuple[float, str]:
    d = cfg["drawdown"]
    if drawdown < d["smallStartPct"]:
        return 0.0, "normal"
    if drawdown < d["smallEndPct"]:
        return interpolate(drawdown, d["smallStartPct"], d["smallEndPct"], 0.0, d["smallExtraEndPct"]), "small_drawdown"
    if drawdown < d["mediumEndPct"]:
        return interpolate(drawdown, d["smallEndPct"], d["mediumEndPct"], d["smallExtraEndPct"], d["mediumExtraEndPct"]), "medium_drawdown"
    return interpolate(drawdown, d["mediumEndPct"], d["deepEndPct"], d["mediumExtraEndPct"], d["deepExtraEndPct"]), "deep_drawdown"


def finish(state_name: str, base: float, extra: float, crash: float, reasons: list[str], chain: list[dict[str, str]], cfg: dict[str, Any], state: dict[str, Any], recovery: dict[str, Any], available_cash: float | None, cash_provided: bool, defensive_now: bool = False) -> DcaL2Decision:
    pre_cap = money(base + extra + crash)
    cash_cap = money(available_cash * cfg["cashUsageCap"]) if cash_provided and available_cash is not None else None
    final = pre_cap
    crash_after = crash
    extra_after = extra
    if cash_cap is not None and final > cash_cap:
        reduction = final - cash_cap
        crash_after = money(max(0.0, crash_after - reduction))
        reduction = max(0.0, reduction - crash)
        extra_after = money(max(0.0, extra_after - reduction))
        reduction = max(0.0, reduction - extra)
        base = money(max(0.0, base - reduction))
        final = money(base + extra_after + crash_after)
        reasons.append("CASH_CAP_APPLIED")
        chain.append(stage("cash_cap", "capped", f"cap {cash_cap:.2f}"))
    manual_review = state_name in {"manual_review", "extreme_drawdown_review"}
    return DcaL2Decision(
        state=state_name,
        base_amount=money(base),
        extra_amount=money(extra_after),
        crash_fund_amount=money(crash_after),
        pre_cap_amount=pre_cap,
        final_amount=money(final),
        cash_cap_amount=cash_cap,
        reason_codes=ordered_reasons(reasons),
        factor_chain=chain + [stage("final_amount", state_name, f"{final:.2f}")],
        manual_review=manual_review,
        hard_blocked=False,
        recovery_confirmations=recovery["confirmations"],
        crash_fund_balance=money(number((state or {}).get("crashFundBalance")) or number((state or {}).get("crash_fund_balance")) or 0.0),
        crash_fund_weekly_limit=money((number((state or {}).get("crashFundInitial")) or 0.0) * cfg["crashFund"]["weeklyReleaseInitialMonthlyBudgetPct"]),
        defensive_now=defensive_now,
    )


def blocked(reason: str, detail: str, cfg: dict[str, Any], state: dict[str, Any]) -> DcaL2Decision:
    return DcaL2Decision("hard_block", 0, 0, 0, 0, 0, 0, [reason], [stage("hard_block", "blocked", detail)], False, True, 0, money(number((state or {}).get("crashFundBalance")) or 0), 0, False)


def stage(name: str, status: str, detail: str) -> dict[str, str]:
    return {"stage": name, "status": status, "detail": detail}


def ordered_reasons(reasons: list[str]) -> list[str]:
    order = ["HARD_BLOCK", "DEFENSIVE", "EXTREME", "DATA", "MARKET", "EXTRA", "CRASH", "CASH", "ELEVATED"]
    return sorted(set(reasons), key=lambda value: next((index for index, prefix in enumerate(order) if value.startswith(prefix)), len(order)))


def interpolate(value: float, start: float, end: float, low: float, high: float) -> float:
    if end <= start:
        return high
    ratio = min(1.0, max(0.0, (value - start) / (end - start)))
    return low + (high - low) * ratio


def number(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def positive(value: Any) -> bool:
    result = number(value)
    return result is not None and result > 0


def money(value: Any) -> float:
    return round(float(value or 0.0) + 1e-12, 2)
