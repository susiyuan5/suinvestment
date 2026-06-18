from __future__ import annotations


RISK_GATE_CONFIG = {
    "disabled_by_default": True,
    "max_sector_concentration": 0.20,
    "max_single_symbol_exposure": 0.05,
    "minimum_price_coverage_rows": 260,
    "minimum_history_years": 5,
    "volatility_ceiling_12w": 0.12,
    "missing_price_fallback": "no_action",
    "abnormal_weekly_move_warning": 0.20,
    "new_symbol_cooldown_weeks": 12,
    "low_confidence_no_action_rule": True,
    "rollback_command": "use active 38-symbol research universe and ignore shadow-only outputs",
}


def evaluate_gate_inputs(inputs: dict) -> dict:
    failures = []
    warnings = []
    if inputs.get("largest_sector_share", 0) > RISK_GATE_CONFIG["max_sector_concentration"]:
        failures.append("max_sector_concentration")
    if inputs.get("min_price_coverage_rows", 0) < RISK_GATE_CONFIG["minimum_price_coverage_rows"]:
        failures.append("minimum_price_coverage_rows")
    if inputs.get("max_volatility_12w", 0) > RISK_GATE_CONFIG["volatility_ceiling_12w"]:
        warnings.append("volatility_ceiling_12w")
    return {
        "passed": not failures,
        "failures": failures,
        "warnings": warnings,
        "disabled_by_default": RISK_GATE_CONFIG["disabled_by_default"],
    }
