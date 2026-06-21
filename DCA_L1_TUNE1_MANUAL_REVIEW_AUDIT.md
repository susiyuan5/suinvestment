# DCA-L1 Tune 1: Manual Review Diagnosis

Date: 2026-06-21  
Baseline: `c3db3126a9c8a2bb495f265c9af5da700f7273c9` (`stable-dca-l1-audit1-calculation-review`)

## Decision

This phase is report-only. No calibration was applied.

All six live symbols are in `manual_review` because the dashboard is currently using the `Weekly` fallback snapshot generated on 2026-06-16. At the 2026-06-21 audit time, its fields exceed the configured 24-hour freshness window. The DCA data-quality gate therefore caps every symbol at or below `1.00x` and requires manual review.

This is justified safety behavior. Removing that review state would conflict with the required rule that stale/manual/fallback data must never create an extra buy. The policy is not permanently locking symbols into review: its existing fresh-data tests demonstrate that a symbol can enter `active` or `caution` and can exceed `1.00x` only when all required gates are clean.

## Per-symbol diagnosis

| Symbol | Data quality | Market | Drawdown | Trend/SMA | RSI | Weekly volatility | Concentration | Cash cap | Final clamp | Multiplier | Review justified? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- |
| BYDDY | Weekly fallback, stale; manual_review cap 1.00x | Bull, cap 2.00x | extreme_drawdown, raw 1.20x, value-trap review | -16.30%, material downtrend, x0.75, review | 46.13, neutral | 4.92%, elevated, x0.85 | not_evaluated | not applicable; cash not provided | manual_review, 0.77x | 0.77x | Yes: stale data plus extreme drawdown and downtrend |
| MSFT | Weekly fallback, stale; manual_review cap 1.00x | Bull, cap 2.00x | deep_dip, raw 1.50x | -12.70%, material downtrend, x0.75, review | 51.82, neutral | 5.83%, elevated, x0.85 | not_evaluated | not applicable; cash not provided | manual_review, 0.96x | 0.96x | Yes: stale data and material downtrend |
| NVDA | Weekly fallback, stale; manual_review cap 1.00x | Bull, cap 2.00x | small_dip, raw 1.10x | +10.48%, above SMA proxy | 62.09, no-dip-support cap 1.00x | 4.87%, elevated, x0.85 | not_evaluated | not applicable; cash not provided | manual_review, 0.94x | 0.94x | Yes: stale data; other gates also prevent extra buy |
| AAPL | Weekly fallback, stale; manual_review cap 1.00x | Bull, cap 2.00x | normal, raw 1.00x | +11.38%, above SMA proxy | 81.87, no-dip-support cap 1.00x | 1.82%, normal | not_evaluated | not applicable; cash not provided | manual_review, 1.00x | 1.00x | Yes: stale fallback data alone is sufficient |
| ASML | Weekly fallback, stale; manual_review cap 1.00x | Bull, cap 2.00x | normal, raw 1.00x | +44.46%, above SMA proxy | 73.00, no-dip-support cap 1.00x | 5.70%, elevated, x0.85 | not_evaluated | not applicable; cash not provided | manual_review, 0.85x | 0.85x | Yes: stale data and elevated volatility |
| KO | Weekly fallback, stale; manual_review cap 1.00x | Bull, cap 2.00x | normal, raw 1.00x | +8.41%, above SMA proxy | 57.47, neutral | 1.75%, normal | not_evaluated | not applicable; cash not provided | manual_review, 1.00x | 1.00x | Yes: stale fallback data alone is sufficient |

## Why all six share the same review status

The common trigger is data provenance and freshness, not a shared market or portfolio-risk defect:

1. Browser API retrieval was unavailable in the audited load.
2. The dashboard used the scheduled `Weekly` snapshot for each live symbol.
3. The snapshot timestamp was older than `CONFIG.cacheHours = 24`.
4. `signal.data_freshness` became `stale`.
5. DCA classified the input as poor data, capped the multiplier at `1.00x`, and set `manual_review`.

`concentration_guard = not_evaluated` is informational because holdings were not supplied. It does not set `manual_review`, reduce the multiplier, or force all symbols into the same status.

The market regime was a fresh historical QQQ Bull regime and was not the reason for the shared review state. The portfolio cash cap was not invoked because available cash was not provided.

## Is the policy too conservative?

No, not for the currently loaded inputs.

- Stale and fallback data are explicitly required to avoid extra buying.
- A fresh, fully validated favorable-dip test already produces an `active` multiplier above `1.00x`.
- Clean data can also produce a normal `active` or risk-limited `caution` status without concentration data; `not_evaluated` does not itself cause review.
- Bear, unknown, panic, extreme-drawdown, extreme-volatility, and high-concentration paths retain conservative caps.

Changing the status of these six rows without refreshing their market snapshot would weaken provenance safety rather than improve calibration. The appropriate remediation is an ordinary market-data refresh, followed by another read-only observation, not a threshold relaxation.

## Before/after summary

No tuning was applied, so before and after are identical.

| Measure | Before | After |
| --- | ---: | ---: |
| Multiplier range | 0.77x-1.00x | 0.77x-1.00x |
| Symbols above 1.00x | 0 | 0 |
| Symbols equal to 1.00x | 2: AAPL, KO | 2: AAPL, KO |
| Symbols below 1.00x | 4: BYDDY, MSFT, NVDA, ASML | 4: BYDDY, MSFT, NVDA, ASML |
| manual_review | 6 | 6 |
| blocked | 0 | 0 |

The existing upstream Manual Trade Plan base amount was `CAD 0.00` for all six stale rows, so their final manual amounts also remained `CAD 0.00`.

## Safety confirmation

- Signal score formula: unchanged.
- Action thresholds: unchanged.
- Risk-level formula: unchanged.
- Market-regime formula: unchanged.
- DCA policy code and thresholds: unchanged.
- Live symbols: unchanged.
- `data/*.json`: unchanged.
- `research/results/phase6s/*`: unchanged.
- Manual Trade Plan execution boundary: unchanged.
- Broker, order execution, and automatic trading: not added.
- Buy/Execute/Auto Buy/Promote/Activate controls: not added.

## Validation

- `node --check app.js`
- `node --check research-sandbox.js`
- `node tests/dca-policy.test.js`
- `python -m unittest discover -s tests`

