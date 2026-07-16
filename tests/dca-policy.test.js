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

test("DCA-L2 recovery requires two distinct plan weeks", function () {
  const config = policy.DEFAULT_L2_CONFIG;
  const once = policy.evaluateDcaL2Policy({ baseAmount: 100, price: 100, dataStatus: "fresh", marketRegime: "Bull", date: "2026-07-07" }, { defensiveLatched: true }, config);
  assert.equal(once.state, "panic_bear_extreme_volatility");
  assert.equal(once.defensiveNow, false);
  const duplicate = policy.evaluateDcaL2Policy({ baseAmount: 100, price: 100, dataStatus: "fresh", marketRegime: "Bull", date: "2026-07-07" }, { defensiveLatched: true, recoveryConfirmations: once.recoveryConfirmations, lastRecoveryWeek: "2026-W28" }, config);
  assert.equal(duplicate.recoveryConfirmations, 1);
  const recovered = policy.evaluateDcaL2Policy({ baseAmount: 100, price: 100, dataStatus: "fresh", marketRegime: "Bull", date: "2026-07-14" }, { defensiveLatched: true, recoveryConfirmations: once.recoveryConfirmations, lastRecoveryWeek: "2026-W28" }, config);
  assert.equal(recovered.state, "normal");
});

test("DCA-L2 weight zero, missing weight, and invalid weight are distinct", function () {
  const base = { baseAmount: 100, price: 75, dataStatus: "fresh", marketRegime: "Bull", drawdownPct: 30, trendStatus: "above_sma", volatilityPct: 2, crashFundInitial: 100, crashFundBalance: 100, date: "2026-07-06" };
  assert.equal(policy.evaluateDcaL2Policy(base, {}, policy.DEFAULT_L2_CONFIG).crashFundAmount, 25);
  assert.equal(policy.evaluateDcaL2Policy({ ...base, crashFundWeight: 0 }, {}, policy.DEFAULT_L2_CONFIG).crashFundAmount, 0);
  const invalid = policy.evaluateDcaL2Policy({ ...base, crashFundWeight: -1 }, {}, policy.DEFAULT_L2_CONFIG);
  assert.equal(invalid.crashFundAmount, 0);
  assert.equal(invalid.manualReview, true);
  assert.equal(policy.evaluateDcaL2Policy({ ...base, baseAmount: 0, crashFundWeight: 0 }, {}, policy.DEFAULT_L2_CONFIG).finalAmount, 0);
});

test("DCA-L2 recovery config override three is honored", function () {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "dca-l2-policy-config.json"), "utf8"));
  config.recovery.requiredDistinctPlanWeeks = 3;
  let state = { defensiveLatched: true };
  const dates = ["2026-07-07", "2026-07-14", "2026-07-21"];
  const results = dates.map(function (date) {
    const result = policy.evaluateDcaL2Policy({ baseAmount: 100, price: 100, dataStatus: "fresh", marketRegime: "Bull", date }, state, config);
    state = { defensiveLatched: true, recoveryConfirmations: result.recoveryConfirmations, lastRecoveryWeek: "2026-W" + String(28 + result.recoveryConfirmations - 1).padStart(2, "0") };
    return result;
  });
  assert.equal(results[1].state, "panic_bear_extreme_volatility");
  assert.equal(results[2].state, "normal");
});

test("invalid configuration fails safe to base-only manual review", function () {
  const previous = policy.getL2Config();
  policy.setL2Config(null);
  const result = policy.evaluateDcaL2Policy({ baseAmount: 100, price: 75, dataStatus: "fresh", marketRegime: "Bull", drawdownPct: 30, trendStatus: "above_sma", volatilityPct: 2, date: "2026-07-06" });
  assert.equal(result.baseAmount, 100);
  assert.equal(result.extraAmount, 0);
  assert.equal(result.crashFundAmount, 0);
  assert.equal(result.manualReview, true);
  policy.setL2Config(previous);
});

test("portfolio DCA-L2 planner enforces component budgets and very high concentration", function () {
  const result = require("../portfolio-policy.js").allocateDcaL2Plan([
    { decision: { baseAmount: 100, extraAmount: 50, crashFundAmount: 25 }, currentAllocationPct: 40 },
    { decision: { baseAmount: 100, extraAmount: 50, crashFundAmount: 25 }, currentAllocationPct: 10 }
  ], { normalPool: 100, crashFund: 10, portfolioCashCap: 80 });
  assert.equal(result.items[0].decision.finalAmount, 0);
  assert.ok(result.plannedNormal <= 100);
  assert.ok(result.plannedCrash <= 10);
  assert.ok(result.totalPlanned <= 80);
});

test("portfolio planner consumes shared golden fixtures", function () {
  const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "dca_l2_portfolio_cases.json"), "utf8"));
  const portfolio = require("../portfolio-policy.js");
  fixtures.forEach(function (fixture) {
    const result = portfolio.allocateDcaL2Plan(fixture.items.map(function (item) {
      return { decision: { baseAmount: item.decision.base_amount, extraAmount: item.decision.extra_amount, crashFundAmount: item.decision.crash_fund_amount }, currentAllocationPct: item.currentAllocationPct };
    }), fixture.options);
    Object.keys(fixture.expected).forEach(function (key) {
      const actualKey = key === "plannedNormal" ? "plannedNormal" : key === "plannedCrash" ? "plannedCrash" : key === "totalPlanned" ? "totalPlanned" : "unallocatedCash";
      assert.equal(result[actualKey], fixture.expected[key], fixture.name + " / " + key);
    });
  });
});
