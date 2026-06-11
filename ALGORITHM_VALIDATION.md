# Algorithm Validation Report

## Phase 1.5 Results

Tested across 6 portfolio tickers (NVDA, MSFT, AAPL, ASML, KO, BYDDY) with
5 years of weekly price data (2021-06 to 2026-06).

| Metric | Old Simple Strategy | v2 Risk-Adjusted | Change |
|--------|--------------------|------------------|--------|
| Total final value | 168,363 CAD | 166,736 CAD | -0.97% |
| Total invested | 60,000 CAD | 60,000 CAD | 0% |
| Max drawdown (worst) | 44.2% | 44.2% | 0% |

## Algorithm Decision

**Default algorithm: simple dip-buy multiplier (calculate_buy_amount)**

The old simple strategy remains the default because:
- It achieves the highest long-term total return in this backtest.
- Its formula is transparent and easy to understand.
- It has been validated across multiple tickers and time periods.

**Optional algorithm: risk-adjusted v2 (use_risk_adjusted=True)**

The v2 risk-adjusted strategy is available as an opt-in mode for users who want
additional protection against extreme tail-risk events. It now uses the selected
strategy direction, so `dip_buy` increases buys after drops while `momentum`
increases buys after gains.

## Why v1 Was Replaced

The original risk-adjusted multiplier (stable-algo-v1) used target_weekly_vol=0.04
with a wider clamp [0.7, 1.1], plus a 20% drawdown cap and a 4-week decline cap.
This was too conservative for high-growth tickers like NVDA (-19.3% vs old).

v2 fixed this by raising target_weekly_vol to 0.07, narrowing the vol clamp,
removing the standalone 20% drawdown and 4-week decline caps, and adding a
combined stress cap that only triggers when multiple signals align.

## How to Use

**Python backtest** (CLI):

```
# Default: old simple strategy
python main.py --trading-mode backtest --ticker SPY --mode dip_buy

# Opt-in: v2 risk-adjusted (requires modifying backtest.py call)
# In backtest.py: run_backtest(..., use_risk_adjusted=True)
```

**JavaScript dashboard**:

The dashboard currently uses the old simple multiplier logic (in app.js).
The risk-adjusted mode has not been ported to the dashboard yet.
