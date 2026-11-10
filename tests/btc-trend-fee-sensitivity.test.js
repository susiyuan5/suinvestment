const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const signal = require("../btc-trend-signal.js");

const snapshot = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "btc-weekly-v1.json"), "utf8"),
);
const load = () => import("../scripts/btc-trend-fee-sensitivity.mjs");

test("fee sensitivity reproduces the published 0.1% baseline", async () => {
  const { buildReport } = await load();
  const baseline = buildReport(snapshot).periods.find((p) => p.name === "report baseline");
  const row = baseline.fees.find((f) => f.fee === 0.001);
  assert.ok(Math.abs(row.rule.cagr - 0.744) < 0.005, "rule CAGR near 74.4%");
  assert.ok(Math.abs(row.hold.cagr - 0.693) < 0.005, "buy and hold CAGR near 69.3%");
  assert.ok(Math.abs(row.rule.maxDrawdown + 0.568) < 0.002, "rule max drawdown near -56.8%");
  assert.ok(Math.abs(row.hold.maxDrawdown + 0.83) < 0.002, "buy and hold max drawdown near -83%");
});

test("higher fees never help and only the fee changes between tiers", async () => {
  const { buildReport } = await load();
  for (const period of buildReport(snapshot).periods) {
    for (let i = 1; i < period.fees.length; i += 1) {
      assert.ok(period.fees[i].rule.multiple < period.fees[i - 1].rule.multiple);
      assert.equal(period.fees[i].switches, period.fees[0].switches);
      assert.equal(period.fees[i].timeInMarket, period.fees[0].timeInMarket);
    }
  }
});

test("zero fee equals compounding the held weeks and break-even closes the gap", async () => {
  const { simulate, breakEvenFee } = await load();
  const { rows } = signal.evaluate(snapshot.weeks);
  const from = rows[0].weekEnd;
  const to = rows[rows.length - 1].weekEnd;
  let expected = 1;
  for (let i = 1; i < rows.length; i += 1)
    if (rows[i - 1].position === 1) expected *= rows[i].close / rows[i - 1].close;
  const free = simulate(rows, 0, from, to);
  assert.ok(Math.abs(free.rule.multiple / expected - 1) < 1e-9);
  assert.ok(Math.abs(free.hold.multiple / (rows[rows.length - 1].close / rows[0].close) - 1) < 1e-9);
  const fee = breakEvenFee(rows, from, to);
  const at = simulate(rows, fee, from, to);
  assert.ok(Math.abs(at.rule.multiple / at.hold.multiple - 1) < 1e-6);
});
