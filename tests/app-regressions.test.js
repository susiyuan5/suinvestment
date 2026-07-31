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
  assert.match(appSource, /SettingsStorage\.loadApiKey\(localStorage, sessionStorage\)/);
  assert.match(appSource, /SettingsStorage\.saveApiKey\(apiKeyInput\.value, localStorage, sessionStorage\)/);
  assert.match(appSource, /SettingsStorage\.getApiKey\(localStorage\)/);
  assert.doesNotMatch(
    appSource,
    /var apiKey = sessionStorage\.getItem\(STORAGE_KEYS\.apiKey\)/
  );
});
