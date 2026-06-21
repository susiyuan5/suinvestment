# DCA2 QA1 Post-Deployment Review

## Production URL Checked

`https://susiyuan5.github.io/suinvestment/`

The production page, versioned DCA2 stylesheet, and versioned DCA2 application script returned HTTP 200 with no-cache requests. The deployed HTML contains `DCA Policy Preview`, the stylesheet contains `.dca-preview-panel`, and the application script contains `renderDcaPolicyPreview`.

## Deploy / Load Result

Production loaded normally in headless Chrome after a cache-busting query and an extended load budget. Market data and the existing six live portfolio symbols rendered. No deployment-blocking console or asset symptom was visible in the captured page.

## Manual Trade Plan Visual Result

The existing Manual Trade Plan remains the primary surface. Its symbol rows, existing recommendation labels, actual displayed amounts, score/risk information, total, Copy control, and copy-text disclosure remain present.

The current plan rows were not visually replaced or relabelled as DCA output.

## DCA Preview Location

`DCA Policy Preview / 定投策略预览` appears inside the Manual Trade Plan panel:

1. Below the existing actual plan rows and total.
2. Above the existing copy-text details.
3. Collapsed by default.

This placement keeps the real Manual Trade Plan visually primary and the preview secondary.

## Display-Only Labelling Result

The collapsed summary is labelled `Display-only mock / 仅展示模拟`. Expanded content repeats:

- Display-only.
- Mock preview.
- Not used in current buy amount.
- No trading execution.
- Manual decision required.
- Preview only; not an order and not broker-connected.

No Buy Now, Execute, Place Order, Auto Buy, Promote, Activate, or equivalent execution control exists in the preview.

## Calculation-Isolation Result

Passed.

The DCA2 `app.js` diff was audited for assignments and changes to formula functions. It adds one DOM reference, one render call after the existing finalized signals are available, and display-only DOM helpers.

Confirmed:

- Existing buy amount calculation functions were not changed.
- Existing recommendation functions were not changed.
- Existing risk-level functions were not changed.
- Existing market-regime logic was not changed.
- Signal score, multiplier, risk level, action thresholds, and market-regime formulas were not changed.
- Preview rendering reads `signal.suggested_buy_amount`, action, risk, score, provenance, and existing market status only for text display.
- Preview rendering does not assign to a signal, portfolio state, recommendation state, amount state, plan total, or `orderTextEl`.
- Preview rendering does not alter the actual Manual Trade Plan amount source.
- Base DCA, Extra Dip-Buy, Risk Guard, and Final Amount Preview do not calculate an active amount.

## Desktop Layout Result

Passed at 1440px production width.

- Manual Trade Plan remains readable in the existing sidebar.
- DCA Preview is visibly subordinate and collapsed by default.
- Preview labelling remains legible without resembling an order ticket.
- Existing plan rows and controls did not shift into an unusable layout.
- No visible overflow was introduced by the collapsed preview.
- Static review confirms expanded symbol cards use compact grids and wrapped Factor Chain text.

## Mobile Layout Result

Passed at a 390px production viewport, with one existing-page caveat noted below.

- The dashboard uses its existing single-column flow.
- DCA Preview remains within the Manual Trade Plan panel and is collapsed by default.
- Preview stages switch to one column below 720px.
- Summary labels, badges, warning text, and Factor Chain entries have wrapping and overflow containment.
- Final Amount Preview is an inactive status card, not a more authoritative amount than the actual plan.
- No execution control is present.

The production mobile screenshot shows the broader dashboard's existing dense typography at 390px; no DCA-specific horizontal overflow was observed.

## Loading / Data-Quality Behavior Result

Passed by code-path and deployed asset review.

- Before `state.dataQualityEvaluated`, preview status is Waiting and no confident final preview is displayed.
- Stale, missing, unavailable, or field-level quality issues produce Manual Review and block the mock Extra Dip-Buy status.
- QQQ/market-regime fallback produces a warning-only state and is not treated as a buy opportunity.
- Final Amount Preview remains `Not active` even with valid data.
- Missing data is never converted into a positive DCA opportunity.

## Panic / Data Quality Regression Check

Passed.

- DCA2 did not change `canShowPanicBanner`, panic calculation, or panic gating.
- The production capture did not show a premature Panic banner.
- DCA2 did not change Data Quality Summary initialization or placeholder logic.
- Data Quality Summary remains a separate existing panel and is not driven by preview state.

## Research Sandbox Boundary Check

Passed.

- The production Research Sandbox entry remains present.
- `research-sandbox.html` returned HTTP 200 and retains read-only/research-only labelling.
- DCA2 changed no research sandbox files.
- Shadow Observation remains read-only and separate.
- The preview reads only live Manual Trade Plan entries and does not add research/shadow symbols.

## Issues Found

No critical DCA2 issue was found.

Tooling limitation: the in-app browser automation connection was unavailable in this session. Production load and visual checks used no-cache HTTP asset verification plus headless Chrome desktop/mobile captures. Expanded-preview behavior was verified through deployed markup, deployed CSS, and code-path review rather than an automated production click sequence.

## Fixes Applied

None. No code or style change was required.

## Safety Confirmation

- Actual buy amount logic changed: no.
- Live recommendation formulas changed: no.
- Signal score, multiplier, risk, threshold, or market regime formulas changed: no.
- Manual Trade Plan actual amount source changed: no.
- UI execution controls added: no.
- Broker or automatic trading added: no.
- Data files changed: no.
- Generated research/shadow files changed: no.
- Research Sandbox behavior changed: no.
- Live/default calculation or trading behavior changed: no.

## Remaining Known Issues

- The preview intentionally produces no DCA policy amount because no active policy calculation is approved.
- Expanded production interaction was not clicked through automatically in this session due to the browser-automation connection limitation.
- The broader mobile dashboard remains information-dense at 390px; this predates DCA2 and was not changed in QA1.

## Recommended Next Step

Keep DCA2 display-only. Perform one human production click-through of the expanded preview on desktop and mobile after the next normal deployment check. Do not proceed to active DCA logic without a separate formula specification, isolation tests, and explicit authorization.
