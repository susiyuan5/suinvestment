# BTC Weekly Trend Signal (20W MA, enter 2 / exit 1) — 2026-10-20

Research-only, manual decision support. Adds a read-only `虚拟货币` view to the workspace main nav (below 止盈), separate from the stock pools. BTC is not added to the weekly DCA plan, Manual Trade Plan, holdings logic or any broker flow.

## Rule

- Weekly bars: UTC Monday–Sunday; weekly close = Sunday UTC daily close (Yahoo `BTC-USD` daily). The in-progress week is shown but never drives the signal.
- MA: 20-week simple moving average of complete weekly closes.
- Cash → holding after **2 consecutive** weekly closes above the MA. Holding → cash after **1** weekly close below the MA.
- Signal forms at the weekly close and applies from the next week (no look-ahead).
- "Next step" price: next week's MA includes next week's close `x`, so `x < MA'` ⇔ `x < mean(latest 19 closes)`. The panel shows that threshold.
- Data older than 9 days after the latest complete week is flagged stale.

## Backtest (0.1% per switch, signal at week close, held next week)

Yahoo BTC-USD, 2015-08 → 2026-10 (11.2 y):

| Rule | CAGR | Max DD | Trades |
|---|---|---|---|
| Buy & hold | 69.3% | -83.0% | — |
| 50W MA 1/1 | 67.3% | -64.2% | 14 |
| 20W MA 1/1 | 69.9% | -71.9% | 22 |
| **20W MA 2/1 (chosen)** | **74.4%** | **-56.8%** | 15 |
| 20W MA 2/2 | 62.9% | -57.6% | 14 |
| 20W MA 3/1 | 66.0% | -57.1% | 13 |

Kraken XBTUSD weekly (Thursday-aligned), 2014-09 → 2026-10: buy & hold 53.9% / -79.2%; 20W 1/1 71.8% / -57.6%; 20W 2/1 68.6% / -53.4%; 20W 2/2 68.0% / -59.6%.

Grid over entry 1–4 × exit 1–3 weeks: adding exit confirmation consistently hurt (BTC breakdowns are fast); 2-week entry was best or near-best on both sources; 3–4 week entry gave up too much upside. A %-buffer variant (±2–10%) was not robust across sources (Yahoo 75.5% vs Kraken 62.2% at ±2%).

Sub-periods (Yahoo CAGR, 20W 2/1 vs buy & hold): 2015–2019 149% vs 123%; 2020–2022 66% vs 32%; **2023–2026 21% vs 52%** — the rule lags in choppy/grinding markets. Its main value is cutting bear-market drawdowns.

## Limitations

- Parameters were selected on the same history (in-sample); expect weaker live results.
- Results are sensitive to weekly bar alignment and start date (Yahoo vs Kraken differ materially).
- No taxes, spreads or Wealthsimple crypto fees beyond 0.1% per switch.

## Files

- `btc-trend-signal.js` — pure logic (browser + Node), tests `tests/btc-trend-signal.test.js` with frozen fixture `tests/fixtures/btc-weekly-v1.json`.
- `btc-trend-panel.js`, `btc-trend-panel.css`, view `#view-crypto` in `index.html`.
- `scripts/update_btc_weekly.py` (tests `tests/test_btc_weekly.py`), live-data task `update-btc-weekly`, workflow `.github/workflows/update-btc-weekly.yml` (Mon/Tue 01:40 UTC + manual dispatch). Output `data/btc-weekly-v1.json` is published only to `live-data`.

## Rollout

After merge, run **Update BTC weekly closes** once via workflow_dispatch so `live-data` has `data/btc-weekly-v1.json`; until then the panel shows a read error (HTTP 404) rather than stale bundled data.
