# BTC — Core + Trend Mix and Position Size (2026-11-10)

The research below was done with the live rule unchanged, to size the trade-offs so Su could decide; nothing here is a recommendation to trade. The decision taken afterwards and what was rolled out are recorded at the end.

Context: `docs/BTC_TREND_FEE_SENSITIVITY_2026-11-10.md` found that cost is not the rule's weak point at Su's fee level (OKX, 0.1% per side, staying in USDT when out). The two open items were (1) how large a BTC position a loss limit allows, and (2) whether keeping a permanent core holding reduces the rule's lag in choppy markets.

## Method

- Script: `scripts/btc-core-trend-research.mjs` (`node scripts/btc-core-trend-research.mjs [--json]`), tests in `tests/btc-core-trend-research.test.js`. It imports `btc-trend-signal.js` and uses its positions unchanged.
- Data, both frozen:
  - Yahoo BTC-USD, UTC Monday–Sunday weeks, to 2026-10-18 (`tests/fixtures/btc-weekly-v1.json`).
  - Kraken XBTUSD weekly bars, UTC Thursday–Wednesday, fetched 2026-11-10 from Kraken's public OHLC API and cut at 2026-10-21 to match (`tests/fixtures/btc-weekly-kraken-research-v1.json`).
- Mix: a `core` share of the balance is always in BTC; the rest follows the rule. On an entry signal all cash buys BTC. On an exit signal BTC is cut back to `core` of the balance. No rebalancing between signals. Core 0% is the pure rule; core 100% is buy & hold.
- Cost 0.1% of the amount traded. Signals form at the weekly close and apply to the next week.
- Checks: core 0% equals the fee-sensitivity script to 1e-9; on Kraken the pure rule gives 69.1% CAGR / -53.5% max drawdown and buy & hold 54.2% / -79.2%, against 68.6% / -53.4% and 53.9% / -79.2% in the 2026-10-20 report (its exact start week is not recorded).

## 1. Core + trend mix

Longest window per source (CAGR / max drawdown):

| Core share | Yahoo 2015-08 → 2026-10 | Kraken 2014-09 → 2026-10 |
|---|---|---|
| 0% (pure rule) | 74.5% / -56.8% | 69.1% / -53.5% |
| 25% | 74.9% / -63.4% | 67.2% / -59.9% |
| 50% | 74.3% / -69.9% | 64.3% / -66.3% |
| 75% | 72.6% / -76.5% | 60.1% / -72.8% |
| 100% (buy & hold) | 69.5% / -83.0% | 54.2% / -79.2% |

By period (CAGR / max drawdown):

| Core share | 2015-08 → 2019 Yahoo | Kraken | 2020 → 2022 Yahoo | Kraken | 2023 → 2026-10 Yahoo | Kraken |
|---|---|---|---|---|---|---|
| 0% | 148.4% / -56.8% | 155.5% / -53.5% | 65.6% / -32.5% | 60.7% / -45.9% | 21.6% / -28.1% | 26.7% / -26.5% |
| 25% | 144.3% / -63.4% | 148.7% / -59.9% | 60.0% / -43.0% | 58.5% / -43.5% | 29.6% / -27.1% | 34.0% / -25.7% |
| 50% | 138.8% / -69.9% | 140.8% / -66.3% | 52.9% / -54.0% | 53.8% / -52.1% | 37.2% / -35.9% | 40.9% / -34.9% |
| 75% | 131.8% / -76.5% | 131.8% / -72.8% | 43.7% / -64.7% | 45.6% / -62.9% | 44.5% / -44.1% | 47.3% / -43.4% |
| 100% | 122.6% / -83.0% | 121.3% / -79.2% | 31.5% / -75.1% | 32.2% / -76.0% | 51.4% / -51.8% | 53.1% / -51.4% |

Reading:

