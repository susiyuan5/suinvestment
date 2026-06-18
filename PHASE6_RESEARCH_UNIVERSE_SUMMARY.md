# Phase 6 Research Universe Summary

Phase 6 expanded the research universe, not the live portfolio. It created a separate data and validation path for broader factor and ML research while leaving live dashboard recommendations unchanged.

## Scope

- Live Portfolio remains 6 symbols: BYDDY, MSFT, NVDA, AAPL, ASML, KO.
- Research Universe contains 38 symbols for research and validation only.
- Reference symbols are QQQ, SPY, DIA, and IWM.
- Research symbols do not appear in the Manual Trade Plan.
- Research data is stored separately in `data/research-prices.json`.
- Live/backtest data remains `data/backtest-prices.json`.
- No Phase 6 result changes buy amounts, signal scores, multipliers, risk levels, action thresholds, market regime formula, or the default Python strategy.

## Phase Map

| Phase | Component | Main Output | Live Impact |
|:--|:--|:--|:--|
| 6A | Research universe scaffold | `data/research-universe.json` | None |
| 6B | Research-only historical prices | `data/research-prices.json` | None |
| 6C | Research factor report mode | `results/phase6/research_factor_report.csv` | None |
| 6D | Research factor validation | `results/phase6/research_factor_validation_summary.csv` | None |
| 6E | Research ML sandbox | `results/phase6/ml/` | None |

## Phase 6B Data Expansion

- Requested research symbols: 38
- Requested total with references: 42
- Successful symbols: 42
- Failed symbols: 0
- Symbols with fewer than 50 weekly rows: 0
- Latest date range: 2026-06-12 to 2026-06-15
- First date range: 2015-01-02 to 2015-01-02
- `data/backtest-prices.json` was unchanged.

## Phase 6C Factor Report

- Live factor report rows: 1572
- Live latest rows: 6
- Research factor report rows: 22728
- Research latest rows: 38
- Reference symbols QQQ/SPY/DIA/IWM are excluded from the research trade-factor table.

## Phase 6D Factor Validation

- Research validation IC rows: 15732
- Research validation quantile rows: 15705
- Research validation summary rows: 27

Most positive research-universe mean rank IC:

| Factor | Horizon | Mean Rank IC |
|:--|:--|--:|
| volatility_12w | 12w | 0.07685093 |
| volatility_12w | 4w | 0.04424703 |
| sma_20_distance | 12w | 0.04280623 |
| momentum_12w | 12w | 0.04121375 |
| sma_10_distance | 12w | 0.03579331 |

Most negative research-universe mean rank IC:

| Factor | Horizon | Mean Rank IC |
|:--|:--|--:|
| weekly_return | 1w | -0.02003089 |
| macd | 12w | -0.01401268 |
| drawdown_from_52w_high | 4w | -0.01372722 |
| momentum_4w | 1w | -0.00546589 |
| drawdown_from_52w_high | 1w | -0.00436006 |

Versus Phase 5 six-symbol validation:

- 24 factor/horizon pairs stayed directionally consistent.
- 21 weakened while staying same direction.
- 3 reversed: weekly_return 4w, drawdown_from_52w_high 1w, and macd 1w.

Interpretation: expanding from 6 to 38 symbols made the validation more meaningful, but factor signals remain modest and require more testing.

## Phase 6E ML Sandbox

- Live ML regression rows: 9
- Live ML classification rows: 6
- Live ML feature importance rows: 150
- Live ML predictions rows: 4176
- Research ML regression rows: 9
- Research ML classification rows: 6
- Research ML feature importance rows: 470
- Research ML predictions rows: 64128
- Train range: 2015-01-02 to 2024-03-01
- Test range: 2024-03-08 to 2026-06-12

Best research regression:

- Model: baseline_mean
- Target: forward_1w_return
- RMSE: 0.04897514
- MAE: 0.03411983
- R2: -0.00038217
- Spearman: 0.0

Best research classification:

- Model: logistic_regression
- Target: forward_12w_positive
- Balanced accuracy: 0.53779906
- ROC AUC: 0.53544648
- Accuracy: 0.53292383

Some models beat baselines on selected 4w/12w targets, but there was no clear improvement versus Phase 5 live-portfolio ML. ML remains too weak for live promotion.

## Main Conclusion

Phase 6 improved research coverage and made factor validation more credible, but it did not produce evidence strong enough to influence live recommendations.

- The 38-symbol universe is better than the prior 6-symbol research path, but still limited.
- Factor IC results are directionally useful in places, but modest.
- ML did not become strong enough after expanding the universe.
- No Phase 6 result should affect live dashboard recommendations.
- The current live dashboard should remain unchanged.

## Promotion Position

No Phase 6 factor, ML result, or research output is ready for live use. Before any research output can influence recommendations, it must pass:

- Walk-forward validation
- Out-of-sample validation
- Regime-specific testing
- Sector/category concentration checks
- Ex-sector and single-name dependency checks
- Transaction cost and slippage testing
- Stability across future data refreshes
- Human review

## Recommended Next Direction

Option A, recommended next: Phase 6G sector/regime breakdown.

- Test factors by sector/category.
- Test factors by Bull/Neutral/Correction/Bear market regime.
- Check whether volatility and momentum signals are concentrated in technology or semiconductors.

Option B: Phase 6H expand universe to roughly 80 symbols, but only after the 38-symbol pipeline remains stable.

Option C: Phase 7 PyPortfolioOpt. Keep it deferred until factor and regime stability are stronger, and start with research-only mode when it is eventually introduced.
