# Weekly history for added stocks — 2026-10-28

## Problem

Stocks added to the weekly plan in the browser (currently QNT, JOBY, PEP, CBRS, WMT) had no weekly history in
`data/backtest-prices.json`, whose job used a fixed list (BYDDY, MSFT, NVDA, AAPL, ASML, KO, QQQ, SPY).
`WeeklySignalModel.riskDataStatus` therefore returned `unknown` (needs ≥21 weekly rows plus trend, volatility and
drawdown), and the dashboard showed 「基础投入 · 风险未知」: Base continued, Extra + Crash were always off.

## Change

- New owner-maintained list `data/weekly-history-symbols.json`. `scripts/update_backtest_prices.py` fetches these
  after the strict core snapshot passes validation.
- Extra symbols need ≥21 weekly rows (not 50), so recent listings such as QNT and CBRS qualify.
- Best effort: a failed, short, stale, regressed or invalid extra symbol keeps its previous valid rows
  (`stale_fallback`) or is left out with an entry in `errors`; it never blocks the core snapshot or the workflow.
- Core `SYMBOLS`, their validation, the adjusted-daily v2 file and DCA-L2 v2 evidence are unchanged.
- Tests: `tests/test_weekly_history_symbols.py` (config validation, 21-week minimum, fallback, regression,
  isolation between symbols).

## Expected effect (checked against live-data snapshot 2026-10-24 + fresh Yahoo rows on 2026-10-28)

| Symbol | Weeks | 52w drawdown | Trend | Risk status |
|---|---|---|---|---|
| WMT | 283 | 11.3% | mixed | known |
| PEP | 283 | 22.2% | strong downtrend | known |
| JOBY | 283 | 67.1% | strong downtrend | known |
| CBRS | 25 | 59.8% | strong downtrend | known |
| QNT | 22 | 49.3% | strong downtrend | known |

With risk known, the existing gates apply: drawdown ≥35% sets `actionBlocked`, and the weekly-dca-v4 value-trap
guard (`stockBasePreservation.maxDrawdownPct = 35`) then also stops Base. So **JOBY, CBRS and QNT are expected to
move from "Base only" to "保留现金"** while they stay ≥35% below their high (for QNT/CBRS the high is their
post-listing high). PEP/WMT keep Base and become eligible for Extra/Crash when their signals allow it.
To keep the previous behaviour for a symbol, remove it from `data/weekly-history-symbols.json`.

## Rollout

After merge, run **Update historical backtest prices** (workflow_dispatch) or wait for its schedule; the dashboard
picks up the new rows from the `live-data` branch.

Research scripts that iterate every symbol in `data/backtest-prices.json` (e.g. `compare_algorithms.py`) will see the
extra symbols on their next run.