- **A core holding is a trade, not an improvement.** Over the long windows, each 25 points of core adds about 6–7 points of max drawdown. Return is flat on Yahoo up to a 50% core and falls steadily on Kraken.
- **It does what it was meant to in 2023 → 2026.** Each 25 points of core adds about 7–8 points of CAGR in the period where the pure rule lagged, on both sources.
- **It costs the most where the rule earned its keep.** In 2020 → 2022 a 50% core gives up 7–13 points of CAGR and deepens the drawdown from -32.5% to -54.0% on Yahoo (-45.9% to -52.1% on Kraken).
- **25% is the only mix that is not clearly worse somewhere.** It keeps most of the long-run result (Yahoo +0.4 pt CAGR, Kraken -1.9 pt), adds about 6.5 points of drawdown, and recovers about 8 points of CAGR in 2023 → 2026 with a slightly smaller drawdown in that period. The two sources disagree on the sign of the long-run CAGR change, so this is not a robust gain.
- Whether the last four years (choppy, rule lags) or the earlier cycles (deep bear markets, rule protects) are the better guide to the future cannot be settled from this data.

## 2. Position size

If the rest of the portfolio is flat, a BTC share `w` of total wealth that falls by `d` costs `w × d` of total wealth. So the largest share a loss limit `L` allows is `w = L / |d|`. Using the worse of the two sources' historical max drawdowns:

| Core share | Worst drawdown | Loss at 5% share | 10% | 20% | 30% | 50% | Max share for a 5% / 10% / 20% loss limit |
|---|---|---|---|---|---|---|---|
| 0% (pure rule) | -56.8% | -2.8% | -5.7% | -11.4% | -17.1% | -28.4% | 9% / 18% / 35% |
| 25% | -63.4% | -3.2% | -6.3% | -12.7% | -19.0% | -31.7% | 8% / 16% / 32% |
| 50% | -69.9% | -3.5% | -7.0% | -14.0% | -21.0% | -35.0% | 7% / 14% / 29% |
| 75% | -76.5% | -3.8% | -7.6% | -15.3% | -22.9% | -38.2% | 7% / 13% / 26% |
| 100% (buy & hold) | -83.0% | -4.2% | -8.3% | -16.6% | -24.9% | -41.5% | 6% / 12% / 24% |

Reading:

- Following the pure rule instead of buy & hold lets the same loss limit carry roughly 1.5× the BTC share (for a 10% limit: 18% against 12%).
- These are historical worst cases on weekly closes. A future drawdown can be deeper, intra-week lows are lower than weekly closes, and stocks can fall at the same time, so the table is an upper bound on the share, not a target. Sizing against a deeper assumed drawdown (for example -70% for the pure rule) gives 7% / 14% / 29%.

## Limitations

- In-sample: the rule's parameters were chosen on this history, and the mix shares were compared on it too.
- Two sources of the same asset; they share the same market history, so agreement between them is weaker evidence than it looks.
- No taxes, no yield on idle USDT, flat fee, weekly closes only.
- Prices are USD pairs; trades on OKX are BTC/USDT.
- Data ends 2026-10-18 (Yahoo) / 2026-10-21 (Kraken).

## Decision and rollout (Su, 2026-11-10)

Su chose a **25% core** and a **10% loss limit** on total wealth. Implemented on the 虚拟货币 page as manual guidance only; the page still reads no account and places no orders.

- The 20-week MA signal (enter after 2 closes above, exit after 1 below) is unchanged. What an exit means changed: BTC is cut to 25% of the BTC budget and the rest stays in USDT, instead of going fully to cash.
- BTC budget cap = 10% ÷ 63.4% (worst historical drawdown of the 25% core mix), rounded down to a whole percent = **15% of total wealth**. That is about 15% of total wealth in BTC while the rule holds and about 3.75% while it is out. The table above shows 16% because it rounds to nearest; the page rounds down so the reference drawdown stays within the limit (15% × 63.4% = 9.5%).
- At an assumed 70% drawdown the cap would be 14%; the page shows this next to the cap.
- Constants live in `PLAN` in `btc-trend-signal.js` (`coreShare`, `lossLimit`, `referenceDrawdown`); a unit test ties `referenceDrawdown` to this report's result.
