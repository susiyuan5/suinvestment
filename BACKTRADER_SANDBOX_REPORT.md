# Phase 5B Backtrader Sandbox Report

Generated at: `2026-06-15T23:48:35.843386+00:00`

Backtrader is research-only in this project. These results do not affect live dashboard recommendations, buy amounts, signal scores, multipliers, risk levels, action thresholds, the default Python strategy, or the market regime formula.

## Scope

- Symbols: BYDDY, MSFT, NVDA, AAPL, ASML, KO
- Source: `data/backtest-prices.json` weekly close data
- Engine: Backtrader sandbox
- Strategies: Fixed Weekly DCA, Simple Dip-Buy, Risk-Adjusted v2

## Assumptions

- Starting cash per ticker: `10000.0`
- Weekly budget per ticker: `100.0`
- Commission rate: `0.001`
- Slippage rate: `0.0005`
- Model: initial cash pool, not new weekly cash contributions
- Weekly execution timing: submitted on weekly bar using close-style sandbox execution
- Fractional shares: `True`
- Portfolio row is an aggregate of six independent single-symbol runs, not a combined broker account.

## Outputs

- `results/phase5/backtrader_summary.csv`
- `results/phase5/backtrader_trades.csv`

## Portfolio Aggregate

| strategy | final_value | total_return | annualized_return | max_drawdown | total_invested | orders |
|:--|--:|--:|--:|--:|--:|--:|
| fixed_weekly_dca | 171663.55 | 1.8611 | 0.1773 | 0.3315 | 60000.00 | 1566 |
| simple_dip_buy | 170541.46 | 1.8424 | 0.1770 | 0.3315 | 60000.00 | 1566 |
| risk_adjusted_v2 | 168422.88 | 1.8070 | 0.1759 | 0.3316 | 60000.00 | 1566 |

## Interpretation

- Backtrader is used here as a standardized sandbox engine, not as a live or default engine.
- Differences versus `backtest.py` may come from Backtrader broker accounting, order timing, cash handling, slippage handling, commission handling, and fractional-share treatment.
- This run should not be interpreted as a promotion decision for any strategy.
- Later phases can use Backtrader for more standardized rolling windows, contribution-mode tests, and report generation.

## Current Limits

- Uses close-only weekly data; no intraday or high/low path is available.
- Portfolio aggregate is a simple sum/average across independent ticker runs.
- Does not use QuantStats, Alphalens, scikit-learn, or PyPortfolioOpt in Phase 5B.
- Trade rows written: `4698`
