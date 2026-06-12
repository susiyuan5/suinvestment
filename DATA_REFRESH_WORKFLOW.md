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

## GitHub Actions Automation

Phase 4G adds `.github/workflows/update-backtest-prices.yml` for automated historical snapshot refresh.

The workflow can run in two ways:

- Manual: open GitHub Actions, choose `Update historical backtest prices`, and run the workflow.
- Scheduled: weekly on Saturday at 12:00 UTC, after the regular US market week has closed.

The automated workflow:

1. Checks out the repository.
2. Sets up Python.
3. Sets up Node.
4. Installs Python dependencies from `requirements.txt`.
5. Runs `python scripts/update_backtest_prices.py --refresh-all`.
6. Validates `data/backtest-prices.json`.
7. Compiles `scripts/update_backtest_prices.py`.
8. Runs `python -m unittest discover -s tests`.
9. Runs `node --check app.js`.
10. Opens a pull request only if `data/backtest-prices.json` changed and every validation step passed.

The workflow uses GitHub CLI (`gh`) to create the pull request and avoids a third-party pull-request action. It needs these repository permissions:

- `contents: write`
- `pull-requests: write`

PR-based updates are safer than direct pushes to `main` because the refreshed snapshot can be reviewed before merge. This matters because Market Regime can affect live recommendation outputs through real data inputs.

## Automated Validation Checks

The GitHub Actions workflow fails before opening a PR if:

- `data/backtest-prices.json` is missing.
- The JSON is invalid.
- QQQ is missing.
- SPY is missing.
- QQQ has fewer than 50 weekly rows.
- SPY has fewer than 50 weekly rows.
- The latest QQQ date is missing.
- The latest SPY date is missing.
- Python tests fail.
- `node --check app.js` fails.

The pull request body includes:

- QQQ row count
- QQQ latest date
- SPY row count
- SPY latest date
- Python test status
- Node check status

## If Automated Refresh Fails

If Yahoo historical access fails in GitHub Actions:

1. Do not manually merge any partial data output.
2. Confirm the committed `data/backtest-prices.json` still has valid QQQ/SPY histories.
3. Re-run the workflow later from `workflow_dispatch`.
4. If failures persist, run the manual refresh locally and commit only after validation passes.

If QQQ/SPY validation fails:

1. Leave the existing committed snapshot in place.
2. Inspect whether Yahoo returned partial or malformed data.
3. Do not merge a PR that removes QQQ/SPY or reduces either below 50 weekly rows.

Do not add automatic trading, broker integration, or algorithm promotion as part of data refresh automation.
