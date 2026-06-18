# Research Universe Expansion Plan

Phase 6H creates a planning-only proposal for expanding the current 38-symbol research universe toward a sector-balanced 80-symbol research universe. This does not activate the larger universe.

## Current State

- Live Portfolio symbols: 6
- Active Research Universe symbols: 38
- Reference symbols: QQQ, SPY, DIA, IWM
- Active universe file: `data/research-universe.json`
- Planning file: `data/research-universe-expansion-plan.json`

The live dashboard, Manual Trade Plan, default Python strategy, buy amount logic, signal score, multiplier, risk levels, action thresholds, and market regime formula remain unchanged.

## Why Expansion Is Being Considered

Phase 6G showed that research factor results are sector and regime dependent:

- `volatility_12w` was partly broad-based, but strongest in core technology and semiconductors.
- Consumer/retail reversed for `volatility_12w 12w`.
- Momentum and SMA distance signals were more concentrated and reversed in Bear regimes.
- A larger, more balanced universe should make future validation harder to overfit to technology or semiconductor paths.

## Planning-Only Guardrails

- `data/research-universe.json` remains the active 38-symbol research universe.
- `data/research-prices.json` is not refreshed in Phase 6H.
- `data/backtest-prices.json` is not modified.
- Proposed symbols do not appear in live dashboard recommendations.
- Proposed symbols do not appear in the Manual Trade Plan.
- Existing research scripts continue using the active 38-symbol universe unless a later phase explicitly activates the plan.
- PyPortfolioOpt remains deferred.

## Proposed Category Balance

| Category | Before | Proposed After | Rationale |
|:--|--:|--:|:--|
| core_technology | 6 | 10 | Keeps software/platform exposure but caps concentration. |
| semiconductors | 7 | 10 | Preserves chip supply-chain coverage without letting it dominate. |
| consumer_retail | 6 | 10 | Tests whether factors reverse outside technology-heavy groups. |
| defensive_healthcare | 6 | 10 | Adds defensive and healthcare breadth. |
| financial_payments | 5 | 10 | Adds banks, brokers, asset managers, and payments. |
| industrial_diversified | 4 | 10 | Adds aerospace, logistics, defense, and industrial cyclicals. |
| international | 4 | 8 | Broadens non-US exposure without making it too large. |
| energy_materials | 0 | 8 | Adds commodity, energy, chemicals, and metals sensitivity. |
| utilities_real_assets | 0 | 4 | Adds defensive yield and real-asset exposure. |

Total proposed research symbols: 80, excluding reference symbols.

## Proposed Additions

| Category | Proposed Additions |
|:--|:--|
| core_technology | CRM, ORCL, ADBE, NOW |
| semiconductors | TXN, AMAT, LRCX |
| consumer_retail | TGT, LOW, BKNG, CMG |
| defensive_healthcare | ABBV, PFE, TMO, ABT |
| financial_payments | GS, MS, BLK, SCHW, PYPL |
| industrial_diversified | RTX, UPS, LMT, ETN, MMM, BA |
| international | SAP, NVO, SONY, MELI |
| energy_materials | XOM, CVX, COP, LIN, APD, ECL, NEM, FCX |
| utilities_real_assets | NEE, DUK, SO, AMT |

## Validation Helper

Run:

```powershell
python research\plan_universe_expansion.py
```

The helper validates:

- no duplicate symbols
- live portfolio symbols remain unchanged
- reference symbols remain separate
- active research universe remains unchanged
- proposed research universe is around 80 symbols
- category counts before and after match the plan
- technology plus semiconductor concentration remains bounded
- no prices are fetched and no active universe file is modified

## Risk Controls

- The plan file is separate from the active universe file.
- Proposed symbols require review before activation.
- Any future activation must compare 38-symbol and 80-symbol results side by side.
- Larger universe results still require walk-forward, out-of-sample, sector, regime, and transaction-cost validation.
- A larger universe should reduce overfitting risk, but it does not automatically make factors or ML models live-ready.

## Recommended Phase 6I

Only after review:

1. Activate the sector-balanced research universe in a controlled research-only phase.
2. Fetch research-only prices into `data/research-prices.json`.
3. Regenerate research factor reports.
4. Rerun factor validation.
5. Rerun sector/regime breakdown.
6. Compare 38-symbol versus 80-symbol results.

PyPortfolioOpt should remain deferred until factor and regime stability improves under the broader research universe.
