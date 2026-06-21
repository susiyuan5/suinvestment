# DCA1 Design Review Report

## A. Review Scope

This is a documentation-only review of `DCA1_MANUAL_TRADE_PLAN_DESIGN.md`, `DCA_STRATEGY_POLICY_LAYER.md`, and the related navigation boundaries in `PROJECT_NAVIGATION.md`.

- No implementation was performed.
- No formulas or signal thresholds were changed.
- No live dashboard behavior was changed.
- No Manual Trade Plan logic was changed.
- No data or generated research outputs were changed.
- No broker, execution, activate, promote, or trade controls were added.

## B. DCA1 Components Reviewed

The review covered:

- Base DCA.
- Extra Dip-Buy.
- Risk Cap / Cash Reserve Guard.
- Final Suggested Buy Amount.
- Explanation / Factor Chain.
- Data-quality failure behavior.
- Mobile layout expectations.
- Future testing plan.
- Safety and research/live separation boundaries.

The proposed design presents these as future policy and UI concepts, not current application behavior.

## C. Base DCA Review

The design clearly defines Base DCA as the stable scheduled participation layer and the primary strategy. It is shown independently from signal score so a weak signal cannot silently cancel the base contribution.

For a future UI mock, Base DCA must remain display-only. The mock must reuse current displayed values or fixed presentation fixtures and must not introduce a new calculation path. It must not imply automatic execution: the user remains responsible for reviewing the plan and manually deciding whether to act.

Review result: clear and suitable for mock-only presentation.

## D. Extra Dip-Buy Review

The design explains that a verified dip, signal score, trend, market regime, volatility, or drawdown may inform an optional additive amount in a future policy. It also clearly states that:

- Extra Dip-Buy starts at zero.
- It is additive and bounded.
- It cannot reduce or cancel Base DCA.
- It is future design only and does not change current recommendation thresholds.
- It does not execute trades.
- Poor, stale, missing, fallback-only, or timestamp-invalid data blocks or neutralizes the extra amount.

Review result: clear and appropriately conservative.

## E. Risk Guard Review

The Risk Cap / Cash Reserve Guard is described as a future planning and display layer that may limit Extra Dip-Buy first and cap the displayed total when reserve, concentration, volatility, drawdown, market regime, or data-quality risk is present.

The design covers:

- Poor or stale data.
- Severe volatility and drawdown.
- Position or portfolio concentration.
- Limited cash and reserve discipline.
- Panic conditions requiring fresh corroborating data and a hard cap.
- Manual overrides requiring explicit source and timestamp labels.

For the mock-only phase, Risk Guard must be shown as explanatory status only. It must not call a broker, create orders, or modify current calculations.

Review result: ready for mock-only display, with explicit unavailable/loading states required.

## F. Final Amount Review

The proposed relationship is traceable:

```text
Base DCA Amount
+ Allowed Extra Dip-Buy Amount
= Pre-Cap Amount
-> Risk Cap / Cash Reserve Guard
= Final Suggested Buy Amount
```

This separates raw signal evidence, Base DCA, optional Extra Dip-Buy, guard effects, and the final displayed manual planning amount.

The future mock must label Final Suggested Buy Amount as:

- Not an order.
- Not automatic trading.
- Not broker-connected.
- Subject to manual user review and decision.

Review result: clear, provided the mock repeats the manual-review label near the final amount.

## G. Factor Chain Review

The design provides an understandable policy path from inputs to the displayed result:

1. Input data and provenance.
2. Signal and dip state.
3. Base DCA plus eligible Extra Dip-Buy policy.
4. Risk, cash reserve, concentration, regime, volatility, and drawdown modifiers.
5. Final displayed manual planning amount.
6. Human-readable explanation of why the amount changed or was blocked.

The expandable Explanation / Factor Chain can make the result understandable without reading source code. The mock should use plain labels, wrap long bilingual text, and distinguish unavailable inputs from neutral inputs.

Review result: suitable for mock-only implementation.

## H. Data Quality Failure Review

