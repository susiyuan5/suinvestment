# Algorithm Phase 3C Hybrid Validation Report

## Executive Summary

- **Hybrid DCA + Dip Tilt improved cash deployment but did not consistently beat Fixed Weekly DCA in rolling portfolio return win rate.** The best hybrid by rolling portfolio return win rate was `trend_aware_hybrid` at 30.77% versus 53.85% for Fixed Weekly DCA, with an average rolling portfolio return margin of -0.04 percentage points versus DCA.
- **Hybrid did not fully preserve Simple Dip-Buy's equal-invested edge.** Full-period per-ticker equal-invested returns averaged 115.45% for Simple Dip-Buy versus 113.01% for the best hybrid.
- **Hybrid reduced underinvestment during uptrends.** Simple Dip-Buy left 2.08% of contributed cash idle on average, while `trend_aware_hybrid` left 0.01%, a reduction of 2.07 percentage points.
- **The hybrid result is not NVDA-only, but it is also not clearly superior ex-NVDA.** Excluding NVDA, `trend_aware_hybrid` returned 47.45% versus 47.45% for DCA, a margin of 0.00 percentage points.
- **Risk-Adjusted v2 still does not solve the stress-window problem.** In the weakest DCA rolling windows it had slightly lower drawdown than DCA, but also lower average stress return and no broad win-rate advantage.
- **No hybrid should be promoted to default or live recommendation logic.** The candidates are worth keeping in sandbox validation, especially for longer-history out-of-sample testing, but Phase 3C is not enough evidence to change production behavior.

## Validation Scope

All Phase 3C simulations use true weekly contribution mode: each ticker receives the same new weekly cash amount before the buy decision. Equal-total-invested rows are normalized analysis only and are not real account paths. Portfolio rows use equal ticker funding and the same dates, weekly schedule, fees, slippage, rounding, and cash handling as the ticker rows.

## Full-Period True Contribution Averages

| Strategy | Avg ticker return | Portfolio return | Avg DD | Avg cash left |
| --- | --- | --- | --- | --- |
| fixed_weekly_dca | 112.13% | 112.13% | 26.92% | 0.00% |
| simple_dip_buy | 108.92% | 108.92% | 26.54% | 2.08% |
| risk_adjusted_v2 | 105.93% | 105.93% | 26.66% | 1.24% |
| hybrid_70_30 | 111.19% | 111.19% | 26.82% | 0.57% |
| hybrid_80_20 | 111.52% | 111.52% | 26.85% | 0.35% |
| trend_aware_hybrid | 112.13% | 112.13% | 26.92% | 0.01% |

## Equal-Total-Invested Normalization

This section rescales each strategy to the same invested capital. It answers buy-point quality per invested dollar, not real account wealth.

| Strategy | Full ticker normalized return | Rolling portfolio normalized return |
| --- | --- | --- |
| fixed_weekly_dca | 112.13% | 31.21% |
| simple_dip_buy | 115.45% | 33.38% |
| risk_adjusted_v2 | 111.64% | 31.92% |
| hybrid_70_30 | 113.01% | 31.79% |
| hybrid_80_20 | 112.67% | 31.57% |
| trend_aware_hybrid | 112.14% | 31.23% |

## Rolling Walk-Forward Win Rates

Rolling windows include 1-year, 2-year, and 3-year true-contribution windows where the local dataset allows them. These results avoid relying on one June 2026 endpoint.

| Strategy | Return win rate | Calmar win rate |
| --- | --- | --- |
| fixed_weekly_dca | 53.85% | 17.95% |
| simple_dip_buy | 15.38% | 69.23% |
| risk_adjusted_v2 | 2.56% | 7.69% |
| hybrid_70_30 | 0.00% | 0.00% |
| hybrid_80_20 | 0.00% | 0.00% |
| trend_aware_hybrid | 30.77% | 12.82% |

## Ex-NVDA Portfolio Check

| Strategy | Return | Max DD | Calmar | Cash left |
| --- | --- | --- | --- | --- |
| fixed_weekly_dca | 47.45% | 12.59% | 0.64 | 0.00% |
| simple_dip_buy | 47.05% | 12.27% | 0.65 | 1.53% |
| risk_adjusted_v2 | 47.13% | 12.42% | 0.64 | 0.31% |
| hybrid_70_30 | 47.35% | 12.50% | 0.64 | 0.40% |
| hybrid_80_20 | 47.39% | 12.53% | 0.64 | 0.24% |
| trend_aware_hybrid | 47.45% | 12.57% | 0.64 | 0.01% |

