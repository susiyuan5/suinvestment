# Shadow Observation Lifecycle Map

## Purpose

This document maps the research-only Shadow Observation workflow from Phase 6S through Phase 6X. It is designed to prevent confusion between observation, governance, archive, validation, monthly review, human review, and live promotion.

Shadow Observation is not a live trading system. It does not create trading advice, place orders, modify the Manual Trade Plan, or change the default dashboard.

## Current Status

- Observation runs available: `1`
- Unique observation date count: `1`
- Minimum observation runs required: `8`
- Minimum calendar weeks required: `8`
- Human-review eligibility: `no`
- Live-promotion eligibility: `no`
- Archive validation status: `valid`
- Latest observation timestamp: `2026-06-19T00:36:16.089451+00:00`
- Monitored symbol count: `12`
- Current governance status: `not_enough_observation_history`

No candidate is eligible for human review or live promotion.

## Phase 6S - Shadow Observation Log

Purpose: run research-only shadow observation for monitored symbols.

Main script:

- `research/run_phase6s_shadow_observation.py`

Main outputs:

- `research/results/phase6s/shadow-observation-log.json`
- `research/results/phase6s/shadow-observation-log.csv`
- `research/results/phase6s/shadow-observation-summary.md`
- `research/results/phase6s/shadow-observation-validation-report.json`

UI:

- `research-sandbox.html`
- `research-sandbox.js`
- `research-sandbox.css`

Boundary: no live activation, no trade controls, and no Manual Trade Plan changes.

## Phase 6T - Governance Gates

Purpose: interpret observation history with explicit gates.

Main config:

- `research/shadow_observation_governance.json`

Main script:

- `research/analyze_shadow_observation_history.py`

Main outputs:

- `research/results/phase6s/shadow-observation-governance-report.json`
- `research/results/phase6s/shadow-observation-governance-summary.md`

Required gates:

- Minimum 8 observation runs
- Minimum 8 calendar weeks
- Zero risk warnings
- Zero missing data
- Zero degraded candidates
- Manual review required before any promotion consideration
- Strategy backtest required
- Sector/regime check required
- Transaction cost check required

Boundary: `eligible_for_human_review_only` is not live promotion. The workflow must never output `eligible_for_live_promotion`.

## Phase 6U - Manual/Monthly Refresh Checklist

Purpose: define safe monthly/manual refresh order.

Main document:

- `SHADOW_OBSERVATION_REFRESH_CHECKLIST.md`

Readiness helper:

- `research/check_shadow_refresh_readiness.py`

The checklist explains when and how to refresh research prices, rerun observation, analyze governance, archive snapshots, validate archives, generate monthly review, and run checks.

Boundary: the checklist cannot promote symbols or modify live behavior.

## Phase 6V - History Archive Support

Purpose: preserve longitudinal evidence.

Main script:

- `research/archive_shadow_observation_snapshot.py`

Main archive location:

- `research/results/phase6s/history/`

Main outputs:

- `research/results/phase6s/history/shadow-observation-history-manifest.json`
- `research/results/phase6s/history/shadow-observation-history-summary.md`
- `research/results/phase6s/history/<timestamped snapshot folders>/`

The archive prevents duplicate observation timestamps from counting as fake runs.

Boundary: the archive script does not run observations, fetch prices, promote symbols, or change dashboard behavior.

## Phase 6W - Archive Integrity Validation

Purpose: validate archive health.

Main script:

- `research/validate_shadow_observation_archive.py`

Main outputs:

- `research/results/phase6s/history/shadow-observation-archive-validation-report.json`
- `research/results/phase6s/history/shadow-observation-archive-validation-summary.md`

It checks:

- Manifest/folder consistency
- Required archived files
- Duplicate timestamps
- Missing archive files
- Unique observation timestamp count
- Governance count does not exceed unique real timestamps

Boundary: it does not rerun observations or create fake history.

## Phase 6X - Monthly Review Report

Purpose: summarize current monthly readiness for human review.

Main script:

- `research/generate_shadow_monthly_review.py`

Main template:

- `SHADOW_MONTHLY_REVIEW_TEMPLATE.md`

Main outputs:

- `research/results/phase6s/shadow-monthly-review-report.json`
- `research/results/phase6s/shadow-monthly-review-summary.md`

It summarizes:

