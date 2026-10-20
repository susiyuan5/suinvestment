"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../btc-trend-signal.js");
const fixture = require("./fixtures/btc-weekly-v1.json");

function weeks(closes, end = "2026-10-18") {
  const last = Date.parse(end + "T00:00:00Z");
  return closes.map((close, i) => ({
    week_end: new Date(last - (closes.length - 1 - i) * 7 * 86400000).toISOString().slice(0, 10),
    close,
  }));
}
const opt = { maPeriod: 3, entryWeeks: 2, exitWeeks: 1 };

test("entry needs two consecutive closes above the MA", () => {
  // MA3 from index 2: closes 10,10,10 → MA 10 (not above)
  const r1 = S.evaluate(weeks([10, 10, 10, 13]), opt);
  assert.equal(r1.current.state, "cash");
  assert.equal(r1.current.aboveStreak, 1);
  const r2 = S.evaluate(weeks([10, 10, 10, 13, 15]), opt);
  assert.equal(r2.current.state, "holding");
  assert.equal(r2.transitions.at(-1).event, "enter");
  assert.equal(r2.transitions.at(-1).weekEnd, "2026-10-18");
});

test("a single close below the MA exits", () => {
  const r = S.evaluate(weeks([10, 10, 10, 13, 15, 16, 11]), opt);
  assert.equal(r.current.state, "cash");
  assert.equal(r.transitions.at(-1).event, "exit");
  assert.equal(r.current.belowStreak, 1);
});

test("an interrupted streak does not enter", () => {
  const r = S.evaluate(weeks([10, 10, 10, 13, 9, 14]), opt);
  assert.equal(r.current.state, "cash");
  assert.equal(r.transitions.length, 0);
});

test("next-week threshold equals mean of the latest N-1 closes", () => {
  const closes = [10, 10, 10, 13, 15, 16];
  const r = S.evaluate(weeks(closes), opt);
  assert.equal(r.nextStep.kind, "exit-watch");
  assert.equal(r.nextStep.price, (15 + 16) / 2);
  // Closing exactly below the threshold must flip the state; at/above must not.
  const below = S.evaluate(weeks([...closes, r.nextStep.price - 0.01]), opt);
  const above = S.evaluate(weeks([...closes, r.nextStep.price + 0.01]), opt);
  assert.equal(below.current.state, "cash");
  assert.equal(above.current.state, "holding");
});

test("invalid or short series are rejected", () => {
  assert.throws(() => S.evaluate(weeks([10, 10]), opt), /not enough/);
  const gap = weeks([10, 10, 10, 11]);
  gap[2].week_end = "2026-10-05";
  assert.throws(() => S.evaluate(gap, opt), /invalid/);
  assert.throws(() => S.evaluate(weeks([10, 10, -1, 11]), opt), /invalid/);
  assert.throws(() => S.evaluate(weeks([10, 10, 10, 11]), { maPeriod: 0 }), /invalid option/);
});

test("frozen snapshot reproduces the researched 20W 2/1 signal history", () => {
  const r = S.fromSnapshot(fixture, new Date("2026-10-20T12:00:00Z"));
  assert.equal(r.options.maPeriod, 20);
  assert.equal(r.current.weekEnd, "2026-10-18");
  assert.equal(r.current.state, "holding");
  assert.equal(r.current.lastTransition.weekEnd, "2026-08-30");
  assert.deepEqual(
    r.transitions.slice(-4).map((t) => [t.weekEnd, t.event]),
    [["2025-10-19", "exit"], ["2026-05-03", "enter"], ["2026-05-31", "exit"], ["2026-08-30", "enter"]],
  );
  assert.equal(r.freshness.stale, false);
  assert.ok(Math.abs(r.current.ma - 71529.58) < 0.05);
});

test("stale snapshot is flagged and wrong schema is refused", () => {
  const r = S.fromSnapshot(fixture, new Date("2026-11-10T00:00:00Z"));
  assert.equal(r.freshness.stale, true);
  assert.throws(() => S.fromSnapshot({ ...fixture, schema: "x" }), /格式不兼容/);
});
