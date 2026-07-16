from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass
from datetime import date as date_cls, timedelta
from pathlib import Path
from typing import Any


CONFIG_PATH = Path(__file__).with_name("data") / "dca-l2-policy-config.json"
SAFE_CONFIG = {
    "version": "dca-l2-v1", "configValid": False, "cashUsageCap": 0.3,
    "base": {"normal": 1.0, "defensive": 0.5},
    "drawdown": {"smallStartPct": 5, "smallEndPct": 10, "mediumEndPct": 20, "deepEndPct": 35, "smallExtraEndPct": 0.125, "mediumExtraEndPct": 0.25, "deepExtraEndPct": 0.5},
    "volatility": {"elevatedPct": 4, "extremePct": 6},
    "concentration": {"highPct": 25, "veryHighPct": 35},
    "crashFund": {"weeklyReleaseInitialMonthlyBudgetPct": 0.25},
    "recovery": {"requiredDistinctPlanWeeks": 2},
    "budget": {"defaultNormalPool": 300, "defaultCrashFund": 100, "schedule": "weekly_tuesday"},
}


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
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        validate_config(payload)
        payload["configValid"] = True
        return payload
    except (OSError, json.JSONDecodeError, ValueError, TypeError):
        return dict(SAFE_CONFIG)


def validate_config(config: dict[str, Any]) -> None:
    if not isinstance(config, dict) or config.get("version") not in {"dca-l2-v1", "dca-l2-v2"}:
        raise ValueError("unsupported DCA-L2 config version")
    if "concentration" not in config or "veryHighPct" not in config["concentration"]:
        raise ValueError("missing concentration.veryHighPct")
    if "recovery" not in config:
        raise ValueError("missing recovery config")
    if "requiredDistinctPlanWeeks" not in config["recovery"] and "requiredDistinctTradingDays" not in config["recovery"]:
        raise ValueError("missing recovery threshold")
    if number(config["concentration"]["veryHighPct"]) is None:
        raise ValueError("invalid concentration threshold")


