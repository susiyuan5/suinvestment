"""Pure Core-Satellite v5 budgeting policy shared by dashboard and reports."""
from __future__ import annotations
import json, math
from pathlib import Path
from typing import Any

PRESET_PATH = Path(__file__).with_name("data") / "core-satellite-v5.json"
CORE_SYMBOLS = ("SPY", "QQQ", "NVDA", "AAPL", "ASML", "KO")
STOCK_SYMBOLS = ("NVDA", "AAPL", "ASML", "KO")
TECH_SYMBOLS = ("NVDA", "AAPL", "ASML")
ALLOCATION_EPSILON = 1e-9

def money(value: Any) -> float:
    try: number = float(value)
    except (TypeError, ValueError): return 0.0
    return round(max(0.0, number) + 1e-10, 2) if math.isfinite(number) else 0.0
def _pct(value: Any) -> float | None:
    try: number = float(value)
    except (TypeError, ValueError): return None
    return round(number * 100 + 1e-9, 2) if math.isfinite(number) else None
def _ratio_from_pct(value: Any) -> float: return round((float(value) + 1e-9) / 100, 4)
def load_preset(path: Path = PRESET_PATH) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not validate_preset(payload): raise ValueError("invalid core-satellite-v5 preset")
    return payload
def validate_preset(preset: dict[str, Any]) -> bool:
    if not isinstance(preset, dict) or preset.get("version") != "core-satellite-v5": return False
    core, growth, stocks = preset.get("core") or {}, preset.get("growth_etfs"), preset.get("satellites")
    if core.get("symbol") != "SPY" or not isinstance(growth, list) or len(growth) != 1 or growth[0].get("symbol") != "QQQ" or not isinstance(stocks, list) or len(stocks) != 4: return False
    assets = [core, *growth, *stocks]; total = sum(float(row.get("target_allocation", float("nan"))) for row in assets)
    return math.isfinite(total) and abs(total - 1) <= ALLOCATION_EPSILON and core.get("asset_type") == "core_etf" and growth[0].get("asset_type") == "growth_etf" and all(0 <= float(row.get("target_allocation", 1)) <= .15 + ALLOCATION_EPSILON and row.get("asset_type") == "individual_stock" and row.get("bucket") == "satellite" for row in stocks)
def allocation_metrics(allocations: dict[str, Any]) -> dict[str, float]:
    values = {symbol: (_pct(allocations.get(symbol, 0)) or 0.0) for symbol in CORE_SYMBOLS}
    allocated = sum(values.values())
    return {"allocated": allocated, "remaining": max(0.0, 100 - allocated), "overage": max(0.0, allocated - 100), "core": values["SPY"], "growth_etf": values["QQQ"], "satellite": sum(values[s] for s in STOCK_SYMBOLS), "technology": sum(values[s] for s in TECH_SYMBOLS), **{s: values[s] for s in STOCK_SYMBOLS}}
def validate_allocations(allocations: dict[str, Any]) -> dict[str, Any]:
    errors: list[str] = []
    for symbol in CORE_SYMBOLS:
        try: number = float(allocations.get(symbol))
        except (TypeError, ValueError): number = float("nan")
        if not math.isfinite(number) or number < 0: errors.append(f"{symbol} 目标比例必须是非负数字")
    metrics, limits = allocation_metrics(allocations), load_preset()["limits"]
    if abs(metrics["allocated"] - 100) > ALLOCATION_EPSILON: errors.append("六项比例合计必须严格等于 100.00%")
    if not limits["spy_min_target_pct"] - ALLOCATION_EPSILON <= metrics["core"] <= limits["spy_max_target_pct"] + ALLOCATION_EPSILON: errors.append("SPY 目标比例必须在 40.00% 至 80.00% 之间")
    if not limits["satellite_min_target_pct"] - ALLOCATION_EPSILON <= metrics["satellite"] <= limits["satellite_max_target_pct"] + ALLOCATION_EPSILON: errors.append("个股合计比例必须在 20.00% 至 60.00% 之间")
    for symbol in STOCK_SYMBOLS:
        if metrics[symbol] > limits["single_stock_max_target_pct"] + ALLOCATION_EPSILON: errors.append(f"{symbol} 目标为 {metrics[symbol]:.2f}%，超过单股上限 {limits['single_stock_max_target_pct']:.2f}%")
    if metrics["technology"] > limits["technology_max_target_pct"] + ALLOCATION_EPSILON: errors.append(f"科技个股合计为 {metrics['technology']:.2f}%，超过上限 {limits['technology_max_target_pct']:.2f}%")
    return {"valid": not errors, "errors": errors, "metrics": metrics}
def allocations_for_core(core_percent: Any) -> dict[str, float] | None:
    try: core = float(core_percent)
    except (TypeError, ValueError): return None
    if not math.isfinite(core) or not 40 <= core <= 80: return None
    return load_preset().get("shortcuts", {}).get(str(int(core)), average_satellite_allocations(core)).copy()
