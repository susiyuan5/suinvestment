# Data Reliability Audit

## Scope

Phase 4A audited the dashboard and Python data flow without changing behavior. The review covered market-data sources, cache behavior, fallback behavior, stale-data detection, manual overrides, and derived metrics used by live dashboard recommendations and Python analysis/backtests.

No algorithm logic, live recommendation calculation, default Python strategy, broker/trading behavior, sandbox strategy status, or UI layout behavior was changed.

## Current Data Sources

| Area | Source | Code path | Current use |
| --- | --- | --- | --- |
| Dashboard live quote | Finnhub quote API, when a user API key exists | `app.js` `fetchFinnhubSnapshot` | Latest price and, if candles work, 1D/5D changes |
| Dashboard browser fallback | Yahoo Finance chart API | `app.js` `fetchYahooSnapshot` | Latest price, 1D move, 5D move |
| Scheduled dashboard snapshot | `data/market-data.json` generated from Yahoo by GitHub Actions | `scripts/update-market-data.js`, `app.js` `fetchWeeklySnapshot` | Scheduled close snapshot and fallback signal input |
| Dashboard cache | `localStorage` key `su-investment-pro:market-cache` | `app.js` `saveCache`, `getValidCache` | Last successful merged snapshot for up to 24 hours |
| Dashboard manual override | `localStorage` key `su-investment-pro:manual-overrides` | `app.js` `applyOverride`, `applyManualOverrides` | User-entered weekly/decision percentage override |
| Dashboard historical/trend data | `data/backtest-prices.json`, then Yahoo 5-year weekly fallback | `app.js` `fetchBacktestSnapshot`, `fetchBacktestWeeklyPrices` | Trend, volatility, drawdown, market regime, dashboard backtest |
| Python historical data | Yahoo Finance daily chart API | `data_loader.py` | Backtest and analysis daily prices converted to weekly |
| Python manual portfolio | `data/manual_portfolio.csv` | `portfolio.py`, `analysis.py` | Portfolio concentration/risk checks only |

## Dashboard Data Flow

Dashboard refresh runs through this order:

1. Fetch scheduled weekly snapshot from `data/market-data.json`.
2. Fetch static backtest snapshot from `data/backtest-prices.json`.
3. Compute market regime from QQQ historical rows, then SPY, then neutral fallback.
4. For each portfolio symbol plus QQQ:
   - Try Finnhub if an API key exists.
   - If Finnhub fails, try Yahoo browser chart API.
   - If browser API fails, use scheduled weekly snapshot.
   - If no weekly snapshot exists, use valid local cache.
   - If none exist, mark source as `Unavailable`.
5. Apply manual overrides after fetches.
6. Build signal, risk, action, buy amount, order text, and portfolio-risk view.

The UI source badge exposes broad source labels such as `Finnhub`, `Yahoo`, `Weekly`, `Cache`, `Manual`, or `Unavailable`. Warnings also mention stale data, cache use, or manual override when those conditions are detected.

## Cache Behavior

Dashboard cache is stored per symbol in `localStorage` under `su-investment-pro:market-cache`.

- Successful Finnhub/Yahoo rows are saved with `fetchedAt = Date.now()`.
- Cached rows are valid only while `Date.now() - fetchedAt <= 24h`.
- Cache is used after live API failures and after scheduled weekly fallback is unavailable.
- Cached rows are labeled `Cache`.
- Cache source reduces signal score and adds a cache warning.

This is directionally safe, but the cache stores merged rows rather than field-level provenance. A cached row can contain a live price combined with scheduled snapshot fields, yet only one `fetchedAt` is retained.

## Stale-Data Behavior

Dashboard freshness is determined by `getDataFreshness(row, dataAgeHours)`:

- Missing or unavailable rows are `missing`.
- Any row with `dataAgeHours > 24` is `stale`.
- Otherwise the row is `fresh`.

Stale dashboard data is protective:

- `getSuggestedAction` returns `DO_NOT_BUY` when data is stale.
- `calculateRiskLevel` returns at least `High` for stale data.
- `generateSignalReason` returns a stale-data reason.
- `generateSignalWarning` adds a stale-data warning.

