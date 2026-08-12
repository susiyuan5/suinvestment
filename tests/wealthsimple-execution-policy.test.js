const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const policy = require("../wealthsimple-execution-policy.js");
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "execution_policy_cases.json"), "utf8"));
test("Wealthsimple execution policy matches golden fixtures", () => {
  for (const fixture of cases) {
    const result = policy.execute({ ...fixture.input }, { now: Date.parse("2026-08-12T12:00:00Z") });
    for (const [key, value] of Object.entries(fixture.expected)) assert.equal(result[key], value, fixture.name + ":" + key);
  }
});
test("FX fee is estimated only with fresh FX data", () => {
  const base = { symbol: "AAPL", marketType: "listed", price: 100, suggestedAmount: 20, tradingCurrency: "USD", accountCurrency: "CAD", accountType: "NON_REGISTERED", fractionalSupported: true, quoteTimestamp: "2026-08-11T12:00:00Z", fxRate: 1.35, fxAsOf: "2026-08-11T12:00:00Z", fxFeeRate: .015 };
  const result = policy.execute(base, { now: Date.parse("2026-08-12T12:00:00Z") });
  assert.equal(result.estimatedFxFee, .3);
  assert.equal(result.requiresCurrencyConversion, true);
});
test("OTC uses limit orders and never creates a fractional suggestion", () => {
  const result = policy.execute({ symbol: "OTC_SECURITY", marketType: "OTC", price: 10, suggestedAmount: 20, tradingCurrency: "USD", accountCurrency: "USD", accountType: "NON_REGISTERED", fractionalSupported: false, quoteTimestamp: "2026-08-11T12:00:00Z" }, { now: Date.parse("2026-08-12T12:00:00Z") });
  assert.equal(result.requiredOrderType, "LIMIT");
  assert.equal(result.requiresFractionalOrder, false);
});
test("ETF lookthrough adds SPY exposure and supports direct-only mode", () => {
  const lookthrough = require("../etf-lookthrough.js");
  const data = { schemaVersion: "etf-holdings-v1", asOf: "2026-08-11T00:00:00Z", holdings: [{ etfTicker: "SPY", componentTicker: "AAPL", weight: .072 }, { etfTicker: "SPY", componentTicker: "NVDA", weight: .07 }] };
  const result = lookthrough.calculate({ SPY: { allocation: 40 }, AAPL: { allocation: 14 }, NVDA: { allocation: 14 } }, data, Date.parse("2026-08-12T00:00:00Z"), 30, "lookthrough");
  assert.equal(result.effectiveExposure.AAPL, 16.88);
  assert.equal(result.effectiveExposure.NVDA, 16.8);
  assert.equal(lookthrough.calculate({ SPY: { allocation: 40 }, AAPL: { allocation: 14 } }, data, Date.now(), 30, "direct_only").effectiveExposure.AAPL, 14);
});
