# Phase 4D Market Regime Data Source Audit

Audit date: 2026-06-12

Stable baseline:

- Commit: `49410dd1f77f24f4d937804b29e60364415cdb3f`
- Tag: `stable-phase4c-validation`

## Scope

This audit reviewed how the dashboard calculates market regime, where its data comes from, why the live dashboard currently shows a neutral/fallback regime, and what should be fixed in a later phase.

No algorithm logic, live recommendation formulas, Python default strategy, broker behavior, automatic trading behavior, or dashboard UI behavior was changed.

## Current Market Regime Calculation Path

Dashboard refresh calls these steps:

1. `refreshMarketData()`
2. `fetchBacktestSnapshot()`
3. `fetchMarketRegime()`
4. `calculateEnhancedLowFrequencyMultiplier(..., state.marketRegime)`
5. `renderDataQualitySummary()`

`fetchMarketRegime()` uses this order:

1. If market regime is disabled, return `getNeutralMarketRegime("QQQ")`.
2. Load QQQ historical weekly rows via `fetchBacktestWeeklyPrices("QQQ")`.
3. If QQQ has at least 50 rows, compute regime from QQQ.
4. Otherwise load SPY historical weekly rows via `fetchBacktestWeeklyPrices("SPY")`.
5. If SPY has at least 50 rows, compute regime from SPY.
6. Otherwise return `getNeutralMarketRegime("QQQ")`.

`calculateMarketRegimeFromPrices()` requires at least 50 valid closing prices. It computes:

- latest close
- 20-week moving average
- 50-week moving average
- 52-week recent drawdown

Regime classification:

- Bear: drawdown above 20%, or latest below the 50-week moving average
- Bull: latest above the 20-week moving average and 20-week MA above 50-week MA
- Correction: latest below the 20-week moving average
- Neutral: otherwise

## Current Data Source Path

Market regime does not use the live Finnhub/Yahoo quote path.

It uses `data/backtest-prices.json` first through `fetchBacktestSnapshot()` and `fetchBacktestWeeklyPrices(symbol)`. If a symbol is missing from that static snapshot, `fetchBacktestWeeklyPrices()` attempts a browser Yahoo 5-year weekly fallback for that symbol.

In the current repo snapshot:

| File | Relevant content |
| --- | --- |
| `data/market-data.json` | Contains QQQ short-term scheduled snapshot data, including latest close and 1D/5D changes |
| `data/backtest-prices.json` | Contains 262 weekly rows for BYDDY, MSFT, NVDA, AAPL, ASML, and KO |
| `data/backtest-prices.json` | Does not contain QQQ |
| `data/backtest-prices.json` | Does not contain SPY |
| `scripts/update-market-data.js` | Generates `data/market-data.json`, but not `data/backtest-prices.json` |

Observed local counts:

| Symbol | `data/backtest-prices.json` rows |
| --- | ---: |
| BYDDY | 262 |
| MSFT | 262 |
| NVDA | 262 |
| AAPL | 262 |
| ASML | 262 |
| KO | 262 |
| QQQ | 0 |
| SPY | 0 |

`data/market-data.json` currently has QQQ in the scheduled short-term snapshot, but that file is not enough for market regime because the regime calculation requires 50+ historical weekly closes, not only the latest 1D/5D signal values.

## Why The Dashboard Falls Back

The current fallback is primarily caused by missing QQQ/SPY history in `data/backtest-prices.json`.

The fallback is not primarily caused by:

- missing QQQ scheduled snapshot data, because QQQ exists in `data/market-data.json`
- missing manual override metadata
- stale row metadata
- row-level provenance propagation
- live quote failure for portfolio rows

The direct trigger is:

1. `fetchMarketRegime()` requests QQQ weekly history.
2. `data/backtest-prices.json` has no QQQ key.
3. Browser Yahoo fallback may be unavailable or insufficient in the deployed environment.
4. QQQ fails the `rows.length >= 50` requirement.
5. `fetchMarketRegime()` requests SPY weekly history.
6. `data/backtest-prices.json` has no SPY key.
7. SPY fails the `rows.length >= 50` requirement.
8. The dashboard returns `getNeutralMarketRegime("QQQ")`.

Phase 4C then displays this as:

- Market Regime / &#24066;&#22330;&#29366;&#24577;: &#38663;&#33633; &middot; Fallback / &#22791;&#29992;&#25968;&#25454;
- Warning: market regime is neutral because fallback is being used

## Live Recommendation Impact

