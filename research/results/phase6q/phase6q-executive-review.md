# Phase 6Q Executive Research Review Pack

Generated: `2026-06-18T16:11:22.363583+00:00`

## Executive Summary

- Active 38-symbol research universe remains the default research universe.
- Expanded 80-symbol universe remains research-only and is not activated for live/default use.
- 50-symbol shadow set remains shadow-only and disabled by default.
- 12 monitored symbols remain monitoring-only and are not live recommendations.
- Final recommendation: continue research and do not activate live/default yet.

## Current Universe State

- Active universe: `38` symbols.
- Expanded universe: `80` symbols.
- Reference symbols: `4`.
- New expanded-only symbols: `42`.
- Removed symbols: `0`.
- 50-symbol shadow set disabled by default: `True`.
- Partial activation disabled by default: `True`.

## 12 Shadow Candidates

The detailed review table is in `shadow-candidate-review-table.csv`.

| Symbol | Category | Why Selected |
|---|---|---|
| ABBV | defensive_healthcare | Strong coverage (599 rows) and useful defensive_healthcare diversification for shadow testing. |
| ABT | defensive_healthcare | Strong coverage (599 rows) and useful defensive_healthcare diversification for shadow testing. |
| AMT | utilities_real_assets | Strong coverage (599 rows) and useful utilities_real_assets diversification for shadow testing. |
| APD | energy_materials | Strong coverage (599 rows) and useful energy_materials diversification for shadow testing. |
| BA | industrial_diversified | Strong coverage (599 rows) and useful industrial_diversified diversification for shadow testing. |
| BKNG | consumer_retail | Strong coverage (599 rows) and useful consumer_retail diversification for shadow testing. |
| BLK | financial_payments | Strong coverage (599 rows) and useful financial_payments diversification for shadow testing. |
| CMG | consumer_retail | Strong coverage (599 rows) and useful consumer_retail diversification for shadow testing. |
| COP | energy_materials | Strong coverage (599 rows) and useful energy_materials diversification for shadow testing. |
| DUK | utilities_real_assets | Strong coverage (599 rows) and useful utilities_real_assets diversification for shadow testing. |
| ETN | industrial_diversified | Strong coverage (599 rows) and useful industrial_diversified diversification for shadow testing. |
| GS | financial_payments | Strong coverage (599 rows) and useful financial_payments diversification for shadow testing. |

## Deferred / Rejected Summary

The grouped summary is in `deferred-rejected-summary.csv`.

- `continue_research`: 30 symbols. Adequate data, but requires more evidence because of noise risk, weak or unproven factor usefulness, duplicate exposure, volatility/risk, or regime weakness.
- `defer_due_to_data`: 0 symbols. No symbols currently assigned to this group.
- `reject_for_now`: 0 symbols. No symbols currently assigned to this group.

Common review reasons include data limitation, noise risk, weak factor usefulness, duplicate exposure, volatility/risk, and regime weakness.

## 38 vs 80 Improvement Summary

- Sector balance improved by expanding from `7` active categories to `9` expanded categories.
- New sector/category coverage: `energy_materials, utilities_real_assets`.
- Concentration risk improved directionally because the expanded set adds non-technology, non-semiconductor candidates.
- Signal distribution changed enough to produce useful research candidates, but also adds noise that requires shadow monitoring.
- The expansion adds candidate diversity, but it is not strong enough to justify live/default activation.

## Risk Gate Summary

- Disabled by default: `True`.
- Max sector concentration: `0.2`.
- Max single symbol exposure: `0.05`.
- Minimum price coverage rows: `260`.
- Volatility ceiling 12w: `0.12`.
- Missing price fallback: `no_action`.
- New symbol cooldown weeks: `12`.
- Rollback path: `use active 38-symbol research universe and ignore shadow-only outputs`.
- Phase 6M gates passed: `True`.
- Rollback baseline remains the active 38-symbol research universe.

## Partial Activation Status

- Partial activation plan exists.
- `disabled_by_default = true`.
- No live/default activation.
- No dashboard activation.
- No Manual Trade Plan change.

## Safety Confirmation

- `data/research-universe.json` unchanged.
- `data/research-prices.json` unchanged.
- `data/backtest-prices.json` unchanged.
- `app.js` unchanged.
- Manual Trade Plan unchanged.
- Live/default behavior unchanged.
- PyPortfolioOpt not introduced.