The design defines conservative handling for missing, stale, fallback-only, legacy override, and timestamp-invalid data. It prohibits interpreting missing data as a dip or high-conviction opportunity.

The future mock must explicitly cover:

| Condition | Required mock state |
| --- | --- |
| Price missing | Block Extra Dip-Buy; show warning and manual review state |
| QQQ or market regime unavailable | Show regime unavailable/fallback; do not imply a confirmed risk regime |
| Fallback or manual price used | Show source and timestamp; prevent silent confidence escalation |
| Research data unavailable | Mark research evidence unavailable; do not use it as live evidence |
| Data stale | Block or neutralize Extra Dip-Buy and show freshness warning |
| Loading incomplete | Show waiting state; do not show panic, risk, or confident final amount before evaluation finishes |
| Panic input unavailable | Show panic evaluation unavailable rather than active or inactive with false certainty |

Review result: the policy direction is correct. The explicit QQQ, research-unavailable, loading, and panic-unavailable states should be acceptance criteria for DCA2.

## I. Mobile Layout Review

The design avoids a compressed desktop table on mobile by requiring:

- Symbol and Final Suggested Buy Amount in the first readable row.
- Base, Extra, and Guard stacked underneath.
- A single-column expandable Factor Chain.
- Full-width data-quality warnings.
- Wrapping bilingual labels and stable amount columns.
- No activate, promote, trade, broker, or execution controls.

This addresses badge overflow, unreadable chains, unclear amount hierarchy, and accidental execution affordances.

Review result: ready for a responsive mock.

## J. Testing Plan Review

The existing test plan covers policy invariants, data quality, regression safety, responsive layout, accessibility, and deterministic rounding. DCA2 should explicitly verify:

- Normal fresh data.
- Missing and stale price data.
- QQQ unavailable.
- Market regime unavailable.
- Panic evaluation unavailable and loading incomplete.
- Fallback and manual override provenance.
- Risk Guard blocking or capping display states.
- Desktop and mobile wrapping and hierarchy.
- No changes to formulas, thresholds, signal score, multiplier, risk level, market regime, or current buy amount logic.
- No changes to data files or generated research/shadow outputs.
- No Manual Trade Plan logic changes unless a separate future phase explicitly authorizes them.
- No activate, promote, trade, broker, or execution controls.

Review result: adequate after these cases are treated as required mock acceptance checks.

## K. Safety Boundary Review

The reviewed documents clearly state:

- No broker integration.
- No automatic trading.
- No activate, promote, or trade controls.
- No live formula or signal threshold changes.
- No Manual Trade Plan behavior changes in documentation/review phases.
- Research and shadow symbols do not enter the live Manual Trade Plan.
- DCA remains future policy/UI design until an explicit implementation phase authorizes otherwise.
- Human review and manual action remain mandatory.

Review result: safety boundary is clear.

## L. Gaps / Issues Found

Minor clarification items for the future mock specification:

- Give QQQ/market-regime unavailable a named visual state.
- Give loading-incomplete and panic-evaluation-unavailable distinct states.
- Keep research evidence unavailable separate from live data failure.
- Place a concise `manual planning only / not an order` label beside Final Suggested Buy Amount.
- Ensure the visible breakdown and copied text cannot disagree if a later phase ever makes the mock interactive.

No critical blockers found for a future UI mock-only phase.

## M. Approval Status

**Approved with minor documentation clarifications.**

This approval applies only to readiness for a future UI mock-only implementation. It does not approve live logic, trading behavior, formula changes, buy amount logic changes, Manual Trade Plan calculation changes, or automatic execution.

## N. Recommended Next Phase

**Phase DCA2: UI mock-only Manual Trade Plan DCA presentation.**

DCA2 must:

- Be display-only and disabled from execution.
- Preserve all current formulas and buy amount logic.
- Avoid modifying current Manual Trade Plan calculation behavior.
- Add no broker, trade, activate, promote, or order-execution controls.
- Modify no data files or generated research/shadow outputs.
- Include explicit missing, stale, fallback, QQQ unavailable, loading, and panic-unavailable mock states.
- Preserve manual user review as the final decision point.
