# DCA Strategy Policy Layer Design

Status: design-only proposal

This document proposes a future Manual Trade Plan policy layer that keeps base DCA as the primary strategy. It does not change live formulas, buy amounts, Manual Trade Plan behavior, dashboard UI behavior, data files, generated research outputs, or broker/trading behavior.

## Policy Goal

The Manual Trade Plan should remain anchored by a predictable base DCA amount. Strategy signals may only influence the optional extra buy amount. They should not cancel or reduce the base DCA unless a separate future risk-control phase explicitly approves a cash-reserve guard.

## Proposed Three-Layer Structure

### 1. Base DCA Amount

Purpose:

- Maintain consistent market participation.
- Avoid underinvestment during persistent uptrends.
- Keep the live plan understandable and stable.

Policy:

- Every active live portfolio symbol receives its normal base DCA allocation when data quality is acceptable.
- Strategy signals do not cancel the base DCA.
- Base DCA remains the primary strategy and the first visible component of the Manual Trade Plan.

### 2. Extra Dip-Buy Amount

Purpose:

- Add opportunistic buying when a symbol has a verified dip signal.
- Let signal logic express conviction without replacing DCA.

Policy:

- Dip-buy, signal score, market regime, or future sandbox signals may adjust only the extra amount.
- Extra dip-buy should be additive and bounded.
- Extra amount should be visibly separated from base DCA in any future UI or report.

### 3. Risk Cap / Cash Reserve Guard

Purpose:

- Prevent overdeployment during poor data conditions, severe volatility, concentration risk, or limited available cash.
- Preserve the existing crash fund / reserve discipline.

Policy:

- Risk cap can limit the total plan or extra dip-buy amount.
- It should not silently reinterpret a missing or stale signal as a high-conviction dip.
- Data-quality failure should block or neutralize extra buy logic first, while preserving the base DCA policy for future human review.

## Scenario Policy Table

| Scenario | Base DCA Amount | Extra Dip-Buy Amount | Risk Cap / Cash Reserve Guard | Manual Trade Plan Meaning |
| --- | --- | --- | --- | --- |
| Normal market | Keep normal scheduled DCA. | None or minimal. | Standard cash reserve applies. | Plan behaves like steady DCA. |
| Small dip | Keep normal scheduled DCA. | Small optional add-on if signal is verified. | Cap extra amount if cash reserve would be weakened. | DCA remains primary; dip signal gently tilts deployment. |
| Medium dip | Keep normal scheduled DCA. | Moderate add-on if signal, freshness, and risk checks agree. | Cap total deployment and preserve reserve. | DCA continues; extra buy expresses dip opportunity. |
| Panic dip | Keep normal scheduled DCA unless a future explicit safety rule says otherwise. | Larger add-on may be allowed only with confirmed fresh data and risk guard. | Strong cap, reserve protection, and data-quality checks are required. | Panic logic cannot become uncontrolled buying. |
| Data-quality failure | Do not treat missing/stale data as a dip. Base DCA policy should be surfaced for human review. | Block or set to zero until data quality is restored. | Warn clearly; prevent stale/fallback data from increasing allocation. | Plan should say data is unreliable, not produce false conviction. |

## Implementation Boundary For A Future Phase

This proposal should not be implemented directly in a documentation phase. A future implementation phase should first define:

- How base DCA is calculated per symbol.
- Which existing signal fields can contribute to extra dip-buy.
- Maximum extra amount per symbol and portfolio.
- How available cash and reserve constraints cap extra buys.
- How stale, fallback, manual override, and missing data affect extra buys.
- How to display base vs extra vs capped amount without changing the meaning of the Manual Trade Plan.
- Tests proving signal changes cannot cancel base DCA unintentionally.

## Recommended Documentation Location

Recommended primary home:

- `DCA_STRATEGY_POLICY_LAYER.md`

Reason:

- This is a design proposal, not current live behavior.
- Keeping it separate avoids implying that the dashboard already uses the policy.
- It can later be linked from `PROJECT_NAVIGATION.md` after a dedicated documentation acceptance phase.

Recommended future references:

- `PROJECT_NAVIGATION.md`: add a short pointer under Manual Trade Plan only after this design is accepted.
- `README.md`: add a short pointer only after implementation starts or the policy becomes an official roadmap item.
- `research/README.md`: not the primary home, because this policy targets Manual Trade Plan behavior, not research-universe scripts.

## Safety Confirmation

- Live formulas changed: no.
- Buy amount logic changed: no.
- Manual Trade Plan behavior changed: no.
- UI behavior changed: no.
- Data files changed: no.
- Generated research/shadow files changed: no.
- Activate/promote/trade controls added: no.
- Broker or execution logic added: no.
