"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const policy = require("../dca-policy.js");

function risingCloses(length) {
  return Array.from({ length }, function (_, index) { return 100 + index * 0.4; });
}

test("kill switch preserves base amount", function () {
  const result = policy.evaluateDcaPolicy({ baseAmount: 50 }, { enabled: false });
  assert.equal(result.multiplier, 1);
  assert.equal(result.finalAmount, 50);
  assert.equal(result.status, "disabled");
});

test("missing price blocks the manual amount", function () {
  const result = policy.evaluateDcaPolicy({ baseAmount: 50, currentPrice: null });
  assert.equal(result.multiplier, 0);
  assert.equal(result.finalAmount, 0);
  assert.equal(result.status, "blocked");
});

test("poor data cannot increase above base amount", function () {
  const closes = risingCloses(60);
  const result = policy.evaluateDcaPolicy({
    baseAmount: 50,
    currentPrice: closes[closes.length - 1] * 0.82,
    closes,
    dataQuality: "poor",
    marketRegime: "Bull",
    marketContextAvailable: true,
    volatilityPct: 3,
    concentrationEvaluated: false
  });
  assert.ok(result.multiplier <= 1);
  assert.ok(result.finalAmount <= 50);
  assert.equal(result.status, "manual_review");
});

test("bear market cannot increase above base amount", function () {
  const closes = risingCloses(60);
  const result = policy.evaluateDcaPolicy({
    baseAmount: 50,
    currentPrice: closes[closes.length - 1] * 0.88,
    closes,
    dataQuality: "fresh",
    marketRegime: "Bear",
    marketContextAvailable: true,
    volatilityPct: 3,
    concentrationEvaluated: false
  });
  assert.ok(result.multiplier <= 1);
});

test("extreme drawdown requires review and avoids maximum multiplier", function () {
  const closes = risingCloses(60);
  const result = policy.evaluateDcaPolicy({
    baseAmount: 100,
    currentPrice: closes[closes.length - 1] * 0.60,
    closes,
    dataQuality: "fresh",
    marketRegime: "Bull",
    marketContextAvailable: true,
    volatilityPct: 3,
    concentrationEvaluated: false
  });
  assert.equal(result.status, "manual_review");
  assert.ok(result.multiplier <= 1);
});

test("very high concentration caps multiplier at 0.75", function () {
  const closes = risingCloses(60);
  const result = policy.evaluateDcaPolicy({
    baseAmount: 100,
    currentPrice: closes[closes.length - 1],
    closes,
    dataQuality: "fresh",
    marketRegime: "Bull",
    marketContextAvailable: true,
    volatilityPct: 3,
    concentrationEvaluated: true,
    currentAllocationPct: 40
  });
  assert.ok(result.multiplier <= 0.75);
  assert.equal(result.status, "manual_review");
});

test("result includes a traceable final chain", function () {
  const closes = risingCloses(60);
  const result = policy.evaluateDcaPolicy({
    baseAmount: 100,
    currentPrice: closes[closes.length - 1],
    closes,
    dataQuality: "fresh",
    marketRegime: "Bull",
    marketContextAvailable: true,
    volatilityPct: 3,
    concentrationEvaluated: false
  });
  assert.ok(result.factorChain.some(function (item) { return item.stage === "final_manual_amount"; }));
});

test("favorable validated dip can increase the manual amount", function () {
  const closes = Array.from({ length: 60 }, function (_, index) {
    if (index === 50) return 120;
    return 100 + Math.sin(index) * 3;
  });
  const result = policy.evaluateDcaPolicy({
    baseAmount: 100,
    currentPrice: 108,
    closes,
    dataQuality: "fresh",
    marketRegime: "Bull",
    marketContextAvailable: true,
    volatilityPct: 3,
    concentrationEvaluated: true,
    currentAllocationPct: 15
  });
  assert.equal(result.status, "active");
  assert.ok(result.multiplier > 1);
  assert.ok(result.finalAmount > 100);
});

test("DCA-L2 shared fixtures match browser policy", function () {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "dca-l2-policy-config.json"), "utf8"));
  const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "dca_l2_policy_cases.json"), "utf8"));
  fixtures.forEach(function (fixture) {
    const result = policy.evaluateDcaL2Policy(fixture.input, {}, config);
    assert.equal(result.state, fixture.expected.state, fixture.name);
    assert.equal(result.baseAmount, fixture.expected.baseAmount, fixture.name);
    assert.equal(result.extraAmount, fixture.expected.extraAmount, fixture.name);
    assert.equal(result.crashFundAmount, fixture.expected.crashFundAmount, fixture.name);
    if (fixture.expected.crashFundWeeklyLimit !== undefined) assert.equal(result.crashFundWeeklyLimit, fixture.expected.crashFundWeeklyLimit, fixture.name);
    assert.equal(result.finalAmount, fixture.expected.finalAmount, fixture.name);
    assert.deepEqual(result.reasonCodes, fixture.expected.reasonCodes, fixture.name);
  });
});

test("DCA-L2 recovery requires two distinct trading dates", function () {
  const config = policy.DEFAULT_L2_CONFIG;
  const once = policy.evaluateDcaL2Policy({ baseAmount: 100, price: 100, dataStatus: "fresh", marketRegime: "Bull", date: "2026-07-07" }, { defensiveLatched: true }, config);
  assert.equal(once.state, "panic_bear_extreme_volatility");
  assert.equal(once.defensiveNow, false);
  const duplicate = policy.evaluateDcaL2Policy({ baseAmount: 100, price: 100, dataStatus: "fresh", marketRegime: "Bull", date: "2026-07-07" }, { defensiveLatched: true, recoveryConfirmations: once.recoveryConfirmations, lastRecoveryTradingDate: "2026-07-07" }, config);
  assert.equal(duplicate.recoveryConfirmations, 1);
  const recovered = policy.evaluateDcaL2Policy({ baseAmount: 100, price: 100, dataStatus: "fresh", marketRegime: "Bull", date: "2026-07-08" }, { defensiveLatched: true, recoveryConfirmations: once.recoveryConfirmations, lastRecoveryTradingDate: "2026-07-07" }, config);
  assert.equal(recovered.state, "normal");
});
