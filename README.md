# Su Investment Pro

Su Investment Pro is a weekly investment calculator, historical backtesting toolkit, and live market decision-support assistant. It is not an automatic trading bot. It never places real orders, never logs in to a brokerage account, and never submits buy or sell instructions through a broker API.

All suggestions are for manual review only. The final trading decision and any brokerage order must be placed manually by the user.

## Files

- `index.html` - App markup
- `style.css` - Dark mobile-first dashboard UI
- `app.js` - Market fetching, weekly snapshot loading, cache, manual overrides, panic mode, and order calculation
- `scripts/update-market-data.js` - GitHub Actions script that calculates weekly percentage changes
- `scripts/update_backtest_prices.py` - Historical weekly snapshot updater for dashboard backtests and market regime inputs
- `data/market-data.json` - Weekly market snapshot served by GitHub Pages
- `data/backtest-prices.json` - Historical weekly close snapshot for dashboard backtests, trend/volatility/drawdown, and QQQ/SPY market regime
- `config.py` - Backtest and risk-control defaults
- `strategy.py` - Weekly-return strategy logic
- `backtest.py` - Weekly historical simulation
- `metrics.py` - Return, drawdown, volatility, Sharpe, and portfolio metrics
- `benchmarks.py` - Fixed DCA, lump sum, and current strategy comparison
- `optimization.py` - Simple parameter search
- `visualization.py` - Optional PNG chart output
- `portfolio.py` - Manual portfolio CSV loading for analysis risk checks
- `analysis.py` - Live or near-live market analysis and suggestion output
- `main.py` - Command-line backtest entry point
- `tests/` - Basic strategy and cash-safety tests
- `data/manual_portfolio.csv` - Example manual portfolio input file

## Settings

- Monthly Budget: CAD 400
- Normal Pool: CAD 300
- Crash Fund: CAD 100 reserve
- Weekly Deployment: CAD 69.23
- Execution Schedule: Every Tuesday 12:00 PM

## Allocations

- BYDDY: 30%
- MSFT: 22%
- NVDA: 18%
- AAPL: 15%
- ASML: 10%
- KO: 5%

## Data Source Priority

1. Finnhub, when the user enters an API key, for current quote
2. Weekly snapshot generated every Tuesday from Yahoo daily closes
3. Yahoo Finance browser fallback, where available
4. 24-hour local cache
5. Manual override

Manual overrides are entered per stock as a weekly percentage value, such as `-9.2`, `+12`, or `10.5`. Overrides are saved in the browser and take priority for that stock.

## Data Refresh Workflow / 数据刷新流程

Use `scripts/update_backtest_prices.py` to maintain `data/backtest-prices.json`, which powers dashboard backtests, trend/volatility/drawdown, and QQQ/SPY Market Regime history.

Run the manual refresh workflow after weekly data updates, before stable releases, or whenever the Data Quality Summary unexpectedly shows Market Regime neutral fallback:

```powershell
python scripts\update_backtest_prices.py
python -m py_compile scripts\update_backtest_prices.py
python -m unittest discover -s tests
node --check app.js
```

Post-refresh, confirm QQQ and SPY exist in `data/backtest-prices.json`, each has at least 50 weekly rows, latest dates are recent, and the dashboard Data Quality Summary shows a computed QQQ/SPY Market Regime source rather than Neutral fallback.

Full workflow and failure-handling notes are in `DATA_REFRESH_WORKFLOW.md`. Future GitHub Actions automation should be handled as a separate Phase 4G.

## Live Calculator Signal

```text
Weekly % = ((LatestClose - WeekAgoClose) / WeekAgoClose) * 100
```

The live calculator displays a buy signal using the lower of the latest 1-day and 5-day moves, so a sharp drop right before Tuesday can affect the next order. The weekly snapshot is updated every Tuesday by GitHub Actions.

## Multiplier Rules

- Drop of 15% or more: `2x`
- Drop of 8% or more: `1.5x`
- Rise of 10% or more: `0.5x`
- Otherwise: `1x`

