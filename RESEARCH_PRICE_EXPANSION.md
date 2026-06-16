# Research Price Expansion

Phase 6B adds a research-only historical data workflow for the broader research universe.

## Files

- `data/research-universe.json`: research symbol groups.
- `scripts/update_research_prices.py`: research-only historical weekly close refresher.
- `data/research-prices.json`: generated research-only historical weekly close data.
- `results/phase6/research_price_coverage.csv`: symbol-level coverage and failure report.

## Separation From Live Data

`data/backtest-prices.json` remains the live/backtest portfolio and QQQ/SPY market-regime snapshot. It is used by existing dashboard backtests and market-regime calculations.

`data/research-prices.json` is separate. It is for factor validation, ML research, future optimization experiments, and broader universe diagnostics only.

Research universe symbols do not become live dashboard recommendations, do not appear in the Manual Trade Plan, and do not change buy amounts, signal scores, multipliers, risk levels, action thresholds, or the default Python strategy.

## How To Refresh

Run from the repository root:

```powershell
python scripts\update_research_prices.py
```

By default, the script fetches:

- `research_universe_symbols`
- `reference_symbols`

To exclude references:

```powershell
python scripts\update_research_prices.py --exclude-references
```

## Failure Handling

Yahoo/historical access may fail for some symbols. The script continues fetching other symbols and records failures in:

- `data/research-prices.json` under `failures`
- `results/phase6/research_price_coverage.csv`

Failed symbols are not silently treated as valid. Missing or short research histories should be expected during research expansion and must not affect the live dashboard.

The script retries transient fetch failures before recording a symbol as failed. Final failures remain visible in both the JSON payload and coverage CSV.

## Validation

The script checks:

- no duplicate symbols in the research universe definition
- live portfolio symbols remain unchanged
- reference symbols stay separate from research symbols
- QQQ/SPY remain reference symbols
- successful symbols report row count, first date, latest date, and whether they meet the 50-week minimum

## Current Use

Phase 6B only creates the broader research data source. Existing Phase 5 factor and ML scripts remain on their current default inputs unless explicitly updated in later phases.

## Next Step

Phase 6C should add an explicit research-universe factor report mode that reads `data/research-prices.json` without changing the default live portfolio factor report.
