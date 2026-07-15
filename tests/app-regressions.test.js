const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const appSource = fs.readFileSync("app.js", "utf8");

test("app delegates backtest simulation to the shared engine exactly once", function () {
  assert.equal((appSource.match(/BacktestEngine\.simulateStrategy\(/g) || []).length, 1);
  assert.doesNotMatch(appSource, /Unreachable compatibility body/);
  assert.doesNotMatch(appSource, /const positions = aligned\.reduce/);
});
