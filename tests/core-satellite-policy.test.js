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
});
test("planner conservation includes retained cash exactly once", () => {
  const result = policy.plan({ baseBudget: 69.23, crashFundRemaining: 100, actualAllocations: {}, satelliteDecisions: {} });
  const allocated = result.items.reduce((sum, row) => sum + row.finalAmount, 0) + result.cashRetained;
  assert.equal(allocated, result.conservation.source);
  assert.equal(result.items.some((row) => row.symbol === "QQQ"), false);
});
