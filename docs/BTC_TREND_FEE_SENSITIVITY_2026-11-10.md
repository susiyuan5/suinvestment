# BTC Weekly Trend Rule — Fee Sensitivity (2026-11-10)

Research only. The live rule (20-week MA, enter after 2 closes above, exit after 1 below) is **unchanged**; this report only varies the assumed trading cost. No page, data task or strategy formula was modified.

## Question

The original backtest (`docs/BTC_WEEKLY_TREND_SIGNAL_2026-10-20.md`) assumed 0.1% per switch. Retail crypto spreads and fees are usually higher. How much of the rule's result survives at higher cost?

## Method

- Script: `scripts/btc-trend-fee-sensitivity.mjs` (`node scripts/btc-trend-fee-sensitivity.mjs [snapshot.json] [--json]`). It imports `btc-trend-signal.js` and uses its positions as-is.
- Data: frozen `tests/fixtures/btc-weekly-v1.json` (Yahoo BTC-USD, UTC Monday–Sunday weeks, 631 complete weeks, 2014-09-21 → 2026-10-18).
- Timing: a position decided at a week's close is held over the following week (no look-ahead).
- Cost: the fee is charged on the full balance at every switch (buy or sell), and once on entry for buy & hold. Tiers: 0.1%, 0.5%, 1%, 1.5%, 2%, 3% per side.
- Break-even fee: the per-side fee at which the rule's final balance equals buy & hold's.
- Check: at 0.1% from 2015-08-23 the script gives 74.5% CAGR / -56.8% max drawdown for the rule and 69.5% / -83.0% for buy & hold, matching the original report (74.4% / -56.8% and 69.3% / -83.0%). The original start week is not recorded; 2015-08-23 is the week that reproduces it.

## Results

Report baseline window, 2015-08-23 → 2026-10-18 (11.2 years, 29 switches, in the market 58% of weeks):

| Fee per side | Rule CAGR | Rule max DD | Buy & hold CAGR | Buy & hold max DD | Rule − hold |
|---|---|---|---|---|---|
| 0.1% | 74.5% | -56.8% | 69.5% | -83.0% | +5.0 pt |
| 0.5% | 72.7% | -57.2% | 69.4% | -83.0% | +3.3 pt |
| 1.0% | 70.4% | -57.6% | 69.3% | -83.0% | +1.1 pt |
| 1.5% | 68.2% | -58.0% | 69.3% | -83.0% | -1.0 pt |
| 2.0% | 66.0% | -58.5% | 69.2% | -83.0% | -3.2 pt |
| 3.0% | 61.6% | -59.3% | 69.0% | -83.0% | -7.4 pt |

Break-even fee: **1.26% per side**.

Full available history, 2015-02-01 → 2026-10-18 (11.7 years, 31 switches, in the market 56% of weeks):

| Fee per side | Rule CAGR | Rule max DD | Buy & hold CAGR | Rule − hold |
|---|---|---|---|---|
| 0.1% | 68.7% | -56.8% | 65.4% | +3.3 pt |
| 0.5% | 66.9% | -57.2% | 65.3% | +1.6 pt |
| 1.0% | 64.7% | -57.6% | 65.2% | -0.6 pt |
| 1.5% | 62.5% | -58.0% | 65.2% | -2.7 pt |
| 2.0% | 60.3% | -58.5% | 65.1% | -4.8 pt |
| 3.0% | 56.0% | -59.3% | 64.9% | -8.9 pt |

Break-even fee: **0.87% per side**.

Sub-periods (rule CAGR vs buy & hold CAGR):

| Period | Switches | 0.1% | 1.0% | 2.0% | Break-even fee |
|---|---|---|---|---|---|
| 2015-08 → 2019 | 6 | 148.4% vs 122.6% | 145.3% vs 122.1% | 141.9% vs 121.6% | 9.19% |
| 2020 → 2022 | 8 | 65.6% vs 31.5% | 61.6% vs 31.1% | 57.3% vs 30.6% | 9.46% |
| 2023 → 2026-10 | 15 | 21.6% vs 51.4% | 17.3% vs 51.1% | 12.7% vs 50.6% | none (behind at 0%) |

## Reading

- **Return edge is thin and cost-sensitive.** Over the whole history the rule's CAGR advantage over buy & hold disappears at roughly 0.9–1.3% per side, depending on the start week.
- **Drawdown protection is not cost-sensitive.** Max drawdown moves from -56.8% to -59.3% across the whole fee range, against -83.0% for buy & hold. The rule's case rests on drawdown, not on extra return.
- **Start date matters about as much as fees.** Moving the start from 2015-08-23 (near that year's low) to 2015-02-01 lowers both CAGRs by about 4–6 points and the break-even fee from 1.26% to 0.87%.
- **Switching has become more frequent.** 15 of the 29 switches fall in the last 3.8 years, the same period in which the rule trails buy & hold at any fee. Each extra point of fee costs about 4–5 points of CAGR there, versus about 2–3 points in earlier periods.

## Limitations

- One data source and one bar alignment. The original report found Yahoo and Kraken differ materially; this was not re-run on Kraken.
- In-sample: the rule's parameters were chosen on this same history.
- The fee is a flat percentage per switch. Real costs can vary with order size and volatility, and taxes on each sale are not modelled. The actual Wealthsimple crypto fee was not looked up; pick the tier that matches the account.
- Cash earns nothing while out of the market.
- The fixture ends 2026-10-18.

## Suggested next steps (not done)

1. Confirm the real per-side cost in the account and read the matching row.
2. If it is near or above 1%, test ways to switch less often in choppy markets (for example a core holding plus a trend-following portion), judged on both Yahoo and Kraken data.
3. Add a position-size rule; at any fee the rule still has a drawdown near -57%.
