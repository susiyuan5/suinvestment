# DCA2 Display-Only Manual Trade Plan UI Mock

## Implementation Scope

DCA2 adds a display-only DCA Policy Preview to the existing Manual Trade Plan panel. It presents the approved DCA1 policy hierarchy without implementing a DCA calculation or changing any live recommendation behavior.

## Files Changed

- `index.html`: adds the read-only preview container and repeated safety labels.
- `app.js`: renders preview rows from already-finalized display signals without mutating them.
- `style.css`: adds compact preview cards, badges, factor-chain styling, and mobile stacking.
- `DCA2_UI_MOCK_REPORT.md`: records scope and safety boundaries.

## UI Location

The collapsed `DCA Policy Preview / 定投策略预览` section appears inside the existing Manual Trade Plan panel, below the current real plan rows and above copy-text details.

Each live symbol has an expandable preview row showing:

- Current existing recommendation, displayed amount, and risk.
- Base DCA Preview.
- Extra Dip-Buy Preview.
- Risk Guard Preview.
- Final Amount Preview.
- Factor Chain Preview.
- Data-quality/manual-review warnings when relevant.

## Display-Only Boundary

- The preview reads `entry.signal` only after the existing Manual Trade Plan calculation and rounding path has completed.
- It does not assign to signal values, portfolio risk, order text, or plan totals.
- It does not calculate Base DCA, Extra Dip-Buy, Risk Guard, or a second final amount.
- Final Amount Preview always states that the future policy is not active.
- Current Manual Trade Plan amounts remain the sole displayed actual planning amounts.

## Not Active

- DCA policy calculation is not active.
- Extra Dip-Buy calculation is not active.
- Risk Guard calculation is not active.
- Final Amount Preview is not active and is not an order.
- No broker, automatic trading, activation, promotion, or execution behavior exists.

## Formula and Behavior Confirmation

- Current buy amount calculation: unchanged.
- Signal score: unchanged.
- Multiplier: unchanged.
- Risk level: unchanged.
- Action thresholds: unchanged.
- Market regime formula: unchanged.
- Manual Trade Plan amount source and copied order text: unchanged.
- Live/default behavior: unchanged.

## Mobile Behavior

Preview stages use a compact two-column layout where space permits and stack into one column below 720px. Labels, badges, warnings, and the Factor Chain wrap without horizontal page overflow.

The preview is collapsed by default and nested symbol rows are also collapsed by default, keeping the Manual Trade Plan compact.

## Data-Quality Behavior

- Loading: shows `DCA preview waiting for data` and no confident final preview.
- Stale, missing, unavailable, or field-level quality issues: shows `Manual review required` and blocks the mock Extra Dip-Buy status.
- QQQ/market-regime fallback: warning only; no confident final preview is produced.
- Manual/fallback provenance remains sourced from existing signal metadata.
- Missing data is never presented as a buy opportunity.

## Remaining Limitations

- DCA2 is not a policy engine and intentionally produces no preview amount.
- Status labels are explanatory mappings from existing data-quality and risk labels, not new risk formulas.
- No interaction beyond native read-only disclosure controls is provided.
- A future active implementation would require separate authorization, formula design, tests, and human review.

## Recommended Next Step

Run a DCA2 post-deployment visual and calculation-isolation review. Confirm the preview is readable on desktop/mobile and that current Manual Trade Plan text, totals, and signals are byte-for-byte equivalent with the preview collapsed or expanded.