If QQQ weekly change is at or below `-10%`, panic mode applies `1.3x` to MSFT, NVDA, AAPL, and ASML, and the app displays `PANIC MODE ACTIVE`.

## Backtest Strategy Logic

The Python backtester uses the weekly-return formula requested for historical simulation:

```text
weekly_return = current_week_close / previous_week_close - 1
```

For `dip_buy` mode:

```text
adjustment = -sensitivity * weekly_return
buy_multiplier = 1 + adjustment
```

For `momentum` mode:

```text
adjustment = sensitivity * weekly_return
buy_multiplier = 1 + adjustment
```

The multiplier is clamped:

```text
buy_multiplier = min(max(buy_multiplier, min_multiplier), max_multiplier)
buy_amount = base_buy_amount * buy_multiplier
```

Default parameters:

- `base_buy_amount = 100`
- `sensitivity = 5`
- `min_multiplier = 0.3`
- `max_multiplier = 2.0`
- `initial_cash = 10000`
- `commission_rate = 0.001`
- `slippage_rate = 0.0005`
- `strategy_mode = dip_buy`
- `fractional_shares = True`

## Backtest Risk Controls

- A single buy is capped at 30% of current cash.
- If price drawdown from recent high exceeds 30%, buying is reduced by default.
- If price drops for more than 4 consecutive weeks, conservative mode starts and buy amount is capped at the base buy amount.
- Commission and slippage are included.
- If cash is insufficient, the backtester buys only what available cash allows.

## Installation

Python 3.10+ is recommended.

```bash
python -m pip install -r requirements.txt
```

`matplotlib` is only needed for PNG charts. CSV backtest output uses the Python standard library.

## Backtest Usage

```bash
python main.py --trading-mode backtest --ticker SPY --start 2015-01-01 --end 2025-12-31 --mode dip_buy
```

```bash
python main.py --trading-mode backtest --ticker QQQ --start 2018-01-01 --end 2025-12-31 --mode momentum --base-buy 100 --sensitivity 5
```

Run parameter optimization:

```bash
python main.py --trading-mode backtest --ticker SPY --start 2015-01-01 --end 2025-12-31 --optimize
```

Skip charts:

```bash
python main.py --trading-mode backtest --ticker SPY --start 2015-01-01 --end 2025-12-31 --no-charts
```

## Backtest Outputs

The backtester writes files to `results/`:

- `{TICKER}_trades.csv`
- `{TICKER}_portfolio_history.csv`
- `benchmark_comparison.csv`
- `parameter_optimization.csv`, when `--optimize` is used
- `portfolio_value.png`
- `benchmark_comparison.png`
- `buy_amounts.png`
- `drawdown.png`
- `buy_points.png`

Trade records include date, ticker, price, weekly return, buy multiplier, buy amount, shares bought, total shares, cash, portfolio value, total cost, and unrealized profit.

## Metrics

The backtester calculates:

- `total_return`
- `annualized_return`
- `max_drawdown`
- `volatility`
- `sharpe_ratio`
- `final_portfolio_value`
- `total_invested`
- `cash_left`
- `number_of_trades`
- `average_buy_price`

## Benchmarks

The comparison table includes:

- `weekly_return_adjust_strategy`
- `fixed_dca_strategy`
- `lump_sum_strategy`

Each benchmark reports final portfolio value, total return, max drawdown, and Sharpe ratio.

## Trading Modes

Default mode:

```text
trading_mode = analysis
```

Supported modes:

- `analysis` - live or near-live market analysis and manual trade suggestions only
- `backtest` - historical simulation using past market data
- `paper` - simulated analysis mode only; no real orders
- `live_disabled` - disabled placeholder that exits immediately

The project intentionally does not include live broker execution. Functions such as `place_market_buy_order`, `place_market_sell_order`, and `submit_order` are not used or created.

## Live Analysis Usage

Single ticker:

```bash
python main.py --trading-mode analysis --ticker SPY
```

Multiple tickers:

```bash
python main.py --trading-mode analysis --tickers SPY QQQ VOO
```

Manual cash input:

```bash
python main.py --trading-mode analysis --ticker SPY --available-cash 10000
```

