# Phase UI-QA1 Production Loaded-State Audit

Date: 2026-06-19

Production URL checked: https://susiyuan5.github.io/suinvestment/

## Executive Result

Phase UI-QA1 completed a production loaded-state and research-sandbox entry audit. The production URL returned HTTP 200. The in-app browser full-load check timed out during the audit, so the review also used source inspection and static production reachability checks.

Safe UI fixes were made for loaded-state clarity only:

- Data Quality Summary now uses pending placeholders instead of initial zero counts before market data is evaluated.
- Market Regime status no longer presents neutral fallback as a loaded status before data quality evaluation completes.
- Panic Mode banner is gated behind confirmed QQQ signal loading and data-quality evaluation.
- Research & Testing now includes a clear read-only Research Sandbox entry.

No recommendation formulas, default strategy behavior, market-regime formula, buy amounts, action thresholds, data files, Manual Trade Plan logic, broker logic, or auto-trading behavior changed.

## Production Reachability

- URL: https://susiyuan5.github.io/suinvestment/
- HTTP status: 200
- Browser full-load result: in-app browser load timed out during this QA pass.
- Follow-up note: after GitHub Pages deploys this commit, reload the production page with Ctrl+F5 and confirm the new Research Sandbox entry appears in Research & Testing.

## Findings And Fixes

### Data Quality Summary

Finding: the static HTML showed zero counts before data loaded. This could be mistaken for a completed fresh-data state.

Fix: initial counters now display `--`, and `app.js` keeps the data-quality summary in a waiting state until the market data pass has completed.

### Market Regime Status

Finding: before data evaluation, the Market Regime status could derive a neutral fallback label from the default fallback object.

Fix: before data quality is evaluated, Market Regime displays the waiting message instead of treating neutral fallback as a loaded state.

### Panic Mode Banner

Finding: the banner was controlled by `state.panicActive`, which was derived from QQQ signal value. There was no explicit UI gate proving that QQQ data had loaded during the current refresh cycle.

Fix: the refresh cycle now clears the prior QQQ state first, tracks whether QQQ signal data loaded, and only allows the Panic banner to display after data-quality evaluation and QQQ signal confirmation.

### Research Sandbox Entry

Finding: `research-sandbox.html` existed but had no obvious entry from the main dashboard.

Fix: a compact link was added inside Research & Testing:

- Research-only
- Read-only shadow observation review
- Not live
- Not trading advice
- No activation or order controls

## Safety Confirmation

- Live recommendation formulas: unchanged
- Signal score logic: unchanged
- Multiplier logic: unchanged
- Buy amount logic: unchanged
- Risk level logic: unchanged
- Action thresholds: unchanged
- Market-regime formula: unchanged
- Default Python strategy: unchanged
- Live dashboard symbols: unchanged
- Manual Trade Plan logic: unchanged
- Broker integration: unchanged
- Auto-trading behavior: not added
- Research candidates: not promoted
- Activate/promote/trade controls: not added
- `data/research-universe.json`: unchanged
- `data/research-prices.json`: unchanged
- `data/backtest-prices.json`: unchanged

## Validation

Commands run:

```powershell
node --check app.js
node --check research-sandbox.js
Invoke-WebRequest -Uri https://susiyuan5.github.io/suinvestment/ -UseBasicParsing -TimeoutSec 30
```

Additional final validation is recorded in the commit report.