Python analysis has a stricter blocking path:

- `analysis.py` computes latest weekly price age from Yahoo-derived weekly data.
- If age exceeds `AnalysisConfig.stale_data_limit_hours` (24h), it returns `DO_NOT_BUY` with high risk.

## Fallback Behavior

Fallbacks are well layered, but provenance is too coarse.

- Finnhub failure falls back to Yahoo.
- Yahoo failure falls back to the scheduled weekly snapshot.
- Scheduled snapshot absence falls back to valid cache.
- Cache absence produces `Unavailable`.
- `Unavailable` produces `DO_NOT_BUY` and high/extreme risk.

The main reliability issue is that fallback sources can be mixed. For example, a fresh live quote may be merged with a scheduled weekly snapshot for daily/weekly changes. The final row label may still be `Finnhub` or `Yahoo`, and the row-level timestamp may look fresh even if one of the component fields came from an older scheduled snapshot.

## Manual Override Behavior

Manual overrides are stored in `localStorage` under `su-investment-pro:manual-overrides` as a plain number by symbol.

Current behavior:

- Override value is parsed as a percent, such as `-9.2`, `+12`, or `10.5`.
- Override is applied after data fetching, so it takes priority over fetched data.
- Override sets `weeklyChange` and `decisionChange` to the manual value.
- Override sets `dailyChange` to `null`.
- Source badge becomes `Manual`.
- Warning includes manual override active.
- User can clear the override with the clear button.

Risks:

- Overrides have no timestamp.
- The UI does not show when an override was entered.
- A manual-only row with no fetched row can be treated as fresh because `getDataFreshness` only marks stale when a numeric age exceeds 24h.
- If a base fetched row exists, manual override inherits base fields like price and `fetchedAt`, so source and freshness can describe the base data rather than the override itself.

## Derived Metric Dependency Map

| Metric | Dashboard dependency | Python dependency | Reliability notes |
| --- | --- | --- | --- |
| Latest price | Finnhub quote, Yahoo chart meta/latest close, weekly snapshot, cache, or manual base row | Yahoo latest daily close | Manual override does not override price; manual signal may pair with old/missing price |
| 1D move | Finnhub candles or quote previous close; Yahoo daily closes; scheduled snapshot | Not used directly in Python analysis | Manual override sets this to `null`; merged live/scheduled values can mix dates |
| 5D move / dashboard weekly change | Finnhub/Yahoo daily candles, scheduled snapshot, cache, or manual override | Not used directly in Python analysis | Main dashboard decision input uses lower of available 1D/5D values |
| Python weekly return | N/A in dashboard live path | Latest weekly close vs previous weekly close after daily-to-weekly conversion | Python blocks stale data instead of using fallback/cache |
| Volatility | `data/backtest-prices.json` or Yahoo 5-year weekly fallback | Recent weekly prices from Yahoo | Dashboard live card may show fresh quote but volatility from static historical file |
| Drawdown | `data/backtest-prices.json` or Yahoo 5-year weekly fallback | Recent weekly high from Yahoo | Same field-level freshness risk as volatility |
| Trend | `data/backtest-prices.json` or Yahoo 5-year weekly fallback | Not explicitly used in Python default analysis | No visible timestamp/source for trend input |
| Market regime | QQQ historical rows, SPY fallback, neutral fallback | Not used by Python default strategy | Neutral fallback can affect recommendations without a prominent data-quality warning |
| Signal score | Decision change, 1D/5D moves, source, freshness, manual/cache penalties, trend/vol/drawdown/regime, news/fundamentals if present | N/A | Penalizes cache/manual/unavailable, but cannot penalize stale component fields when provenance is lost |
| Suggested buy amount | Signal score/action/risk/multiplier plus portfolio cash controls | Weekly return strategy plus portfolio/cash risk controls | Dashboard stale/unavailable blocks buys; manual-only freshness issue remains |

## Risks Found

