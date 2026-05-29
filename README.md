# Su Investment Pro

Su Investment Pro is a production-ready standalone weekly investment calculator built with vanilla HTML, CSS, and JavaScript. It is designed to run directly on GitHub Pages, Vercel, and Mobile Safari with no build step.

## Files

- `index.html` - App markup
- `style.css` - Dark mobile-first dashboard UI
- `app.js` - Market fetching, cache, manual overrides, panic mode, and order calculation

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

1. Finnhub, when the user enters an API key
2. Yahoo Finance fallback
3. 24-hour local cache
4. Manual override

Manual overrides are entered per stock as a weekly percentage value, such as `-9.2`, `+12`, or `10.5`. Overrides are saved in the browser and take priority for that stock.

## Weekly Change Formula

```text
Weekly % = ((LatestClose - WeekAgoClose) / WeekAgoClose) * 100
```

The app compares the latest close with a 5-7 trading day lookback and rounds to 2 decimals.

## Multiplier Rules

- Drop of 15% or more: `2x`
- Drop of 8% or more: `1.5x`
- Rise of 10% or more: `0.5x`
- Otherwise: `1x`

If QQQ weekly change is at or below `-10%`, panic mode applies `1.3x` to MSFT, NVDA, AAPL, and ASML, and the app displays `PANIC MODE ACTIVE`.

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
