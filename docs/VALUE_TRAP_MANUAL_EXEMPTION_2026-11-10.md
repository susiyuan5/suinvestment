# Manual Value-Trap Exemption — 2026-11-10

Manual decision support. No order placement; the weekly plan remains a suggestion Su executes by hand.

## Why

Since weekly-dca-v4 an individual stock's scheduled Base is cancelled when it is 35% or more below its 52-week high (`stockBasePreservation.maxDrawdownPct`). Su added INTC and SNDK to the weekly plan specifically to buy them after they had roughly halved (INTC -56.6%, SNDK -60.6% from their June 2026 highs on 2026-11-10). Once their weekly history was published the guard correctly cancelled their Base, which is the opposite of what Su intended for these two stocks. Su chose a per-stock override over changing the threshold for every stock.

## What it does

- A stock can be marked exempt by the owner. For an exempt stock at or past the guard, the engine keeps the scheduled **Base only**. Extra and Crash stay off.
- Nothing else is relaxed. Data errors, panic mode, manual pauses, an unknown drawdown, and a caller that does not supply gate details still cancel the buy. Index ETFs are unaffected (they never used this guard). Stocks that are not marked are unchanged, and below the guard the flag has no effect.
- The global threshold (35%) and all formulas are unchanged.

## Where

- Engine: `weekly-dca-engine.js`, input flag `valueTrapExempt` on a plan item; reason code `STOCK_BASE_MANUAL_VALUE_TRAP_EXEMPTION` on the decision and the plan row (replacing `STOCK_BASE_PRESERVED_PRICE_SIGNAL` when the exemption is what kept Base).
- App: `app.js`. The toggle is a checkbox in the weekly plan's expanded 详情 row, shown only for a non-index stock that is at or past the guard or already exempt. Turning it on asks for confirmation. The row status reads "基础投入 · 手动豁免" in the warning colour and the reason line says the guard was overridden by the owner.
- Storage: `su-investment-pro:value-trap-exemptions-v1`, a JSON array of symbols in this browser only. It is not synced; another device or a cleared browser starts with no exemptions.

## Tests

- `tests/weekly-dca-engine.test.js` — Base only, only for the marked stock, no effect below the guard, hard blocks and unknown drawdown still win.
- `scripts/dca-optimization-smoke.mjs` (`npm run audit:dca`) — toggle offered only on the affected stock, declined confirmation changes nothing, enabling restores Base for that stock alone, persists across reload, and can be withdrawn.

## Limits and risks

- This removes a protection on purpose. A stock that has halved can keep falling; the guard exists because that is common for single companies. There is no backtest of buying through the guard.
- The exemption has no expiry and no size limit beyond the stock's weekly Base. It stays on until Su turns it off, including after the stock recovers.
- It does not add these stocks to the separate 抄底 pool, whose rules cover six fixed symbols.
