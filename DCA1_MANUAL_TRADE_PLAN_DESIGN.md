# DCA1 Manual Trade Plan UI and Logic Design

Status: design-only proposal; not implemented

This report proposes how the Manual Trade Plan could present the policy defined in `DCA_STRATEGY_POLICY_LAYER.md`. It does not change current formulas, signal calculations, buy amounts, Manual Trade Plan behavior, dashboard UI, data, or execution behavior.

## Design Objective

Keep scheduled DCA visible and primary while making any opportunistic amount understandable. A future Manual Trade Plan should show the path from base allocation to final suggested amount without implying that a signal can cancel the base contribution.

Conceptual relationship:

```text
Base DCA Amount
+ Allowed Extra Dip-Buy Amount
= Pre-Cap Amount
-> Risk Cap / Cash Reserve Guard
= Final Suggested Buy Amount
```

This is a policy relationship, not a proposed formula. Exact amounts and thresholds require a separate implementation phase and approval.

## Proposed Per-Symbol Layout

Each symbol remains one compact plan row. The primary line shows the final amount; an expandable explanation reveals its components.

| Display element | Purpose | Proposed treatment |
| --- | --- | --- |
| Base DCA Amount | Stable scheduled participation | First component, always visually primary when data quality permits normal planning |
| Extra Dip-Buy Amount | Optional signal-driven add-on | Separate additive value; show zero when no verified opportunity exists |
| Risk Cap / Cash Reserve Guard | Explains whether deployment was limited | Show status and any cap effect; never present it as alpha or conviction |
| Final Suggested Buy Amount | Amount for manual review | Prominent total after the guard, clearly marked as a suggestion rather than an order |
| Explanation / Factor Chain | Shows why extra amount or cap changed | Collapsed by default; list evidence, freshness, source, and risk flags |

Suggested information hierarchy:

1. Symbol, action label, and Final Suggested Buy Amount.
2. Inline breakdown: `Base + Extra`, followed by a guard status.
3. Expandable Explanation / Factor Chain.
4. Data provenance, freshness, and warnings next to the affected component.

The existing copyable text should eventually mirror the same breakdown so the visible plan and copied plan cannot disagree.

## Signal-to-Extra Mapping Policy

Existing signals should be interpreted only as inputs to the optional Extra Dip-Buy Amount:

| Existing input | Future policy use | Must not do |
| --- | --- | --- |
| Signal score | Scale an eligible extra amount within approved bounds | Reduce or cancel Base DCA |
| Dip / recent return evidence | Establish whether an extra amount is eligible | Treat missing or stale data as a dip |
| Trend and market regime | Moderate the extra amount or its cap | Rewrite the Base DCA schedule |
| Volatility and drawdown | Inform extra-buy bounds and risk flags | Automatically create an uncapped panic buy |
| Portfolio concentration and cash state | Limit the extra amount or final total | Hide the reason for a cap |
| Manual override | Recompute affected evidence with explicit provenance | Be treated as unlabelled fresh market data |

The future calculation boundary should be explicit:

- Base DCA is calculated independently from the signal score.
- Extra Dip-Buy begins at zero and is added only when freshness and eligibility checks pass.
- The guard can reduce Extra Dip-Buy first and may cap the final total according to a separately approved reserve policy.
- No negative extra amount is allowed.
- A signal state cannot convert Base DCA into zero by itself.

## Scenario Display States

| Scenario | Base display | Extra display | Guard / warning display | Final-plan interpretation |
| --- | --- | --- | --- | --- |
| Normal market | Normal scheduled amount | Zero or minimal | Standard reserve status | Steady DCA remains primary |
| Small dip | Normal scheduled amount | Small verified add-on | Show remaining reserve capacity | Gentle DCA tilt |
| Medium dip | Normal scheduled amount | Moderate verified add-on | Show total and concentration caps | Opportunity is additive and bounded |
| Panic dip | Normal scheduled amount, subject only to an explicitly approved future safety policy | Potential larger add-on only with fresh corroborating data | Strong warning and hard cap | Never imply unlimited buying |
| Data-quality failure | Show Base DCA policy as requiring human review rather than false precision | Zero / unavailable | Prominent stale, fallback, missing, or legacy-override warning | Do not create conviction from unreliable inputs |

## Data-Quality Failure Behavior

The future UI should fail visibly and conservatively:

- Extra Dip-Buy is zero or unavailable when required signal fields are stale, missing, fallback-only, or lack valid timestamps.
- Final Suggested Buy Amount must not imply that unreliable data produced an opportunistic recommendation.
- Base DCA should be labelled as a policy amount pending human review, not silently removed by signal failure.
- The explanation should identify which fields failed freshness checks and their provenance.
- Manual overrides must retain their source and timestamp labels.
- Copy text must include the data-quality warning whenever the visible row does.

## Mobile Layout Notes

- Keep Symbol and Final Suggested Buy Amount on the first row.
- Stack Base, Extra, and Guard as three short labelled rows below it; do not compress all values into one overflowing sentence.
- Use a native disclosure control for Explanation / Factor Chain, collapsed by default.
- Keep data-quality warnings full width and immediately above the explanation disclosure.
- Allow labels to wrap without changing numeric column widths.
- Preserve a stable amount column so loading, zero-extra, and capped states do not shift the row.
- The copy command remains a single clear action; no activate, promote, trade, or execution controls are introduced.

## Future Test Plan

### Policy invariants

- Base DCA is unchanged when only signal score, dip depth, trend, or volatility changes.
- Extra Dip-Buy is never negative.
- A weak or absent signal produces zero extra rather than cancelling Base DCA.
- Final amount equals the guarded result of Base plus Extra, subject to documented rounding.
- Risk caps affect the intended component and expose the cap reason.

### Data-quality cases

- Fresh live/cached data permits normal eligibility evaluation.
- Stale, missing, fallback-only, and timestamp-less legacy override cases block Extra Dip-Buy.
- Timestamped manual overrides remain clearly labelled and are applied consistently.
- Visible warnings and copied text contain the same reliability status.

### Regression cases

- Before any rollout, snapshot current Manual Trade Plan output for representative symbols and compare it with the future feature-disabled path.
- Existing signal score, multiplier, risk level, market regime, action thresholds, and current default output remain unchanged when the policy layer is disabled.
- Portfolio rounding and total reconciliation remain deterministic.
- Existing Python unit tests and JavaScript syntax checks continue to pass.

### Responsive and accessibility cases

- Verify desktop and narrow mobile widths with long bilingual labels and warnings.
- Confirm no amount, label, or disclosure overlaps adjacent content.
- Confirm keyboard access, focus order, disclosure state, and screen-reader labels.
- Confirm loading and data-failure states do not cause layout shifts or expose stale amounts as fresh.

## Documentation Placement Decision

- `DCA_STRATEGY_POLICY_LAYER.md` is the primary policy source because it defines strategy boundaries without claiming implementation.
- `DCA1_MANUAL_TRADE_PLAN_DESIGN.md` is the companion UI/logic design report.
- `PROJECT_NAVIGATION.md` should link both documents under Manual Trade Plan and clearly label them design-only.
- `README.md` should not be changed in DCA1. A concise pointer belongs there only after the policy becomes an accepted roadmap item or implementation begins.
- `research/README.md` is not the right primary location because the proposal governs the live Manual Trade Plan boundary, not research-universe tooling.

## Safety Confirmation

- Live formulas changed: no.
- Manual Trade Plan logic changed: no.
- UI behavior changed: no.
- Data files changed: no.
- Generated research/shadow files changed: no.
- Activate, promote, trade, broker, or execution controls added: no.
- Live/default behavior changed: no.
