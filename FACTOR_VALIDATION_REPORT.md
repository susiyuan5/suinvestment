# Phase 5D Factor Validation Report

Generated at: `2026-06-16T00:03:27.229144+00:00`

This report is research-only. It does not affect live dashboard recommendations, buy amounts, signal scores, multipliers, risk levels, action thresholds, the default Python strategy, or the market regime formula.

## Method

- Uses the Phase 5A factor table for BYDDY, MSFT, NVDA, AAPL, ASML, and KO only.
- QQQ/SPY remain market-regime/reference data and are excluded.
- Uses an Alphalens-style manual validation with pandas and scipy instead of direct Alphalens integration because the universe is only six weekly symbols and the current data shape is simpler than Alphalens' preferred factor/pricing pipeline.
- Calculates forward 1w, 4w, and 12w returns.
- Computes cross-sectional rank IC, Pearson correlation, tercile returns, long-short spread, and per-symbol robustness diagnostics.

## Outputs

- `results/phase5/factor_validation_ic.csv`
- `results/phase5/factor_validation_quantiles.csv`
- `results/phase5/factor_validation_summary.csv`

## Most Positive Mean Rank IC

| factor | horizon | mean_rank_ic | positive_rate | mean_spread |
|:--|:--|--:|--:|--:|
| sma_10_distance | 12w | 0.1215 | 0.6058 | 0.0330 |
| sma_20_distance | 4w | 0.0955 | 0.5774 | 0.0197 |
| volatility_12w | 12w | 0.0920 | 0.6218 | 0.0527 |
| sma_20_distance | 12w | 0.0879 | 0.5584 | 0.0308 |
| rsi_14 | 4w | 0.0836 | 0.5592 | 0.0192 |

## Most Negative Mean Rank IC

| factor | horizon | mean_rank_ic | positive_rate | mean_spread |
|:--|:--|--:|--:|--:|
| macd | 12w | -0.1286 | 0.3867 | -0.0228 |
| macd | 4w | -0.0359 | 0.4721 | -0.0002 |
| weekly_return | 1w | -0.0158 | 0.4903 | 0.0008 |
| macd | 1w | -0.0130 | 0.4681 | 0.0020 |
| momentum_4w | 1w | -0.0065 | 0.5078 | 0.0023 |

## Coverage Issues

- No factor coverage below 90%.

## Interpretation Notes

- The stock universe is very small, so IC and quantile results are preliminary.
- Factor validation is not enough to promote a strategy.
- Any promising factor requires walk-forward and out-of-sample validation before live use.
- Rank IC can be unstable with only six symbols per week.
- IC rows written: `6624`
- Quantile rows written: `6630`