| Priority | Risk | Impact | Evidence |
| --- | --- | --- | --- |
| P0 | Manual overrides have no timestamp and can be treated as fresh even without fetched data | User may unknowingly act on an old manual override | Overrides store only a number; manual-only row has no `fetchedAt`; `getDataFreshness` returns fresh when no finite age exists |
| P0 | Row-level freshness hides mixed-source fields | Fresh quote can be combined with older weekly snapshot or static historical indicators | `mergeWeeklySnapshot` combines live/API rows with scheduled snapshot fields but keeps one broad source/fetchedAt |
| P1 | Historical indicator data can be stale without a visible warning | Trend, volatility, drawdown, and market regime can influence live multipliers while quote data appears fresh | Live enhanced multiplier reads `data/backtest-prices.json`/Yahoo weekly rows separately from quote freshness |
| P1 | Market regime can silently fall back to neutral | Regime cap can affect live multiplier without user seeing that QQQ/SPY regime data failed | `fetchMarketRegime` returns neutral if QQQ and SPY data fail |
| P1 | Scheduled snapshot stale symbols are not surfaced at symbol level | GitHub Actions can carry prior symbol data forward, but dashboard does not show `staleReason`/`staleFrom` from the snapshot | `scripts/update-market-data.js` stores stale metadata; `getWeeklySnapshot` does not preserve it |
| P2 | README source-priority wording is slightly confusing | Manual override is listed last, but it actually takes priority after fetch | README says manual overrides take priority, but the numbered list can be read as lower priority |
| P2 | Python and dashboard freshness rules differ | Users may see dashboard and CLI disagree around weekends/holidays | Dashboard row freshness uses fetchedAt/generatedAt; Python checks latest weekly price date against a 24h threshold |
| P2 | News/fundamental data paths exist but are usually unavailable and have no freshness model | Score adjustment may be hard to reason about if those fields are later added | `calculateNewsSignal`/`calculateFundamentalsSignal` accept row fields but no current freshness/provenance standard |

## Recommended Phase 4B Fix Plan

1. P0: Add structured manual override metadata.
   - Store `{ value, appliedAt }` instead of a bare number.
   - Show override timestamp in the card details.
   - Mark overrides older than a configurable threshold as stale or require reconfirmation.
   - Preserve clear/reset behavior.

2. P0: Add field-level provenance and timestamps.
   - Track source and timestamp separately for `price`, `dailyChange`, `weeklyChange`, `decisionChange`, `trend`, `volatility`, `drawdown`, and `marketRegime`.
   - Show a compact data-quality line in card details.
   - Penalize or block when any critical signal field is stale.

3. P1: Preserve scheduled snapshot stale metadata.
   - Carry `stale`, `staleReason`, `staleFrom`, `latestDate`, and `generatedAt` from `data/market-data.json` into dashboard rows.
   - Mark scheduled stale rows visibly even if the row is still usable as a fallback.

4. P1: Add historical-indicator freshness checks.
   - Check the latest date in `data/backtest-prices.json`.
   - Show trend/volatility/drawdown source and age.
   - Fall back conservatively if historical indicators are stale.

5. P1: Make market-regime fallback visible.
   - Include regime source/proxy and whether neutral is computed or fallback.
   - Add a warning when QQQ/SPY regime data fails and neutral fallback is used.

6. P2: Clarify documentation.
   - Update README source-priority wording to say manual override is applied after fetch and overrides the decision-change input.
   - Document the difference between dashboard live data, scheduled snapshot data, cache, and Python Yahoo data.

7. P2: Align dashboard and Python stale policies.
   - Decide whether weekend/holiday data should be treated as acceptable when market is closed.
   - Consider market-calendar-aware freshness instead of a simple 24h threshold.

## Current Safety Assessment

The dashboard has meaningful safety gates for missing, stale, cached, and manual data. In most missing/stale cases it either blocks buys or lowers confidence through score/risk/warnings.

The key gap is not absence of safety logic; it is loss of provenance when several data sources are merged into one row. Phase 4B should focus on making data freshness field-level and visible before changing strategy logic.
