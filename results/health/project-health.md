# Project Health

- Status: **WARNING**
- Generated: `2026-08-10T12:52:08.137597+00:00`
- Scope: operational data and workflow health only; this is not strategy validation or trading approval.

## Issues

- `workflow_pages_smoke_pending`

## Historical Coverage

- QQQ: 271 rows; latest `2026-08-07`; lag `3` days
- SPY: 271 rows; latest `2026-08-07`; lag `3` days

## Workflows

- market_update: `completed` / `success`
- historical_update: `completed` / `success`
- quality_checks: `completed` / `success`
- pages_smoke: `in_progress` / `pending`
- shadow_update: `completed` / `success`
- idea_engine_update: `completed` / `success`

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

## Research Pipeline

- DCA-L2 v2 valid: `True`
- Schedule events: `270`
- Executed trades: `4860`
- Scope: `research_only`
