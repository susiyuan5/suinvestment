# Algorithm Phase 3A Stress-Test Report

## Executive Summary

- **Do not change the Python default yet.** Across full available ticker histories, Simple Dip-Buy averaged 180.60% total return with 33.16% average max drawdown; Risk-Adjusted v2 averaged 177.89% total return with 33.16% average max drawdown, so v2 does not justify replacing the default.
- **Risk-Adjusted v2 shows limited standalone value in the available stress windows.** In detected drawdown/high-volatility windows, it averaged 18.11% return versus 19.55% for Simple Dip-Buy, while drawdown and volatility stayed very close.
- **The timing edge is not proven yet.** Fixed Weekly DCA averaged 182.20% over the full period, slightly above Simple Dip-Buy, while the enhanced low-frequency proxy averaged 154.24%. That is a reason to keep validating, not to promote a new live algorithm.
- **A v3 candidate is worth sandbox testing, not promotion.** The top balanced candidate is `s3_min0.5_max2_tv0.1_dd1.3_cd1.4_cs1.1` with score 0.357821; the current v2-like parameter set `s4_min0.3_max2_tv0.07_dd1.1_cd1.2_cs1.3` ranked 770 of 1458. The top cluster still needs walk-forward testing before any default or live recommendation changes.

## Evidence From Current Strategies

The table below averages per-ticker results for the full available local dataset. All strategies use the Python cash, risk, and execution model for comparability; the enhanced low-frequency row is a Python proxy of the dashboard backtest multiplier, not a change to the dashboard.

| Strategy | Avg return | Avg CAGR | Avg max DD | Avg vol | Avg Sharpe | Avg Calmar | Avg buys | Avg cash left |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fixed_weekly_dca | 182.20% | 17.29% | 33.16% | 26.87% | 0.66 | 0.52 | 160.8 | 0.00 |
| simple_dip_buy | 180.60% | 17.26% | 33.16% | 26.76% | 0.66 | 0.52 | 163.3 | 0.00 |
| risk_adjusted_v2 | 177.89% | 17.18% | 33.16% | 26.93% | 0.66 | 0.52 | 160.8 | 0.00 |
| enhanced_low_frequency_proxy | 154.24% | 16.19% | 33.16% | 25.77% | 0.65 | 0.49 | 178.5 | 0.00 |

## Stress Windows Do Not Yet Justify a Default Change

Detected drawdown and high-volatility windows are the best available local stress regimes. The current dataset begins in June 2021, so it captures the 2022 drawdown and later ticker-specific volatility, but it does not include the 2020 crash or older cycles.

| Strategy | Stress avg return | Stress avg max DD | Stress avg vol | Stress avg Calmar | Stress avg cash usage |
| --- | --- | --- | --- | --- | --- |
| fixed_weekly_dca | 19.68% | 18.12% | 16.22% | 0.68 | 88.62% |
| simple_dip_buy | 19.55% | 17.83% | 16.05% | 0.69 | 87.43% |
| risk_adjusted_v2 | 18.11% | 17.88% | 15.93% | 0.68 | 86.47% |
| enhanced_low_frequency_proxy | 15.20% | 15.98% | 13.92% | 0.64 | 78.85% |

## Phase 3A.1 Audit Of Fixed DCA Outperformance

**The comparison is fair inside the Python backtest harness, with one naming caveat.** Simple Dip-Buy, Risk-Adjusted v2, Fixed Weekly DCA, and the enhanced proxy use the same six tickers, the same detected window dates per ticker/window, the same `initial_cash = 10000`, the same `base_buy_amount = 100`, the same commission and slippage settings, the same cash cap, and the same drawdown risk rule. The caveat is that `fixed_weekly_dca` is not a true external-contribution DCA model; it is a fixed 1x deployment rule spending down the same initial cash pool as the other Python strategies.

**The DCA edge is narrow and sample-dependent, not robust.** On the full available period, Fixed DCA beat Simple Dip-Buy by 1.60 percentage points on average, but the median ticker-level difference was -0.07 points and DCA won only 2 of 6 tickers. Excluding NVDA, Fixed DCA underperformed Simple Dip-Buy by 0.43 points on average. In the detected major drawdown windows, Fixed DCA also slightly trailed Simple Dip-Buy by 0.19 points on average.

