# DCA-L1 Audit 1: Calculation Review

Date: 2026-06-21  
Baseline: `450ade4976f3b6709690a6b2ca1a720ee3979c8f` (`stable-dca-l1-live-manual-multiplier-policy`)

## Scope and conclusion

This was a calculation and safety audit only. No DCA code, recommendation formula, data file, live symbol, Manual Trade Plan control, broker integration, or automatic-trading behavior was changed.

The live DCA policy passed the reviewed safety gates. The current local dashboard snapshot contained stale price fields, so all six symbols were placed in `manual_review`, no symbol received an extra-buy multiplier above `1.00x`, and the existing upstream Manual Trade Plan risk path produced a base and final amount of `CAD 0.00` for every symbol.

## Live symbol calculation audit

| Symbol | Base amount | DCA multiplier | Final amount | Status | Main limiting reasons |
| --- | ---: | ---: | ---: | --- | --- |
| BYDDY | CAD 0.00 | 0.77x | CAD 0.00 | manual_review | stale data, extreme drawdown review, material downtrend, elevated volatility |
| MSFT | CAD 0.00 | 0.96x | CAD 0.00 | manual_review | stale data, material downtrend, elevated volatility |
| NVDA | CAD 0.00 | 0.94x | CAD 0.00 | manual_review | stale data, RSI above 60 cap, elevated volatility |
| AAPL | CAD 0.00 | 1.00x | CAD 0.00 | manual_review | stale data, RSI above 60 cap |
| ASML | CAD 0.00 | 0.85x | CAD 0.00 | manual_review | stale data, RSI above 60 cap, elevated volatility |
| KO | CAD 0.00 | 1.00x | CAD 0.00 | manual_review | stale data; no extra buy allowed |

- Multiplier range: `0.77x` to `1.00x`.
- Above `1.00x`: none.
- Equal to `1.00x`: AAPL, KO.
- Below `1.00x`: BYDDY, MSFT, NVDA, ASML.
- Blocked: none in the current snapshot.
- Manual review: BYDDY, MSFT, NVDA, AAPL, ASML, KO.
- Highest multiplier: AAPL and KO at `1.00x`; the stale-data gate prevents any extra buy.
- Lowest multiplier: BYDDY at `0.77x`; material downtrend and elevated volatility reduce its already review-capped amount.

`concentration_guard` reported `not_evaluated` for all six symbols because holdings were not provided. It did not infer or invent an exposure value.

## Safety gate results

| Gate | Audit result |
| --- | --- |
| Data quality | Fresh data can use the normal policy. Stale, manual, fallback, or otherwise poor data enters `manual_review` and is capped at `1.00x`. Missing required price/data returns `blocked`, `0.00x`, and a zero final amount. |
| Market environment | Bull uses the configured upper bound. Bear/correction is capped at `1.00x`. Unknown or unavailable context enters `manual_review` and is capped at `1.00x`. Panic/severe stress enters `manual_review` and is capped at `0.75x`. |
| Drawdown | Normal, small, medium, and deep dip tiers are traceable. A 35%+ extreme drawdown uses raw `1.20x`, requires manual review, and the manual-review gate prevents an extra buy above base. It does not become a blind `2.00x`. |
| Trend | The 40-week SMA proxy is explicit. Moderate weakness reduces the multiplier; material or severe weakness requires manual review or applies a `1.00x` cap. Insufficient trend history also requires review and caps at `1.00x`. |
| RSI | Oversold bonuses are conditional. RSI below 25 requires review and caps at `1.00x`; RSI above 60 removes extra-buy support with a `1.00x` cap. Missing RSI adds no bonus. |
| Volatility | Elevated weekly volatility multiplies by `0.85`. Extreme weekly volatility requires manual review and caps at `1.00x`. Missing volatility adds no bonus. |
| Concentration | With holdings, 25%+ exposure caps at `1.00x`; 35%+ exposure requires review and caps at `0.75x`. Without holdings, status is explicitly `not_evaluated`. |
| Cash reserve | If available cash is provided, aggregate final manual amounts are scaled to at most 30% of available cash. The scale and resulting multiplier are appended to the factor chain. |
| Final clamp | The multiplier is clamped to configured bounds after all adjustments and caps. Any manual-review state blocks extra buy above `1.00x`. Final amount is rounded to cents and traced in the factor chain. |

## Scenario checks

Direct policy checks confirmed:

- stale/manual/fallback data: final amount did not exceed base and status was `manual_review`;
- missing data: multiplier `0.00x`, final amount zero, status `blocked`;
- unknown market: no increase above base and status `manual_review`;
- bear market: no increase above base;
- panic market: multiplier capped at `0.75x`;
- extreme drawdown: multiplier capped at `1.00x` under required manual review;
- extreme volatility: no increase above base and status `manual_review`;
- missing holdings: concentration remained `not_evaluated`;
- very high concentration: multiplier capped at `0.75x` and status `manual_review`.

## Controls and execution boundary

The DCA panel contains zero buttons. No `Execute`, `Auto Buy`, `Promote`, or `Activate` control was found. The visible DCA safety copy states that the plan is manual, is not an order, has no automatic trading, and has no broker connection. Existing recommendation words such as `Buy` remain informational labels, not execution controls.

## Issues and fixes

No calculation or safety defect was found in the reviewed scope. No fix was applied.

Residual limitations remain unchanged: the policy is weekly, relies on the supplied historical snapshot and provenance metadata, does not model execution/slippage/tax, and cannot evaluate concentration until holdings are supplied.

## Validation

- Runtime audit: six live symbols rendered with base amount, multiplier, final amount, status, risk guards, and factor chain.
- Scenario audit: missing, poor, unknown-market, bear, panic, extreme-drawdown, high-volatility, no-holdings, and high-concentration paths checked directly.
- DCA execution-control audit: zero buttons in the DCA panel; no execute/auto-buy/promote/activate controls.
- `node --check app.js`
- `node --check research-sandbox.js`
- `node tests/dca-policy.test.js`
- `python -m unittest discover -s tests`

