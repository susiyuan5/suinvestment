# Phase 5 Research Summary

Phase 5 built a research-only stack around factors, sandbox backtesting, performance diagnostics, factor validation, and ML experiments. None of these components changes live dashboard recommendations, buy amounts, signal scores, multipliers, risk levels, action thresholds, the default Python strategy, or the market regime formula.

Current recommendation: keep all Phase 5 outputs research-only. No factor, Backtrader result, QuantStats metric, or ML prediction is ready for live promotion.

## Component Map

| Phase | Component | Script | Main outputs | Live impact |
|:--|:--|:--|:--|:--|
| 5A | pandas-ta-classic factor report | `research/factor_report.py` | `FACTOR_REPORT.md`, `results/phase5/factor_report.csv`, `results/phase5/factor_latest.csv` | None |
| 5B | Backtrader sandbox | `research/backtrader_sandbox.py` | `BACKTRADER_SANDBOX_REPORT.md`, `backtrader_summary.csv`, `backtrader_trades.csv` | None |
| 5C | QuantStats diagnostics | `research/quantstats_report.py` | `QUANTSTATS_REPORT.md`, `results/phase5/quantstats/` | None |
| 5D | Alphalens-style factor validation | `research/factor_validation.py` | `FACTOR_VALIDATION_REPORT.md`, factor validation CSVs | None |
| 5E | scikit-learn ML sandbox | `research/ml_sandbox.py` | `ML_SANDBOX_REPORT.md`, ML result CSVs | None |

## Phase 5A Factor Report

The factor table was generated for 6 portfolio symbols: BYDDY, MSFT, NVDA, AAPL, ASML, and KO. QQQ/SPY remain market-regime/reference data and are excluded from the trade factor table.

ATR was skipped because the current weekly snapshot stores close prices only and does not include high/low data. The factor report is research-only and requires validation before any strategy use.

## Phase 5B Backtrader Sandbox

Backtrader compared Fixed Weekly DCA, Simple Dip-Buy, and Risk-Adjusted v2 using the existing weekly close history.

Portfolio aggregate final values:

| Strategy | Final value |
|:--|--:|
| Fixed Weekly DCA | 171663.549586 |
| Simple Dip-Buy | 170541.45914 |
| Risk-Adjusted v2 | 168422.876969 |

Differences versus the existing custom `backtest.py` may come from order timing, cash handling, broker accounting, commission/slippage handling, and fractional-share assumptions. These results are not a promotion decision.

## Phase 5C QuantStats

QuantStats provided diagnostic performance summaries for the Backtrader sandbox equity series.

| Strategy | CAGR | Sharpe | Max drawdown |
|:--|--:|--:|--:|
| Fixed Weekly DCA | 0.23429224 | 1.07101176 | 0.21241087 |
| Simple Dip-Buy | 0.2326724 | 1.07166732 | 0.21142 |
| Risk-Adjusted v2 | 0.22959066 | 1.06236707 | 0.21016776 |

Final value alone is not enough to promote a strategy. The diagnostics are useful, but the evidence still comes from a small universe and one data window.

## Phase 5D Factor Validation

Factor validation used manual Alphalens-style diagnostics with pandas and scipy. Direct Alphalens integration was not forced because the universe is only six weekly symbols.

Most positive mean rank IC:

| Factor | Horizon | Mean rank IC |
|:--|:--|--:|
| `sma_10_distance` | 12w | 0.12151749 |
| `sma_20_distance` | 4w | 0.09551704 |
| `volatility_12w` | 12w | 0.09195678 |
| `sma_20_distance` | 12w | 0.08794063 |
| `rsi_14` | 4w | 0.08361516 |

Most negative mean rank IC:

| Factor | Horizon | Mean rank IC |
|:--|:--|--:|
| `macd` | 12w | -0.12863492 |
| `macd` | 4w | -0.03592888 |
| `weekly_return` | 1w | -0.01577496 |
| `macd` | 1w | -0.01300912 |
| `momentum_4w` | 1w | -0.00647321 |

The 6-symbol universe makes IC and quantile results preliminary. Factor validation alone is not enough to change live recommendations.

## Phase 5E ML Sandbox

The ML sandbox used time-based train/test splits and sklearn Pipelines. Features at time t predict future returns after time t; the last 20% of dates are held out.

Key findings:

- Regression models did not beat `baseline_mean`.
- Best regression: `baseline_mean` on `forward_1w_return`, RMSE 0.04030839.
- Best classification: `logistic_regression` on `forward_12w_positive`, balanced accuracy 0.57350427, ROC AUC 0.57948718.
- 4w classification did not beat baseline.
- ML is not ready for live use.

## Promotion Gates

Before any Phase 5 research output can affect live recommendations, all of these gates must be passed:

- Test on a larger universe than 6 symbols.
- Use a longer historical period with multiple market regimes.
- Pass walk-forward validation.
- Pass out-of-sample validation that was not used during model design.
- Run regime-specific testing, including bull, bear, sideways, and high-volatility periods.
- Run ex-NVDA and single-name dependency checks.
- Include transaction cost and slippage testing.
- Show stability across multiple data refresh dates.
- Show clear improvement over Fixed Weekly DCA and Simple Dip-Buy baselines.
- Avoid any material increase in drawdown.
- Receive explicit human review before any live integration.

## Final Decision

No live strategy change is justified from Phase 5. The live dashboard should remain unchanged, the Python default strategy should remain unchanged, and all factor/ML/Backtrader/QuantStats outputs should stay in the research layer.

## Recommended Phase 6A

Expand the research universe and history before adding new models or portfolio optimization. Phase 6A starts with the scaffold in `RESEARCH_UNIVERSE.md` and `data/research-universe.json`; Phase 6B should add historical data coverage for that broader universe. PyPortfolioOpt remains deferred until the research dataset is broader and more reliable.
