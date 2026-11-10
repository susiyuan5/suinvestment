"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../tqqq-ma-signal.js");
const fixture = require("./fixtures/tqqq-ma-daily-v1.json");

// Weekday sessions ending on `end`; each entry is [spy, qqq].
function days(pairs, end = "2026-11-09") {
  const out = [];
  let stamp = Date.parse(end + "T00:00:00Z");
  for (let i = pairs.length - 1; i >= 0; i -= 1) {
    while ([0, 6].includes(new Date(stamp).getUTCDay())) stamp -= 86400000;
    out.unshift({ date: new Date(stamp).toISOString().slice(0, 10), spy: pairs[i][0], qqq: pairs[i][1] });
    stamp -= 86400000;
  }
  return out;
}
const opt = { maPeriod: 3 };
const flat = [[100, 100], [100, 100], [100, 100]];

test("buy needs both symbols at least 4% above their averages", () => {
  // SPY alone above the line is not enough.
  let r = S.evaluate(days([...flat, [110, 100]]), opt);
  assert.equal(r.current.state, "cash");
  assert.equal(r.transitions.length, 0);
  r = S.evaluate(days([...flat, [110, 110]]), opt);
  assert.equal(r.current.state, "hold");
  assert.equal(r.current.signalToday, true);
  assert.equal(r.transitions[0].event, "buy");
});

test("either symbol 3% below its average sells; between the lines keeps the state", () => {
  const up = [...flat, [110, 110]];
  let r = S.evaluate(days([...up, [108, 108], [107, 107]]), opt);
  assert.equal(r.current.state, "hold", "drifting between the lines keeps holding");
  assert.equal(r.current.signalToday, false);
  r = S.evaluate(days([...up, [110, 110], [110, 100]]), opt);
  assert.equal(r.current.state, "cash", "QQQ alone below the sell line sells");
  assert.equal(r.transitions.at(-1).event, "sell");
  // After a sell, recovering to the average is not a buy.
  r = S.evaluate(days([...up, [110, 110], [110, 100], [110, 104]]), opt);
  assert.equal(r.current.state, "cash");
});

test("lines and distances follow the 200-day average", () => {
  const r = S.evaluate(fixture.days);
  for (const side of [r.current.spy, r.current.qqq]) {
    assert.ok(Math.abs(side.sellLine - side.ma200 * 0.97) < 1e-9);
    assert.ok(Math.abs(side.buyLine - side.ma200 * 1.04) < 1e-9);
    assert.ok(Math.abs(side.close * (1 + side.toBuyPct / 100) - side.buyLine) < 1e-9);
    assert.ok(Math.abs(side.close * (1 - side.toSellPct / 100) - side.sellLine) < 1e-9);
  }
  assert.ok(Math.abs(r.current.heat.halfLine - r.current.qqq.ma200 * 1.3) < 1e-9);
  assert.ok(Math.abs(r.current.heat.exitLine - r.current.qqq.ma200 * 1.4) < 1e-9);
  const tail = fixture.days.slice(-200);
  const mean = (key) => tail.reduce((sum, row) => sum + row[key], 0) / 200;
  assert.ok(Math.abs(r.current.spy.ma200 - mean("spy")) < 1e-6);
  assert.ok(Math.abs(r.current.qqq.ma200 - mean("qqq")) < 1e-6);
});

