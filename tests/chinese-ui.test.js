const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("homepage uses simplified Chinese and has no language switcher", () => {
  const html = fs.readFileSync("index.html", "utf8");
  const app = fs.readFileSync("app.js", "utf8");
  assert.match(html, /<html lang="zh-CN">/);
  assert.doesNotMatch(html, /id="languageToggle"/);
  assert.doesNotMatch(html, /当前尚未应用 60% 大盘/);
  assert.equal((html.match(/本周资金与定投决策/g) || []).length, 1);
  assert.doesNotMatch(html, /本周资金计划/);
  assert.match(html, /<h2 id="holdings-title">个股信号与持仓<\/h2>/);
  assert.doesNotMatch(app, /thisTuesday:\s*"本周定投决策"/);
  assert.match(html, /id="displayCurrencySelect"/);
  assert.match(html, /显示货币不改变原始预算、持仓和成交币种/);
  assert.match(html, /当前 USD\/CAD 汇率/);
  assert.match(html, /fx-rate-service\.js/);
  for (const id of ["weeklyDecisionPlan", "weeklyDecisionTotal", "weeklyDecisionRows", "weeklyDecisionSafety", "coreSatelliteSummary", "allocationEditorRows", "saveCustomAllocationBtn", "restoreDefaultAllocationBtn", "undoAllocationBtn"]) assert.match(html, new RegExp(`id="${id}"`));
});

test("weekly decision is the single visible planning surface", () => {
  const html = fs.readFileSync("index.html", "utf8");
  for (const id of ["weeklyDecisionOverview", "weeklyDecisionAllocationSummary", "weeklyDecisionExplanation", "weeklyDecisionQqqStatus", "weeklyBaseBudget", "weeklyCrashFund", "weeklyConservationStatus"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.equal((html.match(/id="refreshBtn"/g) || []).length, 1);
  assert.equal((html.match(/id="copyBtn"/g) || []).length, 1);
});

test("desktop hierarchy follows the static DOM order", () => {
  const html = fs.readFileSync("index.html", "utf8");
  const ordered = ["id=\"decisionSummary\"", "class=\"overview-panel\"", "class=\"dashboard-layout\"", "class=\"inline-holdings-panel\"", "id=\"coreSatelliteAllocationEditor\"", "deployment-overview", "id=\"watchlist\"", "research-panel", "id=\"dataQualityPanel\""];
  let previous = -1;
  ordered.forEach((marker) => { const index = html.indexOf(marker); assert.ok(index > previous, `${marker} is out of order`); previous = index; });
  assert.match(html, /id="coreSatelliteSummary" class="visually-hidden"/);
  assert.match(html, /<details id="coreSatelliteAllocationEditor"/);
  assert.equal((html.match(/恢复默认 60\/40/g) || []).length, 1);
});

test("weekly decision order contract contains SPY and all five satellites", () => {
  const source = fs.readFileSync("app.js", "utf8");
  assert.match(source, /const expected = \["SPY", "NVDA", "AAPL", "ASML", "KO", "BYDDY"\]/);
  assert.match(source, /QQQ 仅作为科技风险指标/);
  assert.match(source, /数据或计算未通过安全检查，请人工复核/);
});