def average_satellite_allocations(core_percent: Any) -> dict[str, float] | None:
    try: core = float(core_percent)
    except (TypeError, ValueError): return None
    if not math.isfinite(core) or not 40 <= core <= 80: return None
    each = _ratio_from_pct((90 - core) / 4)
    return {"SPY": _ratio_from_pct(core), "QQQ": .10, **{symbol: each for symbol in STOCK_SYMBOLS}}
def plan_core_satellite(*, base_budget: float, crash_fund_remaining: float, actual_allocations: dict[str, float] | None = None, satellite_decisions: dict[str, dict[str, Any]] | None = None, blocked_symbols: list[str] | None = None, cash_only_symbols: list[str] | None = None, spy_data_valid: bool = True, qqq_data_valid: bool = True, safety_blocked: bool = False, spy_crash_enhancement: float = 0.0, preset: dict[str, Any] | None = None, normal_pool_remaining: float | None = None, portfolio_cash_cap: float | None = None, commission_bps: float = 0.0) -> dict[str, Any]:
    preset, actual, decisions = preset or load_preset(), actual_allocations or {}, satellite_decisions or {}
    if not validate_preset(preset): raise ValueError("invalid preset")
    blocked_symbols, cash_only_symbols = blocked_symbols or [], cash_only_symbols or []
    limits, base, crash = preset["limits"], money(base_budget), money(crash_fund_remaining)
    spy_usable, qqq_usable = spy_data_valid and not safety_blocked, qqq_data_valid and not safety_blocked
    spy_actual = float(actual.get("SPY") or 0); stock_actual = sum(float(actual.get(s) or 0) for s in STOCK_SYMBOLS); tech_actual = sum(float(actual.get(s) or 0) for s in TECH_SYMBOLS)
    assets = [preset["core"], *preset["growth_etfs"], *preset["satellites"]]; rounded = [money(base * row["target_allocation"]) for row in assets]; rounded[0] = money(rounded[0] + base - sum(rounded))
    rows = [{"symbol":"SPY","bucket":"core","asset_type":"core_etf","originalBaseAmount":rounded[0],"dcaAdjustedAmount":rounded[0],"crashFundEnhancement":0.0,"riskReduction":0.0,"redirectedToSpy":0.0,"cashRetained":0.0,"finalAmount":rounded[0] if spy_usable else 0.0,"reasonCodes":[] if spy_usable else ["SPY_DATA_OR_SAFETY_BLOCK"],"factorChain":[] }]; redirect = 0.0
    for index, asset in enumerate(assets[1:], 1):
        symbol, original, is_qqq = asset["symbol"], rounded[index], asset["symbol"] == "QQQ"; decision = decisions.get(symbol) or {}; adjusted = money(decision.get("finalAmount", original))
        row = {"symbol":symbol,"bucket":asset["bucket"],"asset_type":asset["asset_type"],"originalBaseAmount":original,"dcaAdjustedAmount":adjusted,"crashFundEnhancement":0.0 if is_qqq else money(decision.get("crashFundAmount")),"riskReduction":0.0,"redirectedToSpy":0.0,"cashRetained":0.0,"finalAmount":adjusted,"reasonCodes":list(decision.get("reasonCodes", [])),"factorChain":[]}
        hard = (is_qqq and not qqq_usable) or (adjusted <= 0 < original) or (not is_qqq and float(actual.get(symbol) or 0) >= limits["single_stock_block_pct"]) or (not is_qqq and stock_actual >= limits["satellite_enhancement_block_pct"] and adjusted > original) or (not is_qqq and asset.get("sector") == "technology" and tech_actual >= limits["technology_enhancement_block_pct"] and adjusted > original) or symbol in blocked_symbols
        if hard:
            row["riskReduction"], row["finalAmount"] = adjusted, 0.0; row["reasonCodes"].append("QQQ_DATA_OR_SAFETY_BLOCK" if is_qqq and not qqq_usable else "SATELLITE_RISK_BLOCKED")
            if is_qqq or symbol in cash_only_symbols: row["cashRetained"] = original
            elif _can_redirect(decision, actual.get(symbol, 0), limits["single_stock_block_pct"]): redirect += original
        rows.append(row)
    redirected = money(redirect) if spy_usable and spy_actual < limits["spy_max_current_pct"] else 0.0
    if redirected: rows[0]["redirectedToSpy"], rows[0]["finalAmount"] = redirected, money(rows[0]["finalAmount"] + redirected); rows[0]["reasonCodes"].append("SATELLITE_BASE_REDIRECTED_TO_SPY")
    enhancement = money(min(crash, rounded[0] * (limits["spy_enhancement_max_multiple"] - 1), money(spy_crash_enhancement))) if spy_usable else 0.0; rows[0]["crashFundEnhancement"], rows[0]["finalAmount"] = enhancement, money(rows[0]["finalAmount"] + enhancement)
    return _finalize(rows, decisions, preset, base, crash, normal_pool_remaining, portfolio_cash_cap, commission_bps, safety_blocked, spy_actual, stock_actual, tech_actual, rounded[0])


