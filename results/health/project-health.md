# Project Health

- Status: **WARNING**
- Generated: `2026-07-13T03:14:51.527850+00:00`
- Scope: operational data and workflow health only; this is not strategy validation or trading approval.

## Issues

- `workflow_quality_checks_pending`

## Historical Coverage

- QQQ: 267 rows; latest `2026-07-10`; lag `3` days
- SPY: 267 rows; latest `2026-07-10`; lag `3` days

## Workflows

- market_update: `completed` / `success`
- historical_update: `completed` / `success`
- quality_checks: `in_progress` / `pending`

## Watchlist

- Static fallback status: `ready`
- Runtime primary: `Yahoo Finance chart API`
- Same-origin fallback: `data/backtest-prices.json`

## Shadow

- Observation runs: `2`
- Complete mature outcomes: `0`
- Human review gate: `False`
- Live promotion eligible: `false`
