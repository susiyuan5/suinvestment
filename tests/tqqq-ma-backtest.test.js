const test = require("node:test");
const assert = require("node:assert/strict");
const signal = require("../tqqq-ma-signal.js");
const liveFixture = require("./fixtures/tqqq-ma-daily-v1.json");
const load = () => import("../scripts/tqqq-ma-backtest.mjs");
const near = (actual, expected, tolerance) => Math.abs(actual - expected) < tolerance;

test("backtest positions come from the live rule and agree with the page fixture", async () => {
  const { loadSeries, positions } = await load();
  const series = loadSeries();
  const base = positions(series);
  const live = signal.evaluate(liveFixture.days);
  const byDate = new Map(base.rows.map((row) => [row.date, row]));
  for (const row of live.rows.slice(-400)) {
    assert.equal(byDate.get(row.date).state, row.state, row.date);
    assert.ok(near(byDate.get(row.date).qqqPct, row.qqqPct, 1e-6));
  }
  assert.deepEqual(
    base.transitions.slice(-4).map((row) => row.date + " " + row.event),
    live.transitions.slice(-4).map((row) => row.date + " " + row.event),
  );
  assert.equal(base.held.length, series.length);
  assert.ok(base.held.slice(0, base.offset).every((value) => value === 0));
});

test("accounting identities: buy and hold, always-held and fee direction", async () => {
  const { loadSeries, simulate, buyAndHold } = await load();
  const series = loadSeries();
  const qqq = series.map((row) => row.qqqAdj);
  const window = { from: "2010-02-11", to: "2019-12-31" };
  const hold = buyAndHold(series, qqq, { ...window, fee: 0 });
  const start = series.findIndex((row) => row.date >= window.from);
  const end = series.findIndex((row) => row.date > window.to) - 1;
  assert.ok(near(hold.multiple, qqq[end] / qqq[start], 1e-12));
  const always = simulate(series, qqq, series.map(() => 1), { ...window, fee: 0, lag: 0 });
  assert.ok(near(always.multiple / hold.multiple, 1, 1e-9));
  assert.ok(near(always.maxDrawdown, hold.maxDrawdown, 1e-9));
  const never = simulate(series, qqq, series.map(() => 0), { ...window, fee: 0.01 });
  assert.equal(never.multiple, 1);
  assert.equal(never.trades, 0);
  const half = simulate(series, qqq, series.map(() => 0.5), { ...window, fee: 0.01, lag: 0 });
  assert.ok(half.maxDrawdown > hold.maxDrawdown, "half size has a shallower drawdown");
  assert.ok(near(half.timeInMarket, 0.5, 1e-9));
});

test("synthetic 3x series is spliced onto real TQQQ and ends where it does", async () => {
  const { loadSeries, leveragedSeries } = await load();
  const series = loadSeries();
  const leveraged = leveragedSeries(series);
  const first = series.findIndex((row) => row.tqqqAdj !== null);
  assert.equal(leveraged.firstReal, "2010-02-11");
  for (let i = first; i < series.length; i += 1) assert.equal(leveraged.values[i], series[i].tqqqAdj);
  assert.ok(leveraged.values.slice(0, first).every((value) => Number.isFinite(value) && value > 0));
  assert.ok(leveraged.annualDrag > 0 && leveraged.annualDrag < 0.15);
  // Day before the splice: 3x the QQQ move less the fitted drag.
  const expected = 1 + 3 * (series[first].qqqAdj / series[first - 1].qqqAdj - 1) - leveraged.drag;
  assert.ok(near(leveraged.values[first] / leveraged.values[first - 1], expected, 1e-9));
});

test("report: headline results and sensitivity ordering", async () => {
  const { buildReport } = await load();
  const report = buildReport();
  const real = report.periods.find((period) => period.name === "real TQQQ");
  assert.ok(near(real.rule.cagr, 0.305, 0.005));
  assert.ok(near(real.rule.maxDrawdown, -0.481, 0.005));
  assert.ok(near(real.holdTqqq.cagr, 0.401, 0.005));
  assert.ok(near(real.holdTqqq.maxDrawdown, -0.817, 0.005));
  const long = report.periods.find((period) => period.name.startsWith("with synthetic"));
  assert.ok(near(long.rule.cagr, 0.15, 0.005));
  assert.ok(near(long.rule.maxDrawdown, -0.858, 0.005));
  assert.ok(long.holdTqqq.maxDrawdown < -0.99);
  for (let i = 1; i < report.sensitivity.fees.length; i += 1) {
    assert.ok(report.sensitivity.fees[i].real.multiple < report.sensitivity.fees[i - 1].real.multiple);
    assert.equal(report.sensitivity.fees[i].real.trades, report.sensitivity.fees[0].real.trades);
  }
  // The overheat reading only differs where QQQ actually reached +30%.
  const calm = report.periods.find((period) => period.name === "2010 to 2019");
  assert.equal(calm.ruleWithHeat.multiple, calm.rule.multiple);
  assert.equal(report.heat.lastExit, "2000-03-31");
  assert.equal(report.heat.half, report.heat.halfWhileHeld);
});
