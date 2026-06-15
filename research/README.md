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

## Phase 5B

Phase 5B adds a Backtrader sandbox comparison workflow:

```powershell
python research\backtrader_sandbox.py
```

Outputs:

- `results/phase5/backtrader_summary.csv`
- `results/phase5/backtrader_trades.csv`
- `BACKTRADER_SANDBOX_REPORT.md`

The sandbox compares Fixed Weekly DCA, Simple Dip-Buy, and Risk-Adjusted v2 on the current portfolio symbols only. It is an additional research engine and does not replace `backtest.py`.

Do not infer live strategy changes from this report yet. Differences versus the existing custom backtest can come from Backtrader order timing, broker accounting, cash handling, commission/slippage handling, or fractional-share assumptions.
