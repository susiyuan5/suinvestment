# Phase 6I 38 vs 80 Research Universe Comparison

This report is research-only. It does not affect live dashboard recommendations, Manual Trade Plan, buy amounts, signal scores, multipliers, risk levels, action thresholds, default Python strategy, or market regime formula.

## Universe Counts

- Active research universe: `38` symbols
- Expanded research universe: `80` symbols
- Active references: `4`
- Expanded references: `4`
- New symbols added: `42`
- Removed symbols: `0`

## Category Distribution

| category | active 38 | expanded 80 |
|:--|--:|--:|
| consumer_retail | 6 | 10 |
| core_technology | 6 | 10 |
| defensive_healthcare | 6 | 10 |
| energy_materials | 0 | 8 |
| financial_payments | 5 | 10 |
| industrial_diversified | 4 | 10 |
| international | 4 | 8 |
| semiconductors | 7 | 10 |
| utilities_real_assets | 0 | 4 |

## Concentration

- Active largest category share: `0.184211`
- Expanded largest category share: `0.125`
- Active technology + semiconductors share: `0.342105`
- Expanded technology + semiconductors share: `0.25`
- Energy/materials coverage: `8` symbols
- Utilities/real assets coverage: `4` symbols

## Price Data Status

- Successful symbols: `84`
- Coverage count explanation: `84` = `80` expanded research symbols + `4` reference symbols.
- Failed symbols: `0`
- Short successful symbols: `0`
- Latest date range: `2026-06-12` to `2026-06-18`
- Price file: `data/research-prices-sector-balanced-80.json`

## Safety Confirmation

- Active universe still default: `True`
- Expanded universe explicit only: `True`
- PyPortfolioOpt introduced: `False`
- Live dashboard symbols changed: `False`
- `data/backtest-prices.json` is not written by this runner.
- Manual Trade Plan is not written by this runner.

## Next Step

Phase 6J should run explicit 38-vs-80 factor, validation, sector/regime, and ML comparisons using the separate expanded price file.
