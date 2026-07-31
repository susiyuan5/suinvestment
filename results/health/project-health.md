# Project Health

- Status: **WARNING**
- Generated: `2026-07-31T23:11:48.197530+00:00`
- Scope: operational data and workflow health only; this is not strategy validation or trading approval.

## Issues

- `workflow_historical_update_pending`
- `workflow_quality_checks_pending`

## Historical Coverage

- QQQ: 270 rows; latest `2026-07-31`; lag `0` days
- SPY: 270 rows; latest `2026-07-31`; lag `0` days

## Workflows

- market_update: `completed` / `success`
- historical_update: `in_progress` / `pending`
- quality_checks: `in_progress` / `pending`
- pages_smoke: `completed` / `success`
- shadow_update: `completed` / `success`

## Pending Automated Updates

- historical_prices: none
- shadow_observation: none

## Watchlist

- Static fallback status: `ready`
- Runtime primary: `Yahoo Finance chart API`
- Same-origin fallback: `data/backtest-prices.json`

## Shadow

- Observation runs: `3`
- Complete mature outcomes: `0`
- Human review gate: `False`
- Live promotion eligible: `false`

## Research Pipeline

- DCA-L2 v2 valid: `True`
- Schedule events: `269`
- Executed trades: `4842`
- Scope: `research_only`
