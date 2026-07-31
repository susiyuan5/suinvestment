const assert = require("node:assert/strict");
const test = require("node:test");
const analysis = require("../market-analysis.js");

test("market analysis classifies trend and computes finite risk measures", function () {
  const closes = Array.from({ length: 60 }, (_, index) => 100 + index);
  assert.equal(analysis.tickerTrend(closes, -1).status, "healthy_pullback");
  assert.ok(analysis.weeklyVolatility(closes, 12) >= 0);
  assert.equal(analysis.recentDrawdown(closes, 52), 0);
});

test("market regime rejects short histories and classifies a sustained rise", function () {
  assert.equal(analysis.marketRegime([{ date: "2026-01-01", close: 100 }]), null);
  const rows = Array.from({ length: 60 }, (_, index) => ({ date: `2026-01-${String((index % 28) + 1).padStart(2, "0")}`, close: 100 + index }));
  assert.equal(analysis.marketRegime(rows).type, "Bull");
});
