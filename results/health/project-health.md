# Project Health

- Status: **HEALTHY**
- Generated: `2026-09-20T16:59:13.796332+00:00`
- Scope: operational data and workflow health only; this is not strategy validation or trading approval.

## Issues

- `none`

## Historical Coverage

- QQQ: 277 rows; latest `2026-09-18`; lag `2` days
- SPY: 277 rows; latest `2026-09-18`; lag `2` days

## Workflows

- market_update: `completed` / `success`
- historical_update: `completed` / `success`
- quality_checks: `completed` / `success`
- pages_smoke: `completed` / `success`
- shadow_update: `completed` / `success`
- idea_engine_update: `completed` / `success`

## Pending Automated Updates

- historical_prices: none
- shadow_observation: none
- idea_engine: none

## Watchlist

- Static fallback status: `ready`
- Runtime primary: `Yahoo Finance chart API`
- Same-origin fallback: `data/backtest-prices.json`

## Shadow

- Observation runs: `4`
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
- Schedule events: `276`
- Executed trades: `4968`
- Scope: `research_only`

## Idea Engine

- Version: `idea-engine-v3.1`
- Source: `v3.1-short-term`
- Primary horizon: `4` weeks
- Shadow observations: `6`
- Mature short-term outcomes: `0`
- Human review gate: `False`
- Scope: research only; never enters DCA or automatic trading.

## Historical OOS price-timing calibration

- Status: `preliminary_no_reliable_edge`
- As of: `2026-09-14`
- Permanent OOS samples: `5360`
- Independent weekly origins: `67`
- Reliability gate: `False`
- Scope: price/volume timing only; the composite score remains uncalibrated.

## Short-term trade-plan research

- Schema: `short-term-trade-plan-v1.3`
- Style fusion: `global-style-fusion-v1.3`
- Candidates / strategies: `10` / `30`
- Status counts: `{'conditional_review': 0, 'manual_review_ready': 0, 'simulation_only': 0, 'waiting_trigger': 2, 'waiting_breakout': 0, 'waiting_pullback': 0, 'chase_blocked': 0, 'event_blocked': 0, 'invalidated': 0, 'blocked': 8}`
- Historical OOS: `preliminary_no_reliable_edge` / samples `150` / passed models `[]`
- Shadow preliminary / formal review: `False` / `False`
- Scope: research-only simulation; no orders or automatic trading.
