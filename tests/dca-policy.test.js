"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
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
