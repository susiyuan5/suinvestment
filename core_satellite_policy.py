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
def plan_core_satellite(*, base_budget: float, crash_fund_remaining: float, actual_allocations: dict[str, float] | None = None, satellite_decisions: dict[str, dict[str, Any]] | None = None, blocked_symbols: list[str] | None = None, cash_only_symbols: list[str] | None = None, spy_data_valid: bool = True, qqq_data_valid: bool = True, safety_blocked: bool = False, spy_crash_enhancement: float = 0.0, preset: dict[str, Any] | None = None) -> dict[str, Any]:
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
        row = {"symbol":symbol,"bucket":asset["bucket"],"asset_type":asset["asset_type"],"originalBaseAmount":original,"dcaAdjustedAmount":adjusted,"crashFundEnhancement":0.0 if is_qqq else money(decision.get("crashFundAmount")),"riskReduction":0.0,"redirectedToSpy":0.0,"cashRetained":0.0,"finalAmount":adjusted,"reasonCodes":[],"factorChain":[]}
        hard = (is_qqq and not qqq_usable) or (adjusted <= 0 < original) or (not is_qqq and float(actual.get(symbol) or 0) >= limits["single_stock_block_pct"]) or (not is_qqq and stock_actual >= limits["satellite_enhancement_block_pct"] and adjusted > original) or (not is_qqq and asset.get("sector") == "technology" and tech_actual >= limits["technology_enhancement_block_pct"] and adjusted > original) or symbol in blocked_symbols
        if hard:
            row["riskReduction"], row["finalAmount"] = adjusted, 0.0; row["reasonCodes"].append("QQQ_DATA_OR_SAFETY_BLOCK" if is_qqq and not qqq_usable else "SATELLITE_RISK_BLOCKED")
            if is_qqq or symbol in cash_only_symbols: row["cashRetained"] = original
            else: redirect += original
        rows.append(row)
    redirected = money(redirect) if spy_usable and spy_actual < limits["spy_max_current_pct"] else 0.0
    if redirected: rows[0]["redirectedToSpy"], rows[0]["finalAmount"] = redirected, money(rows[0]["finalAmount"] + redirected); rows[0]["reasonCodes"].append("SATELLITE_BASE_REDIRECTED_TO_SPY")
    enhancement = money(min(crash, rounded[0] * (limits["spy_enhancement_max_multiple"] - 1), money(spy_crash_enhancement))) if spy_usable else 0.0; rows[0]["crashFundEnhancement"], rows[0]["finalAmount"] = enhancement, money(rows[0]["finalAmount"] + enhancement)
    total, source = money(sum(row["finalAmount"] for row in rows)), money(base + crash); cash = money(max(0, source - total))
    return {"version":preset["version"],"items":rows,"spyBase":rounded[0],"spyRedirected":redirected,"crashFundUsed":enhancement,"cashRetained":cash,"totalPlanned":total,"conservation":{"source":source,"allocated":total,"cash":cash,"balanced":abs(total + cash - source) <= .005},"summary":{"coreTargetPct":40,"growthEtfTargetPct":10,"satelliteTargetPct":50,"satelliteActualPct":stock_actual,"technologyActualPct":tech_actual,"spyActualPct":spy_actual,"qqqGeneratesBuyAmount":True}}
