# Project Health

- Status: **WARNING**
- Generated: `2026-08-13T14:44:45.350339+00:00`
- Scope: operational data and workflow health only; this is not strategy validation or trading approval.

## Issues

- `pending_idea_engine_pr`
- `workflow_pages_smoke_pending`

## Historical Coverage

- QQQ: 271 rows; latest `2026-08-07`; lag `6` days
- SPY: 271 rows; latest `2026-08-07`; lag `6` days

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
- idea_engine: PR #52 pending (https://github.com/susiyuan5/suinvestment/pull/52)

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
