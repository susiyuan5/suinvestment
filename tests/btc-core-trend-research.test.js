const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const signal = require("../btc-trend-signal.js");

const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"));
const load = () => import("../scripts/btc-core-trend-research.mjs");
const near = (actual, expected, tolerance) => Math.abs(actual - expected) < tolerance;

test("core 0 is the pure rule and core 1 is buy and hold", async () => {
  const { rowsFor, simulate, FEE } = await load();
  const fees = await import("../scripts/btc-trend-fee-sensitivity.mjs");
  const yahoo = read("btc-weekly-v1.json");
  const rows = rowsFor(yahoo);
  const plain = signal.evaluate(yahoo.weeks).rows;
  assert.deepEqual(rows.map((r) => r.position), plain.map((r) => r.position));
  assert.deepEqual(rows.map((r) => r.actualEnd), plain.map((r) => r.weekEnd));
  const reference = fees.simulate(plain, FEE, "2015-08-23", "9999");
  const rule = simulate(rows, 0, FEE, "2015-08-23", "9999");
  const hold = simulate(rows, 1, FEE, "2015-08-23", "9999");
  assert.ok(near(rule.multiple / reference.rule.multiple, 1, 1e-9));
  assert.ok(near(rule.maxDrawdown, reference.rule.maxDrawdown, 1e-9));
  assert.ok(near(hold.multiple / reference.hold.multiple, 1, 1e-9));
  assert.equal(hold.trades, 1);
});

test("Kraken weekly bars reproduce the published baseline", async () => {
  const { buildReport } = await load();
  const kraken = buildReport().sources[1].periods[0].mixes;
  const rule = kraken.find((mix) => mix.core === 0);
  const hold = kraken.find((mix) => mix.core === 1);
  assert.ok(near(rule.cagr, 0.686, 0.01), "rule CAGR near 68.6%");
  assert.ok(near(rule.maxDrawdown, -0.534, 0.005), "rule max drawdown near -53.4%");
  assert.ok(near(hold.cagr, 0.539, 0.01), "buy and hold CAGR near 53.9%");
  assert.ok(near(hold.maxDrawdown, -0.792, 0.005), "buy and hold max drawdown near -79.2%");
});

test("a larger core means more average exposure and sizing follows the drawdown", async () => {
  const { buildReport } = await load();
  const report = buildReport();
  for (const source of report.sources)
    for (const period of source.periods)
      for (let i = 1; i < period.mixes.length; i += 1)
        assert.ok(period.mixes[i].averageExposure > period.mixes[i - 1].averageExposure);
  for (const row of report.sizing) {
    for (const cell of row.lossByShare) assert.ok(near(cell.loss, cell.share * row.drawdown, 1e-12));
    for (const cell of row.shareForLoss)
      assert.ok(near(cell.share * Math.abs(row.drawdown), cell.limit, 1e-12));
  }
});