def evaluate_dca_l2_policy(
    input_data: dict[str, Any],
    policy_state: dict[str, Any] | None = None,
    config: dict[str, Any] | None = None,
) -> DcaL2Decision:
    cfg = config or load_config()
    validate_config(cfg)
    data = input_data or {}
    state = dict(policy_state or {})
    if "crashFundInitial" not in state and number(data.get("crashFundInitial")) is not None:
        state["crashFundInitial"] = number(data.get("crashFundInitial"))
    if "crashFundBalance" not in state and number(data.get("crashFundBalance")) is not None:
        state["crashFundBalance"] = number(data.get("crashFundBalance"))
    configure_budget_state(data, state, cfg)
    reasons: list[str] = []
    chain: list[dict[str, str]] = []
    base_original = money(data.get("baseAmount"))
    price = number(data.get("price"))
    available_cash = number(data.get("availableCash"))
    cash_provided = data.get("availableCashProvided") is True
    data_status = str(data.get("dataStatus") or "invalid").lower()
    decision_date = str(data.get("date") or "")

    if not positive(price):
        return blocked("HARD_BLOCK_INVALID_PRICE", "invalid price", cfg, state)
    if data_status in {"invalid", "missing", "future"}:
        return blocked("HARD_BLOCK_INVALID_DATA", "invalid or missing data", cfg, state)
    if cash_provided and (available_cash is None or available_cash <= 0):
        return blocked("HARD_BLOCK_ZERO_CASH", "available cash is zero", cfg, state)

    drawdown = max(0.0, number(data.get("drawdownPct")) or 0.0)
    volatility = max(0.0, number(data.get("volatilityPct")) or 0.0)
    market = str(data.get("marketRegime") or "Unknown").lower()
    panic = data.get("panicActive") is True
    trend = str(data.get("trendStatus") or "unavailable").lower()
    concentration = number(data.get("currentAllocationPct"))
    market_closed = data_status == "market_closed_last_close"
    stale = data_status in {"stale", "fallback", "manual", "poor"}
    defensive_now = panic or market in {"bear", "weak", "risk_off"} or volatility >= cfg["volatility"]["extremePct"]

    recovery = update_recovery_state(state, decision_date, data_status, defensive_now, cfg)
    in_defensive = defensive_now or recovery["latched"]
    if recovery["latched"] and not defensive_now:
        reasons.append("RECOVERY_LATCH_ACTIVE")

    if cfg.get("configValid", True) is False:
        reasons.append("POLICY_CONFIG_UNAVAILABLE")
        chain.append(stage("config", "manual_review", "base amount only; extra and Crash Fund blocked"))
        return finish("manual_review", base_original, 0, 0, reasons, chain, cfg, state, recovery, available_cash, cash_provided)

    if stale:
        reasons.append("DATA_MANUAL_REVIEW")
        chain.append(stage("data_quality", "manual_review", "base preserved; extra blocked"))
        return finish("manual_review", base_original, 0, 0, reasons, chain, cfg, state, recovery, available_cash, cash_provided)
    if market_closed:
        reasons.append("MARKET_CLOSED_LAST_CLOSE")
        chain.append(stage("market_session", "market_closed", "base preserved; extra blocked"))
        return finish("normal", base_original, 0, 0, reasons, chain, cfg, state, recovery, available_cash, cash_provided)
    if in_defensive:
        base = money(base_original * cfg["base"]["defensive"])
        reasons.append("DEFENSIVE_BASE_50" if defensive_now else "RECOVERY_LATCH_ACTIVE")
        chain.append(stage("defensive_state", "active", "bear/panic/extreme volatility"))
        return finish("panic_bear_extreme_volatility", base, 0, 0, reasons, chain, cfg, state, recovery, available_cash, cash_provided, defensive_now)

    if drawdown >= cfg["drawdown"]["deepEndPct"]:
        reasons.append("EXTREME_DRAWDOWN_REVIEW")
        chain.append(stage("drawdown", "manual_review", "35%+ value-trap review"))
        return finish("extreme_drawdown_review", base_original, 0, 0, reasons, chain, cfg, state, recovery, available_cash, cash_provided)

    very_high = concentration is not None and concentration >= cfg["concentration"]["veryHighPct"]
    high = concentration is not None and concentration >= cfg["concentration"]["highPct"]
    strong_downtrend = trend in {"strong_downtrend", "severe_downtrend", "manual_review"}
    elevated = volatility >= cfg["volatility"]["elevatedPct"]
    if very_high:
        reasons.append("CONCENTRATION_VERY_HIGH_BLOCKED")
        chain.append(stage("concentration", "manual_review", "veryHighPct reached; all components blocked"))
        return finish("concentration_blocked", 0, 0, 0, reasons, chain, cfg, state, recovery, available_cash, cash_provided)
    if strong_downtrend:
        reasons.append("EXTRA_BLOCKED_STRONG_DOWNTREND")
    if high:
        reasons.append("EXTRA_BLOCKED_CONCENTRATION")
    if elevated:
        reasons.append("ELEVATED_VOLATILITY_EXTRA_CAP")

    extra_pct, state_name = extra_percentage(drawdown, cfg)
    if strong_downtrend or high:
        extra_pct = 0.0
    elif elevated:
        extra_pct = min(extra_pct, cfg["drawdown"]["mediumExtraEndPct"])
    extra = money(base_original * extra_pct)
    crash = 0.0
    if state_name == "deep_drawdown" and not strong_downtrend and not high and not elevated:
        configured_initial = number(data.get("crashFundInitial"))
        if configured_initial is None:
            configured_initial = number(state.get("crashFundInitial"))
        if configured_initial is None:
            configured_initial = number(cfg.get("budget", {}).get("defaultCrashFund")) or number(data.get("monthlyBudget")) or 0.0
        crash_limit = min(
            money(configured_initial) * cfg["crashFund"]["weeklyReleaseInitialMonthlyBudgetPct"],
            max(0.0, money(number(data.get("crashFundBalance")) if data.get("crashFundBalance") is not None else state.get("crashFundBalance"))),
        )
        weight, weight_reason = crash_fund_weight(data)
        if weight_reason:
            reasons.append(weight_reason)
        crash = money(crash_limit * weight)
        reasons.append("CRASH_FUND_PLANNED" if crash > 0 else "CRASH_FUND_EMPTY")
    if extra > 0:
        reasons.append("EXTRA_DIP_BUY")
    chain.append(stage("drawdown", state_name, f"extra {extra_pct * 100:.2f}%"))
    return finish(state_name, base_original, extra, crash, reasons, chain, cfg, state, recovery, available_cash, cash_provided)


