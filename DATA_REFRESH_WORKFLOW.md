# Data Refresh Workflow / 数据刷新流程

This workflow keeps the dashboard historical price snapshot current so Market Regime can use real QQQ/SPY weekly history instead of neutral fallback.

This is a data-maintenance process only. It does not change algorithm logic, live recommendation formulas, the Python default strategy, broker behavior, automatic trading behavior, fallback caps, or dashboard UI behavior.

## What Gets Refreshed

Run `scripts/update_backtest_prices.py` to update `data/backtest-prices.json`.

The snapshot contains weekly closes for:

- Current dashboard portfolio symbols: BYDDY, MSFT, NVDA, AAPL, ASML, KO
- Market regime proxies: QQQ, SPY

The file shape should remain:

```json
{
  "generatedAt": "2026-06-12T00:00:00+00:00",
  "source": "Yahoo Finance chart weekly data generated locally",
  "symbols": {
    "QQQ": [
      { "date": "2026-06-11", "close": 717.119995 }
    ]
  }
}
```

## Why QQQ/SPY Matter

The dashboard Market Regime path uses QQQ first, then SPY, then neutral fallback:

1. Load QQQ weekly history from `data/backtest-prices.json`.
2. If QQQ has at least 50 valid weekly closes, calculate Market Regime from QQQ.
3. Otherwise try SPY.
4. If SPY also has fewer than 50 valid weekly closes, use Neutral fallback.

At least 50 weekly closes are required because the regime formula uses a 50-week moving average. It also checks a 20-week moving average and recent drawdown.

## When To Refresh

Refresh historical data:

- After the weekly scheduled market snapshot updates.
- Before relying on Market Regime after a long gap in maintenance.
- After changing the portfolio ticker universe.
- If the Data Quality Summary shows Neutral fallback for Market Regime unexpectedly.
- Before tagging a stable release that depends on current Market Regime data.

## Manual Refresh Commands

Run these commands from the repository root:

```powershell
python scripts\update_backtest_prices.py
python -m py_compile scripts\update_backtest_prices.py
python -m unittest discover -s tests
node --check app.js
```

The default script behavior preserves existing symbol history when it already has at least 50 weekly rows, and fetches missing or short histories. Use `--refresh-all` only when intentionally refreshing every symbol:

```powershell
python scripts\update_backtest_prices.py --refresh-all
```

## Post-Refresh Checks

After refreshing, check:

- QQQ exists in `data/backtest-prices.json`.
- SPY exists in `data/backtest-prices.json`.
- QQQ has at least 50 weekly rows.
- SPY has at least 50 weekly rows.
- Latest QQQ/SPY dates are recent enough for the intended dashboard use.
- Data Quality Summary does not show Neutral fallback when QQQ/SPY data is valid.
- Market Regime shows a computed proxy, such as QQQ, with row count, latest date, source, and Fresh status.

Useful local check:

```powershell
$json = Get-Content data\backtest-prices.json -Raw | ConvertFrom-Json
@('QQQ','SPY') | ForEach-Object {
  $rows = @($json.symbols.$_)
  [PSCustomObject]@{
    Symbol = $_
    Count = $rows.Count
    LatestDate = $rows[$rows.Count - 1].date
    LatestClose = $rows[$rows.Count - 1].close
  }
} | Format-Table -AutoSize
```

## If Yahoo Historical Access Fails

If the refresh script cannot fetch Yahoo historical data:

1. Do not delete the existing committed `data/backtest-prices.json`.
2. Check whether QQQ/SPY already have at least 50 rows in the committed snapshot.
3. Retry later, because provider access can be intermittent.
4. Avoid committing a regenerated snapshot that removes QQQ/SPY or reduces them below 50 rows.
5. If the failure persists, keep the current static snapshot and document the failure in the phase report.

The dashboard has a neutral fallback path, but Phase 4E showed that missing QQQ/SPY history can affect live recommendations. Preserve the static snapshot unless a replacement has been validated.

## Phase 4G Automation Plan

Phase 4G can automate this workflow, but automation should be implemented separately.

Recommended automation:

1. Add a GitHub Actions job that runs weekly after `scripts/update-market-data.js`.
2. Run `python scripts\update_backtest_prices.py`.
3. Run a snapshot completeness check for QQQ/SPY row counts and latest dates.
4. Run `python -m unittest discover -s tests`.
5. Run `node --check app.js`.
6. Open a pull request or commit only when the snapshot is complete and checks pass.

Do not add automatic trading, broker integration, or algorithm promotion as part of refresh automation.
