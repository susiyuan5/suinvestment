# Shadow Observation Refresh Checklist

This checklist is for monthly or manual research-only shadow observation refreshes. It does not create trading advice, does not update the Manual Trade Plan, and does not change the live/default dashboard.

For the full operational map and promotion boundaries, see `SHADOW_OBSERVATION_LIFECYCLE.md`.

## Purpose

Use this workflow after research price refreshes to update the 12-symbol shadow observation log and governance review. The goal is to preserve longitudinal evidence before any candidate can be considered for human review.

## When To Run

- After a monthly research price refresh.
- Before a human review of the 12 monitored symbols.
- When the read-only research sandbox shows stale observation data.
- After fixing a research-only data issue in the expanded 80-symbol price file.

## Prerequisites

- Work from a clean git tree.
- Confirm this is research-only work.
- Confirm `data/backtest-prices.json` should not change.
- Confirm the Manual Trade Plan should not change.
- Confirm `app.js` live/default dashboard behavior should not change.
- Confirm no activate, promote, trade, or order controls are being added.

## Command Sequence

Run commands in this order:

```powershell
python scripts\update_research_prices.py
python research\run_phase6s_shadow_observation.py
python research\analyze_shadow_observation_history.py
python research\archive_shadow_observation_snapshot.py
python research\analyze_shadow_observation_history.py
python research\validate_shadow_observation_archive.py
python research\check_shadow_refresh_readiness.py
python research\generate_shadow_monthly_review.py
python -m unittest discover -s tests
node --check app.js
node --check research-sandbox.js
```

## Expected Outputs

- `data/research-prices.json` may update only when intentionally refreshing the active 38-symbol research universe.
- `research/results/phase6s/shadow-observation-log.json`
- `research/results/phase6s/shadow-observation-log.csv`
- `research/results/phase6s/shadow-observation-summary.md`
- `research/results/phase6s/shadow-observation-validation-report.json`
- `research/results/phase6s/shadow-observation-governance-report.json`
- `research/results/phase6s/shadow-observation-governance-summary.md`
- `research/results/phase6s/history/shadow-observation-history-manifest.json`
- `research/results/phase6s/history/shadow-observation-history-summary.md`
- `research/results/phase6s/history/shadow-observation-archive-validation-report.json`
- `research/results/phase6s/history/shadow-observation-archive-validation-summary.md`
- `research/results/phase6s/shadow-monthly-review-report.json`
- `research/results/phase6s/shadow-monthly-review-summary.md`

Archive after the governance analysis confirms the latest snapshot is valid. The archive script detects duplicate observation timestamps and does not create another history entry for the same real observation. Archived snapshots are longitudinal evidence only; they do not promote candidates.

Run archive validation after the archive step. It checks history integrity only: required files, manifest/folder consistency, duplicate timestamp detection, and whether governance observation count is grounded in unique real timestamps. It does not rerun observations or promote candidates.

Generate the monthly review after readiness and archive validation. The monthly review summarizes current evidence and blockers only; it does not rerun observations, create fake history, or promote candidates.

## Before Commit

Check:

```powershell
git status
git diff --name-only -- data\backtest-prices.json app.js index.html style.css
```

Confirm:

- `data/backtest-prices.json` did not change.
- Manual Trade Plan files did not change.
- `app.js` default dashboard behavior did not change.
- The sandbox UI remains read-only.
- No candidate was promoted into live/default recommendations.
- No activate, promote, trade, order, or position-sizing controls were added.

## Governance Interpretation

- Minimum observation runs before human review: `8`.
- Minimum calendar weeks before human review: `8`.
- Archived snapshots count only when they have unique real observation timestamps.
- Human review is not live promotion.
- Live promotion is never automatic.
- No candidate can be promoted from this checklist.
- If observation history is below the minimum, status should remain `not_enough_observation_history`.
- Any risk warning, missing data, or candidate degradation blocks human-review eligibility.

## Failure Handling

- If research price refresh fails, do not treat missing symbols as valid.
- If observation generation fails, stop and inspect the missing input.
- If governance analysis fails, do not manually mark candidates as eligible.
- If tests or Node checks fail, do not commit.
- If a forbidden file changed unexpectedly, stop and revert or inspect before continuing.

## Commit And Tag Naming

Suggested commit:

```text
Refresh Phase 6 shadow observation log
```

Suggested tag pattern:

```text
shadow-observation-refresh-YYYY-MM
```

Keep refresh commits research-only. They must not change live/default behavior.
