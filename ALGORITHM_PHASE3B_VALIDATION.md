# Algorithm Phase 3B Validation Report

## Executive Summary

- **Simple Dip-Buy is not robustly better than Fixed Weekly DCA on raw account paths.** In true weekly contribution mode, Simple averaged 108.92% per-ticker return versus 112.13% for DCA. In rolling portfolio windows, Simple won 15.38% of return comparisons versus 82.05% for DCA.
- **But DCA's edge is mostly deployment/timing-path driven, not better return per invested dollar.** In equal-total-invested normalization, Simple averaged 115.45% versus 112.13% for DCA and 111.64% for Risk-Adjusted v2.
- **NVDA still matters, but it is not the only cash-deployment artifact.** In the ex-NVDA true-contribution portfolio test, DCA returned 47.45% versus 47.05% for Simple, while Simple had lower drawdown and a slightly better Calmar ratio.
- **Risk-Adjusted v2 remains optional.** Its rolling ticker win-rate averaged 12.39% versus 37.18% for Simple and 52.99% for DCA; it did not show enough broad stress-window advantage to replace the default.
- **The v3 candidate remains sandbox-only.** `s3_min0.5_max2_tv0.1_dd1.3_cd1.4_cs1.1` averaged 30.69% in rolling portfolio validation, but this is not enough to promote it without older data and out-of-sample testing.
- **The live dashboard should remain unchanged.** Phase 3B strengthens the evidence that validation needs to continue before any live or default strategy change.

## Validation Modes Were Kept Separate

Initial cash pool mode uses the existing Python-style cash pool framing. True weekly contribution mode starts with no cash and adds the same weekly amount before each scheduled buy. Equal-total-invested normalization is labeled as a normalized analysis only; it is not a real account path. Rolling walk-forward windows use true weekly contribution mode so conclusions do not depend on one endpoint.

## Full-Period Per-Ticker Averages

| Mode | Strategy | Avg return | Avg max DD | Avg Calmar |
| --- | --- | --- | --- | --- |
| Initial cash pool | enhanced_low_frequency_proxy | 154.24% | 33.16% | 0.49 |
| Initial cash pool | fixed_weekly_dca | 182.20% | 33.16% | 0.52 |
| Initial cash pool | risk_adjusted_v2 | 177.89% | 33.16% | 0.52 |
| Initial cash pool | simple_dip_buy | 180.60% | 33.16% | 0.52 |
| Initial cash pool | v3_sandbox_candidate | 184.40% | 33.16% | 0.52 |
| True weekly contribution | enhanced_low_frequency_proxy | 87.34% | 24.45% | 0.44 |
| True weekly contribution | fixed_weekly_dca | 112.13% | 26.92% | 0.45 |
| True weekly contribution | risk_adjusted_v2 | 105.93% | 26.66% | 0.45 |
| True weekly contribution | simple_dip_buy | 108.92% | 26.54% | 0.46 |
| True weekly contribution | v3_sandbox_candidate | 111.05% | 26.89% | 0.45 |

## Rolling Walk-Forward Win Rates

Rolling windows include 1-year, 2-year, and 3-year windows where the local dataset allows them. This makes the conclusion less dependent on the June 2021 to June 2026 endpoint.

| Level | Strategy | Return win rate | Avg return metric |
| --- | --- | --- | --- |
| portfolio | fixed_weekly_dca | 82.05% | 31.21 |
| portfolio | simple_dip_buy | 15.38% | 29.76 |
| portfolio | risk_adjusted_v2 | 2.56% | 28.96 |

## Equal-Total-Invested Normalization

This is not a real account path. It rescales each strategy to the same invested capital so a strategy cannot win only because it deployed more cash earlier. Under that lens, Simple Dip-Buy looks better than the raw true-contribution account path suggests.