test("frozen snapshot reproduces the signal saved in the original page", () => {
  // Values stored by the source artifact for 2026-11-09: out since 2026-11-05,
  // SPY 752.69 / 730.70, QQQ 679.35 / 681.17, deviations +3.01% and -0.27%.
  const r = S.evaluate(fixture.days);
  assert.equal(r.current.asof, "2026-11-09");
  assert.equal(r.current.state, "cash");
  assert.equal(r.current.since, "2026-11-05");
  assert.equal(r.current.spy.ma200.toFixed(2), "730.70");
  assert.equal(r.current.qqq.ma200.toFixed(2), "681.17");
  assert.equal(r.current.spy.pct.toFixed(2), "3.01");
  assert.equal(r.current.qqq.pct.toFixed(2), "-0.27");
  assert.equal(r.current.heat.state, "none");
  assert.deepEqual(
    r.transitions.map((row) => row.date + " " + row.event),
    [
      "2020-07-15 buy", "2022-01-21 sell", "2023-02-02 buy", "2025-03-10 sell",
      "2025-06-10 buy", "2026-03-26 sell", "2026-04-14 buy", "2026-11-05 sell",
    ],
  );
  assert.equal(r.history.length, 252);
  assert.equal(r.history.at(-1).date, "2026-11-09");
});

test("overheat levels are reported but never change the state", () => {
  const r = S.evaluate(days([...flat, [110, 110], [112, 200], [114, 400]]), opt);
  assert.equal(r.current.heat.state, "exit");
  assert.equal(r.current.state, "hold");
  assert.deepEqual(r.transitions.map((row) => row.event), ["buy"]);
});

test("stale snapshots are flagged and bad input is refused", () => {
  const fresh = S.fromSnapshot(fixture, new Date("2026-11-10T12:00:00Z"));
  assert.equal(fresh.freshness.stale, false);
  const old = S.fromSnapshot(fixture, new Date("2026-11-14T12:00:00Z"));
  assert.equal(old.freshness.stale, true);
  assert.throws(() => S.fromSnapshot({ schema: "other", days: fixture.days }), /格式不兼容/);
  assert.throws(() => S.evaluate(days(flat), opt), /not enough/);
  assert.throws(() => S.evaluate([...days(flat), { date: "2026-11-09", spy: 1, qqq: 1 }], opt), /invalid/);
  assert.throws(() => S.evaluate(days([...flat, [0, 1]]), opt), /invalid/);
  assert.throws(() => S.evaluate(fixture.days, { buyPct: -1 }), /buy line/);
});

test("manual check mirrors the rule without assuming a previous state", () => {
  assert.deepEqual(S.manual({}), { spy: null, qqq: null, verdict: null });
  assert.equal(S.manual({ spyClose: 104, spyMa: 100 }).verdict, null);
  assert.equal(S.manual({ spyClose: 104, spyMa: 100, qqqClose: 104, qqqMa: 100 }).verdict, "buy");
  assert.equal(S.manual({ spyClose: 110, spyMa: 100, qqqClose: 103.9, qqqMa: 100 }).verdict, "none");
  assert.equal(S.manual({ spyClose: 110, spyMa: 100, qqqClose: 97, qqqMa: 100 }).verdict, "sell");
  assert.equal(S.manual({ spyClose: 96.9, spyMa: 100, qqqClose: 110, qqqMa: 100 }).verdict, "sell");
});

test("position cap: 11% of total wealth from a 10% loss limit", async () => {
  const plan = S.plan();
  assert.equal(plan.lossLimit, 0.1);
  assert.equal(plan.budgetCap, 0.11);
  assert.equal(plan.realHistoryBudgetCap, 0.2);
  assert.ok(plan.budgetCap * plan.referenceDrawdown <= plan.lossLimit);
  assert.equal(S.budgetCap(0.5, 0.25), 1);
  assert.throws(() => S.budgetCap(0, 0.5));
  assert.throws(() => S.budgetCap(0.1, 1.5));
  // The reference drawdowns are the backtest's results.
  const { buildReport } = await import("../scripts/tqqq-ma-backtest.mjs");
  const periods = buildReport().periods;
  const long = periods.find((period) => period.name.startsWith("with synthetic")).rule.maxDrawdown;
  const real = periods.find((period) => period.name === "real TQQQ").rule.maxDrawdown;
  assert.ok(Math.abs(Math.abs(long) - S.PLAN.referenceDrawdown) < 0.0005);
  assert.ok(Math.abs(Math.abs(real) - S.PLAN.realDrawdown) < 0.0005);
});
