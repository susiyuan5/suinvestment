# TQQQ 200-Day Moving-Average Rule — Backtest (2026-11-10)

Research only. The live rule and the TQQQ view's logic are **unchanged**; only the view's footnote now points here. Nothing in this report is a recommendation to trade.

## Question

The rule shown on the TQQQ view (`docs/TQQQ_MA_SIGNAL_2026-11-10.md`) was taken as given. How has it behaved historically, compared with simply holding TQQQ or QQQ?

## Method

- Script: `scripts/tqqq-ma-backtest.mjs` (`node scripts/tqqq-ma-backtest.mjs [--json]`), tests `tests/tqqq-ma-backtest.test.js`. It imports `tqqq-ma-signal.js` and uses its states unchanged.
- Data: frozen `tests/fixtures/tqqq-backtest-daily-research-v1.json` — Yahoo daily bars for SPY, QQQ and TQQQ, 1999-03-10 → 2026-11-09 (6,961 sessions), built by `scripts/build_tqqq_backtest_fixture.py`.
- Signals use plain closes, exactly as the page does. Returns use dividend-adjusted closes.
- Timing: a signal formed at a close is traded at the **next** session's close. Cost 0.1% of the amount traded. Cash earns nothing.
- Two windows:
  - **Real TQQQ**, 2010-02-11 → 2026-11-09 (16.7 years).
  - **Long**, 2000-01-03 → 2026-11-09 (26.8 years). Before TQQQ existed it uses a synthetic series: 3× QQQ's daily return minus a constant drag of 5.03% a year, fitted so the synthetic series ends where real TQQQ does over 2010 → 2026. Over that shared period the synthetic series strays from real TQQQ by at most 24.9%, so pre-2010 figures are a stress test, not a measurement.
- Check: on recent dates the backtest's states equal those of the page's own fixture (out since 2026-11-05).

## Results

CAGR / max drawdown on daily closes:

| Window | Rule | Trades | In market | Hold TQQQ | Hold QQQ |
|---|---|---|---|---|---|
| Real TQQQ, 2010-02 → 2026-11 | 30.5% / -48.1% | 20 | 76% | 40.1% / -81.7% | 18.9% / -35.1% |
| Long, 2000-01 → 2026-11 (synthetic before 2010) | 15.0% / -85.8% | 36 | 65% | -2.6% / -100.0% | 8.3% / -83.0% |

By period:

| Period | Rule | Trades | In market | Hold TQQQ | Hold QQQ |
|---|---|---|---|---|---|
| 2000 → 2002 (synthetic) | -38.7% / -84.9% | 6 | 21% | -89.2% / -99.9% | -36.6% / -83.0% |
| 2003 → 2007 (synthetic) | 5.2% / -57.9% | 10 | 70% | 36.1% / -47.2% | 16.5% / -17.3% |
| 2008 → 2009 (synthetic) | 38.9% / -16.0% | 1 | 28% | -42.1% / -93.1% | -5.0% / -50.0% |
| 2010-02 → 2019 | 33.0% / -43.1% | 11 | 75% | 48.7% / -58.1% | 18.6% / -22.8% |
| 2020 → 2021 | 78.5% / -48.1% | 3 | 88% | 95.8% / -69.9% | 37.4% / -28.6% |
| 2022 | -31.1% / -33.8% | 2 | 6% | -79.2% / -81.0% | -32.7% / -34.8% |
| 2023 → 2026-11 | 24.6% / -41.9% | 6 | 90% | 65.8% / -58.0% | 28.4% / -22.8% |

Signals since 2010: sell 2010-05-26, buy 2010-10-11, sell 2011-08-04, buy 2012-01-19, sell 2012-11-08, buy 2013-03-05, sell 2015-08-21, buy 2016-07-18, sell 2018-10-24, buy 2019-04-04, sell 2020-03-09, buy 2020-06-03, sell 2022-01-21, buy 2023-02-02, sell 2025-03-10, buy 2025-06-10, sell 2026-03-26, buy 2026-04-14, sell 2026-11-05.

## Reading

- **Over TQQQ's real life the rule gave up return for a much smaller drawdown.** 30.5% a year against 40.1% for holding TQQQ, with the worst drawdown cut from -81.7% to -48.1%. It still beat holding QQQ (18.9%) but with a deeper drawdown than QQQ's -35.1%.
- **The rule's value shows in prolonged declines.** It was out for most of 2008–2009 and 2022, when holding TQQQ lost 79–93%.
- **It does not protect against a fast fall from a very stretched market.** In 2000 QQQ was more than 40% above its 200-day average; by the time it closed 3% below, the synthetic 3× position had lost most of its value, and two quick re-entries lost more. The rule's drawdown in that episode is -84.9%, about the same as unleveraged QQQ's. Holding 3× through it would have been a near-total loss.
- **It lags in recoveries and choppy markets.** 2003–2007: 5.2% a year against 16.5% for plain QQQ, with a -57.9% drawdown. 2023 → 2026: 24.6% against 28.4% for QQQ and 65.8% for holding TQQQ.
- **The whole-history comparison depends heavily on the start date and on the synthetic series.** 15.0% a year since 2000 beats QQQ's 8.3%, but the path included an 85% loss.

## Sensitivity

Cost per trade (CAGR / max drawdown, real window then long window):

