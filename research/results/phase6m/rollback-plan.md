# Phase 6M Rollback Plan

Rollback is one command conceptually: ignore all Phase 6I+ shadow outputs and continue using the active 38-symbol research universe.

## Rules

- Do not load `data/research-universe-sector-balanced-80.json` in default scripts.
- Do not load `data/research-prices-sector-balanced-80.json` in dashboard or default backtests.
- Continue using `data/research-universe.json` for active research.
- Continue using live dashboard symbols and Manual Trade Plan unchanged.
- If any future shadow activation fails risk gates, revert to active 38 baseline for research comparisons.