| Strategy | Avg normalized return |
| --- | --- |
| fixed_weekly_dca | 112.13% |
| risk_adjusted_v2 | 111.64% |
| simple_dip_buy | 115.45% |

## Ex-NVDA Check

Removing NVDA narrows the raw-return gap substantially but does not fully reverse it in true weekly contribution mode. The initial cash pool result still slightly favors Simple/Risk-Adjusted, while true contribution still slightly favors DCA. That points to cash deployment and sample path effects, not a clean structural edge for either side.

| Mode | Strategy | Return | Max DD | Calmar |
| --- | --- | --- | --- | --- |
| initial_cash_pool | fixed_weekly_dca | 67.99% | 15.41% | 0.71 |
| initial_cash_pool | simple_dip_buy | 68.42% | 15.11% | 0.72 |
| initial_cash_pool | risk_adjusted_v2 | 68.49% | 15.76% | 0.69 |
| true_weekly_contribution | fixed_weekly_dca | 47.45% | 12.59% | 0.64 |
| true_weekly_contribution | simple_dip_buy | 47.05% | 12.27% | 0.65 |
| true_weekly_contribution | risk_adjusted_v2 | 47.13% | 12.42% | 0.64 |

## V3 Candidate Status

The best Phase 3A parameter candidate is still useful as a sandbox object, but Phase 3B does not make it production-ready. The right next validation is out-of-sample and longer-history testing, not promotion.

| Source | Strategy | Observations | Avg return | Avg DD | Avg Calmar |
| --- | --- | --- | --- | --- | --- |
| initial_cash_pool_full | v3_sandbox_candidate | 1 | 184.40% | 21.29% | 1.09 |
| initial_cash_pool_full | simple_dip_buy | 1 | 180.61% | 21.17% | 1.08 |
| initial_cash_pool_full | fixed_weekly_dca | 1 | 182.20% | 21.26% | 1.08 |
| initial_cash_pool_full | risk_adjusted_v2 | 1 | 177.89% | 21.08% | 1.07 |
| true_weekly_contribution_full | v3_sandbox_candidate | 1 | 111.05% | 18.62% | 0.86 |
| true_weekly_contribution_full | simple_dip_buy | 1 | 108.92% | 18.31% | 0.86 |
| true_weekly_contribution_full | fixed_weekly_dca | 1 | 112.13% | 18.70% | 0.86 |
| true_weekly_contribution_full | risk_adjusted_v2 | 1 | 105.93% | 18.19% | 0.85 |
| rolling_true_weekly_contribution | v3_sandbox_candidate | 39 | 30.69% | 8.55% | 3.11 |
| rolling_true_weekly_contribution | simple_dip_buy | 39 | 29.76% | 8.24% | 3.22 |
| rolling_true_weekly_contribution | fixed_weekly_dca | 39 | 31.21% | 8.64% | 3.09 |
| rolling_true_weekly_contribution | risk_adjusted_v2 | 39 | 28.96% | 8.23% | 3.16 |

## Answers To The Phase 3B Questions

1. Simple Dip-Buy does not robustly beat Fixed Weekly DCA on raw account paths, but it does look better after equal-total-invested normalization.
2. Fixed DCA's advantage is partly NVDA path dependency and partly broader cash-deployment drag from timing rules that underinvest during persistent uptrends.
3. Risk-Adjusted v2 does not add enough broad stress-window value to become default.
4. The v3 candidate is worth further sandbox testing only.
5. The live dashboard algorithm should remain unchanged.

## Outputs

- `results/phase3b_validation/initial_cash_pool_summary.csv`
- `results/phase3b_validation/true_contribution_summary.csv`
- `results/phase3b_validation/equal_invested_summary.csv`
- `results/phase3b_validation/rolling_walk_forward.csv`
- `results/phase3b_validation/ex_nvda_portfolio_summary.csv`
- `results/phase3b_validation/strategy_win_rates.csv`
- `results/phase3b_validation/v3_candidate_robustness.csv`
