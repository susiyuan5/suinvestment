const test = require("node:test");
const assert = require("node:assert/strict");
const policy = require("../dashboard-ui-policy.js");

test("desktop holdings sort by absolute allocation deviation", () => {
  const rows = policy.sortHoldingsByDeviation([{ symbol: "KO", allocationDrift: 1 }, { symbol: "NVDA", allocationDrift: -4 }, { symbol: "SPY", allocationDrift: 2 }]);
  assert.deepEqual(rows.map((row) => row.symbol), ["NVDA", "SPY", "KO"]);
});

test("decision labels remain consistent with amount and action", () => {
  assert.equal(policy.decisionStatus(0, "BUY"), "暂停或保留现金");
  assert.equal(policy.decisionStatus(10, "REDUCE_BUY"), "低于基准投入");
  assert.equal(policy.decisionStatus(10, "HOLD"), "暂停或保留现金");
});

test("empty holdings states distinguish unlocked, cash-only, and fallback", () => {
  assert.match(policy.emptyHoldingsState("automatic", "ready", true), /已检测到现金/);
  assert.equal(policy.emptyHoldingsState("automatic", "locked", false), "加密快照尚未在本机解锁");
  assert.equal(policy.emptyHoldingsState("automatic", "error", false), "自动同步失败，已回退到人工持仓");
});