- Latest observation timestamp
- Observation runs available
- Required runs/weeks
- Governance status
- Archive validation status
- Human-review eligibility
- Live-promotion eligibility
- Next required action

Boundary: it does not run observation, does not archive, and does not change live behavior.

## Operational Flow

1. Refresh research prices manually if needed:
   `python scripts\update_research_prices.py`

2. Run shadow observation:
   `python research\run_phase6s_shadow_observation.py`

3. Analyze governance:
   `python research\analyze_shadow_observation_history.py`

4. Archive latest observation snapshot:
   `python research\archive_shadow_observation_snapshot.py`

5. Validate archive integrity:
   `python research\validate_shadow_observation_archive.py`

6. Check readiness:
   `python research\check_shadow_refresh_readiness.py`

7. Generate monthly review:
   `python research\generate_shadow_monthly_review.py`

8. Run tests:
   `python -m unittest discover -s tests`

9. Run node checks:
   `node --check app.js`
   `node --check research-sandbox.js`

10. Commit only research-only outputs.

11. Continue observing until at least 8 unique observation runs and 8 calendar weeks exist.

## File Map

Governance/config files:

- `research/shadow_observation_governance.json`

Core scripts:

- `research/run_phase6s_shadow_observation.py`
- `research/analyze_shadow_observation_history.py`
- `research/archive_shadow_observation_snapshot.py`
- `research/validate_shadow_observation_archive.py`
- `research/check_shadow_refresh_readiness.py`
- `research/generate_shadow_monthly_review.py`

Latest observation outputs:

- `research/results/phase6s/shadow-observation-log.json`
- `research/results/phase6s/shadow-observation-log.csv`
- `research/results/phase6s/shadow-observation-summary.md`
- `research/results/phase6s/shadow-observation-validation-report.json`

Governance outputs:

- `research/results/phase6s/shadow-observation-governance-report.json`
- `research/results/phase6s/shadow-observation-governance-summary.md`

Archive outputs:

- `research/results/phase6s/history/shadow-observation-history-manifest.json`
- `research/results/phase6s/history/shadow-observation-history-summary.md`
- `research/results/phase6s/history/<timestamped snapshot folders>/`

Archive validation outputs:

- `research/results/phase6s/history/shadow-observation-archive-validation-report.json`
- `research/results/phase6s/history/shadow-observation-archive-validation-summary.md`

Monthly review outputs:

- `research/results/phase6s/shadow-monthly-review-report.json`
- `research/results/phase6s/shadow-monthly-review-summary.md`

Sandbox UI:

- `research-sandbox.html`
- `research-sandbox.js`
- `research-sandbox.css`

Main dashboard files that must not be affected:

- `app.js`
- `index.html` unless explicitly needed for a separate UI phase
- `data/backtest-prices.json`
- Live portfolio symbols
- Manual Trade Plan logic

## Never Allowed From Shadow Observation

- No automatic live promotion
- No trading/order logic
- No broker integration
- No Manual Trade Plan modification
- No live portfolio symbol modification
- No `app.js` default dashboard behavior modification
- No `data/backtest-prices.json` modification
- No PyPortfolioOpt activation
- No activate/promote/trade buttons
- No treating monthly review as live trading advice
- No treating human review eligibility as live promotion

## Promotion Boundary

- Observation = research monitoring only
- Governance = eligibility screening only
- Archive = evidence preservation only
- Archive validation = data integrity check only
- Monthly review = human-readable summary only
- Human review = manual review only
- Live promotion = not implemented and never automatic

## How To Interpret Current Status

Current `1 / 8` observation runs means:

- Insufficient history
- No human-review eligibility
- No live-promotion eligibility
- Continue monthly/manual observation
- Do not change live strategy
- Do not add symbols to Manual Trade Plan

After Phase 6Z, the system may show `2 / 8` observation runs while still having only one unique observation date. Same-day repeated runs can validate the pipeline but are not monthly evidence. They must not be used to satisfy the 8-calendar-week requirement.

## Future Phase 6Z

The next real operational phase may be a second manual observation run.

Phase 6Z should verify:

- A new real observation timestamp is created
- Archive count increases from 1 to 2 only if timestamp is unique
- Governance count changes from `1 / 8` to `2 / 8`
- Duplicate timestamp is not counted as a fake run
- Live/default behavior remains unchanged
