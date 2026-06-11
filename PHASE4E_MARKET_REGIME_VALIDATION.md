# Phase 4E Market Regime Historical Data Validation

Validation date: 2026-06-12

Baseline:

- Commit: `07766784d8042ba79adfdfc0bedea1670d5b0b0d`
- Tag: `stable-phase4d-market-regime-audit`

## Scope

Phase 4E supplied the missing historical inputs required for dashboard market regime calculation. It did not change live recommendation formulas, the Python default strategy, broker behavior, automatic trading behavior, or the market regime fallback cap behavior.

## Changes Validated

- Added `scripts/update_backtest_prices.py` to generate or repair the historical weekly snapshot.
- Updated `data/backtest-prices.json` so it includes the current portfolio symbols plus QQQ and SPY.
- Preserved the existing `data/backtest-prices.json` shape: top-level `generatedAt`, `source`, and `symbols` object with per-symbol arrays of `{date, close}` rows.
- Added compact market regime provenance fields for display: proxy, row count, latest date, source, and freshness.
- Updated README data-source notes for the new historical snapshot updater and market regime dependency.

## Historical Data Coverage

Observed rows in `data/backtest-prices.json` after generation:

| Symbol | Weekly rows | First date | Latest date | Latest close |
| --- | ---: | --- | --- | ---: |
| BYDDY | 262 | 2021-06-07 | 2026-06-05 | 11.26 |
| MSFT | 262 | 2021-06-07 | 2026-06-05 | 416.670013 |
| NVDA | 262 | 2021-06-07 | 2026-06-05 | 205.100006 |
| AAPL | 262 | 2021-06-07 | 2026-06-05 | 307.339996 |
| ASML | 262 | 2021-06-07 | 2026-06-05 | 1641.73999 |
| KO | 262 | 2021-06-07 | 2026-06-05 | 79.480003 |
| QQQ | 263 | 2021-06-04 | 2026-06-11 | 717.119995 |
| SPY | 263 | 2021-06-04 | 2026-06-11 | 737.76001 |

QQQ and SPY both exceed the 50-week minimum required by `calculateMarketRegimeFromPrices()`.

## Market Regime Result

A local validation using the same market regime thresholds showed:

| Proxy | Weekly rows | Latest | 20-week MA | 50-week MA | 52-week drawdown | Regime |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| QQQ | 263 | 717.12 | 643.44 | 614.95 | 2.87% | Bull |
| SPY | 263 | 737.76 | 699.57 | 677.11 | 2.47% | Bull |

Because QQQ now has enough historical weekly data, `fetchMarketRegime()` should compute market regime from QQQ and should not use neutral fallback under current data conditions.

## Expected Dashboard Display

The Data Quality Summary market regime line should now show a computed QQQ-backed regime rather than neutral fallback, for example:

```text
Bull / QQQ / 263 rows / latest 2026-06-11 / Historical weekly prices / QQQ / Fresh
```

The exact language and separator depend on the active dashboard language, but the important change is that the source is historical weekly QQQ data rather than `Neutral fallback`.

The fallback warning should still appear if QQQ and SPY are removed or have fewer than 50 valid weekly rows, because the fallback path remains in place.

## Recommendation Behavior

No recommendation formula was changed:

- signal score formula unchanged
- multiplier formula unchanged
- suggested buy amount formula unchanged
- risk level formula unchanged
- action thresholds unchanged
- market regime classification thresholds unchanged
- fallback cap behavior unchanged

Displayed recommendations may change compared with Phase 4D only because real QQQ market regime data now replaces the previous neutral fallback input.

Under the current generated data, QQQ validates as Bull. This changes the market regime cap from neutral `1.5x` to bull `2.0x` where no other caps apply. That is an input-data correction, not a strategy formula change.

## Validation Commands

```powershell
python scripts\update_backtest_prices.py
python -m py_compile scripts\update_backtest_prices.py
python -m unittest discover -s tests
node --check app.js
```

Results:

- Historical snapshot generation succeeded.
- QQQ rows: 263, latest date 2026-06-11.
- SPY rows: 263, latest date 2026-06-11.
- Python tests passed: `Ran 27 tests OK`.
- Node syntax check passed.

## Remaining Risks

- Yahoo historical data access can still fail in some environments, so the generated static snapshot should be committed and periodically refreshed.
- Existing portfolio symbols remain on the prior 2021-06-07 to 2026-06-05 weekly window unless `--refresh-all` is used.
- Market regime will become stale if the historical snapshot is not refreshed regularly.
- A separate future phase should decide whether missing-regime fallback should be more conservative than neutral.

## Conclusion

Phase 4E fixes the missing input data identified in Phase 4D. QQQ and SPY now have enough historical weekly closes for market regime calculation, so the dashboard can use real historical regime data instead of neutral fallback under current snapshot conditions.
