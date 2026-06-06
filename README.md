# Su Investment Pro

Su Investment Pro is a weekly investment calculator and historical backtesting toolkit. The live calculator is built with vanilla HTML, CSS, and JavaScript and runs directly on GitHub Pages with no build step. The Python backtester is for historical simulation only and does not place real-money trades or submit orders.

## Files

- `index.html` - App markup
- `style.css` - Dark mobile-first dashboard UI
- `app.js` - Market fetching, weekly snapshot loading, cache, manual overrides, panic mode, and order calculation
- `scripts/update-market-data.js` - GitHub Actions script that calculates weekly percentage changes
- `data/market-data.json` - Weekly market snapshot served by GitHub Pages
- `config.py` - Backtest and risk-control defaults
- `strategy.py` - Weekly-return strategy logic
- `backtest.py` - Weekly historical simulation
- `metrics.py` - Return, drawdown, volatility, Sharpe, and portfolio metrics
- `benchmarks.py` - Fixed DCA, lump sum, and current strategy comparison
- `optimization.py` - Simple parameter search
- `visualization.py` - Optional PNG chart output
- `main.py` - Command-line backtest entry point
- `tests/` - Basic strategy and cash-safety tests

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
python main.py --ticker SPY --start 2015-01-01 --end 2025-12-31 --mode dip_buy
```

```bash
python main.py --ticker QQQ --start 2018-01-01 --end 2025-12-31 --mode momentum --base-buy 100 --sensitivity 5
```

Run parameter optimization:

```bash
python main.py --ticker SPY --start 2015-01-01 --end 2025-12-31 --optimize
```

Skip charts:

```bash
python main.py --ticker SPY --start 2015-01-01 --end 2025-12-31 --no-charts
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

## Risk Warning

This project is for education, historical backtesting, and simulation only. It does not provide financial advice and does not execute trades. Historical results do not guarantee future performance.

## Future Improvement Plan

- Add local CSV import for historical prices.
- Add multi-asset portfolio backtests.
- Add taxable-account assumptions.
- Add richer risk controls and rolling-volatility sizing.
