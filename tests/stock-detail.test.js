const test = require("node:test");
const assert = require("node:assert/strict");
const detail = require("../stock-detail.js");

test("stock detail accepts only safe ticker query values", () => {
  assert.equal(detail.tickerFromSearch("?ticker=tsm"), "TSM");
  assert.equal(detail.tickerFromSearch("?ticker=bad%20ticker"), "");
  assert.equal(detail.tickerFromSearch("?other=TSM"), "");
});

test("Yahoo chart metadata becomes a company and price profile", () => {
  const payload = { chart: { result: [{ meta: { symbol: "TSM", longName: "Taiwan Semiconductor Manufacturing Company Limited", fullExchangeName: "NYSE", currency: "USD", instrumentType: "EQUITY", regularMarketPrice: 200, chartPreviousClose: 198, regularMarketTime: 1000 }, timestamp: [900, 1000], indicators: { quote: [{ close: [198, 200] }] } }] } };
  const parsed = detail.parseYahooChart(payload);
  assert.equal(parsed.companyName, "Taiwan Semiconductor Manufacturing Company Limited");
  assert.equal(parsed.change, 2);
  assert.equal(Number(parsed.changePct.toFixed(4)), 1.0101);
  assert.equal(parsed.points.length, 2);
});

test("candidate lookup remains research-only and ticker exact", () => {
  const payload = { research_only: true, candidates: [{ ticker: "TSM" }, { ticker: "MU" }] };
  assert.equal(detail.candidateForTicker(payload, "tsm").ticker, "TSM");
  assert.equal(detail.candidateForTicker({ research_only: false, candidates: [{ ticker: "TSM" }] }, "TSM"), null);
});

test("manual watchlist add is idempotent", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  assert.deepEqual(detail.addToWatchlist(storage, "tsm"), { ok: true, alreadyExists: false, message: "已加入盯盘。" });
  assert.deepEqual(detail.addToWatchlist(storage, "TSM"), { ok: true, alreadyExists: true, message: "已在盯盘列表。" });
  assert.deepEqual(JSON.parse(values.get("su-investment-pro:watchlist")), ["TSM"]);
});
