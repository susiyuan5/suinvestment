# Phase 4E.1 Market Regime Post-Deploy Validation

Validation date: 2026-06-12

Stable point:

- Commit: `e03ab6ae33353cd7a29b9155d7dc5799ab3b6b7b`
- Tag: `stable-phase4e-market-regime-history`

## Scope

This post-deployment validation confirms that Phase 4E resolved the dashboard market regime neutral fallback by supplying QQQ/SPY historical weekly data.

No algorithm logic, live recommendation formulas, Python default strategy, broker behavior, automatic trading behavior, UI design, or fallback cap behavior was changed.

## Implementation Reviewed

Reviewed Phase 4E files:

- `scripts/update_backtest_prices.py`
- `data/backtest-prices.json`
- `app.js`
- `README.md`
- `PHASE4E_MARKET_REGIME_VALIDATION.md`

The historical snapshot updater includes the current portfolio symbols plus QQQ and SPY. The dashboard still uses the same market regime loading path: QQQ first, then SPY, then neutral fallback if neither has enough weekly rows.

## Historical Data Check

`data/backtest-prices.json` contains enough weekly history for market regime calculation:

| Symbol | Weekly rows | First date | Latest date | Latest close |
| --- | ---: | --- | --- | ---: |
| QQQ | 263 | 2021-06-04 | 2026-06-11 | 717.119995 |
| SPY | 263 | 2021-06-04 | 2026-06-11 | 737.76001 |

Both QQQ and SPY exceed the 50-week minimum used by `calculateMarketRegimeFromPrices()`.

## Regime Calculation Check

Local validation using the same thresholds showed:

| Proxy | Weekly rows | Latest date | Latest close | 20-week MA | 50-week MA | 52-week drawdown | Regime |
| --- | ---: | --- | ---: | ---: | ---: | ---: | --- |
| QQQ | 263 | 2026-06-11 | 717.12 | 643.44 | 614.95 | 2.87% | Bull |
| SPY | 263 | 2026-06-11 | 737.76 | 699.57 | 677.11 | 2.47% | Bull |

Because QQQ is present and has enough rows, the dashboard should compute market regime from QQQ and should not fall through to neutral fallback under current data.

## Live Page Check

After Ctrl+F5, the deployed dashboard Data Quality Summary showed:

```text
Market Regime / 市场状态:
牛市 | QQQ | 263 rows / 周 | 2026-06-11 | Historical weekly prices / QQQ | Fresh / 新鲜
```

The previous fallback state is no longer shown:

```text
震荡 · Fallback / 备用数据
```

The bottom data-quality message now indicates a fresh source mix with no stale rows, legacy overrides, or neutral market fallback detected.

## Formula Stability

No formula behavior changed:

- signal score formula unchanged
- multiplier formula unchanged
- suggested buy amount formula unchanged
- risk level formula unchanged
- action thresholds unchanged
- market regime formula unchanged

Any displayed recommendation changes after Phase 4E are expected to come only from replacing the previous neutral fallback input with real QQQ Bull regime data. Under current data, the regime cap can move from Neutral `1.5x` to Bull `2.0x` where no other caps apply.

## Validation Commands

```powershell
python -m unittest discover -s tests
node --check app.js
```

Results:

- Python tests passed: `Ran 27 tests OK`.
- Node syntax check passed.

## Remaining Risks

- The static historical snapshot must be refreshed periodically or market regime provenance will become stale.
- Yahoo historical access can fail in some environments, so committing the generated snapshot remains important.
- If QQQ/SPY rows are later removed or drop below 50 valid rows, the existing neutral fallback warning should return.
- A separate future phase should decide whether missing-regime fallback should be more conservative.

## Conclusion

Phase 4E resolved the current market regime fallback. The dashboard now uses QQQ historical weekly data, shows Bull / 牛市 with QQQ provenance, and preserves live/default recommendation formulas.
