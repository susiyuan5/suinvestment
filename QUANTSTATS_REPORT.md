# Phase 5C QuantStats Report

Generated at: `2026-06-16T00:03:05.143984+00:00`

QuantStats reports are research-only. They do not affect live dashboard recommendations, buy amounts, signal scores, multipliers, risk levels, action thresholds, the default Python strategy, or the market regime formula.

## Scope

- Source engine: Phase 5B Backtrader sandbox strategy logic
- Portfolio series: six independent ticker equity curves summed by strategy
- Strategies: Fixed Weekly DCA, Simple Dip-Buy, Risk-Adjusted v2
- Reports are for performance diagnosis, not strategy promotion.

## Outputs

- `results/phase5/quantstats/quantstats_summary.csv`
- `results/phase5/quantstats/fixed_weekly_dca_report.html`
- `results/phase5/quantstats/simple_dip_buy_report.html`
- `results/phase5/quantstats/risk_adjusted_v2_report.html`

## HTML Status

- `fixed_weekly_dca`: html_written: C:/Users/Administrator/Documents/fince/results/phase5/quantstats/fixed_weekly_dca_report.html
- `simple_dip_buy`: html_written: C:/Users/Administrator/Documents/fince/results/phase5/quantstats/simple_dip_buy_report.html
- `risk_adjusted_v2`: html_written: C:/Users/Administrator/Documents/fince/results/phase5/quantstats/risk_adjusted_v2_report.html

## Summary Metrics

| strategy | final_value | total_return | CAGR | volatility | Sharpe | Sortino | max_drawdown | Calmar | win_rate |
|:--|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| fixed_weekly_dca | 171663.55 | 1.8611 | 0.2343 | 0.2179 | 1.0710 | 1.6725 | 0.2124 | 1.1030 | 0.5402 |
| simple_dip_buy | 170541.46 | 1.8424 | 0.2327 | 0.2162 | 1.0717 | 1.6670 | 0.2114 | 1.1005 | 0.5402 |
| risk_adjusted_v2 | 168422.88 | 1.8070 | 0.2296 | 0.2156 | 1.0624 | 1.6593 | 0.2102 | 1.0924 | 0.5364 |

## Interpretation Notes

- Higher final value alone is not enough to promote a strategy.
- Results may differ from the existing custom backtest because Backtrader execution assumptions differ.
- QuantStats is used here for diagnostics such as return distribution, drawdown, and risk-adjusted performance.
- No live dashboard behavior changes are justified by this report alone.

## Known Limits

- Weekly close-only data limits path-level and intraperiod drawdown analysis.
- Portfolio equity is reconstructed by summing independent ticker sandbox runs, not by using one combined broker account.
- No Alphalens, scikit-learn, or PyPortfolioOpt work is implemented in Phase 5C.
