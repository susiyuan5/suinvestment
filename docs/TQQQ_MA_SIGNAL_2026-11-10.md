# TQQQ 200-Day Moving-Average Signal — 2026-11-10

Manual decision support. Adds a read-only `TQQQ` view to the workspace main nav (after 虚拟货币), ported from a standalone page Su had been using. TQQQ is not added to the weekly DCA plan, Manual Trade Plan, holdings logic or any broker flow, and the view places no orders.

## Rule (as given by Su; not derived or tuned here)

- Check once after each close. A signal formed at a close is acted on the next session.
- **Buy** TQQQ when SPY **and** QQQ both close at least 4% above their own 200-day simple moving average.
- **Sell** everything when **either** closes at least 3% below its 200-day average.
- Between the two lines, do nothing and keep the state left by the last signal.
- QQQ overheat levels: 30% above its average (reduce to half) and 40% above (exit). Per Su's decision these are **displayed as price levels only** and do not change the buy/sell state, because the rule does not say when to buy back after them.

## What the view shows

- One verdict from the latest completed session: 买入 / 卖出 on the day a signal forms, otherwise 不操作 · 继续持有 or 不操作 · 空仓等待 with the distance to the relevant line. Withheld when the data is 4 or more days old.
- Position of each close against its average on a ruler, key price levels, the overheat levels, and one year of deviations.
- A manual calculator for four hand-entered numbers. It runs in the page only and stores nothing; it cannot know the previous state, so between the lines it reports "no action".

## Data

- `data/tqqq-ma-daily-v1.json`, published only to the `live-data` branch by task `update-tqqq-ma` (`scripts/update_tqqq_ma.py`, workflow `.github/workflows/update-tqqq-ma.yml`, weekdays 21:47 and 23:47 UTC plus manual dispatch).
- Yahoo Finance daily closes for SPY and QQQ, **not adjusted** for dividends, about seven years. A date is kept only if both symbols have a close and the session is complete (today's bar counts from 16:20 New York).
- Validation before publishing: at least 460 sessions, weekdays in order, no gap over 7 days, no one-day move over 25%, latest session at most 7 days old. A failure leaves the previous snapshot in place.

## State

The state (holding or out) is recomputed from the price history on every load, starting from "out" at the first session with a 200-day average. With about seven years of data the first signal is long past, so the start assumption does not affect the current state. Nothing is stored in the browser.

## Check against the source page

On the frozen fixture (latest session 2026-11-09) the module gives: out since 2026-11-05; SPY 752.69 against an average of 730.70 (+3.01%); QQQ 679.35 against 681.17 (−0.27%). These match the values the source page had saved for the same date. Signals in the fixture window: buy 2020-07-15, sell 2022-01-21, buy 2023-02-02, sell 2025-03-10, buy 2025-06-10, sell 2026-03-26, buy 2026-04-14, sell 2026-11-05.

## Limitations

- The rule's thresholds were taken as given. A backtest was added afterwards in `docs/TQQQ_MA_BACKTEST_2026-11-10.md`: since 2010 it returned less than holding TQQQ with a much smaller drawdown, and a synthetic extension to 2000 shows an 86% drawdown.
- TQQQ is a 3× daily-leveraged fund; its losses in a decline are larger than QQQ's and compound unfavourably in choppy markets. Since the backtest the view shows a budget cap of 11% of total wealth (10% loss limit); see the backtest report.
- Closes are unadjusted, matching what charting apps show; an adjusted series would give slightly different averages.
- Signals depend on daily closes from one source. A bad or missing bar is caught only by the coarse validation above.

## Files

- `tqqq-ma-signal.js` — pure logic (browser + Node), tests `tests/tqqq-ma-signal.test.js`, fixture `tests/fixtures/tqqq-ma-daily-v1.json`.
- `tqqq-ma-panel.js`, `tqqq-ma-panel.css`, view `#view-tqqq` in `index.html`.
- `scripts/update_tqqq_ma.py` (tests `tests/test_tqqq_ma.py`), task entry in `scripts/live-data-tasks.json`, path allowed in `live-data.js`.
- Browser smoke `scripts/tqqq-smoke.mjs` (`npm run audit:tqqq`), run in `pages-smoke.yml`.

## Rollout

After merge, run **Update TQQQ moving-average daily closes** once via workflow_dispatch so `live-data` has `data/tqqq-ma-daily-v1.json`. Until then the view shows a read error (HTTP 404) and only the manual calculator works.
