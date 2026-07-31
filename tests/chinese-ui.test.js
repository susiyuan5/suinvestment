const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("homepage uses simplified Chinese and has no language switcher", () => {
  const html = fs.readFileSync("index.html", "utf8");
  assert.match(html, /<html lang="zh-CN">/);
  assert.doesNotMatch(html, /id="languageToggle"/);
  for (const id of ["weeklyDecisionPlan", "weeklyDecisionTotal", "weeklyDecisionRows", "weeklyDecisionSafety", "coreSatelliteSummary"]) assert.match(html, new RegExp(`id="${id}"`));
});

test("weekly decision order contract contains SPY and all five satellites", () => {
  const source = fs.readFileSync("app.js", "utf8");
  assert.match(source, /const expected = \["SPY", "NVDA", "AAPL", "ASML", "KO", "BYDDY"\]/);
  assert.match(source, /QQQ 仅作为科技风险指标/);
  assert.match(source, /数据或计算未通过安全检查，请人工复核/);
});
