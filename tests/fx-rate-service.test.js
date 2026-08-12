const test = require("node:test");
const assert = require("node:assert/strict");
const service = require("../fx-rate-service.js");

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); }
  };
}

test("Finnhub USD base quote is normalized as unambiguous USD/CAD", () => {
  const result = service.parseFinnhub({ base: "USD", quote: { CAD: 1.3812 } }, "2026-08-11T12:00:00Z");
  assert.equal(result.pair, "USD/CAD");
  assert.equal(result.rate, 1.3812);
  assert.ok(Math.abs(result.inverseRate - 0.724008) < 0.00001);
  assert.equal(result.source, "Finnhub");
});

test("Yahoo CAD=X chart uses the latest market timestamp", () => {
  const result = service.parseYahoo({ chart: { result: [{ meta: { regularMarketPrice: 1.379, regularMarketTime: 1786453200 }, timestamp: [1786453140] }] } }, "2026-08-11T13:01:00Z");
  assert.equal(result.rate, 1.379);
  assert.equal(result.asOf, new Date(1786453200 * 1000).toISOString());
  assert.equal(result.sourceKind, "yahoo");
});

test("Bank of Canada daily quote is normalized as USD/CAD", () => {
  const result = service.parseBankOfCanada({ observations: [{ d: "2026-08-11", FXUSDCAD: { v: "1.3927" } }] }, "2026-08-11T22:00:00Z");
  assert.equal(result.rate, 1.3927);
  assert.equal(result.asOf, "2026-08-11T21:00:00.000Z");
  assert.equal(result.sourceKind, "bank-of-canada");
});

test("implausible or inverted values are rejected", () => {
  assert.equal(service.parseFinnhub({ base: "USD", quote: { CAD: 100 } }, "2026-08-11T12:00:00Z"), null);
  assert.equal(service.parseBankOfCanada({ observations: [{ d: "bad", FXUSDCAD: { v: "1.3" } }] }, "2026-08-11T12:00:00Z"), null);
  assert.equal(service.parseYahoo({ chart: { result: [{ meta: { regularMarketPrice: 0 } }] } }, "2026-08-11T12:00:00Z"), null);
});

test("freshness distinguishes live, cached and expired quotes", () => {
  const quote = service.normalize({ rate: 1.38, asOf: "2026-08-11T12:00:00Z", source: "test" });
  assert.equal(service.classify(quote, Date.parse("2026-08-11T12:10:00Z"), 3).state, "live");
  assert.equal(service.classify(quote, Date.parse("2026-08-11T12:30:00Z"), 3).state, "cached");
  assert.equal(service.classify(quote, Date.parse("2026-08-15T12:00:00Z"), 3).state, "expired");
});

test("cache only accepts validated quote snapshots", () => {
  const storage = memoryStorage();
  service.saveCache({ rate: 1.37, asOf: "2026-08-11T12:00:00Z", source: "Yahoo Finance" }, storage);
  assert.equal(service.loadCache(storage).rate, 1.37);
  assert.equal(service.saveCache({ rate: -1, asOf: "bad" }, storage), null);
  assert.equal(service.loadCache(storage).rate, 1.37);
});

test("live fetch falls back from unavailable Finnhub forex entitlement to the Bank of Canada", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes("finnhub")) return { ok: false, status: 403, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ observations: [{ d: "2026-08-11", FXUSDCAD: { v: "1.3927" } }] }) };
  };
  const result = await service.fetchLatest({ apiKey: "private-test-key", fetchImpl, now: Date.parse("2026-08-11T13:00:00Z") });
  assert.equal(result.source, "加拿大央行（日均）");
  assert.deepEqual(result.attemptedSources, ["Finnhub", "加拿大央行"]);
  assert.equal(calls.length, 2);
});

test("Yahoo remains the final fallback when the official daily source is unavailable", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes("bankofcanada")) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ chart: { result: [{ meta: { regularMarketPrice: 1.36, regularMarketTime: 1786453200 } }] } }) };
  };
  const result = await service.fetchLatest({ fetchImpl, now: Date.parse("2026-08-11T13:00:00Z") });
  assert.equal(result.source, "Yahoo Finance");
  assert.deepEqual(result.attemptedSources, ["加拿大央行", "Yahoo Finance"]);
  assert.equal(calls.length, 2);
});
