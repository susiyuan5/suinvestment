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

test("v5 default is exact, totals 100%, and QQQ receives ten percent", () => {
  assert.equal(policy.PRESET.version, "core-satellite-v5");
  assert.deepEqual(policy.allocationsForCore(40), { SPY: .4, QQQ: .1, NVDA: .125, AAPL: .125, ASML: .125, KO: .125 });
  assert.equal(policy.validateAllocations(policy.allocationsForCore(40)).valid, true);
  assert.equal(policy.plan({ baseBudget: 100, crashFundRemaining: 10, actualAllocations: {} }).items.find((row) => row.symbol === "QQQ").finalAmount, 10);
});

test("planner conservation includes retained cash exactly once", () => {
  const result = policy.plan({ baseBudget: 69.23, crashFundRemaining: 100, actualAllocations: {}, satelliteDecisions: {} });
  assert.ok(Math.abs(result.items.reduce((sum, row) => sum + row.finalAmount, 0) + result.cashRetained - result.conservation.source) <= .005);
});

test("every target accepts zero to one hundred percent while totals remain exact", () => {
  const valid = { SPY: .4, QQQ: .1, NVDA: .125, AAPL: .125, ASML: .125, KO: .125 };
  assert.equal(policy.validateAllocations(valid).valid, true);
  assert.equal(policy.validateAllocations({ SPY: 0, QQQ: 0, NVDA: 1, AAPL: 0, ASML: 0, KO: 0 }).valid, true);
  assert.equal(policy.validateAllocations({ SPY: 0, QQQ: 1, NVDA: 0, AAPL: 0, ASML: 0, KO: 0 }).valid, true);
  assert.equal(policy.validateAllocations({ ...valid, NVDA: 1.0001 }).valid, false);
  assert.equal(policy.validateAllocations({ ...valid, KO: NaN }).valid, false);
  assert.match(policy.validateAllocations({ ...valid, NVDA: 1.0001 }).errors.join(" "), /NVDA/);
});

test("default and custom stocks can be removed while SPY remains the strategy anchor", () => {
  const withoutKo = { SPY: .45, QQQ: .1, NVDA: .15, AAPL: .15, ASML: .15 };
  const preset = policy.presetFromAllocations(withoutKo);
  assert.ok(preset);
  assert.deepEqual(policy.rowsForPreset(preset).map(row => row.symbol), ["SPY", "QQQ", "NVDA", "AAPL", "ASML"]);
  assert.equal(policy.validateAllocations(withoutKo).valid, true);
  assert.equal(policy.presetFromAllocations({ QQQ: 1 }), null, "SPY cannot be removed from the strategy preset");
});

test("40/60, 50/50, 60/40 shortcuts and equal satellite allocation", () => {
  assert.deepEqual(policy.allocationsForCore(40), { SPY: .4, QQQ: .1, NVDA: .125, AAPL: .125, ASML: .125, KO: .125 });
  assert.deepEqual(policy.allocationsForCore(50), { SPY: .5, QQQ: .1, NVDA: .1, AAPL: .1, ASML: .1, KO: .1 });
  assert.deepEqual(policy.allocationsForCore(60), { SPY: .6, QQQ: .1, NVDA: .075, AAPL: .075, ASML: .075, KO: .075 });
  assert.equal(policy.allocationsForCore(39), null);
  assert.equal(policy.validateAllocations(policy.averageSatelliteAllocations(50)).valid, true);
});

test("actual concentration blocks only at 18 percent", () => {
  assert.equal(policy.plan({ baseBudget: 1000, crashFundRemaining: 0, actualAllocations: { NVDA: 17.99 } }).items.find((row) => row.symbol === "NVDA").finalAmount, 125);
  assert.equal(policy.plan({ baseBudget: 1000, crashFundRemaining: 0, actualAllocations: { NVDA: 18 } }).items.find((row) => row.symbol === "NVDA").finalAmount, 0);
});