## Stress-Window Read

The table below averages the ten weakest rolling portfolio windows based on Fixed Weekly DCA return. It checks whether Risk-Adjusted v2 or a hybrid candidate adds value when the baseline path is under stress.

| Strategy | Avg stress return | Avg stress DD | Avg stress Calmar |
| --- | --- | --- | --- |
| fixed_weekly_dca | 4.04% | 5.48% | 2.05 |
| simple_dip_buy | 3.95% | 5.20% | 2.31 |
| risk_adjusted_v2 | 3.88% | 5.16% | 2.18 |
| hybrid_70_30 | 4.01% | 5.40% | 2.12 |
| hybrid_80_20 | 4.02% | 5.43% | 2.09 |
| trend_aware_hybrid | 4.02% | 5.46% | 2.05 |

## Candidate Robustness

| Source | Strategy | Obs | Avg return | Avg normalized | Avg DD | Cash left | Return win |
| --- | --- | --- | --- | --- | --- | --- | --- |
| full_period_portfolio_true_contribution | fixed_weekly_dca | 1 | 112.13% | 112.13% | 18.70% | 0.00% |  |
| full_period_portfolio_true_contribution | simple_dip_buy | 1 | 108.92% | 113.36% | 18.31% | 2.08% |  |
| full_period_portfolio_true_contribution | risk_adjusted_v2 | 1 | 105.93% | 108.52% | 18.19% | 1.24% |  |
| full_period_portfolio_true_contribution | hybrid_70_30 | 1 | 111.19% | 112.40% | 18.59% | 0.57% |  |
| full_period_portfolio_true_contribution | hybrid_80_20 | 1 | 111.52% | 112.27% | 18.63% | 0.35% |  |
| full_period_portfolio_true_contribution | trend_aware_hybrid | 1 | 112.13% | 112.14% | 18.70% | 0.01% |  |
| rolling_portfolio_true_contribution | fixed_weekly_dca | 39 | 31.21% | 31.21% | 8.64% | 0.00% | 53.85% |
| rolling_portfolio_true_contribution | simple_dip_buy | 39 | 29.76% | 33.38% | 8.24% | 2.68% | 15.38% |
| rolling_portfolio_true_contribution | risk_adjusted_v2 | 39 | 28.96% | 31.92% | 8.23% | 2.23% | 2.56% |
| rolling_portfolio_true_contribution | hybrid_70_30 | 39 | 30.79% | 31.79% | 8.52% | 0.76% | 0.00% |
| rolling_portfolio_true_contribution | hybrid_80_20 | 39 | 30.93% | 31.57% | 8.56% | 0.48% | 0.00% |
| rolling_portfolio_true_contribution | trend_aware_hybrid | 39 | 31.17% | 31.23% | 8.62% | 0.05% | 30.77% |

## Answers To The Phase 3C Questions

1. Hybrid DCA + Dip Tilt does not yet outperform Fixed Weekly DCA more consistently; `trend_aware_hybrid` improved deployment but its rolling portfolio return win rate stayed below DCA.
2. Hybrid does not fully preserve Simple Dip-Buy's equal-invested advantage; the fixed baseline dilutes some buy-point selectivity.
3. Hybrid reduces underinvestment during uptrends by keeping a fixed weekly allocation and using the tilt only for the variable portion.
4. Hybrid performance is not purely NVDA path dependency, but the ex-NVDA portfolio still does not provide enough evidence for promotion.
5. `trend_aware_hybrid` is the only hybrid worth later sandbox UI display consideration, and only with an experimental label; it is not strong enough for default/live use.
6. The live dashboard should remain unchanged.

## Outputs

- `results/phase3c_hybrid/hybrid_true_contribution_summary.csv`
- `results/phase3c_hybrid/hybrid_equal_invested_summary.csv`
- `results/phase3c_hybrid/hybrid_rolling_walk_forward.csv`
- `results/phase3c_hybrid/hybrid_ex_nvda_summary.csv`
- `results/phase3c_hybrid/hybrid_strategy_win_rates.csv`
- `results/phase3c_hybrid/hybrid_candidate_robustness.csv`
