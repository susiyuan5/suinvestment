"""Pure Core-Satellite v1 budgeting policy shared by research tests and reports."""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

PRESET_PATH = Path(__file__).with_name("data") / "core-satellite-v1.json"


def money(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return round(max(0.0, number) + 1e-10, 2) if math.isfinite(number) else 0.0


def load_preset(path: Path = PRESET_PATH) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not validate_preset(payload):
        raise ValueError("invalid core-satellite-v1 preset")
    return payload


def validate_preset(preset: dict[str, Any]) -> bool:
    if not isinstance(preset, dict) or preset.get("version") != "core-satellite-v1":
        return False
    core = preset.get("core") or {}
    satellites = preset.get("satellites")
    if core.get("symbol") != "SPY" or not isinstance(satellites, list) or len(satellites) != 5:
        return False
    total = float(core.get("target_allocation", float("nan"))) + sum(float(row.get("target_allocation", float("nan"))) for row in satellites)
    return math.isfinite(total) and abs(total - 1.0) <= 1e-9 and all(float(row.get("target_allocation", 1)) <= 0.1 and row.get("bucket") == "satellite" for row in satellites)


def plan_core_satellite(*, base_budget: float, crash_fund_remaining: float, actual_allocations: dict[str, float] | None = None, satellite_decisions: dict[str, dict[str, Any]] | None = None, blocked_symbols: list[str] | None = None, spy_data_valid: bool = True, safety_blocked: bool = False, spy_crash_enhancement: float = 0.0, preset: dict[str, Any] | None = None) -> dict[str, Any]:
    preset = preset or load_preset()
    if not validate_preset(preset):
        raise ValueError("invalid preset")
    actual = actual_allocations or {}
    decisions = satellite_decisions or {}
    blocked_symbols = blocked_symbols or []
    limits = preset["limits"]
    spy_actual = float(actual.get("SPY") or 0)
    satellite_actual = sum(float(actual.get(row["symbol"]) or 0) for row in preset["satellites"])
    tech_actual = sum(float(actual.get(row["symbol"]) or 0) for row in preset["satellites"] if row.get("sector") == "technology")
    base = money(base_budget)
    crash = money(crash_fund_remaining)
    spy_usable = spy_data_valid and not safety_blocked
    spy_base = money(base * preset["core"]["target_allocation"])
    rows = [{"symbol": "SPY", "bucket": "core", "originalBaseAmount": spy_base, "dcaAdjustedAmount": spy_base, "crashFundEnhancement": 0.0, "riskReduction": 0.0, "redirectedToSpy": 0.0, "cashRetained": 0.0, "finalAmount": spy_base if spy_usable else 0.0, "reasonCodes": [] if spy_usable else ["SPY_DATA_OR_SAFETY_BLOCK"], "factorChain": ["base:60%"]}]
    redirect = 0.0
    for asset in preset["satellites"]:
        symbol = asset["symbol"]
        original = money(base * asset["target_allocation"])
        decision = decisions.get(symbol) or {}
        adjusted = money(decision.get("finalAmount", original))
        row = {"symbol": symbol, "bucket": "satellite", "originalBaseAmount": original, "dcaAdjustedAmount": adjusted, "crashFundEnhancement": money(decision.get("crashFundAmount")), "riskReduction": 0.0, "redirectedToSpy": 0.0, "cashRetained": 0.0, "finalAmount": adjusted, "reasonCodes": [], "factorChain": []}
        enhanced_block = (satellite_actual >= limits["satellite_enhancement_block_pct"] and adjusted > original) or (asset.get("sector") == "technology" and tech_actual >= limits["technology_enhancement_block_pct"] and adjusted > original)
        hard_block = adjusted <= 0 < original or float(actual.get(symbol) or 0) >= limits["single_stock_block_pct"] or symbol in blocked_symbols or enhanced_block
        if hard_block:
            row["riskReduction"] = row["finalAmount"]
            row["finalAmount"] = 0.0
            row["reasonCodes"].append("SATELLITE_RISK_BLOCKED")
            redirect += original
        rows.append(row)
    satellite_total = sum(row["finalAmount"] for row in rows[1:])
    satellite_cap = money(max(0.0, base - rows[0]["finalAmount"]))
    if satellite_total > satellite_cap:
        for row in rows[1:]:
            row["finalAmount"] = money(row["finalAmount"] * satellite_cap / satellite_total)
            if "NORMAL_POOL_BUDGET_APPLIED" not in row["reasonCodes"]:
                row["reasonCodes"].append("NORMAL_POOL_BUDGET_APPLIED")
    redirected = money(min(redirect, redirect + base)) if spy_usable and spy_actual < limits["spy_max_current_pct"] else 0.0
    rows[0]["redirectedToSpy"] = redirected
    rows[0]["finalAmount"] = money(rows[0]["finalAmount"] + redirected)
    if redirected:
        rows[0]["reasonCodes"].append("SATELLITE_BASE_REDIRECTED_TO_SPY")
    retained = money(redirect - redirected)
    enhancement = money(min(crash, spy_base * (limits["spy_enhancement_max_multiple"] - 1), spy_crash_enhancement)) if spy_usable else 0.0
    rows[0]["crashFundEnhancement"] = enhancement
    rows[0]["finalAmount"] = money(rows[0]["finalAmount"] + enhancement)
    total = money(sum(row["finalAmount"] for row in rows))
    source = money(base + crash)
    cash = money(max(0.0, source - total))
    assert abs(total + cash - source) <= 0.005
    return {"version": preset["version"], "items": rows, "spyBase": spy_base, "spyRedirected": redirected, "crashFundUsed": enhancement, "cashRetained": cash, "totalPlanned": total, "conservation": {"source": source, "allocated": total, "cash": cash, "balanced": True}, "summary": {"coreTargetPct": 60, "satelliteTargetPct": 40, "satelliteActualPct": satellite_actual, "technologyActualPct": tech_actual, "spyActualPct": spy_actual, "qqqGeneratesBuyAmount": False}}
