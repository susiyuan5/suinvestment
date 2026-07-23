const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const appSource = fs.readFileSync("app.js", "utf8");

test("app delegates backtest simulation to the shared engine exactly once", function () {
  assert.equal((appSource.match(/BacktestEngine\.simulateStrategy\(/g) || []).length, 1);
  assert.doesNotMatch(appSource, /Unreachable compatibility body/);
  assert.doesNotMatch(appSource, /const positions = aligned\.reduce/);
});

test("Finnhub API key persists locally and is not limited to the browser session", function () {
  assert.match(appSource, /localStorage\.getItem\(STORAGE_KEYS\.apiKey\)/);
  assert.match(appSource, /localStorage\.setItem\(STORAGE_KEYS\.apiKey, value\)/);
  assert.match(appSource, /localStorage\.removeItem\(STORAGE_KEYS\.apiKey\)/);
  assert.doesNotMatch(
    appSource,
    /var apiKey = sessionStorage\.getItem\(STORAGE_KEYS\.apiKey\)/
  );
});
