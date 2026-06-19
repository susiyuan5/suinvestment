# Project Navigation Hub

This document is the starting map for the live dashboard, research sandbox, Phase 6 research files, shadow observation workflow, production QA reports, and safety boundaries.

## A. Main Live Dashboard

Production URL:

https://susiyuan5.github.io/suinvestment/

Purpose:

- Manual decision-support dashboard for the current live portfolio.
- Shows market data quality, market regime, allocation signals, and Manual Trade Plan copy text.

Main files:

- `index.html`
- `app.js`
- `style.css`
- `tests/`: current Python unit test entry directory.

Important warning:

- The live dashboard is not automatic trading.
- It is not broker-connected.
- It does not execute orders.
- All suggestions require manual user review and manual brokerage action.

## B. Research Sandbox

Entry:

- `research-sandbox.html`

Purpose:

- Read-only research review area for Phase 6J-6Q/6S+ outputs.
- Supports human review of shadow candidates, governance status, archive status, and monthly review summaries.

Main files:

- `research-sandbox.html`
- `research-sandbox.js`
- `research-sandbox.css`

Important warning:

- No activate/promote/trade controls are allowed.
- The sandbox must remain explicit-access only and read-only.
- It must not change the live dashboard, Manual Trade Plan, or live portfolio symbols.

## C. Manual Trade Plan

Purpose:

- Current live portfolio manual planning only.
- It is the copyable manual order-planning surface for the active live dashboard symbols.

Main entry points:

- `index.html`: Manual Trade Plan panel markup uses `#order-title`, `#orderRows`, and `#orderText`.
- `app.js`: `render()` builds the order text, `formatManualTradePlanEntry(signal)` formats each line, and clipboard copy reads from `orderTextEl`.
- `app.js`: `buildSignalObject(stock, row)`, `calculateSignalScore(input)`, and `calculateRiskAdjustedBuyAmount(signal)` feed the displayed recommendation and amount fields.

Policy and design documents:

- `DCA_STRATEGY_POLICY_LAYER.md`: primary policy document for a proposed three-layer Manual Trade Plan: Base DCA Amount, Extra Dip-Buy Amount, and Risk Cap / Cash Reserve Guard.
- `DCA1_MANUAL_TRADE_PLAN_DESIGN.md`: design-only proposal for presenting those layers in the Manual Trade Plan without changing current behavior.

Important policy status:

- These documents describe a future design; they do not implement trading logic or current dashboard behavior.
- Base DCA remains the primary strategy in the proposed policy.
- Strategy signals may adjust only the optional extra dip-buy amount; they must not cancel the base DCA.

Safety:

- Research or shadow symbols must not appear here unless a future human-reviewed live promotion phase explicitly changes live portfolio symbols.
- Phase 6 research does not change Manual Trade Plan.
- Manual Trade Plan logic must not be changed during documentation, research-only, or UI QA phases.

## D. Data Files

- `data/backtest-prices.json`: live/backtest data used by current dashboard workflows, dashboard backtests, and QQQ/SPY market-regime history.
- `data/research-prices.json`: research-only universe historical price data.
- `data/research-universe.json`: active 38-symbol research universe definition.
- `data/research-universe-expansion-plan.json`: planning-only expansion proposal.
- `data/research-universe-sector-balanced-80.json`: explicit research-only 80-symbol comparison universe.
- `data/research-prices-sector-balanced-80.json`: explicit research-only 80-symbol comparison price file.
- `data/market-data.json`: weekly market snapshot served by GitHub Pages.
- `data/manual_portfolio.csv`: sample manual portfolio input for analysis tooling.

The project intentionally separates research data from live/backtest data. Research-only phases must not modify `data/backtest-prices.json` unless a future explicit phase allows it.

## E. Research Universe Reports

- `RESEARCH_UNIVERSE.md`: explains Live Portfolio vs Research Universe and symbol separation.
- `PHASE6_RESEARCH_UNIVERSE_SUMMARY.md`: consolidates Phase 6 research-universe findings and governance conclusions.
- `RESEARCH_FACTOR_REPORT.md`: research-universe factor report notes.
- `RESEARCH_FACTOR_VALIDATION_REPORT.md`: research-universe factor validation notes.
- `RESEARCH_ML_SANDBOX_REPORT.md`: research-universe ML sandbox notes.
- `SECTOR_REGIME_BREAKDOWN_REPORT.md`: sector/category and regime breakdown diagnostics.
- `RESEARCH_UNIVERSE_EXPANSION_PLAN.md`: planning-only sector-balanced 80-symbol expansion proposal.

