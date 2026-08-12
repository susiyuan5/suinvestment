"""Pure Core-Satellite v3 budgeting policy shared by dashboard and reports."""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

PRESET_PATH = Path(__file__).with_name("data") / "core-satellite-v3.json"
CORE_SYMBOLS = ("SPY", "NVDA", "AAPL", "ASML", "KO", "BYDDY")
SATELLITE_SYMBOLS = CORE_SYMBOLS[1:]
TECH_SYMBOLS = ("NVDA", "AAPL", "ASML")
ALLOCATION_EPSILON = 1e-9


def money(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return round(max(0.0, number) + 1e-10, 2) if math.isfinite(number) else 0.0


def _pct(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return round(number * 100 + 1e-9, 2) if math.isfinite(number) else None


def _ratio_from_pct(value: Any) -> float:
    return round((float(value) + 1e-9) / 100, 4)


def load_preset(path: Path = PRESET_PATH) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not validate_preset(payload):
        raise ValueError("invalid core-satellite-v3 preset")
    return payload


def validate_preset(preset: dict[str, Any]) -> bool:
    if not isinstance(preset, dict) or preset.get("version") != "core-satellite-v3":
        return False
    core = preset.get("core") or {}
    satellites = preset.get("satellites")
    if core.get("symbol") != "SPY" or not isinstance(satellites, list) or len(satellites) != 5:
        return False
    total = float(core.get("target_allocation", float("nan"))) + sum(float(row.get("target_allocation", float("nan"))) for row in satellites)
    return math.isfinite(total) and abs(total - 1.0) <= ALLOCATION_EPSILON and all(0 <= float(row.get("target_allocation", 1)) <= 0.15 + ALLOCATION_EPSILON and row.get("bucket") == "satellite" for row in satellites)


def allocation_metrics(allocations: dict[str, Any]) -> dict[str, float]:
    values = {symbol: (_pct(allocations.get(symbol, 0)) or 0.0) for symbol in CORE_SYMBOLS}
    allocated = sum(values.values())
    return {"allocated": allocated, "remaining": max(0.0, 100 - allocated), "overage": max(0.0, allocated - 100), "core": values["SPY"], "satellite": allocated - values["SPY"], "technology": sum(values[symbol] for symbol in TECH_SYMBOLS)}


def validate_allocations(allocations: dict[str, Any]) -> dict[str, Any]:
    errors: list[str] = []
    for symbol in CORE_SYMBOLS:
        value = allocations.get(symbol)
        try:
            number = float(value)
        except (TypeError, ValueError):
            number = float("nan")
        if not math.isfinite(number) or number < 0:
            errors.append(f"{symbol} 目标比例必须是非负数字")
    metrics = allocation_metrics(allocations)
    limits = load_preset()["limits"]
    if abs(metrics["allocated"] - 100) > ALLOCATION_EPSILON: errors.append("六项比例合计必须严格等于 100.00%")
    if not limits["spy_min_target_pct"] - ALLOCATION_EPSILON <= metrics["core"] <= limits["spy_max_target_pct"] + ALLOCATION_EPSILON: errors.append("SPY 目标比例必须在 40.00% 至 80.00% 之间")
    if not limits["satellite_min_target_pct"] - ALLOCATION_EPSILON <= metrics["satellite"] <= limits["satellite_max_target_pct"] + ALLOCATION_EPSILON: errors.append("个股合计比例必须在 20.00% 至 60.00% 之间")
    for symbol in SATELLITE_SYMBOLS:
        value = _pct(allocations.get(symbol)) or 0.0
        if value > limits["single_stock_max_target_pct"] + ALLOCATION_EPSILON: errors.append(f"{symbol} 目标为 {value:.2f}%，超过单股上限 {limits['single_stock_max_target_pct']:.2f}%")
    if metrics["technology"] > limits["technology_max_target_pct"] + ALLOCATION_EPSILON: errors.append(f"科技个股合计为 {metrics['technology']:.2f}%，超过上限 {limits['technology_max_target_pct']:.2f}%")
    return {"valid": not errors, "errors": errors, "metrics": metrics}


def allocations_for_core(core_percent: Any) -> dict[str, float] | None:
    try:
        core = float(core_percent)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(core) or not 40 <= core <= 80: return None
    preset = load_preset().get("shortcuts", {}).get(str(int(core)))
    if preset: return preset.copy()
    return average_satellite_allocations(core)


def average_satellite_allocations(core_percent: Any) -> dict[str, float] | None:
    try: core = float(core_percent)
    except (TypeError, ValueError): return None
    if not math.isfinite(core) or not 40 <= core <= 80: return None
    each = _ratio_from_pct((100 - core) / 5)
    return {"SPY": _ratio_from_pct(core), **{symbol: each for symbol in SATELLITE_SYMBOLS}}


def recommended_allocations() -> dict[str, float]:
    return load_preset()["shortcuts"]["40"].copy()


def plan_core_satellite(*, base_budget: float, crash_fund_remaining: float, actual_allocations: dict[str, float] | None = None, satellite_decisions: dict[str, dict[str, Any]] | None = None, blocked_symbols: list[str] | None = None, cash_only_symbols: list[str] | None = None, spy_data_valid: bool = True, safety_blocked: bool = False, spy_crash_enhancement: float = 0.0, preset: dict[str, Any] | None = None) -> dict[str, Any]:
    preset = preset or load_preset()
    if not validate_preset(preset): raise ValueError("invalid preset")
    actual, decisions, blocked_symbols = actual_allocations or {}, satellite_decisions or {}, blocked_symbols or []
    cash_only_symbols = cash_only_symbols or []
    limits = preset["limits"]
    spy_actual = float(actual.get("SPY") or 0)
    satellite_actual = sum(float(actual.get(row["symbol"]) or 0) for row in preset["satellites"])
    tech_actual = sum(float(actual.get(row["symbol"]) or 0) for row in preset["satellites"] if row.get("sector") == "technology")
    base, crash = money(base_budget), money(crash_fund_remaining)
    spy_usable = spy_data_valid and not safety_blocked
    spy_base = money(base * preset["core"]["target_allocation"])
    rows = [{"symbol": "SPY", "bucket": "core", "originalBaseAmount": spy_base, "dcaAdjustedAmount": spy_base, "crashFundEnhancement": 0.0, "riskReduction": 0.0, "redirectedToSpy": 0.0, "cashRetained": 0.0, "finalAmount": spy_base if spy_usable else 0.0, "reasonCodes": [] if spy_usable else ["SPY_DATA_OR_SAFETY_BLOCK"], "factorChain": [f"base:{preset['core']['target_allocation'] * 100}%"]}]
    redirect = 0.0
    for asset in preset["satellites"]:
        symbol, original = asset["symbol"], money(base * asset["target_allocation"])
        decision = decisions.get(symbol) or {}
        adjusted = money(decision.get("finalAmount", original))
        row = {"symbol": symbol, "bucket": "satellite", "originalBaseAmount": original, "dcaAdjustedAmount": adjusted, "crashFundEnhancement": money(decision.get("crashFundAmount")), "riskReduction": 0.0, "redirectedToSpy": 0.0, "cashRetained": 0.0, "finalAmount": adjusted, "reasonCodes": [], "factorChain": []}
        enhanced_block = (satellite_actual >= limits["satellite_enhancement_block_pct"] and adjusted > original) or (asset.get("sector") == "technology" and tech_actual >= limits["technology_enhancement_block_pct"] and adjusted > original)
        hard_block = adjusted <= 0 < original or float(actual.get(symbol) or 0) >= limits["single_stock_block_pct"] or symbol in blocked_symbols or enhanced_block
        if hard_block:
            row["riskReduction"], row["finalAmount"] = row["finalAmount"], 0.0
            row["reasonCodes"].append("SATELLITE_RISK_BLOCKED")
            if symbol not in cash_only_symbols: redirect += original
        rows.append(row)
    satellite_total = sum(row["finalAmount"] for row in rows[1:])
    satellite_cap = money(max(0.0, base - rows[0]["finalAmount"]))
    if satellite_total > satellite_cap and satellite_total > 0:
        for row in rows[1:]: row["finalAmount"] = money(row["finalAmount"] * satellite_cap / satellite_total); row["reasonCodes"].append("NORMAL_POOL_BUDGET_APPLIED")
    redirected = money(min(redirect, redirect + base)) if spy_usable and spy_actual < limits["spy_max_current_pct"] else 0.0
    rows[0]["redirectedToSpy"], rows[0]["finalAmount"] = redirected, money(rows[0]["finalAmount"] + redirected)
    if redirected: rows[0]["reasonCodes"].append("SATELLITE_BASE_REDIRECTED_TO_SPY")
    retained = money(redirect - redirected)
    if retained:
        for row in rows:
            if row["symbol"] != "SPY" and row["finalAmount"] == 0: row["cashRetained"] = money(row["cashRetained"] + retained / max(1, len(rows) - 1))
    enhancement = money(min(crash, spy_base * (limits["spy_enhancement_max_multiple"] - 1), spy_crash_enhancement)) if spy_usable else 0.0
    rows[0]["crashFundEnhancement"], rows[0]["finalAmount"] = enhancement, money(rows[0]["finalAmount"] + enhancement)
    total, source = money(sum(row["finalAmount"] for row in rows)), money(base + crash)
    cash = money(max(0.0, source - total))
    assert abs(total + cash - source) <= 0.005
    return {"version": preset["version"], "items": rows, "spyBase": spy_base, "spyRedirected": redirected, "crashFundUsed": enhancement, "cashRetained": cash, "totalPlanned": total, "conservation": {"source": source, "allocated": total, "cash": cash, "balanced": True}, "summary": {"coreTargetPct": preset["core"]["target_allocation"] * 100, "satelliteTargetPct": (1 - preset["core"]["target_allocation"]) * 100, "satelliteActualPct": satellite_actual, "technologyActualPct": tech_actual, "spyActualPct": spy_actual, "qqqGeneratesBuyAmount": False}}