| Fee | Real TQQQ window | Long window |
|---|---|---|
| 0% | 30.7% / -48.1% | 15.2% / -85.7% |
| 0.1% | 30.5% / -48.1% | 15.0% / -85.8% |
| 0.5% | 29.9% / -48.1% | 14.4% / -86.1% |
| 1.5% | 28.3% / -48.5% | 12.8% / -86.9% |

With about one trade a year, cost matters little. A 1.5% currency-conversion charge on each trade would take about 2 points a year.

Sessions between the signal's close and the trade:

| Lag | Real TQQQ window | Long window |
|---|---|---|
| 0 (same close) | 28.9% / -50.5% | 13.0% / -88.7% |
| 1 (next close, used above) | 30.5% / -48.1% | 15.0% / -85.8% |
| 2 | 26.4% / -51.9% | 13.8% / -85.3% |

A one-day change in execution moves the result by 2–4 points a year, so differences of that size elsewhere in this report are not meaningful.

Buy and sell lines:

| Buy / sell | Real TQQQ window (trades) | Long window (trades) |
|---|---|---|
| +2% / -1% | 26.5% / -53.0% (38) | 11.9% / -83.1% (74) |
| +2% / -3% | 31.8% / -54.9% (24) | 18.1% / -80.3% (42) |
| +2% / -5% | 28.0% / -63.6% (23) | 17.0% / -80.3% (37) |
| +4% / -1% | 24.8% / -52.2% (30) | 9.0% / -87.7% (58) |
| **+4% / -3% (the rule)** | 30.5% / -48.1% (20) | 15.0% / -85.8% (36) |
| +4% / -5% | 27.9% / -51.0% (19) | 15.2% / -83.7% (31) |
| +6% / -1% | 17.2% / -47.9% (28) | 6.0% / -83.3% (46) |
| +6% / -3% | 21.7% / -48.4% (20) | 6.8% / -91.5% (34) |
| +6% / -5% | 19.2% / -53.2% (19) | 6.9% / -90.6% (31) |

The chosen lines are not an isolated peak: +2% / -3% and +4% / -5% are similar. A higher buy line (+6%) is clearly worse, and a tight sell line (-1%) trades far more for less return. Nothing here justifies changing the rule; given the lag sensitivity above, the neighbours are within noise.

## The overheat levels

The page shows the QQQ +30% and +40% levels as prices only. In this history:

- QQQ closed 30% or more above its 200-day average on 76 sessions: December 1999 to April 2000 (74) and two in September 2020. It closed 40% or more above on 64 sessions, all between December 1999 and March 2000. The rule was holding on every one of them.
- One reading of those levels — half size at +30%, out at +40%, back to full size as soon as QQQ is under +30% — was tested for information only, because the rule does not define the buy-back:

| Window | Rule | Rule with that overheat reading |
|---|---|---|
| Real TQQQ, 2010-02 → 2026-11 | 30.5% / -48.1% | 31.4% / -48.1% |
| Long, 2000-01 → 2026-11 | 15.0% / -85.8% | 17.5% / -77.1% |
| 2000 → 2002 (synthetic) | -38.7% / -84.9% | -28.0% / -75.7% |

It helped in 2000 and made almost no difference since 2010, where it applied on two days. It rests on a single episode, so it is weak evidence either way, and even with it the 2000 drawdown is -75.7%.

## What this means for position size

The view gives no position size. For scale only: if the rest of the portfolio is flat, a 10% loss limit on total wealth corresponds to a TQQQ budget of about 20% of total wealth at the real-history drawdown (-48.1%) and about 11% at the long-window drawdown (-85.8%). Stocks would very likely be falling at the same time, so both are upper bounds.

## Decision and rollout (Su, 2026-11-10)

Su chose a **10% loss limit** on total wealth sized against the long-window drawdown. The TQQQ view now shows a 仓位上限 block: TQQQ budget cap = 10% ÷ 85.8%, rounded down to a whole percent = **11% of total wealth** (11% × 85.8% = 9.4%). The note beside it gives the 20% figure that the real-history drawdown (-48.1%) would allow, and says the cap is separate from the crypto view's cap, so both being hit together would lose more than 10%. Constants live in `PLAN` in `tqqq-ma-signal.js`; a unit test ties them to this backtest's results. The buy/sell rule is unchanged, and the page still reads no account and places no orders.

## Limitations

- **In-sample.** The thresholds were chosen by someone who could see this history; future results are likely to be weaker.
- **One real cycle type.** TQQQ's actual life (2010 →) is mostly a rising market. The two worst episodes for a 3× fund, 2000–2002 and 2008, are covered only by the synthetic series, whose constant drag ignores that financing costs were higher then and whose fit to real TQQQ drifts by up to 24.9%.
- Daily closes only: intraday gaps, the difference between the close and an achievable fill, and trading halts are not modelled.
- No taxes, no currency conversion beyond the fee tiers, no yield on cash.
- Unadjusted closes drive the signal, matching the page; adjusted closes would shift a few signal dates.

## Files

- `scripts/tqqq-ma-backtest.mjs`, `tests/tqqq-ma-backtest.test.js`
- `scripts/build_tqqq_backtest_fixture.py`, `tests/test_tqqq_backtest_fixture.py`
- `tests/fixtures/tqqq-backtest-daily-research-v1.json`