def configure_budget_state(data: dict[str, Any], state: dict[str, Any], cfg: dict[str, Any]) -> None:
    crash_initial = number(data.get("crashFundInitial"))
    if crash_initial is None:
        crash_initial = number(state.get("crashFundInitial"))
    if crash_initial is None:
        crash_initial = number(data.get("crashFund")) or number(cfg.get("budget", {}).get("defaultCrashFund")) or 0.0
    normal_pool = number(data.get("normalPool"))
    if normal_pool is None:
        monthly = number(data.get("monthlyBudget"))
        normal_pool = max(0.0, monthly - crash_initial) if monthly is not None else number(cfg.get("budget", {}).get("defaultNormalPool")) or 0.0
    normal_used = number(data.get("normalPoolUsed")) if number(data.get("normalPoolUsed")) is not None else number(state.get("normalPoolUsed")) or 0.0
    crash_used = number(data.get("crashFundUsed")) if number(data.get("crashFundUsed")) is not None else number(state.get("crashFundUsed")) or 0.0
    state["_normalPoolRemaining"] = money(max(0.0, normal_pool - normal_used))
    state["_crashFundRemaining"] = money(max(0.0, crash_initial - crash_used))


def update_recovery_state(state: dict[str, Any], decision_date: str, data_status: str, in_defensive: bool, config: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = config or load_config()
    prior_latched = state.get("defensiveLatched") is True
    prior_count = max(0, int(number(state.get("recoveryConfirmations")) or 0))
    prior_week = str(state.get("lastRecoveryWeek") or "")
    valid = data_status == "fresh" and bool(decision_date)
    current_week = iso_week_id(decision_date) if valid else None
    if in_defensive:
        return {"latched": True, "confirmations": 0, "last_week": ""}
    if not prior_latched:
        return {"latched": False, "confirmations": 0, "last_week": ""}
    count = prior_count
    if current_week and current_week != prior_week:
        if prior_week and not consecutive_iso_weeks(prior_week, current_week):
            count = 0
        count += 1
    required = int(number(cfg["recovery"].get("requiredDistinctPlanWeeks", cfg["recovery"].get("requiredDistinctTradingDays", 2))) or 2)
    required = max(1, required)
    return {"latched": count < required, "confirmations": count, "last_week": current_week or prior_week}


def iso_week_id(value: str) -> str | None:
    try:
        parsed = date_cls.fromisoformat(value)
    except (TypeError, ValueError):
        return None
    iso = parsed.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def consecutive_iso_weeks(previous: str, current: str) -> bool:
    try:
        prev_year, prev_week = previous.split("-W")
        curr_year, curr_week = current.split("-W")
        prev_date = date_cls.fromisocalendar(int(prev_year), int(prev_week), 1)
        curr_date = date_cls.fromisocalendar(int(curr_year), int(curr_week), 1)
    except (ValueError, TypeError):
        return False
    return curr_date - prev_date == timedelta(days=7)


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
    normal_remaining = money(state.get("_normalPoolRemaining")) if state.get("_normalPoolRemaining") is not None else None
    crash_remaining = money(state.get("_crashFundRemaining")) if state.get("_crashFundRemaining") is not None else None
    if normal_remaining is not None:
        original = base
        base = money(min(base, normal_remaining))
        extra = money(min(extra, max(0.0, normal_remaining - base)))
        if base < original or extra < money(pre_cap - original - crash):
            reasons.append("NORMAL_POOL_BUDGET_APPLIED")
    if crash_remaining is not None:
        original_crash = crash
        crash = money(min(crash, crash_remaining))
        if crash < original_crash:
            reasons.append("CRASH_FUND_BUDGET_APPLIED")
    cash_cap = money(available_cash * cfg["cashUsageCap"]) if cash_provided and available_cash is not None else None
    final = money(base + extra + crash)
    if cash_cap is not None and final > cash_cap:
        reduction = final - cash_cap
        crash_after = money(max(0.0, crash - reduction))
        reduction = max(0.0, reduction - crash)
        extra_after = money(max(0.0, extra - reduction))
        reduction = max(0.0, reduction - extra)
        base = money(max(0.0, base - reduction))
        crash, extra = crash_after, extra_after
        final = money(base + extra + crash)
        reasons.append("CASH_CAP_APPLIED")
        chain.append(stage("cash_cap", "capped", f"cap {cash_cap:.2f}"))
    manual_review = state_name in {"manual_review", "extreme_drawdown_review", "concentration_blocked"} or "CRASH_FUND_WEIGHT_INVALID_MANUAL_REVIEW" in reasons
    return DcaL2Decision(
        state=state_name,
        base_amount=money(base),
        extra_amount=money(extra),
        crash_fund_amount=money(crash),
        pre_cap_amount=pre_cap,
        final_amount=money(final),
        cash_cap_amount=cash_cap,
        reason_codes=ordered_reasons(reasons),
        factor_chain=chain + [stage("final_amount", state_name, f"{final:.2f}")],
        manual_review=manual_review,
        hard_blocked=False,
        recovery_confirmations=recovery["confirmations"],
        crash_fund_balance=money(state.get("crashFundBalance")),
        crash_fund_weekly_limit=money((number(state.get("crashFundInitial")) or 0.0) * cfg["crashFund"]["weeklyReleaseInitialMonthlyBudgetPct"]),
        defensive_now=defensive_now,
    )


def plan_portfolio_dca_l2(items: list[dict[str, Any]], *, normal_pool: float, crash_fund: float, normal_used: float = 0.0, crash_used: float = 0.0, portfolio_cash_cap: float | None = None) -> dict[str, Any]:
    rows = [dict(item) for item in items]
    normal_remaining = money(max(0.0, normal_pool - normal_used))
    crash_remaining = money(max(0.0, crash_fund - crash_used))
    for row in rows:
        decision = dict(row.get("decision") or {})
        for field in ("base_amount", "extra_amount", "crash_fund_amount"):
            decision[field] = money(decision.get(field))
        allocation = number(row.get("currentAllocationPct"))
        if allocation is not None and allocation >= 35:
            decision["base_amount"] = decision["extra_amount"] = decision["crash_fund_amount"] = 0.0
            decision.setdefault("reason_codes", []).append("CONCENTRATION_VERY_HIGH_BLOCKED")
            decision["manual_review"] = True
        elif allocation is not None and allocation >= 25:
            decision["extra_amount"] = decision["crash_fund_amount"] = 0.0
            decision.setdefault("reason_codes", []).append("EXTRA_BLOCKED_CONCENTRATION")
        row["decision"] = decision

    def scale(field: str, available: float, reason: str) -> None:
        total = money(sum(row["decision"][field] for row in rows))
        if total <= available:
            return
        ratio = available / total if total else 0.0
        for row in rows:
            decision = row["decision"]
            decision[field] = money(decision[field] * ratio)
            decision.setdefault("reason_codes", []).append(reason)

    scale("crash_fund_amount", crash_remaining, "CRASH_FUND_BUDGET_APPLIED")
    scale("base_amount", normal_remaining, "NORMAL_POOL_BASE_BUDGET_APPLIED")
    remaining_for_extra = money(max(0.0, normal_remaining - sum(row["decision"]["base_amount"] for row in rows)))
    scale("extra_amount", remaining_for_extra, "NORMAL_POOL_EXTRA_BUDGET_APPLIED")
    total = money(sum(sum(row["decision"][field] for field in ("base_amount", "extra_amount", "crash_fund_amount")) for row in rows))
    if portfolio_cash_cap is not None and total > money(max(0.0, portfolio_cash_cap)):
        reduction = money(total - max(0.0, portfolio_cash_cap))
        for field in ("crash_fund_amount", "extra_amount", "base_amount"):
            component = money(sum(row["decision"][field] for row in rows))
            if component <= 0 or reduction <= 0:
                continue
            cut = min(component, reduction)
            ratio = (component - cut) / component
            for row in rows:
                row["decision"][field] = money(row["decision"][field] * ratio)
                row["decision"].setdefault("reason_codes", []).append("PORTFOLIO_CASH_CAP_APPLIED")
            reduction = money(reduction - cut)
        total = money(sum(sum(row["decision"][field] for field in ("base_amount", "extra_amount", "crash_fund_amount")) for row in rows))
    for row in rows:
        decision = row["decision"]
        decision["final_amount"] = money(decision["base_amount"] + decision["extra_amount"] + decision["crash_fund_amount"])
        decision["reason_codes"] = ordered_reasons(decision.get("reason_codes", []))
    planned_normal = money(sum(row["decision"]["base_amount"] + row["decision"]["extra_amount"] for row in rows))
    planned_crash = money(sum(row["decision"]["crash_fund_amount"] for row in rows))
    return {
        "items": rows,
        "normal_pool": money(normal_pool), "normal_pool_used": money(normal_used), "normal_pool_remaining": normal_remaining,
        "crash_fund": money(crash_fund), "crash_fund_used": money(crash_used), "crash_fund_remaining": crash_remaining,
        "planned_normal": planned_normal, "planned_crash": planned_crash, "total_planned": total,
        "monthly_budget_remaining": money(normal_remaining + crash_remaining),
        "unallocated_cash": money(max(0.0, normal_remaining + crash_remaining - total)),
    }


def normalize_dca_l2_ledger(value: dict[str, Any] | None, current_month: str | None = None) -> dict[str, Any]:
    raw = value if isinstance(value, dict) else {}
    month = current_month or date_cls.today().isoformat()[:7]
    raw_month = raw.get("month") if isinstance(raw.get("month"), str) else month
    entries = []
    for index, item in enumerate(raw.get("entries", []) if isinstance(raw.get("entries"), list) else []):
        amount = number(item.get("amount")) if isinstance(item, dict) else None
        if amount is None or amount <= 0:
            continue
        entry = item if isinstance(item, dict) else {}
        entries.append({
            "id": str(entry.get("id") or f"migrated-{index}-{amount}"),
            "month": str(entry.get("month") or raw_month),
            "type": entry.get("type") if entry.get("type") in {"base", "extra", "crash"} else "crash",
            "symbol": str(entry.get("symbol") or "").strip().upper(),
            "amount": money(amount),
            "date": str(entry.get("date") or f"{raw_month}-01"),
            "note": str(entry.get("note") or ""),
            "reversible": entry.get("reversible") is not False,
        })
    return {"version": "dca-l2-v2", "month": raw_month, "initial": money(raw.get("initial")), "entries": entries, "defensiveLatched": raw.get("defensiveLatched") is True, "recoveryConfirmations": int(number(raw.get("recoveryConfirmations")) or 0), "lastRecoveryWeek": str(raw.get("lastRecoveryWeek") or "")}


def dca_l2_ledger_used(ledger: dict[str, Any], entry_type: str) -> float:
    month = ledger.get("month")
    return money(sum(number(item.get("amount")) or 0 for item in ledger.get("entries", []) if item.get("type") == entry_type and (not item.get("month") or item.get("month") == month)))


def blocked(reason: str, detail: str, cfg: dict[str, Any], state: dict[str, Any]) -> DcaL2Decision:
    return DcaL2Decision("hard_block", 0, 0, 0, 0, 0, 0, [reason], [stage("hard_block", "blocked", detail)], False, True, 0, money(state.get("crashFundBalance")), 0, False)


def stage(name: str, status: str, detail: str) -> dict[str, str]:
    return {"stage": name, "status": status, "detail": detail}


def ordered_reasons(reasons: list[str]) -> list[str]:
    order = ["HARD_BLOCK", "DEFENSIVE", "EXTREME", "DATA", "MARKET", "CONCENTRATION", "EXTRA", "CRASH", "NORMAL", "CASH", "ELEVATED", "PORTFOLIO"]
    def key(value: str) -> tuple[int, int]:
        primary = next((index for index, prefix in enumerate(order) if value.startswith(prefix)), len(order))
        secondary = 0 if value == "CRASH_FUND_WEIGHT_INVALID_MANUAL_REVIEW" else (1 if value == "CRASH_FUND_EMPTY" else 0)
        return primary, secondary
    return sorted(set(reasons), key=key)


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
    result = number(value)
    return round(result + 1e-12, 2) if result is not None else 0.0


def crash_fund_weight(data: dict[str, Any]) -> tuple[float, str | None]:
    if "crashFundWeight" not in data:
        return 1.0, None
    value = number(data.get("crashFundWeight"))
    if value is None or value < 0:
        return 0.0, "CRASH_FUND_WEIGHT_INVALID_MANUAL_REVIEW"
    return value, None
