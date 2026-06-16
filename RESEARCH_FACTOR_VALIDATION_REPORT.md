# Phase 6D Research Universe Factor Validation Report

Generated at: `2026-06-16T09:27:14.983208+00:00`

This report is research-only. It does not affect live dashboard recommendations, buy amounts, signal scores, multipliers, risk levels, action thresholds, the default Python strategy, or the market regime formula.

## Method

- Uses the Phase 6C research-universe factor table for 38 research symbols.
- QQQ/SPY/DIA/IWM remain market-regime/reference data and are excluded when present.
- Uses an Alphalens-style manual validation with pandas and scipy instead of direct Alphalens integration because the current weekly factor table is compact and does not need Alphalens' full factor/pricing pipeline.
- Calculates forward 1w, 4w, and 12w returns.
- Computes cross-sectional rank IC, Pearson correlation, tercile/quintile returns, long-short spread, and per-symbol robustness diagnostics.

## Outputs

- `results/phase6/research_factor_validation_ic.csv`
- `results/phase6/research_factor_validation_quantiles.csv`
- `results/phase6/research_factor_validation_summary.csv`

## Most Positive Mean Rank IC

| factor | horizon | mean_rank_ic | positive_rate | mean_spread |
|:--|:--|--:|--:|--:|
| volatility_12w | 12w | 0.0769 | 0.6296 | 0.0521 |
| volatility_12w | 4w | 0.0442 | 0.5609 | 0.0178 |
| sma_20_distance | 12w | 0.0428 | 0.5915 | 0.0217 |
| momentum_12w | 12w | 0.0412 | 0.5722 | 0.0235 |
| sma_10_distance | 12w | 0.0358 | 0.5969 | 0.0131 |

## Most Negative Mean Rank IC

| factor | horizon | mean_rank_ic | positive_rate | mean_spread |
|:--|:--|--:|--:|--:|
| weekly_return | 1w | -0.0200 | 0.4657 | -0.0015 |
| macd | 12w | -0.0140 | 0.5107 | -0.0102 |
| drawdown_from_52w_high | 4w | -0.0137 | 0.4731 | 0.0003 |
| momentum_4w | 1w | -0.0055 | 0.4848 | 0.0007 |
| drawdown_from_52w_high | 1w | -0.0044 | 0.4941 | 0.0001 |

## Coverage Issues

- No factor coverage below 90%.

## Phase 5 Comparison

- Compares research-universe mean rank IC against the existing Phase 5 six-symbol validation summary where available.
- Directionally consistent factor/horizon pairs: `24`
- Weakened but same-direction pairs: `21`
- Reversed factor/horizon pairs: `3`

| factor | horizon | live_ic | research_ic | direction |
|:--|:--|--:|--:|:--|
| macd | 12w | -0.1286 | -0.0140 | consistent |
| sma_10_distance | 12w | 0.1215 | 0.0358 | consistent |
| sma_20_distance | 4w | 0.0955 | 0.0334 | consistent |
| sma_10_distance | 4w | 0.0820 | 0.0214 | consistent |
| momentum_4w | 4w | 0.0691 | 0.0134 | consistent |
| rsi_14 | 4w | 0.0836 | 0.0280 | consistent |
| momentum_12w | 4w | 0.0806 | 0.0309 | consistent |
| sma_20_distance | 12w | 0.0879 | 0.0428 | consistent |
| momentum_12w | 12w | 0.0802 | 0.0412 | consistent |
| momentum_4w | 12w | 0.0655 | 0.0273 | consistent |
| drawdown_from_52w_high | 12w | 0.0392 | 0.0024 | consistent |
| macd | 4w | -0.0359 | -0.0038 | consistent |

## Interpretation Notes

- The 38-symbol research universe is broader than Phase 5, but still not a professional-scale universe.
- Factor validation is not enough to promote a strategy.
- Any promising factor requires walk-forward, out-of-sample, regime-specific, ex-sector, and transaction-cost validation before live use.
- Rank IC can be unstable when symbols share sector exposure or the universe is small.
- IC rows written: `15732`
- Quantile rows written: `15705`