Manual portfolio CSV:

```bash
python main.py --trading-mode analysis --tickers SPY QQQ VOO --portfolio data/manual_portfolio.csv
```

Backtest mode remains available:

```bash
python main.py --trading-mode backtest --ticker SPY --start 2015-01-01 --end 2025-12-31 --mode dip_buy
```

## Manual Portfolio Input

The project never connects to a brokerage account. To include current holdings in analysis risk checks, edit:

```text
data/manual_portfolio.csv
```

Columns:

- `ticker`
- `shares`
- `average_cost`
- `current_value`
- `target_allocation`
- `notes`

This file is manually maintained by the user and is used only for decision-support risk checks.

## Live Analysis Outputs

Analysis mode writes:

- `results/live_analysis.csv`
- `results/manual_trade_checklist.csv`
- `results/analysis_report.txt`

Each analysis row includes:

- date
- ticker
- latest price
- weekly return
- strategy mode
- buy multiplier
- suggested buy amount
- suggested sell amount
- suggested action
- risk level
- reason
- warning
- manual trade note

Possible suggested actions:

- `BUY`
- `REDUCE_BUY`
- `HOLD`
- `CONSIDER_SELL`
- `DO_NOT_BUY`

Manual checklist before acting on any suggestion:

1. Confirm the ticker is correct.
2. Confirm the latest price.
3. Confirm available cash.
4. Confirm suggested buy amount.
5. Confirm portfolio concentration.
6. Confirm current market risk.
7. Confirm this is not financial advice.
8. Place the order manually only if you decide to do so.

## Live Analysis Risk Controls

Default risk parameters are stored in `config.py`:

- `max_cash_usage_per_trade = 0.30`
- `max_single_trade_amount = 500`
- `max_position_pct_per_ticker = 0.30`
- `max_total_equity_exposure = 0.95`
- `large_drawdown_threshold = 0.30`
- `consecutive_decline_weeks_limit = 4`
- `stale_data_limit_hours = 24`

The system will block or warn when:

- ticker is not in `allowed_tickers`
- market data is missing or stale
- cash is too low
- ticker exposure is too high
- total equity exposure is too high
- price is down more than 30% from recent high
- there are more than 4 consecutive weekly declines
- volatility is unusually high

## Deploy to GitHub Pages

1. Push these files to a GitHub repository.
2. Open the repository settings.
3. Go to Pages.
4. Set the source to the branch and folder containing `index.html`.
5. Open the published Pages URL.

## Deploy to Vercel

1. Import the repository in Vercel.
2. Keep the framework preset as Other.
3. Leave build command empty.
4. Deploy.

## Notes

This app stores API keys, cache snapshots, and manual overrides in the browser's `localStorage`. Market data availability depends on the data providers allowing browser requests from the deployed site.

## Tests

```bash
python -m unittest discover tests
```



## Algorithm Status

For the consolidated Phase 3A-3C research conclusion, see [ALGORITHM_RESEARCH_SUMMARY.md](ALGORITHM_RESEARCH_SUMMARY.md).

**Default algorithm**: simple dip-buy multiplier (calculate_buy_amount)
- Tested across 6 tickers over 5 years.
- Recommended for normal long-term investing.

**Optional algorithm**: risk-adjusted v2 (use_risk_adjusted=True)
- Provides protection against extreme tail-risk events.
- Respects `strategy_mode`, including both `dip_buy` and `momentum`.
- Total return is ~1% below the default in normal markets.
- Not recommended as the default.

See [ALGORITHM_VALIDATION.md](ALGORITHM_VALIDATION.md) for full details.


## Risk Warning

This project is for education, historical backtesting, market analysis, and decision support only. It does not provide financial advice and does not execute trades. Historical results and live suggestions do not guarantee future performance.

Never enter brokerage passwords into this project. Never connect strategy output directly to broker order execution. Review every suggestion manually before taking any action in your brokerage account.

## Future Improvement Plan

- Add local CSV import for historical prices.
- Add multi-asset portfolio backtests.
- Add taxable-account assumptions.
- Add richer risk controls and rolling-volatility sizing.
