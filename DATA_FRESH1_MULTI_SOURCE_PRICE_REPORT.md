# DATA-FRESH1 Multi-Source Price Freshness Report

Date: 2026-06-21  
Baseline: `2f49866c282d24d3ec47fbfd24c385bfeeff067f` (`stable-dca-l1-tune1-manual-review-policy`)

## Outcome

DATA-FRESH1 adds a script-only, validated multi-source quote pipeline while preserving the dashboard's local-JSON data boundary. It does not weaken the DCA stale-data gate.

The refresh obtained newer Yahoo Finance API quotes for all eight requested symbols. Because the audit ran on a weekend and the latest market timestamp was 2026-06-18, the quote age was approximately 66 hours. Under the required strict 24-hour rule, all six live symbols correctly remain stale and in `manual_review`. The improvement is operational: the updater now records real quote timestamps and provenance, tries a second public API, safely preserves prior data on failure, and is scheduled after each US trading day instead of once per week.

## Stale fallback cause

The previous live snapshot path had two separate issues:

1. `data/market-data.json`, not `data/backtest-prices.json`, supplies the live dashboard price/1D/5D rows.
2. Its workflow ran only once per week on Tuesday while the dashboard freshness threshold was 24 hours.

The audited snapshot was generated on 2026-06-16 and was still being used on 2026-06-21. All six rows therefore entered the DCA poor-data gate. `data/backtest-prices.json` supplies historical indicators and QQQ/SPY market-regime history; refreshing it alone could not repair live-row freshness.

## Source priority and validation

The new `scripts/price_sources.py` path uses:

1. Yahoo Finance Chart public JSON API, using query1 then query2 endpoints.
2. Stooq public daily CSV API.
3. Previous local snapshot as an explicit stale fallback.

No login, scraping, paywall bypass, CAPTCHA handling, or secret is used. No API key is committed.

Every candidate records:

- symbol and positive numeric price;
- quote timestamp and fetch timestamp;
- source name and `api`/`fallback` source type;
- freshness age in hours;
- validation status, reason, and warnings;
- latest, previous, and five-session comparison dates and closes.

Quotes dated in the future or with non-positive prices are rejected. Quotes older than 24 hours remain stale. An untrusted source with a price move above 40% requires manual review; an 80%+ move always requires review. A stale or failed source cannot overwrite a currently fresh validated snapshot. If every provider fails, the previous price is retained as `stale_fallback`; when no previous price exists, the symbol is explicitly unavailable and no price is guessed.

## Refresh results

### Live market snapshot

| Symbol | Source | Latest date | Validation | Result |
| --- | --- | --- | --- | --- |
| BYDDY | Yahoo Finance Chart API | 2026-06-18 | stale, about 66h | Newer quote stored; DCA remains review-capped |
| MSFT | Yahoo Finance Chart API | 2026-06-18 | stale, about 66h | Newer quote stored; DCA remains review-capped |
| NVDA | Yahoo Finance Chart API | 2026-06-18 | stale, about 66h | Newer quote stored; DCA remains review-capped |
| AAPL | Yahoo Finance Chart API | 2026-06-18 | stale, about 66h | Newer quote stored; DCA remains review-capped |
| ASML | Yahoo Finance Chart API | 2026-06-18 | stale, about 66h | Newer quote stored; DCA remains review-capped |
| KO | Yahoo Finance Chart API | 2026-06-18 | stale, about 66h | Newer quote stored; DCA remains review-capped |
| QQQ | Yahoo Finance Chart API | 2026-06-18 | stale, about 66h | Market quote refreshed; historical regime remains independently fresh |
| SPY | Yahoo Finance Chart API | 2026-06-18 | stale, about 66h | Market-context reference quote added |

Yahoo succeeded for all eight symbols. Stooq was attempted after the Yahoo candidate was identified as stale, but this environment returned an SSL error for BYDDY and insufficient CSV data for the other symbols. Those errors are retained in `results/data_freshness/market_price_freshness.json`; they did not invalidate or overwrite the Yahoo candidate.

### Historical snapshot

`python scripts/update_backtest_prices.py` now refreshes complete histories by default and records per-symbol metadata. The final validation run refreshed all eight histories successfully through Yahoo, with 264 weekly rows through 2026-06-18 for each symbol. An earlier transient SSL failure demonstrated that complete MSFT/SPY histories were preserved rather than replaced with incomplete data.

## Before/after dashboard state

| Measure | Before | After refresh |
| --- | --- | --- |
| Live quote date | 2026-06-16 | 2026-06-18 |
| Live source | Weekly snapshot | Yahoo Finance Chart API via local JSON |
| Fresh live symbols | 0/6 | 0/6 during weekend audit |
| Stale live symbols | 6/6 | 6/6 during weekend audit |
| manual_review | 6 | 6 |
| blocked | 0 | 0 |
| DCA multiplier range | 0.77x-1.00x | 0.80x-1.00x |
| Above 1.00x | none | none |
| Equal to 1.00x | AAPL, KO | AAPL, ASML, KO |
| Below 1.00x | BYDDY, MSFT, NVDA, ASML | BYDDY, MSFT, NVDA |

The after-refresh multipliers changed only because newer validated price content was loaded. The stale-data cap remained active, so no symbol exceeded `1.00x`.

The Data Quality Summary now distinguishes a stale API quote from a fallback snapshot: current rows show `Stale = 6` and `Fallback = 0`. A true previous-snapshot carry-forward continues to count as fallback.

## Automation

The market-data workflow now runs at `22:30 UTC` Monday through Friday, after the normal US market close. It commits both `data/market-data.json` and the compact freshness report. A weekday run with a quote timestamp no older than 24 hours can produce `fresh + validated + api`; weekend or failed runs remain stale/manual-review as required.

## Files and behavior

- `data/backtest-prices.json`: changed by an intentional historical refresh; data shape remains backward compatible and now includes metadata/errors.
- `data/market-data.json`: changed by the live quote refresh and now includes field-level source validation metadata.
- `app.js`: changed only to parse quote timestamps/source validation and display fallback counts accurately. Signal-score, action, risk, market-regime, and DCA multiplier formulas were not changed.
- `dca-policy.js`: unchanged.
- Live symbols: unchanged.
- Research prices/universe and `research/results/phase6s/*`: unchanged.
- Broker/order/automatic trading: unchanged and absent.
- Buy/Execute/Auto Buy/Promote/Activate controls: not added.

## Remaining risks

- Strict 24-hour freshness intentionally marks Friday closes stale later in the weekend. No weekend exception was introduced.
- Both public providers can rate-limit, block, or change response formats.
- Stooq was unavailable in the current environment, so Yahoo remained the only successful provider for this run.
- Public quote timestamps are market timestamps, not guaranteed executable prices.
- A fresh quote does not bypass trend, drawdown, RSI, volatility, concentration, cash, or final-clamp gates.

## Validation

- `python -m py_compile scripts/price_sources.py scripts/update_backtest_prices.py`
- `python scripts/price_sources.py`
- `python scripts/update_backtest_prices.py`
- `python -m unittest discover -s tests`
- `node tests/dca-policy.test.js`
- `node --check app.js`
- `node --check research-sandbox.js`
