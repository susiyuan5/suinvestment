# DCA-L2 Base DCA + Extra Dip-Buy + Crash Fund

## Status

DCA-L2 replaces the Manual Trade Plan amount path. It remains manual decision support only: no broker connection, automatic order, execution, promotion, or activation behavior was added.

## Amount path

```
Base DCA + Extra Dip-Buy + Planned Crash Fund Release
-> portfolio cash guard
-> Final Manual Plan
```

Base DCA is `weeklyDeployment * allocation`. Enhanced Signal, action labels, and risk levels remain visible explanations, but they no longer cancel Base DCA by themselves.

Hard blocks are invalid/missing/future price data and explicitly supplied available cash of zero. Stale/fallback data preserves Base DCA, sets Extra/Crash Fund to zero, and shows `manual_review`. A recent official API close during a confirmed market closure is represented as `market_closed_last_close`: Base remains available, Extra/Crash Fund remain zero.

## State order

`hard_block` -> `panic_bear_extreme_volatility` -> `extreme_drawdown_review` -> `deep_drawdown` -> `medium_drawdown` -> `small_drawdown` -> `normal`.

Bear, Panic, or 6%+ weekly volatility uses 50% Base DCA and blocks Extra/Crash Fund. Two distinct fresh trading dates outside the defensive state are required before recovery. Extreme 35%+ drawdown retains Base DCA but requires manual review with no Extra/Crash Fund.

## Crash Fund ledger

The browser stores a natural-month ledger in local storage. It records initial budget, confirmed manual use, remaining balance, recovery confirmations, and reversible entries. Recording a ledger entry is bookkeeping only and never executes a trade.

Deep-drawdown plans allocate the weekly Crash Fund ceiling across eligible symbols by Base-DCA weight. The ceiling is the smaller of 25% of the initial monthly Crash Fund and the remaining Crash Fund balance. Portfolio cash protection removes Crash Fund first, then Extra, then Base.

## Shared validation and backtest

- `data/dca-l2-policy-config.json` defines shared policy parameters.
- `tests/fixtures/dca_l2_policy_cases.json` is consumed by JS and Python tests.
- `dca-policy.js` and `dca_l2_policy.py` produce structured amount decisions, reason codes, and factor chains.
- `data/backtest-daily-prices.json` is a separate daily snapshot for two-trading-day recovery validation.
- `dca_l2_backtest.py` produces portfolio-level daily decisions and compares DCA-L2 with Fixed DCA.

Latest local daily backtest result: DCA-L2 final value `CAD 115,438.95` versus Fixed DCA `CAD 119,647.94`. DCA-L2 invested `CAD 17,636.26` versus Fixed DCA's `CAD 17,858.76`, with `CAD 2,139.42` of qualified planned Crash Fund releases simulated as confirmed historical execution. This does not support promotion over Fixed DCA; it is a diagnostic result showing the policy needs further validation across more histories and regimes.

## Validation commands

```powershell
node tests\dca-policy.test.js
python -m unittest discover -s tests
python scripts\update_backtest_daily_prices.py
python dca_l2_backtest.py
node --check app.js
node --check research-sandbox.js
```