**The main driver is NVDA path dependence.** NVDA rose about 117.5% over the first 104 weekly observations. Fixed DCA deployed more cash during that early high-growth phase, investing about 7,958 versus 7,526 for Simple Dip-Buy by week 104, and ended with more shares at a slightly lower average buy price. That explains most of the full-period DCA advantage. For ASML, BYDDY, and KO, Simple Dip-Buy did better; MSFT was effectively tied.

**Next tests should separate strategy quality from cash-timing artifacts.** Phase 3B should add a true weekly-contribution model, an equal-total-invested normalization, longer pre-2021 history, rolling walk-forward windows, and per-ticker attribution that reports when dip-buy underinvests during persistent uptrends. Until then, the DCA result should be treated as evidence that the timing edge is unproven, not evidence that Fixed DCA is structurally superior.

## Parameter Sensitivity Points To Candidates, Not Conclusions

The balanced score rewards return and Calmar, penalizes max drawdown and volatility, includes a cash-deployment penalty, and penalizes uneven performance across tickers. It intentionally avoids selecting only the highest-return setting. The top rows are a cluster rather than a single decisive answer, which means some stress caps did not activate often enough in this dataset to separate cleanly.

| Rank | Parameter set | Score | Avg return | Avg DD | Avg vol | Avg Calmar | Cash usage | Ticker stddev |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | s3_min0.5_max2_tv0.1_dd1.3_cd1.4_cs1.1 | 0.358 | 75.02% | 23.44% | 20.21% | 0.64 | 93.24% | 106.73% |
| 2 | s3_min0.5_max2_tv0.1_dd1.3_cd1.4_cs1.3 | 0.358 | 75.02% | 23.44% | 20.21% | 0.64 | 93.24% | 106.73% |
| 3 | s3_min0.5_max2_tv0.1_dd1.3_cd1.4_cs1.5 | 0.358 | 75.02% | 23.44% | 20.21% | 0.64 | 93.24% | 106.73% |
| 4 | s3_min0.5_max2.4_tv0.1_dd1.3_cd1.4_cs1.1 | 0.358 | 75.02% | 23.44% | 20.21% | 0.64 | 93.24% | 106.73% |
| 5 | s3_min0.5_max2.4_tv0.1_dd1.3_cd1.4_cs1.3 | 0.358 | 75.02% | 23.44% | 20.21% | 0.64 | 93.24% | 106.73% |

## Recommendation

1. Keep Simple Dip-Buy as the Python default for now because Phase 3A does not support replacing it with Risk-Adjusted v2. Separately, continue comparing it against Fixed DCA and the enhanced proxy because the local sample does not prove a durable timing edge.
2. Keep Risk-Adjusted v2 optional. It remains useful as a conservative safety variant, but Phase 3A does not show enough drawdown reduction to justify making it default.
3. Treat the top v3 candidate as a sandbox candidate for deeper walk-forward testing. Do not port it to live recommendations yet.
4. Add older market data before making a Phase 3B decision. The current local file has six tickers from June 2021 to June 2026 only.

## Caveats And Assumptions

- Source data: `data/backtest-prices.json` with 6 tickers: NVDA, MSFT, AAPL, ASML, KO, BYDDY.
- The enhanced low-frequency strategy is represented as a Python proxy of the dashboard backtest multiplier under Python cash, risk, and execution constraints; dashboard UI and live recommendation logic were not changed.
- Worst period is a rolling four-week portfolio-value period, used as a worst-month proxy.
- Calmar ratio is annualized return divided by max drawdown. Values can be unstable for short windows.
- Parameter sensitivity uses detected full, major-drawdown, and high-volatility windows; it is a validation screen, not an optimizer for deployment.

## Outputs

- Stress summary CSV: `results/phase3a_stress/stress_test_summary.csv`
- Parameter sensitivity CSV: `results/phase3a_stress/parameter_sensitivity.csv`
- Ranked parameter CSV: `results/phase3a_stress/parameter_sensitivity_ranked.csv`
