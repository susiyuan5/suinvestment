# Sector and Market-Regime Breakdown Report

Generated at: `2026-06-18T11:16:54.718674+00:00`

This report is research-only. It does not affect live dashboard recommendations, buy amounts, signal scores, multipliers, risk levels, action thresholds, the default Python strategy, or the market regime formula.

## Method

- Uses `results/phase6/research_factor_report.csv` for the 38-symbol research universe.
- Uses category metadata in `data/research-universe.json`.
- Excludes reference symbols QQQ/SPY/DIA/IWM from trade-factor IC calculations.
- Reconstructs a simple QQQ-based research-only regime from `data/research-prices.json`.
- The research-only regime is for diagnostics and does not change the live market regime formula.

## Outputs

- `results/phase6/sector_regime_factor_ic.csv`
- `results/phase6/sector_factor_summary.csv`
- `results/phase6/regime_factor_summary.csv`

## Research Regime Mix

- `Bear`: `40` QQQ weekly observations
- `Bull`: `426` QQQ weekly observations
- `Correction`: `114` QQQ weekly observations
- `Neutral`: `19` QQQ weekly observations

## Strongest Sector/Category Results

| group | factor | horizon | mean_rank_ic | periods | direction_vs_overall |
|:--|:--|:--|--:|--:|:--|
| core_technology | volatility_12w | 12w | 0.1837 | 574 | same_direction_stronger |
| core_technology | volatility_12w | 4w | 0.1141 | 582 | same_direction_stronger |
| international | macd | 12w | 0.1094 | 561 | reversed |
| core_technology | sma_20_distance | 12w | 0.0940 | 567 | same_direction_stronger |
| semiconductors | volatility_12w | 12w | 0.0918 | 574 | same_direction_stronger |
| core_technology | momentum_12w | 12w | 0.0878 | 574 | same_direction_stronger |
| industrial_diversified | volatility_12w | 12w | 0.0819 | 574 | same_direction_stronger |
| international | sma_10_distance | 4w | 0.0797 | 585 | same_direction_stronger |

## Weakest or Reversed Sector/Category Results

| group | factor | horizon | mean_rank_ic | periods | direction_vs_overall |
|:--|:--|:--|--:|--:|:--|
| core_technology | macd | 12w | -0.1183 | 561 | same_direction_stronger |
| consumer_retail | volatility_12w | 12w | -0.0849 | 574 | reversed |
| core_technology | macd | 4w | -0.0820 | 569 | same_direction_stronger |
| consumer_retail | weekly_return | 1w | -0.0787 | 596 | same_direction_stronger |
| defensive_healthcare | sma_10_distance | 4w | -0.0717 | 585 | reversed |
| international | drawdown_from_52w_high | 4w | -0.0671 | 593 | same_direction_stronger |
| industrial_diversified | drawdown_from_52w_high | 4w | -0.0542 | 592 | same_direction_stronger |
| consumer_retail | macd | 12w | -0.0529 | 561 | same_direction_stronger |

## Strongest Regime Results

| group | factor | horizon | mean_rank_ic | periods | direction_vs_overall |
|:--|:--|:--|--:|--:|:--|
| Bear | drawdown_from_52w_high | 12w | 0.2324 | 40 | same_direction_stronger |
| Bear | volatility_12w | 12w | 0.2324 | 40 | same_direction_stronger |
| Neutral | rsi_14 | 12w | 0.1912 | 6 | same_direction_stronger |
| Neutral | momentum_12w | 12w | 0.1768 | 7 | same_direction_stronger |
| Neutral | volatility_12w | 4w | 0.1554 | 7 | same_direction_stronger |
| Bear | volatility_12w | 4w | 0.1537 | 40 | same_direction_stronger |
| Bear | drawdown_from_52w_high | 4w | 0.1416 | 40 | reversed |
| Neutral | sma_10_distance | 12w | 0.1010 | 10 | same_direction_stronger |

## Weakest or Reversed Regime Results

| group | factor | horizon | mean_rank_ic | periods | direction_vs_overall |
|:--|:--|:--|--:|--:|:--|
| Bear | rsi_14 | 12w | -0.2287 | 40 | reversed |
| Bear | sma_20_distance | 12w | -0.2118 | 40 | reversed |
| Bear | momentum_12w | 12w | -0.1988 | 40 | reversed |
| Bear | macd | 12w | -0.1963 | 40 | same_direction_stronger |
| Bear | sma_10_distance | 12w | -0.1452 | 40 | reversed |
| Neutral | drawdown_from_52w_high | 12w | -0.1378 | 18 | reversed |
| Bear | rsi_14 | 4w | -0.1359 | 40 | reversed |
| Neutral | rsi_14 | 1w | -0.1302 | 6 | reversed |

## Concentration Notes

- volatility_12w 12w: 6/7 category groups are positive; strongest is core_technology (0.1837), weakest is consumer_retail (-0.0849), reversed groups: 1
- momentum_12w 12w: 3/7 category groups are positive; strongest is core_technology (0.0878), weakest is consumer_retail (-0.0285), reversed groups: 4
- sma_20_distance 12w: 4/7 category groups are positive; strongest is core_technology (0.0940), weakest is consumer_retail (-0.0278), reversed groups: 3
- volatility_12w by regime: 3/4 regime groups are positive; strongest is Bear (0.2324), weakest is Neutral (-0.0918), reversed groups: 1

## Interpretation Notes

- Sector/category results may be noisy because some groups are small.
- Regime results may be noisy if one regime dominates the sample.
- A factor should not be promoted unless it is stable across sectors, regimes, out-of-sample windows, and transaction-cost assumptions.
- This phase does not add research symbols to the dashboard or Manual Trade Plan.
- PyPortfolioOpt remains deferred.
