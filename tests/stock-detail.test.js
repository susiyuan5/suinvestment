const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
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
  assert.equal(parsed.source, "yahoo-live");
});

test("same-origin research trend becomes a clearly non-live fallback quote", () => {
  const payload = {
    schema_version: "idea-price-trends-v1",
    research_only: true,
    symbols: {
      TSM: {
        currency: "USD",
        as_of: "2026-07-31",
        points: [
          { date: "2026-07-24", close: 198 },
          { date: "2026-07-31", close: 200 }
        ]
      }
    }
  };

  const parsed = detail.parseStaticTrend(payload, "tsm");
  assert.equal(parsed.ticker, "TSM");
  assert.equal(parsed.source, "same-origin-research-weekly");
  assert.equal(parsed.interval, "1wk");
  assert.equal(parsed.current, 200);
  assert.equal(parsed.change, 2);
  assert.equal(parsed.points.length, 2);
  assert.equal(detail.parseStaticTrend({ ...payload, research_only: false }, "TSM"), null);
});

test("live quote wins while valid research history recovers a failed live quote", () => {
  const live = { source: "yahoo-live", points: [{}, {}] };
  const fallback = { source: "same-origin-research-weekly", points: [{}, {}] };
  assert.equal(detail.selectQuote(live, fallback), live);
  assert.equal(detail.selectQuote(null, fallback), fallback);
  assert.equal(detail.selectQuote({ source: "yahoo-live", points: [] }, fallback), fallback);
});

test("live quote timeout aborts instead of blocking the static fallback forever", async () => {
  let capturedSignal = null;
  const neverFinishes = (_url, options) => {
    capturedSignal = options.signal;
    return new Promise(() => {});
  };
  await assert.rejects(detail.fetchJsonWithTimeout(neverFinishes, "https://example.invalid", {}, 5), /timeout/);
  assert.equal(capturedSignal.aborted, true);
});

test("published same-origin trends cover every current v3.1 candidate", () => {
  const trends = JSON.parse(fs.readFileSync("data/idea-engine-v3/price-trends.json", "utf8"));
  const candidates = JSON.parse(fs.readFileSync("research/results/v3_1/idea-engine/latest-candidates.json", "utf8"));
  assert.equal(trends.schema_version, "idea-price-trends-v1");
  assert.equal(trends.research_only, true);
  for (const candidate of candidates.candidates) {
    const quote = detail.parseStaticTrend(trends, candidate.ticker);
    assert.ok(quote, `${candidate.ticker} must have a valid fallback trend`);
    assert.ok(quote.points.length >= 52, `${candidate.ticker} fallback should cover about one year`);
  }
});

test("candidate lookup remains research-only and ticker exact", () => {
  const payload = { research_only: true, candidates: [{ ticker: "TSM" }, { ticker: "MU" }] };
  assert.equal(detail.candidateForTicker(payload, "tsm").ticker, "TSM");
  assert.equal(detail.candidateForTicker({ research_only: false, candidates: [{ ticker: "TSM" }] }, "TSM"), null);
  assert.equal(detail.candidateForTicker({ schema_version: "idea-engine-v3.1", research_only: true, candidates: [{ ticker: "TSM" }] }, "TSM").ticker, "TSM");
});

test("manual watchlist add is idempotent", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  assert.deepEqual(detail.addToWatchlist(storage, "tsm"), { ok: true, alreadyExists: false, message: "已加入盯盘。" });
  assert.deepEqual(detail.addToWatchlist(storage, "TSM"), { ok: true, alreadyExists: true, message: "已在盯盘列表。" });
  assert.deepEqual(JSON.parse(values.get("su-investment-pro:watchlist")), ["TSM"]);
});