def _can_redirect(decision, allocation, threshold):
    codes = decision.get("reasonCodes", [])
    if decision.get("hardBlocked") or any(code.startswith(("HARD_BLOCK", "DATA_", "POLICY_", "NORMAL_POOL", "CASH_", "PORTFOLIO_CASH", "ACTION_")) for code in codes):
        return False
    return float(allocation or 0) >= threshold or any(code.startswith("CONCENTRATION_") for code in codes)


def _cap_component(rows, field, limit, code):
    values = [int(round(money(row[field]) * 100)) for row in rows]
    total, cents = sum(values), max(0, math.floor(limit * 100 + 1e-7))
    if total <= cents: return
    parts = [value * cents / total for value in values]
    allocated = [math.floor(value) for value in parts]
    tail = cents - sum(allocated)
    for index in sorted(range(len(rows)), key=lambda i: (-(parts[i] - allocated[i]), i)):
        if tail > 0 and values[index] > 0: allocated[index] += 1; tail -= 1
    for index, row in enumerate(rows):
        row[field] = allocated[index] / 100
        if allocated[index] < values[index] and code not in row["reasonCodes"]: row["reasonCodes"].append(code)


def _finalize(rows, decisions, preset, base, crash, normal_remaining, cash_cap, commission_bps, safety_blocked, spy_actual, stock_actual, tech_actual, spy_base):
    normal = base if normal_remaining is None else money(normal_remaining)
    cash_cap = None if cash_cap is None else money(cash_cap)
    fee_rate = max(0, float(commission_bps)) / 10000
    for row in rows:
        if safety_blocked:
            row["finalAmount"] = 0
            row["reasonCodes"].append("PLAN_SAFETY_BLOCK")
        decision = decisions.get(row["symbol"], {})
        row["crashFundAmount"] = min(row["finalAmount"], money(row["crashFundEnhancement"]))
        normal_amount = money(row["finalAmount"] - row["crashFundAmount"])
        row["extraAmount"] = min(normal_amount, money(decision.get("extraAmount")))
        row["baseAmount"] = money(normal_amount - row["extraAmount"])
    def total(field): return money(sum(row[field] for row in rows))
    _cap_component(rows, "baseAmount", normal, "NORMAL_POOL_BASE_BUDGET_APPLIED")
    _cap_component(rows, "extraAmount", money(normal - total("baseAmount")), "NORMAL_POOL_EXTRA_BUDGET_APPLIED")
    _cap_component(rows, "crashFundAmount", crash, "CRASH_FUND_BUDGET_APPLIED")
    if cash_cap is not None:
        affordable = math.floor(cash_cap / (1 + fee_rate) * 100 + 1e-7) / 100
        for field in ("crashFundAmount", "extraAmount", "baseAmount"):
            amount = total("baseAmount") + total("extraAmount") + total("crashFundAmount")
            if amount > affordable: _cap_component(rows, field, max(0, total(field) - (amount - affordable)), "PORTFOLIO_CASH_CAP_APPLIED")
    for row in rows:
        row["finalAmount"] = money(row["baseAmount"] + row["extraAmount"] + row["crashFundAmount"])
        row["crashFundEnhancement"] = row["crashFundAmount"]
        row["redirectedToSpy"] = min(row["redirectedToSpy"], row["baseAmount"])
        row["riskReduction"] = money(row["dcaAdjustedAmount"] + row["redirectedToSpy"] - row["finalAmount"])
        row["factorChain"].append(f'final:{row["finalAmount"]:.2f}')
    amount = total("finalAmount"); planned_normal = money(total("baseAmount") + total("extraAmount"))
    source = money(min(normal, max(base, planned_normal)) + crash); cash = money(source - amount)
    return {"version": preset["version"], "items": rows, "spyBase": spy_base, "spyRedirected": rows[0]["redirectedToSpy"],
        "crashFundUsed": total("crashFundAmount"), "plannedNormal": planned_normal, "plannedCrash": total("crashFundAmount"),
        "normalPoolRemaining": normal, "crashFundRemaining": crash, "portfolioCashCap": cash_cap, "estimatedCommission": money(amount * fee_rate),
        "cashRetained": cash, "totalPlanned": amount,
        "conservation": {"source": source, "allocated": amount, "cash": cash, "balanced": amount <= source + .005 and (cash_cap is None or amount * (1 + fee_rate) <= cash_cap + 1e-7)},
        "summary": {"coreTargetPct": preset["core"]["target_allocation"] * 100, "growthEtfTargetPct": sum(row["target_allocation"] for row in preset["growth_etfs"]) * 100,
            "satelliteTargetPct": sum(row["target_allocation"] for row in preset["satellites"]) * 100, "satelliteActualPct": stock_actual,
            "technologyActualPct": tech_actual, "spyActualPct": spy_actual, "qqqGeneratesBuyAmount": True}}
