# Phase 6M Risk Gate Review

Research/shadow-only. No live integration is enabled.

```json
{
  "riskGateConfig": {
    "disabled_by_default": true,
    "max_sector_concentration": 0.2,
    "max_single_symbol_exposure": 0.05,
    "minimum_price_coverage_rows": 260,
    "minimum_history_years": 5,
    "volatility_ceiling_12w": 0.12,
    "missing_price_fallback": "no_action",
    "abnormal_weekly_move_warning": 0.2,
    "new_symbol_cooldown_weeks": 12,
    "low_confidence_no_action_rule": true,
    "rollback_command": "use active 38-symbol research universe and ignore shadow-only outputs"
  },
  "gateInputs": {
    "largest_sector_share": 0.16,
    "min_price_coverage_rows": 572,
    "max_volatility_12w": 0.0
  },
  "gateResult": {
    "passed": true,
    "failures": [],
    "warnings": [],
    "disabled_by_default": true
  },
  "liveIntegrationEnabled": false,
  "manualTradePlanChanged": false,
  "defaultDashboardChanged": false
}
```
