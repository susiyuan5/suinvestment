# Project Health

- Status: **BLOCKED**
- Generated: `2026-07-21T15:25:47.509105+00:00`
- Scope: operational data and workflow health only; this is not strategy validation or trading approval.

## Issues

- `qqq_history_unhealthy`
- `spy_history_unhealthy`

## Historical Coverage

- QQQ: 267 rows; latest `2026-07-10`; lag `11` days
- SPY: 267 rows; latest `2026-07-10`; lag `11` days

## Workflows

- market_update: `completed` / `success`
- historical_update: `completed` / `success`
- quality_checks: `completed` / `success`

## Watchlist

- Static fallback status: `ready`
- Runtime primary: `Yahoo Finance chart API`
- Same-origin fallback: `data/backtest-prices.json`

## Shadow

- Observation runs: `2`
- Complete mature outcomes: `0`
- Human review gate: `False`
- Live promotion eligible: `false`