Market regime fallback affects live recommendations. It is not display-only.

When neutral fallback is used:

- `market_regime.type` is `Neutral`.
- `max_multiplier` is `LOW_FREQ_ALGO_PARAMS.maxNeutralMultiplier`, currently `1.5`.
- `calculateEnhancedLowFrequencyMultiplier()` caps the multiplier at `1.5` through `getMarketRegimeMultiplierCap("Neutral")`.
- `calculateSignalScore()` does not apply Bull bonus, Correction penalty, or Bear penalty.
- `calculateRiskLevel()` does not add Correction or Bear risk points.
- `generateSignalReason()` still reports the market regime cap.
- Phase 4B/4C provenance and data-quality display warn that the regime is fallback.

Relative safety:

- Compared with Bull, neutral fallback is more conservative because it caps the market-regime multiplier at `1.5` instead of `2.0`.
- Compared with Correction or Bear, neutral fallback can be less conservative because Correction caps at `1.3`, Bear caps at `1.1`, and those regimes add extra risk penalties and warnings.

So the fallback is partially safe, but not fully conservative in every market state.

## Is Current Fallback Behavior Safe?

Current behavior is acceptable as a temporary fallback because it is visible and does not produce the most aggressive Bull cap.

However, it is not ideal because a true Correction or Bear market would be under-recognized. In that case the dashboard would miss:

- lower market-regime multiplier caps
- additional risk points
- Correction/Bear warnings
- negative signal-score adjustments

The Phase 4C Data Quality Summary helps users notice the fallback state, but it does not itself make the recommendation path more conservative.

## Risks Found

| Priority | Risk | Impact |
| --- | --- | --- |
| P0 | QQQ/SPY are absent from `data/backtest-prices.json` | Market regime falls back to Neutral on deployed pages when browser Yahoo fallback does not provide enough history |
| P0 | Market regime fallback can be less conservative than a true Correction/Bear regime | Multipliers, risk levels, signal scores, and warnings may be less defensive than intended |
| P1 | `market-data.json` contains QQQ but only short-term 1D/5D data | Users may assume QQQ is available for regime, but the regime path requires 50+ weekly closes |
| P1 | `scripts/update-market-data.js` does not update historical regime inputs | Scheduled data refresh keeps signal snapshots current but does not repair regime history |
| P1 | Browser Yahoo fallback may fail in production because of CORS/network/provider behavior | Regime reliability depends on a fallback that may not be robust on GitHub Pages |
| P2 | Data Quality Summary accurately warns fallback, but does not explain the missing QQQ/SPY history cause | User sees fallback state but not the root data gap |

## Recommended Phase 4E Fixes

1. P0: Add QQQ and SPY to the historical snapshot used by market regime.
   - Ensure `data/backtest-prices.json` includes at least 50 weekly rows for QQQ and SPY.
   - Prefer the same 5-year span as the current portfolio symbols.
   - Keep this as a data-source fix, not a strategy change.

2. P0: Add a deterministic historical snapshot generation path.
   - Add or extend a script to generate `data/backtest-prices.json` from Yahoo daily data converted to weekly data.
   - Include portfolio symbols plus QQQ and SPY.
   - Preserve generatedAt/source metadata.

3. P1: Make market regime provenance more explicit.
   - Show proxy symbol, row count, latest date, and source in the Data Quality Summary or market regime details.
   - Distinguish computed Neutral from fallback Neutral.

4. P1: Consider a more conservative fallback rule when QQQ/SPY history is unavailable.
   - For example, cap at Correction-level `1.3` when regime data is missing.
   - This would change recommendation behavior, so it should be validated separately before implementation.

5. P1: Add validation checks for snapshot completeness.
   - CI or a local script should fail/warn if QQQ or SPY has fewer than 50 historical rows.
   - Report latest date age for all historical symbols.

6. P2: Document market regime data requirements.
   - README should state that market regime requires QQQ or SPY 50+ weekly historical closes.
   - Clarify that `market-data.json` QQQ is used for panic/short-term signal, not for the market-regime moving average path.

## Conclusion

The current market regime fallback is caused by missing QQQ/SPY historical weekly data in `data/backtest-prices.json`, not by the short-term QQQ scheduled snapshot being absent.

The fallback is visible and partially conservative because Neutral caps the multiplier below Bull, but it can be less conservative than a true Correction or Bear regime. Phase 4E should fix the historical QQQ/SPY data source first, then separately evaluate whether missing-regime fallback should become more defensive.
