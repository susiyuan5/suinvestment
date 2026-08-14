# Project Health

- Status: **WARNING**
- Generated: `2026-08-14T00:08:25.199334+00:00`
- Scope: operational data and workflow health only; this is not strategy validation or trading approval.

## Issues

- `workflow_historical_update_unknown`
- `workflow_idea_engine_update_unknown`
- `workflow_market_update_unknown`
- `workflow_pages_smoke_unknown`
- `workflow_quality_checks_unknown`
- `workflow_shadow_update_unknown`

## Historical Coverage

- QQQ: 271 rows; latest `2026-08-07`; lag `7` days
- SPY: 271 rows; latest `2026-08-07`; lag `7` days

## Workflows

- market_update: `unknown` / `unknown`
- historical_update: `unknown` / `unknown`
- quality_checks: `unknown` / `unknown`
- pages_smoke: `unknown` / `unknown`
- shadow_update: `unknown` / `unknown`
- idea_engine_update: `unknown` / `unknown`

## Pending Automated Updates

- historical_prices: none
- shadow_observation: none
- idea_engine: none

## Watchlist

- Static fallback status: `unknown`
- Runtime primary: `Yahoo Finance chart API`
- Same-origin fallback: `data/backtest-prices.json`

## Shadow

- Observation runs: `3`
- Complete mature outcomes: `0`
- Human review gate: `False`
- Live promotion eligible: `false`


## SnapTrade Personal 只读同步

- Status: `locked`
- Connection: `read`
- Encrypted snapshot: `True`
- No trading: `true`
- Requires human review: `true`

## Research Pipeline

- DCA-L2 v2 valid: `True`
- Schedule events: `270`
- Executed trades: `4860`
- Scope: `research_only`

## Idea Engine

- Version: `idea-engine-v3.1`
- Source: `v3.1-short-term`
- Primary horizon: `4` weeks
- Shadow observations: `1`
- Mature short-term outcomes: `0`
- Human review gate: `False`
- Scope: research only; never enters DCA or automatic trading.

## Historical OOS price-timing calibration

- Status: `preliminary_no_reliable_edge`
- As of: `2026-08-13`
- Permanent OOS samples: `5039`
- Independent weekly origins: `63`
- Reliability gate: `False`
- Scope: price/volume timing only; the composite score remains uncalibrated.

## Short-term trade-plan research

- Schema: `short-term-trade-plan-v1.2`
- Style fusion: `global-style-fusion-v1`
- Candidates: `10`
- Status counts: `{'conditional_review': 0, 'manual_review_ready': 0, 'simulation_only': 1, 'waiting_trigger': 2, 'waiting_breakout': 0, 'waiting_pullback': 1, 'chase_blocked': 0, 'event_blocked': 0, 'invalidated': 0, 'blocked': 6}`
- Historical OOS: `preliminary_no_reliable_edge` / samples `128` / passed models `[]`
- Shadow mature: `False`
- Scope: research-only simulation; no orders or automatic trading.
