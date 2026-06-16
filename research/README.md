# Research Stack

This directory contains optional research scripts. Nothing here changes the live dashboard, the default Python strategy, buy amount logic, signal score, multiplier, risk level, action thresholds, or market regime formula.

For consolidated Phase 5 findings and promotion gates, see `PHASE5_RESEARCH_SUMMARY.md`.

For the Phase 6A research universe scaffold, see `RESEARCH_UNIVERSE.md` and `data/research-universe.json`.

## Phase 5A

Phase 5A adds the first weekly factor report:

```powershell
python -m pip install -r requirements-research.txt
python research\factor_report.py
```

Outputs:

- `results/phase5/factor_report.csv`
- `results/phase5/factor_latest.csv`
- `FACTOR_REPORT.md`

The factors are research inputs only and need later validation before any live strategy use.

The default command remains the live-portfolio factor report for BYDDY, MSFT, NVDA, AAPL, ASML, and KO.

## Phase 5B

Phase 5B adds a Backtrader sandbox comparison workflow:

```powershell
python research\backtrader_sandbox.py
```

Outputs:

- `results/phase5/backtrader_summary.csv`
- `results/phase5/backtrader_trades.csv`
- `BACKTRADER_SANDBOX_REPORT.md`

The sandbox compares Fixed Weekly DCA, Simple Dip-Buy, and Risk-Adjusted v2 on the current portfolio symbols only. It is an additional research engine and does not replace `backtest.py`.

Do not infer live strategy changes from this report yet. Differences versus the existing custom backtest can come from Backtrader order timing, broker accounting, cash handling, commission/slippage handling, or fractional-share assumptions.

## Phase 5C

Phase 5C adds QuantStats-style performance reports from the Backtrader sandbox equity series:

```powershell
python research\quantstats_report.py
```

Outputs:

- `results/phase5/quantstats/quantstats_summary.csv`
- `results/phase5/quantstats/fixed_weekly_dca_report.html`
- `results/phase5/quantstats/simple_dip_buy_report.html`
- `results/phase5/quantstats/risk_adjusted_v2_report.html`
- `QUANTSTATS_REPORT.md`

Treat these reports as diagnostics only. Higher final value, higher Sharpe ratio, or lower drawdown is not enough to promote a strategy without broader validation, out-of-sample testing, and review of execution assumptions.

## Phase 5D

Phase 5D adds Alphalens-style factor validation for the Phase 5A factor table:

```powershell
python research\factor_validation.py
```

Outputs:

- `results/phase5/factor_validation_ic.csv`
- `results/phase5/factor_validation_quantiles.csv`
- `results/phase5/factor_validation_summary.csv`
- `FACTOR_VALIDATION_REPORT.md`

The validation checks preliminary relationships between research factors and forward 1-week, 4-week, and 12-week returns. Interpret results cautiously: the universe has only six symbols, and promising IC or quantile spreads require walk-forward and out-of-sample validation before any live strategy use.

## Phase 5E

Phase 5E adds a scikit-learn ML sandbox using the Phase 5A factor table:

```powershell
python research\ml_sandbox.py
```

Outputs:

- `results/phase5/ml/ml_regression_results.csv`
- `results/phase5/ml/ml_classification_results.csv`
- `results/phase5/ml/ml_feature_importance.csv`
- `results/phase5/ml/ml_predictions.csv`
- `ML_SANDBOX_REPORT.md`

The ML sandbox uses time-based train/test splits and sklearn Pipelines to reduce leakage risk. It is not used by the live dashboard, and predictions must not be treated as recommendations. Results are preliminary because the universe has only six symbols and limited weekly history.

## Phase 6A

Phase 6A separates the Live Portfolio from a broader Research Universe:

- Live Portfolio remains BYDDY, MSFT, NVDA, AAPL, ASML, and KO.
- Research Universe symbols are for factor validation, ML research, and future optimization experiments only.
- Reference symbols QQQ, SPY, DIA, and IWM are not trade candidates in this scaffold.
- Research Universe symbols do not become buy recommendations and do not appear in the Manual Trade Plan.
- Historical data expansion for the broader universe is deferred to Phase 6B.

## Phase 6B

Phase 6B adds a separate research-only historical data refresh:

```powershell
python scripts\update_research_prices.py
```

Outputs:

- `data/research-prices.json`
- `results/phase6/research_price_coverage.csv`
- `RESEARCH_PRICE_EXPANSION.md`

`data/research-prices.json` is not the live dashboard data source. It is separate from `data/backtest-prices.json`, and missing or failed research symbols do not affect live recommendations. Research universe symbols are not a buy list.

## Phase 6C

Phase 6C adds an explicit research-universe factor report mode while preserving the default live-portfolio factor report:

```powershell
python research\factor_report.py
python research\factor_report.py --universe research
```

Outputs for research mode:

- `results/phase6/research_factor_report.csv`
- `results/phase6/research_factor_latest.csv`
- `RESEARCH_FACTOR_REPORT.md`

Reference symbols QQQ, SPY, DIA, and IWM are excluded from the research trade-factor table by default. Research-universe factors do not affect live recommendations and should not be interpreted as a buy list.
