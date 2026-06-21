# DCA2 QA2 Expanded Preview Confirmation

## Production Check

Production URL checked:

`https://susiyuan5.github.io/suinvestment/`

The user manually expanded and visually checked the deployed DCA Policy Preview on production.

## Manual Expanded-Click Verification

**Result: passed.**

- DCA Policy Preview expands correctly inside the Manual Trade Plan area.
- The preview remains below and within the current Manual Trade Plan surface.
- Existing actual Manual Trade Plan rows remain visually primary.
- The actual displayed plan amount remains separate from the inactive Final Amount Preview.

## Display-Only Labelling

**Result: passed.**

The expanded preview visibly includes:

- Display-only.
- Mock preview.
- Not used in current buy amount.
- No trading execution.
- Manual decision required.
- Preview-only / inactive policy wording.

The preview is clearly secondary and does not present itself as the active Manual Trade Plan.

## Final Amount Separation

**Result: passed.**

- Current Manual Plan continues to show the existing real planning amount.
- Final Amount Preview remains inactive and visually separate.
- Final Amount Preview does not look like an executable order.
- No preview value feeds back into the actual Manual Trade Plan.

## Factor Chain Readability

**Result: passed with minor density note.**

The Factor Chain Preview is understandable and traces:

1. Current signal.
2. Existing recommendation.
3. Existing manual amount.
4. Inactive DCA policy layer.
5. Inactive/manual-review Risk Guard.
6. Inactive Final Preview.

The chain remains readable, though the small preview cards can feel dense on narrow mobile screens. This is a future visual-polish item, not a safety or behavior blocker.

## Risk Guard Readability

**Result: passed.**

Risk Guard Preview clearly communicates preview, caution, blocked, or manual-review status without implying execution. It remains an explanatory display and does not apply a new risk formula.

## Data-Quality Behavior

**Result: passed.**

When data quality is poor or incomplete, the expanded preview shows a warning/manual-review state instead of a confident active final amount. Missing or fallback data is not presented as a buy opportunity.

## Mobile / Narrow Expanded Layout

**Result: passed with minor readability polish recommended.**

- The expanded preview remains contained on narrow screens.
- Cards stack without becoming an execution-style order ticket.
- Badges and Factor Chain content remain within the preview.
- Final Amount Preview remains readable and subordinate to the actual plan amount.
- Minor spacing/type-density polish may be considered later for the smallest preview cards.

## Forbidden Controls Check

**Result: passed.**

No Buy, Execute, Place Order, Auto Buy, Promote, Activate, or equivalent control is visible in the DCA Preview.

## Broker / Automatic Trading Wording Check

**Result: passed.**

No wording suggests broker connectivity or automatic trading. The visible safety language instead states that there is no trading execution and that manual decision is required.

## Calculation-Isolation Confirmation

**Result: passed.**

This confirmation relies on the DCA2-QA1 code isolation review and the fact that QA2 makes no code changes.

- Actual buy amount logic remains unchanged.
- Live recommendation formulas remain unchanged.
- Signal score, multiplier, risk, action thresholds, and market-regime formulas remain unchanged.
- Manual Trade Plan actual amount source remains unchanged.
- DCA Preview remains display-only and does not write back into calculations.

## Safety Confirmation

- `app.js` changed: no.
- `index.html` changed: no.
- `style.css` changed: no.
- Data files changed: no.
- Generated research/shadow outputs changed: no.
- Activate/promote/trade controls added: no.
- Broker integration added: no.
- Automatic trading added: no.
- Active DCA logic implemented: no.
- Live/default behavior changed: no.

## Overall QA2 Status

**Manual expanded-preview confirmation passed.**

DCA2 remains approved as a display-only mock. This checkpoint does not approve active DCA policy calculations, formula changes, trading behavior, or execution integration.

## Recommended Next Step

Keep DCA2 display-only. If desired, schedule a narrowly scoped mobile readability-polish phase that changes spacing and typography only, with no calculation, data, or trading behavior changes.
