# Phase 4B.1 Data Provenance Validation

Validation date: 2026-06-11

Validated commit: `8155ab9ed80caccf789c8de3e28dae40a32256a5`

Validated tag: `stable-phase4b-data-provenance`

## Scope

This validation reviewed the Phase 4B dashboard data provenance changes in `app.js`. It did not change algorithm logic, recommendation formulas, the Python default strategy, broker behavior, or automatic trading behavior.

## Manual Override Compatibility

- Legacy number-only override records still load through `getOverrideRecord(symbol)` and are interpreted as `{ value, appliedAt: null, legacy: true }`.
- New override records are saved as objects with `value` and `appliedAt` timestamp metadata.
- Manual override rows carry manual source metadata for 5D change and decision change.
- Legacy manual-only rows without timestamps are intentionally treated as stale, preventing timestamp-free manual data from appearing fresh.
- The dashboard note exposes either the manual override timestamp or the legacy "no timestamp" state.
- Clearing an override deletes the full override entry, including value and metadata.

## Field-Level Provenance

Phase 4B adds field-level metadata for:

- price
- 1D change
- 5D change
- decision change
- trend
- volatility
- drawdown
- market regime

Normal API rows, Yahoo fallback rows, weekly snapshot rows, cached rows, unavailable rows, and manual override rows now produce field metadata or a safe fallback metadata value. Missing or stale fields are surfaced as data-quality warnings and provenance text.

## Recommendation Stability

The Phase 4B diff was reviewed for recommendation formulas. The following formula paths were not rewritten:

- signal score calculation
- enhanced multiplier calculation
- suggested buy amount calculation
- risk level scoring calculation
- suggested action thresholds

Expected safety behavior did change for manual rows without valid timestamps: they are now labeled stale and may be blocked by existing stale-data safeguards. This is intentional data reliability behavior, not a strategy formula change.

## Runtime And Test Checks

Commands run:

```powershell
node --check app.js
python -m unittest discover -s tests
```

Result:

- JavaScript syntax check passed.
- Python unit tests passed: `Ran 27 tests OK`.

## Remaining Risks

- Browser-level verification should still be repeated after future UI changes because provenance text is rendered inside compact dashboard notes.
- Existing browser localStorage may contain legacy manual override values; these are compatible but will be labeled as timestamp-missing until the user reapplies the override.
- Field freshness is only as reliable as the timestamp available from the upstream source, cached row, weekly snapshot, or historical dataset.

## Conclusion

Phase 4B provenance changes are backward-compatible with legacy override values, add timestamped metadata for new overrides, and preserve core recommendation formulas. Live recommendations remain formula-stable, with only the intended stale-data safeguards affecting manual-only rows that lack valid timestamps.
