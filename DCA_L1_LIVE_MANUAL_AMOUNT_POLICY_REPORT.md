# DCA-L1 Live Manual Amount Policy Report

## Implementation Scope

DCA-L1 adds a production multi-factor DCA policy to the displayed Manual Trade Plan. The policy starts from the amount produced by the existing recommendation and portfolio-risk path, preserves that amount as `baseManualAmount`, and calculates a separate final manual planning amount.

This changes the displayed Manual Trade Plan final amount. It does not change underlying signal, recommendation, action-threshold, risk-level, or market-regime formulas.

## Files Changed

- `dca-policy.js`: standalone, auditable, pure DCA policy engine.
- `app.js`: passes existing data into the policy after the original amount is finalized; renders and totals the final manual amount.
- `index.html`: loads the policy module and updates the DCA section from preview wording to active manual-planning wording.
- `style.css`: adds active/manual-planning status styling.
- `tests/dca-policy.test.js`: Node tests for kill switch, missing data, poor data, bear markets, extreme drawdown, concentration, and factor-chain output.
- `DCA_L1_LIVE_MANUAL_AMOUNT_POLICY_REPORT.md`: implementation and safety record.

## Final Manual Amount

For each live portfolio symbol:

```text
base_manual_amount = existing finalized Manual Trade Plan amount
dca_multiplier = multi-factor DCA policy result
final_manual_amount = base_manual_amount * dca_multiplier
```

The original amount, original action, and original risk state remain available and visible. The DCA policy does not mutate the source signal amount or recommendation formulas. Manual Trade Plan rows, copied plan text, total planned amount, and the DCA details use `final_manual_amount`.

## Central Configuration And Kill Switch

`app.js` defines:

```text
DCA_MULTIPLIER_ENABLED = true
```

`DCA_POLICY_CONFIG` centralizes the multiplier bounds and safety caps. If the kill switch is false, the policy returns multiplier `1.00`, preserves the base amount, and reports that DCA is disabled.

## Factor List

- Data-quality gate.
- Existing market-regime cap.
- 52-week drawdown tier.
- SMA200 proxy trend adjustment.
- RSI14 refinement.
- Recent weekly-volatility guard.
- Position concentration guard when holdings are available.
- Portfolio available-cash cap.
- Final clamp and manual-review cap.

## Data-Quality Rules

- Missing price: blocked, multiplier `0.00`, final amount `0`.
- Missing required data: blocked.
- Stale, fallback, Yahoo fallback, scheduled weekly fallback, or manual override: manual review and maximum multiplier `1.00`.
- Unknown/unavailable QQQ market context: manual review and maximum multiplier `1.00`.
- Missing data is never treated as a dip opportunity.

## Market-Regime Caps

The policy consumes the existing market-regime output and does not calculate a new regime.

- Bull/favorable/risk-on: cap `2.00`.
- Neutral/sideways: cap `1.50`.
- Correction/weak/bear/risk-off: cap `1.00`.
- Panic/severe stress: cap `0.75` and manual review.
- Unknown: cap `1.00` and manual review.

## Drawdown Tiers

Drawdown uses the latest price against the recent 52-week high from existing weekly history.

- Below 5%: raw `1.00`.
- 5-10%: raw `1.10`.
- 10-20%: raw `1.25`.
- 20-35%: raw `1.50`.
- 35% or deeper: raw `1.20`, then manual-review extra-buy cap because of value-trap risk.

Extreme drawdown does not create the maximum multiplier.

## Trend Filter

The stored history is weekly close-only. DCA-L1 therefore uses 40 weekly closes as an explicit SMA200 trading-day proxy rather than pretending weekly data is daily data.

- At/above proxy: no penalty.
- 0-10% below: multiply by `0.90`.
- 10-20% below: multiply by `0.75` and manual review.
- More than 20% below: cap `1.00` and manual review.
- Insufficient history: cap `1.00` and manual review.

## RSI Filter

RSI14 is calculated from the available weekly close series.

- 35-45: multiply by `1.05`.
- 25-35: multiply by `1.10` only when data and market gates are acceptable.
- Below 25: cap `1.00` and manual review.
- Above 60: cap extra-buy support at `1.00`.
- Unavailable: no bonus.

RSI alone cannot create a high multiplier.

## Volatility Guard

The policy uses the existing realized weekly volatility when available, otherwise it calculates 12-period weekly volatility from existing closes.

- Below 4% weekly: no penalty.
- 4-6%: multiply by `0.85`.
- 6% or higher: cap `1.00` and manual review.
- Unavailable: no bonus.

## Concentration Guard

When current holdings produce a non-zero portfolio value:

- Exposure at least 25%: cap `1.00`.
- Exposure at least 35%: cap `0.75` and manual review.

When holdings are absent, the policy reports `not_evaluated`, does not invent exposure, and applies no concentration bonus.

## Portfolio Cash Safety Cap

When available cash is supplied, aggregate final manual amounts are limited to 30% of available cash, matching the existing portfolio cash-use safety boundary. If scaling is required, every affected factor chain records the portfolio cash cap.

## Safety Fallback

If the policy module is missing or any calculation fails:

- Dashboard rendering continues.
- Multiplier falls back to `1.00`.
- Final amount equals the base amount.
- Status becomes manual review.
- Warning says `DCA multiplier unavailable; using base manual amount`.

## UI Behavior

The former preview section is now labelled `DCA Adjusted Manual Plan` and remains collapsed by default. Each live symbol displays:

- Base Manual Amount.
- DCA Multiplier.
- Final Manual Amount.
- Base action and risk.
- Policy status.
- Drawdown/RSI and risk-guard summaries.
- Full factor chain.
- Warnings and manual-review reasons.

The section repeatedly states:

- Manual planning only.
- Not an order.
- No automatic trading.
- No trading execution.
- No broker connection.

No execution control is present.

## Mobile Behavior

The existing DCA cards remain responsive. Stage grids stack into one column below 720px, badges and warnings wrap, and the factor chain uses contained text wrapping without adding a horizontal table.

## Limitations

- Historical data is weekly close-only, so the trend input is a documented 40-week SMA200-day proxy and RSI is a 14-week RSI.
- No intraday execution, slippage, tax, or broker behavior is modeled.
- Concentration remains `not_evaluated` until actual holdings/current values are supplied.
- The policy adjusts manual planning amounts; it does not alter the underlying signal model.

## Safety Confirmation

- Displayed Manual Trade Plan final amount changed: yes, through the DCA multiplier.
- Underlying signal formulas changed: no.
- Signal score formula changed: no.
- Action thresholds changed: no.
- Risk-level formula changed: no.
- Market-regime formula changed: no.
- Live symbols changed: no.
- Data files changed: no.
- Research/shadow outputs changed: no.
- Broker integration added: no.
- Automatic trading added: no.
- Buy/Execute/Auto Buy/Promote/Activate controls added: no.
- User manual decision remains required: yes.

## Tests And Checks

- `node --check dca-policy.js`
- `node --check app.js`
- `node --check research-sandbox.js`
- `node --test tests/dca-policy.test.js`
- `python -m unittest discover -s tests`

## Recommended Next Step

Run a DCA-L1 calculation audit and post-deployment comparison. Verify base versus final amounts for fresh, poor-data, bear, panic, concentration, and missing-field scenarios before changing any policy threshold.
