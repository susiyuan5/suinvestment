# Phase 5A Factor Report

Generated at: `2026-06-15T23:37:14.705304+00:00`

This report is research-only. It does not affect live dashboard recommendations, buy amounts, signal scores, multipliers, risk levels, action thresholds, the default Python strategy, or the market regime formula.

## Scope

- Symbols: BYDDY, MSFT, NVDA, AAPL, ASML, KO
- Source: `data/backtest-prices.json` weekly close snapshot
- Excludes QQQ/SPY because Phase 5A is focused on current portfolio symbols, not market-regime proxies.
- ATR is skipped because the current snapshot stores weekly close only, without high/low data.

## Outputs

- `results/phase5/factor_report.csv`: full weekly factor table
- `results/phase5/factor_latest.csv`: latest factor row per symbol
- Rows written: `1572`

## Latest Factors

| ticker   | date       |   close |   weekly_return |   momentum_4w |   momentum_12w |   volatility_12w |   drawdown_from_52w_high |   rsi_14 |       macd |
|:---------|:-----------|--------:|----------------:|--------------:|---------------:|-----------------:|-------------------------:|---------:|-----------:|
| NVDA     | 2026-06-05 |  205.1  |               0 |    -0.089739  |      0.187609  |        0.0486897 |                0.089739  |  56.202  |   8.69527  |
| AAPL     | 2026-06-05 |  307.34 |               0 |     0.0236818 |      0.239324  |        0.0181783 |                0.0151253 |  69.4276 |  13.9678   |
| MSFT     | 2026-06-05 |  416.67 |               0 |    -0.0124431 |      0.0911305 |        0.0583383 |                0.204995  |  47.1687 |  -8.58213  |
| BYDDY    | 2026-06-05 |   11.26 |               0 |    -0.0755337 |     -0.130502  |        0.0492426 |                0.3173    |  39.3176 |  -0.376117 |
| ASML     | 2026-06-05 | 1641.74 |               0 |     0.0931742 |      0.246339  |        0.0569748 |                0         |  68.4087 | 128.937    |
| KO       | 2026-06-05 |   79.48 |               0 |    -0.01658   |      0.0632776 |        0.0174559 |                0.0255026 |  59.0317 |   1.92871  |

## Interpretation Notes

- These factors are candidate research inputs only.
- No factor should be used in live logic until it passes out-of-sample validation.
- The portfolio universe is small, so any apparent factor relationship is preliminary.
- Later phases should validate predictive value with walk-forward tests and factor-specific performance diagnostics.

## Planned Follow-Ups

- Phase 5B: stabilize the research Backtrader comparison workflow.
- Phase 5C: add QuantStats performance reports for sandbox backtests.
- Later Phase 5: add Alphalens factor validation and scikit-learn ML sandbox experiments.
- Phase 6: evaluate PyPortfolioOpt for portfolio construction; it is intentionally not implemented in Phase 5A.
