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
test("preset is exactly 100 percent and QQQ has no buy row", () => {
  const total = policy.PRESET.core.target_allocation + policy.PRESET.satellites.reduce((sum, row) => sum + row.target_allocation, 0);
  assert.equal(total, 1);
  assert.equal(policy.plan({ baseBudget: 100, crashFundRemaining: 10, actualAllocations: { QQQ: 99 } }).items.some((row) => row.symbol === "QQQ"), false);
  assert.equal(policy.PRESET.version, "core-satellite-v2");
  assert.equal(policy.PRESET.core.target_allocation, 0.40);
});
test("planner conservation includes retained cash exactly once", () => {
  const result = policy.plan({ baseBudget: 69.23, crashFundRemaining: 100, actualAllocations: {}, satelliteDecisions: {} });
  const allocated = result.items.reduce((sum, row) => sum + row.finalAmount, 0) + result.cashRetained;
  assert.ok(Math.abs(allocated - result.conservation.source) <= 0.005);
  assert.equal(result.items.some((row) => row.symbol === "QQQ"), false);
});
test("allocation editor validates default, custom, concentration, and non-finite values", () => {
  const valid = { SPY: 0.40, NVDA: 0.12, AAPL: 0.12, ASML: 0.12, KO: 0.12, BYDDY: 0.12 };
  assert.equal(policy.validateAllocations(valid).valid, true);
  assert.equal(policy.validateAllocations({ ...valid, SPY: 0.39, NVDA: 0.13 }).valid, false);
  assert.equal(policy.validateAllocations({ ...valid, NVDA: 0.13, KO: 0.11 }).valid, false);
  assert.equal(policy.validateAllocations({ ...valid, KO: NaN }).valid, false);
  const custom = { SPY: 0.70, NVDA: 0.06, AAPL: 0.06, ASML: 0.04, KO: 0.08, BYDDY: 0.06 };
  const preset = policy.presetFromAllocations(custom, policy.PRESET);
  assert.equal(preset.core.target_allocation, 0.70);
  assert.equal(policy.plan({ preset, baseBudget: 100, crashFundRemaining: 0 }).spyBase, 70);
});

test("core split shortcuts distribute the individual-stock bucket evenly", () => {
  const aggressive = policy.allocationsForCore(40);
  assert.deepEqual(aggressive, { SPY: 0.4, NVDA: 0.12, AAPL: 0.12, ASML: 0.12, KO: 0.12, BYDDY: 0.12 });
  const balanced = policy.allocationsForCore(50);
  assert.equal(policy.validateAllocations(balanced).valid, true);
  assert.equal(balanced.NVDA, 0.1);
  assert.equal(policy.allocationsForCore(39), null);
});

test("a stock at its 12 percent target is not treated as over-concentrated", () => {
  const result = policy.plan({ baseBudget: 1000, crashFundRemaining: 0, actualAllocations: { NVDA: 12 } });
  assert.equal(result.items.find((row) => row.symbol === "NVDA").finalAmount, 120);
});

test("floating point tails at the 12 percent boundary do not trigger false errors", () => {
  const boundary = { SPY: 0.4, NVDA: 0.1200000005, AAPL: 0.1200000005, ASML: 0.12, KO: 0.12, BYDDY: 0.119999999 };
  assert.equal(policy.validateAllocations(boundary).valid, true);
  const above = { ...boundary, NVDA: 0.1201, BYDDY: 0.1199 };
  assert.equal(policy.validateAllocations(above).valid, false);
  assert.deepEqual(policy.validateAllocations(above).errors, ["NVDA单股比例不得高于 12%"]);
});
