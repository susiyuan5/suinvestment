# Research Universe

Phase 6A introduces a separate research universe so broader validation can happen without changing the live dashboard.

## Key Distinction

- Live Portfolio: the actual dashboard recommendation symbols.
- Research Universe: broader stock pool for factor validation, ML research, and future optimization experiments.
- Reference Symbols: index or ETF references for regime and benchmark research.

This scaffold does not change live recommendations, the Manual Trade Plan, dashboard symbols, buy amounts, signal scores, multipliers, risk levels, action thresholds, or the default Python strategy.

## Files

- `data/research-universe.json`: symbol groups for Phase 6 research.
- `research/universe.py`: research-only loader and validation helper.

## Current Groups

Live portfolio symbols:

- BYDDY
- MSFT
- NVDA
- AAPL
- ASML
- KO

Reference symbols:

- QQQ
- SPY
- DIA
- IWM

Research universe symbols:

- AAPL, MSFT, NVDA, GOOGL, AMZN, META
- ASML, AMD, AVGO, TSM, QCOM, MU, INTC
- COST, WMT, MCD, NKE, SBUX, HD
- KO, PEP, PG, JNJ, UNH, MRK
- JPM, BAC, V, MA, AXP
- CAT, DE, GE, HON
- BYDDY, TM, TCEHY, BABA

## Validation Rules

The helper checks:

- no duplicate symbols within each group
- all live portfolio symbols are included in the research universe
- reference symbols are separate from tradable research symbols
- QQQ and SPY remain reference symbols

Run:

```powershell
python research\universe.py
```

Expected counts:

- live portfolio symbols: 6
- research universe symbols: 38
- reference symbols: 4

## Phase 6B

Phase 6A does not update `data/backtest-prices.json`. Historical data expansion for the research universe should happen in Phase 6B, after this scaffold is reviewed.
