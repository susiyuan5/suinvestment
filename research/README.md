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

Phase 5D adds Alphalens-style factor validation for the Phase 5A live-portfolio factor table:

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

Phase 5E adds a scikit-learn ML sandbox using the Phase 5A live-portfolio factor table:

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

## Phase 6D

Phase 6D adds explicit research-universe factor validation while preserving the default Phase 5 live-portfolio validation path:

```powershell
python research\factor_validation.py
python research\factor_validation.py --universe research
```

Outputs for research mode:

- `results/phase6/research_factor_validation_ic.csv`
- `results/phase6/research_factor_validation_quantiles.csv`
- `results/phase6/research_factor_validation_summary.csv`
- `RESEARCH_FACTOR_VALIDATION_REPORT.md`

The research validation compares the 38-symbol research universe against the earlier six-symbol Phase 5 results where possible. It remains research-only; factor IC, quantile spreads, and direction consistency are not live recommendations.

## Phase 6E

Phase 6E adds explicit research-universe ML sandbox mode while preserving the default Phase 5 live-portfolio ML path:

```powershell
python research\ml_sandbox.py
python research\ml_sandbox.py --universe research
```

Outputs for research mode:

- `results/phase6/ml/research_ml_regression_results.csv`
- `results/phase6/ml/research_ml_classification_results.csv`
- `results/phase6/ml/research_ml_feature_importance.csv`
- `results/phase6/ml/research_ml_predictions.csv`
- `RESEARCH_ML_SANDBOX_REPORT.md`

Research-universe ML remains sandbox-only. The predictions are diagnostics for model stability and baseline comparison, not dashboard recommendations.

## Phase 6F

Phase 6F consolidates the research-universe findings and next research direction:

- `PHASE6_RESEARCH_UNIVERSE_SUMMARY.md`

The summary confirms that Phase 6 expanded research coverage but did not justify live promotion. The recommended next step is sector/regime breakdown before larger-universe expansion or PyPortfolioOpt work.

## Phase 6G

Phase 6G adds sector/category and QQQ-regime breakdown diagnostics for research-universe factor validation:

```powershell
python research\sector_regime_breakdown.py
```

Outputs:

- `results/phase6/sector_regime_factor_ic.csv`
- `results/phase6/sector_factor_summary.csv`
- `results/phase6/regime_factor_summary.csv`
- `SECTOR_REGIME_BREAKDOWN_REPORT.md`

The script uses research-only category metadata from `data/research-universe.json` and reconstructs a simple QQQ-based research regime from `data/research-prices.json`. These diagnostics do not change the live market regime formula, dashboard recommendations, or Manual Trade Plan. Interpret results cautiously because sector groups and regime buckets can be small or imbalanced.

## Phase 6H

Phase 6H creates a planning-only sector-balanced expansion proposal for an approximately 80-symbol research universe:

```powershell
python research\plan_universe_expansion.py
```

Files:

- `data/research-universe-expansion-plan.json`
- `RESEARCH_UNIVERSE_EXPANSION_PLAN.md`
- `research/plan_universe_expansion.py`

This does not activate the 80-symbol universe, fetch prices, change `data/research-prices.json`, change `data/backtest-prices.json`, or add symbols to the dashboard or Manual Trade Plan.

## Phase 6I

Phase 6I activates the sector-balanced 80-symbol universe only for explicit research comparison:

```powershell
python research\run_phase6i_expanded_research.py
```

Files:

- `data/research-universe-sector-balanced-80.json`
- `data/research-prices-sector-balanced-80.json`
- `research/results/phase6i/universe-comparison-38-vs-80.json`
- `research/results/phase6i/universe-comparison-38-vs-80.md`
- `research/results/phase6i/sector-distribution-38-vs-80.json`
- `research/results/phase6i/phase6i-validation-report.json`
- `research/results/phase6i/expanded-80-price-coverage.csv`

The default active research universe remains `data/research-universe.json` with 38 symbols. The expanded 80-symbol universe is only used by explicit Phase 6I research scripts and must not be interpreted as a live buy list.

## Phase 6J-6O

Phase 6J-6O is a research-only expansion validation flow. Run scripts explicitly:

```powershell
python research\run_phase6j_research_comparison.py
python research\run_phase6k_promotion_screening.py
python research\run_phase6l_shadow_comparison.py
python research\run_phase6m_risk_gate_review.py
python research\run_phase6n_partial_activation_plan.py
python research\run_phase6o_monitoring_framework.py
```

Outputs:

- `research/results/phase6j/`: 38-vs-80 universe, factor, sector, regime, ML availability, and decision reports.
- `research/results/phase6k/`: candidate promotion screening lists.
- `research/results/phase6l/`: shadow-only comparison against active 38.
- `research/results/phase6m/`: risk gate config, review, and rollback plan.
- `research/results/phase6n/`: disabled-by-default partial activation plan.
- `research/results/phase6o/`: long-term monitoring framework and monthly review templates.

Safety statement: the default active research universe remains 38 symbols; the live dashboard, Manual Trade Plan, and default strategy remain unchanged; PyPortfolioOpt remains deferred; all Phase 6J-6O outputs are research-only, shadow-only, or disabled-by-default.

## Phase 6S-6T Shadow Observation

Phase 6S records a research-only observation snapshot for the 12 monitored symbols:

```powershell
python research\run_phase6s_shadow_observation.py
```

Phase 6T adds governance gates for interpreting those observations across multiple runs:

```powershell
python research\analyze_shadow_observation_history.py
```

Outputs stay under `research/results/phase6s/`. A single clean observation is not enough: governance requires at least 8 observation runs and 8 calendar weeks before any candidate can even be considered for human review. The governance output never marks a candidate as eligible for live promotion, and the read-only `research-sandbox.html` screen cannot activate, promote, trade, or modify the live portfolio.

## Phase 6U Monthly Refresh Checklist

Phase 6U documents the manual/monthly shadow observation refresh workflow in `SHADOW_OBSERVATION_REFRESH_CHECKLIST.md`.

Recommended command order:

```powershell
python scripts\update_research_prices.py
python research\run_phase6s_shadow_observation.py
python research\analyze_shadow_observation_history.py
python research\check_shadow_refresh_readiness.py
python -m unittest discover -s tests
node --check app.js
node --check research-sandbox.js
```

The readiness helper is console-only and read-only:

```powershell
python research\check_shadow_refresh_readiness.py
```

Interpretation: at least 8 observation runs and 8 calendar weeks are required before human review. Human review is not live promotion, and live promotion is never automatic.