test("SPY honors hard, action, data, and config gates while ignoring stock concentration gates", () => {
  for (const code of ["HARD_BLOCK_INVALID_PRICE", "ACTION_REQUIRES_ZERO_AMOUNT", "DATA_MANUAL_REVIEW", "POLICY_CONFIG_UNAVAILABLE"]) {
    const result = policy.plan({ baseBudget: 100, crashFundRemaining: 20, spyCrashEnhancement: 10,
      actualAllocations: { NVDA: 18 }, satelliteDecisions: { SPY: { finalAmount: 0, reasonCodes: [code] } } });
    const spy = result.items.find(row => row.symbol === "SPY");
    assert.equal(spy.finalAmount, 0, code);
    assert.equal(result.spyRedirected, 0, code);
    assert.ok(spy.reasonCodes.includes(code));
  }
  const result = policy.plan({ baseBudget: 100, crashFundRemaining: 0,
    satelliteDecisions: { SPY: { finalAmount: 0, reasonCodes: ["CONCENTRATION_VERY_HIGH_BLOCKED"] } } });
  assert.equal(result.items[0].finalAmount, 40);
});

test("SPY base cannot be relabeled as an unexecuted drawdown extra", () => {
  const result = policy.plan({ baseBudget: 100, normalPoolRemaining: 300, crashFundRemaining: 0,
    satelliteDecisions: { SPY: { baseAmount: 40, extraAmount: 8, finalAmount: 48 } } });
  assert.equal(result.items[0].baseAmount, 40);
  assert.equal(result.items[0].extraAmount, 0);
  assert.equal(result.items[0].finalAmount, 40);
});

test("group exposure limits remove enhancements and preserve the already allowed base", () => {
  for (const actual of [{ NVDA: 14, AAPL: 14, ASML: 14 }, { NVDA: 15, AAPL: 15, ASML: 15, KO: 15 }]) {
    for (const base of [125, 62.5]) {
      const result = policy.plan({ baseBudget: 1000, normalPoolRemaining: 1200, crashFundRemaining: 100,
        actualAllocations: actual,
        satelliteDecisions: { NVDA: { baseAmount: base, extraAmount: 20, crashFundAmount: 10, finalAmount: base + 30 } } });
      const nvda = result.items.find(row => row.symbol === "NVDA");
      assert.equal(nvda.baseAmount, base);
      assert.equal(nvda.extraAmount, 0);
      assert.equal(nvda.crashFundAmount, 0);
      assert.equal(nvda.finalAmount, base);
      assert.equal(result.spyRedirected, 0);
    }
  }
  const blocked = policy.plan({ baseBudget: 1000, crashFundRemaining: 100,
    actualAllocations: { NVDA: 18, AAPL: 14, ASML: 14 },
    satelliteDecisions: { NVDA: { baseAmount: 125, extraAmount: 20, crashFundAmount: 10, finalAmount: 155 } } });
  assert.equal(blocked.items.find(row => row.symbol === "NVDA").finalAmount, 0);
});

test("removing QQQ preserves each custom satellite base and total funding", () => {
  const preset = policy.presetFromAllocations({ SPY: .50, NVDA: .10, AAPL: .15, ASML: .05, KO: .20 });
  const result = policy.plan({ preset, baseBudget: 100, crashFundRemaining: 0 });
  assert.deepEqual(result.items.map(row => [row.symbol, row.baseAmount]), [["SPY", 50], ["NVDA", 10], ["AAPL", 15], ["ASML", 5], ["KO", 20]]);
  assert.equal(result.totalPlanned, 100);
  assert.ok(result.conservation.balanced);
});

test("fractional-cent cash limits are rounded down before allocation", () => {
  for (const cash of [.006, .016, 1.006]) {
    const result = policy.plan({ baseBudget: 100, crashFundRemaining: 0, portfolioCashCap: cash });
    assert.ok(result.totalPlanned <= cash);
    assert.ok(result.conservation.balanced);
  }
});
