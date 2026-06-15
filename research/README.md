# Research Stack

This directory contains optional research scripts. Nothing here changes the live dashboard, the default Python strategy, buy amount logic, signal score, multiplier, risk level, action thresholds, or market regime formula.

## Phase 5A

Phase 5A adds the first weekly factor report:

```powershell
python -m pip install -r requirements-research.txt
python research\factor_report.py
```

Outputs:

- `results/phase5/factor_report.csv`
- `results/phase5/factor_latest.csv`
- `FACTOR_REPORT.md`

The factors are research inputs only and need later validation before any live strategy use.