All reports are research-only. They do not promote symbols into the live dashboard.

## F. Shadow Observation Workflow

Core documents and configuration:

- `SHADOW_OBSERVATION_LIFECYCLE.md`: read-only lifecycle map for Phase 6S-6X.
- `SHADOW_OBSERVATION_REFRESH_CHECKLIST.md`: manual/monthly refresh checklist.
- `SHADOW_MONTHLY_REVIEW_TEMPLATE.md`: monthly review template and governance framing.
- `research/shadow_observation_governance.json`: governance thresholds and review gates.

Core scripts:

- `research/run_phase6s_shadow_observation.py`: creates the latest shadow observation snapshot.
- `research/analyze_shadow_observation_history.py`: evaluates governance status across observations.
- `research/archive_shadow_observation_snapshot.py`: archives the latest observation snapshot.
- `research/validate_shadow_observation_archive.py`: validates archive integrity.
- `research/check_shadow_refresh_readiness.py`: read-only readiness helper.
- `research/generate_shadow_monthly_review.py`: generates monthly review reports from existing outputs.

These scripts are research-only. They do not create trades, modify the live portfolio, or unlock live promotion.

Generated research/shadow result directories:

- `research/results/phase6i/`: explicit 38-vs-80 research-only comparison outputs.
- `research/results/phase6j/`: 38-vs-80 research comparison outputs.
- `research/results/phase6k/`: promotion screening research outputs.
- `research/results/phase6l/`: shadow-only comparison outputs.
- `research/results/phase6m/`: risk gate and rollback review outputs.
- `research/results/phase6n/`: disabled-by-default partial activation planning outputs.
- `research/results/phase6o/`: monitoring framework outputs.
- `research/results/phase6q/`: executive review pack outputs.
- `research/results/phase6s/`: shadow observation, governance, archive, validation, and monthly review outputs.

These generated outputs are evidence files. Do not edit them manually during documentation/navigation QA phases.

## G. Current Shadow Observation Status

- Observation runs available: 2
- Minimum observation runs required: 8
- Unique observation timestamp count: 2
- Unique observation date count: 1
- Cadence status: `same_day_validation_runs_detected`
- Human-review eligibility: no
- Live-promotion eligibility: no
- Archive validation status: valid

Same-day runs validate the pipeline but are not monthly longitudinal evidence. They must not be repeated just to reach 8/8. Human-review eligibility is not live promotion.

## H. Production QA Reports

- `PRODUCTION_UI_QA1_REPORT.md`: loaded-state audit and fixes for Data Quality, Market Regime waiting state, Panic banner gating, and Research Sandbox entry visibility.
- `PRODUCTION_UI_QA2_VISUAL_REPORT.md`: post-deploy production visual verification report confirming the current page appears normal.

UI QA phases must not change formulas, strategy logic, data files, research outputs, Manual Trade Plan behavior, or trading controls.

## I. Safe Command Groups

These are reference command groups only. Do not run operational shadow workflows unless the current phase explicitly asks for them.

Basic validation:

```powershell
python -m unittest discover -s tests
node --check app.js
node --check research-sandbox.js
```

Current unit test files:

- `tests/test_analysis.py`
- `tests/test_risk_adjuster.py`
- `tests/test_strategy.py`

Shadow readiness/report-only:

```powershell
python research\analyze_shadow_observation_history.py
python research\validate_shadow_observation_archive.py
python research\check_shadow_refresh_readiness.py
python research\generate_shadow_monthly_review.py
```

Monthly observation workflow:

- Use `SHADOW_OBSERVATION_REFRESH_CHECKLIST.md` instead of duplicating operational steps here.

## J. Never Allowed Without Explicit Future Phase

- Broker integration.
- Automatic trading.
- Activate/promote/trade buttons.
- Research symbols appearing in Manual Trade Plan.
- Shadow observation becoming a live signal.
- PyPortfolioOpt live activation.
- `data/backtest-prices.json` modification during research-only phases.
- Formula changes during documentation/UI QA phases.
- Repeated same-day observation runs just to reach 8/8.
- Treating human-review eligibility as live promotion.
