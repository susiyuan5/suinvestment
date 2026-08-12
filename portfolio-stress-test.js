(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PortfolioStressTest = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  var SCENARIOS = [{ id: "bear", name: "普通熊市", assumptions: { spy: -.2, technology: -.3, other: -.15, cash: 0 } }, { id: "deep_bear", name: "深度熊市", assumptions: { spy: -.35, technology: -.5, other: -.3, cash: 0 } }, { id: "tech_shock", name: "科技板块额外下跌", assumptions: { spy: -.15, technology: -.45, other: -.1, cash: 0 } }, { id: "single_stock", name: "单一个股大幅下跌", assumptions: { spy: -.1, technology: -.6, other: -.05, cash: 0 } }, { id: "otc_liquidity", name: "OTC 流动性冲击", assumptions: { spy: -.1, technology: -.35, other: -.25, cash: 0 } }, { id: "fx", name: "CAD/USD 汇率变化", assumptions: { spy: -.1, technology: -.1, other: -.1, cash: 0, fx: -.1 } }];
  function run(positions) { return SCENARIOS.map(function (scenario) { var parts = { spy: 0, technology: 0, other: 0, cash: Number(positions.cash || 0) * scenario.assumptions.cash }; Object.keys(positions || {}).forEach(function (symbol) { if (symbol === "cash") return; var row = positions[symbol] || {}, value = Number(row.value || 0), bucket = row.bucket === "core" ? "spy" : row.sector === "technology" ? "technology" : "other"; parts[bucket] += value * Number(scenario.assumptions[bucket]); }); var loss = parts.spy + parts.technology + parts.other + parts.cash; return { id: scenario.id, name: scenario.name, assumptions: scenario.assumptions, estimatedLoss: loss, contribution: parts, complete: true, note: "仅为情景估算，不代表预测" }; }); }
  return Object.freeze({ SCENARIOS: SCENARIOS, run: run });
});
