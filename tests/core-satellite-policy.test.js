const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const policy = require("../core-satellite-policy.js");
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "core_satellite_cases.json"), "utf8"));

test("Core-Satellite JS consumes shared golden fixtures", () => {
  for (const fixture of fixtures) {
    if (fixture.case === "validate") assert.equal(policy.validatePreset(policy.PRESET), fixture.expected, fixture.name);
    else {
      const result = policy.plan({ ...fixture.input, preset: policy.PRESET });
      for (const [key, expected] of Object.entries(fixture.expected)) {
        if (key === "items") assert.equal(result.items.find((row) => row.symbol === "NVDA").finalAmount, expected, fixture.name);
        else assert.equal(result[key], expected, fixture.name);
      }
    }
  }
});

test("v4 default is exact, totals 100%, and QQQ is signal-only", () => {
  assert.equal(policy.PRESET.version, "core-satellite-v4");
  assert.deepEqual(policy.allocationsForCore(40), { SPY: .4, NVDA: .15, AAPL: .15, ASML: .15, KO: .15 });
  assert.equal(policy.validateAllocations(policy.allocationsForCore(40)).valid, true);
  assert.equal(policy.plan({ baseBudget: 100, crashFundRemaining: 10, actualAllocations: { QQQ: 99 } }).items.some((row) => row.symbol === "QQQ"), false);
});

test("planner conservation includes retained cash exactly once", () => {
  const result = policy.plan({ baseBudget: 69.23, crashFundRemaining: 100, actualAllocations: {}, satelliteDecisions: {} });
  assert.ok(Math.abs(result.items.reduce((sum, row) => sum + row.finalAmount, 0) + result.cashRetained - result.conservation.source) <= .005);
});

test("allocation limits and two decimal precision are enforced", () => {
  const valid = { SPY: .4, NVDA: .15, AAPL: .15, ASML: .15, KO: .15 };
  assert.equal(policy.validateAllocations(valid).valid, true);
  assert.equal(policy.validateAllocations({ ...valid, NVDA: .1501 }).valid, false);
  const techAbove = { SPY: .4, NVDA: .1501, AAPL: .15, ASML: .15, KO: .1499 };
  assert.equal(policy.validateAllocations(techAbove).valid, false);
  assert.equal(policy.validateAllocations({ ...valid, KO: NaN }).valid, false);
  assert.match(policy.validateAllocations({ ...valid, NVDA: .1501 }).errors.join(" "), /NVDA/);
});

test("40/60, 50/50, 60/40 shortcuts and equal satellite allocation", () => {
  assert.deepEqual(policy.allocationsForCore(40), { SPY: .4, NVDA: .15, AAPL: .15, ASML: .15, KO: .15 });
  assert.deepEqual(policy.allocationsForCore(50), { SPY: .5, NVDA: .125, AAPL: .125, ASML: .125, KO: .125 });
  assert.deepEqual(policy.allocationsForCore(60), { SPY: .6, NVDA: .1, AAPL: .1, ASML: .1, KO: .1 });
  assert.equal(policy.allocationsForCore(39), null);
  assert.equal(policy.validateAllocations(policy.averageSatelliteAllocations(50)).valid, true);
});

test("actual concentration blocks only at 18 percent", () => {
  assert.equal(policy.plan({ baseBudget: 1000, crashFundRemaining: 0, actualAllocations: { NVDA: 17.99 } }).items.find((row) => row.symbol === "NVDA").finalAmount, 150);
  assert.equal(policy.plan({ baseBudget: 1000, crashFundRemaining: 0, actualAllocations: { NVDA: 18 } }).items.find((row) => row.symbol === "NVDA").finalAmount, 0);
});
