const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const draft = require("../allocation-draft.js");
const policy = require("../core-satellite-policy.js");

test("optimization draft starts at the requested 100 percent without mutating saved allocations", () => {
  const current = { SPY: .2, QQQ: .1, NVDA: .3, PEP: .4 }, before = { ...current };
  const session = draft.createDraft(current, [{ symbol: "KO", name: "可口可乐" }, { symbol: "WMT", name: "沃尔玛" }]);
  assert.deepEqual(session.allocations, { SPY: .20, QQQ: .10, NVDA: .11, AAPL: .09, ASML: .09, PEP: .09, KO: .09, WMT: .08, QNT: .05, CBRS: .05, JOBY: .05 });
  assert.deepEqual(current, before);
  session.allocations.SPY = .4;
  session.baseline.NVDA = .1;
  assert.deepEqual(current, before);
  assert.equal(draft.RECOMMENDED.SPY, .2);
  const metrics = draft.metrics(draft.RECOMMENDED);
  assert.equal(metrics.valid, true);
  assert.equal(metrics.metrics.allocated, 100);
  assert.equal(metrics.speculativePct, 15);
  assert.equal(metrics.speculativeAboveSuggestion, false);
});

test("candidate list contains explicit template symbols and known holdings, with valid deduplicated symbols", () => {
  const session = draft.createDraft({ SPY: .2, XOM: .8 }, [{ symbol: "ko", name: "可口可乐" }, { symbol: "BRK.B", name: "Berkshire" }, { symbol: "BAD<script>" }, "XOM"]);
  const symbols = session.candidates.map(row => row.symbol);
  assert.ok(symbols.includes("XOM"));
  assert.ok(symbols.includes("BRK.B"));
  assert.ok(symbols.includes("QNT"));
  assert.equal(symbols.filter(symbol => symbol === "KO").length, 1);
  assert.ok(!symbols.includes("BAD<script>"));
  assert.equal(session.candidates.find(row => row.symbol === "KO").name, "可口可乐");
});

test("editing fixes the requested target and distributes remaining basis points exactly", () => {
  for (const [symbol, percent] of [["SPY", 23.47], ["NVDA", 11.27], ["KO", 0], ["JOBY", 100]]) {
    const before = { ...draft.RECOMMENDED }, result = draft.edit(before, symbol, percent);
    assert.equal(result.valid, true, symbol);
    assert.equal(result.allocations[symbol], percent / 100, symbol);
    assert.equal(result.metrics.allocated, 100, symbol);
    assert.equal(Object.values(result.allocations).reduce((sum, ratio) => sum + Math.round(ratio * 10000), 0), 10000);
    assert.deepEqual(before, draft.RECOMMENDED);
  }
});

test("invalid proportions leave the model untouched and never create an unknown row", () => {
  for (const percent of ["", " ", null, true, "NaN", -1, 100.01, 2.345]) {
    const allocations = { ...draft.RECOMMENDED };
    assert.equal(draft.edit(allocations, "SPY", percent).valid, false, String(percent));
    assert.deepEqual(allocations, draft.RECOMMENDED);
  }
  assert.equal(draft.edit(draft.RECOMMENDED, "UNKNOWN", 1).valid, false);
});

test("KO and WMT can be omitted with the manually set SPY allocation preserved", () => {
  let result = draft.edit(draft.RECOMMENDED, "SPY", "27.31");
  assert.equal(result.valid, true);
  for (const symbol of ["KO", "WMT"]) {
    result = draft.remove(result.allocations, symbol);
    assert.equal(result.valid, true);
    assert.equal(result.allocations.SPY, .2731);
    assert.equal(Object.hasOwn(result.allocations, symbol), false);
    assert.equal(result.metrics.allocated, 100);
  }
  assert.equal(draft.remove(result.allocations, "SPY").valid, false);
  assert.equal(draft.remove(result.allocations, "NOT_PRESENT").valid, false);
});

test("normalization respects SPY below legacy shortcut minimum and handles the last allocation safely", () => {
  const allocations = { SPY: .2, QQQ: .1, NVDA: .2 };
  const result = draft.normalize(allocations);
  assert.equal(result.valid, true);
  assert.equal(result.allocations.SPY, .2);
  assert.equal(result.metrics.allocated, 100);
  assert.deepEqual(allocations, { SPY: .2, QQQ: .1, NVDA: .2 });
  assert.equal(draft.remove({ SPY: .2, KO: .8 }, "KO").valid, false);
  assert.deepEqual(draft.remove({ SPY: 1, KO: 0 }, "KO").allocations, { SPY: 1 });
  for (const invalid of [{ QQQ: 1 }, { SPY: .2, KO: NaN }, { SPY: .2, KO: -.2 }, { SPY: .2, KO: 1.01 }]) assert.equal(draft.normalize(invalid).valid, false);
});

test("adding uses known candidates and enforces a positive, precise target", () => {
  const session = draft.createDraft({}, [{ symbol: "XOM", name: "Exxon" }]);
  const result = draft.add(session.allocations, session.candidates, "XOM", "4.53");
  assert.equal(result.valid, true);
  assert.equal(result.allocations.XOM, .0453);
  assert.equal(result.metrics.allocated, 100);
  assert.equal(policy.presetFromAllocations(result.allocations) !== null, true);
  assert.equal(draft.add(session.allocations, session.candidates, "FAKE", 1).valid, false);
  assert.equal(draft.add(session.allocations, session.candidates, "SPY", 1).valid, false);
  for (const invalid of [0, -1, 100.01, "", "4.531", true]) assert.equal(draft.add(session.allocations, session.candidates, "XOM", invalid).valid, false);
});

test("speculative group warning is informative and does not enforce a ratio cap", () => {
  const result = draft.edit(draft.RECOMMENDED, "JOBY", 50);
  const metrics = draft.metrics(result.allocations);
  assert.equal(metrics.valid, true);
  assert.equal(metrics.speculativeAboveSuggestion, true);
  assert.ok(metrics.speculativePct > 15);
});

test("browser bundle exposes the same API without Node or storage side effects", () => {
  const source = fs.readFileSync(require.resolve("../allocation-draft.js"), "utf8");
  const sandbox = { CoreSatellitePolicy: policy };
  vm.runInNewContext(source, sandbox);
  assert.equal(typeof sandbox.AllocationDraft.createUI, "function");
  assert.equal(sandbox.AllocationDraft.metrics(sandbox.AllocationDraft.RECOMMENDED).valid, true);
  assert.equal(sandbox.AllocationDraft.RECOMMENDED.SPY, .2);
});
