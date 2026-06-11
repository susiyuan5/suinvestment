# Algorithm Research Summary

## Current Research Conclusion

Phase 3A, Phase 3B, and Phase 3C do not justify changing live recommendations, changing the Python default strategy, promoting any v3 candidate, or promoting any hybrid strategy.

The current evidence says:

- Fixed Weekly DCA is the strongest benchmark for reliable cash deployment.
- Simple Dip-Buy remains the Python backtest default because it has better equal-invested efficiency, but it can underinvest during persistent uptrends.
- Risk-Adjusted v2 remains optional because it is somewhat more conservative, but it has not shown enough broad return, drawdown, or stress-window advantage to become default.
- Trend-aware Hybrid is sandbox-only. It reduces cash drag, but it does not robustly beat Fixed Weekly DCA.
- The dashboard Enhanced Signal Model remains unchanged as a live manual decision-support model.

No algorithm behavior changed as part of this research consolidation.

## Decision Table

| Strategy | Current status | Strength | Weakness | Current role | Promotion decision |
| --- | --- | --- | --- | --- | --- |
| Fixed Weekly DCA | Baseline benchmark | Strongest cash deployment; wins many raw true-contribution account paths | Does not improve buy-point quality; can overbuy into weak setups | Primary benchmark for all future timing tests | Do not promote as Python default yet; keep as benchmark |
| Simple Dip-Buy | Current Python default | Strong equal-total-invested efficiency; better buy-point quality per invested dollar | Can leave cash idle during strong uptrends; raw account path can lag DCA | Default Python backtest timing strategy | Keep default for now |
| Risk-Adjusted v2 | Optional mode | More conservative behavior in some stress windows; useful tail-risk variant | Did not show enough broad stress-window or return advantage | Optional conservative/tail-risk mode | Do not promote |
| v3 parameter candidate | Sandbox research candidate | Phase 3A balanced screen found promising parameter clusters | Not validated across enough regimes; not robust enough in Phase 3B | Research object for future out-of-sample tests | Do not promote |
| Hybrid 70/30 and 80/20 | Sandbox research candidates | Reduce Simple Dip-Buy cash drag while preserving some dip tilt | Did not win rolling portfolio windows; diluted Simple's equal-invested edge | Sandbox comparison set | Do not promote |
| Trend-aware Hybrid | Sandbox research candidate | Nearly eliminates cash drag and is the strongest Phase 3C hybrid | Still does not robustly beat Fixed DCA; ex-NVDA result is not clearly superior | Possible future sandbox UI display candidate only | Do not promote |
| Dashboard Enhanced Signal Model | Live manual decision-support model | Uses current dashboard signal workflow for manual review | Separate from Python backtest defaults; not validated as a replacement by Phase 3A-3C | Keep live dashboard behavior unchanged | No live change justified |

## Evidence By Phase

## Phase 3A: Stress Test And Sensitivity

Phase 3A showed that the timing edge was not yet proven. In the local initial-cash-pool backtest, Fixed Weekly DCA slightly outperformed Simple Dip-Buy on average, while Risk-Adjusted v2 did not produce enough drawdown or stress-window benefit to replace the default.

The Phase 3A.1 audit found that the DCA advantage was narrow and sample-dependent. NVDA path dependency explained much of the full-period DCA edge; excluding NVDA, Simple Dip-Buy slightly outperformed Fixed DCA in the audited initial-pool comparison.

Conclusion from Phase 3A: keep Simple Dip-Buy as default, keep Risk-Adjusted v2 optional, and keep v3 candidates sandbox-only.

## Phase 3B: Stronger Validation Framework

Phase 3B separated validation modes:

- Initial cash pool
- True weekly contribution
- Equal-total-invested normalization
- Rolling walk-forward windows
- Ex-NVDA portfolio checks
- Per-ticker and portfolio robustness

The true weekly contribution path favored Fixed Weekly DCA because DCA deployed cash earlier and more consistently. The equal-total-invested analysis favored Simple Dip-Buy, meaning Simple still showed better buy-point efficiency once cash-deployment timing was normalized away.

Conclusion from Phase 3B: DCA's advantage is real on raw contribution paths, but it is partly a cash-deployment artifact. Simple Dip-Buy is not robustly better than DCA in account-value terms, but DCA is not clearly better in buy-point quality.

## Phase 3C: Hybrid DCA + Dip Tilt Sandbox

Phase 3C tested Hybrid 70/30, Hybrid 80/20, and Trend-aware Hybrid against Fixed DCA, Simple Dip-Buy, and Risk-Adjusted v2.

The best hybrid was Trend-aware Hybrid. It reduced underinvestment dramatically, leaving about 0.01% contributed cash idle versus about 2.08% for Simple Dip-Buy. However, it did not robustly outperform Fixed Weekly DCA. Its rolling portfolio return win rate was 30.77% versus 53.85% for Fixed DCA, and its average rolling portfolio return margin versus DCA was about -0.04 percentage points.

Phase 3C also showed that the hybrid approach did not fully preserve Simple Dip-Buy's equal-invested advantage. Simple Dip-Buy averaged 115.45% in full-period per-ticker equal-invested return, while the best hybrid averaged 113.01%.

Conclusion from Phase 3C: Trend-aware Hybrid is useful for sandbox research, but not strong enough to promote.

## Current Strategy Roles

## Fixed Weekly DCA

Fixed Weekly DCA should be treated as the core benchmark. A timing strategy must beat it across rolling windows, tickers, and contribution modes before it can be considered robust. DCA's main value is not signal quality; it is consistent deployment.

## Simple Dip-Buy

Simple Dip-Buy remains the Python default. Its strongest evidence is equal-invested efficiency, which suggests it can choose better buy points per invested dollar. Its weakness is underinvestment during strong uptrends, especially in high-growth assets.

## Risk-Adjusted v2

Risk-Adjusted v2 remains optional. It is useful as a conservative/tail-risk variant, but the available stress-window results do not justify making it default.

## Trend-aware Hybrid

Trend-aware Hybrid is sandbox-only. It directly addresses Simple Dip-Buy's cash-drag problem, but the available evidence says it behaves more like a near-DCA deployment rule than a clearly superior timing strategy. It may be worth showing later as an experimental sandbox comparison, not as a recommended or live strategy.

## Dashboard Enhanced Signal Model

The dashboard Enhanced Signal Model remains a live manual decision-support model. Phase 3A-3C did not modify or validate a replacement for the dashboard live recommendation logic. It should remain unchanged.

## What Is Not Justified Yet

- No live strategy change is justified.
- No default Python strategy change is justified.
- No v3 parameter candidate promotion is justified.
- No hybrid promotion is justified.
- No broker integration or automatic trading should be added from these results.

## What Future Testing Needs

Future research should add:

- Longer historical coverage before June 2021.
- More market regimes, including older bull markets, crashes, sideways periods, and rate-cycle shifts.
- Out-of-sample validation that does not reuse the same local optimization period.
- More tickers and broader asset classes.
- Separate reporting for raw account value, equal-invested efficiency, drawdown, volatility, Calmar, cash usage, and per-ticker robustness.
- A clear benchmark requirement: any timing strategy must beat Fixed Weekly DCA robustly, not only in one endpoint or one high-growth ticker path.

## Final Decision

Keep the system as-is:

- Python default: Simple Dip-Buy.
- Optional mode: Risk-Adjusted v2.
- Benchmark: Fixed Weekly DCA.
- Sandbox only: v3 candidates and hybrid candidates.
- Live dashboard: Enhanced Signal Model unchanged.

The research direction is promising, but the evidence is not strong enough for production or default-strategy promotion.
