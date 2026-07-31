(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CoreSatellitePolicy = factory();
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  var EPSILON = 0.005;
  var PRESET = {
    version: "core-satellite-v1", research_only: true, qqq_signal_only: true,
    core: { symbol: "SPY", target_allocation: 0.6, asset_type: "index_etf", bucket: "core", signal_role: "market_core" },
    satellites: [
      { symbol: "NVDA", target_allocation: 0.1, asset_type: "stock", bucket: "satellite", sector: "technology", signal_role: "satellite_dca_l2" },
      { symbol: "AAPL", target_allocation: 0.1, asset_type: "stock", bucket: "satellite", sector: "technology", signal_role: "satellite_dca_l2" },
      { symbol: "ASML", target_allocation: 0.08, asset_type: "stock", bucket: "satellite", sector: "technology", signal_role: "satellite_dca_l2" },
      { symbol: "KO", target_allocation: 0.07, asset_type: "stock", bucket: "satellite", sector: "consumer_staples", signal_role: "satellite_dca_l2" },
      { symbol: "BYDDY", target_allocation: 0.05, asset_type: "stock", bucket: "satellite", sector: "consumer_discretionary", signal_role: "satellite_dca_l2" }
    ], limits: { spy_max_current_pct: 70, satellite_enhancement_block_pct: 45, single_stock_block_pct: 12, technology_enhancement_block_pct: 35, spy_enhancement_max_multiple: 1.25 }
  };
  function finite(value) { var n = Number(value); return Number.isFinite(n) ? n : null; }
  function money(value) { var n = finite(value); return n === null ? 0 : Math.round((Math.max(0, n) + 1e-10) * 100) / 100; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function validatePreset(preset) {
    if (!preset || preset.version !== "core-satellite-v1" || !preset.core || !Array.isArray(preset.satellites)) return false;
    var total = Number(preset.core.target_allocation) + preset.satellites.reduce(function (sum, row) { return sum + Number(row.target_allocation); }, 0);
    if (!Number.isFinite(total) || Math.abs(total - 1) > 1e-9) return false;
    if (preset.core.symbol !== "SPY" || preset.satellites.length !== 5) return false;
    return preset.satellites.every(function (row) { return Number(row.target_allocation) <= 0.1 && row.bucket === "satellite"; });
  }
  function normalizedPreset(preset) { return validatePreset(preset) ? clone(preset) : null; }
  function loadPreset(url) { return fetch(url).then(function (response) { if (!response.ok) throw new Error("preset fetch failed"); return response.json(); }).then(function (value) { var result = normalizedPreset(value); if (!result) throw new Error("invalid core-satellite preset"); return result; }); }
  function rowsForPreset(preset) { var p = normalizedPreset(preset) || clone(PRESET); return [p.core].concat(p.satellites).map(function (row) { return Object.assign({}, row, { allocation: row.target_allocation, preset_version: p.version }); }); }
  function reason(row, code) { row.reasonCodes = row.reasonCodes || []; if (row.reasonCodes.indexOf(code) < 0) row.reasonCodes.push(code); }
  function plan(input) {
    var p = normalizedPreset(input && input.preset) || clone(PRESET), budget = input || {}, baseBudget = money(budget.baseBudget == null ? budget.base_budget : budget.baseBudget), crashBudget = money(budget.crashFundRemaining == null ? budget.crash_fund_remaining : budget.crashFundRemaining), spy = p.core.symbol;
    var actualAllocations = budget.actualAllocations || budget.actual_allocations || {}, satelliteDecisions = budget.satelliteDecisions || budget.satellite_decisions || {}, spyDataValid = budget.spyDataValid == null ? budget.spy_data_valid !== false : budget.spyDataValid !== false;
    var actual = actualAllocations, spyActual = finite(actual[spy]) || 0, satelliteActual = p.satellites.reduce(function (s, x) { return s + (finite(actual[x.symbol]) || 0); }, 0);
    var techActual = p.satellites.filter(function (x) { return x.sector === "technology"; }).reduce(function (s, x) { return s + (finite(actual[x.symbol]) || 0); }, 0);
    var spyUsable = spyDataValid && budget.safetyBlocked !== true;
    var rows = [], normalRemaining = baseBudget, redirect = 0;
    var spyBase = money(baseBudget * p.core.target_allocation);
    rows.push({ symbol: spy, bucket: "core", originalBaseAmount: spyBase, dcaAdjustedAmount: spyBase, crashFundEnhancement: 0, riskReduction: 0, redirectedToSpy: 0, cashRetained: 0, finalAmount: spyUsable ? spyBase : 0, reasonCodes: spyUsable ? [] : ["SPY_DATA_OR_SAFETY_BLOCK"], factorChain: ["base:60%"] });
    normalRemaining = money(Math.max(0, normalRemaining - spyBase));
    p.satellites.forEach(function (asset) {
      var original = money(baseBudget * asset.target_allocation), adjusted = money(satelliteDecisions[asset.symbol] && satelliteDecisions[asset.symbol].finalAmount);
      if (!satelliteDecisions[asset.symbol]) adjusted = original;
      var row = { symbol: asset.symbol, bucket: "satellite", originalBaseAmount: original, dcaAdjustedAmount: adjusted, crashFundEnhancement: money((satelliteDecisions[asset.symbol] && satelliteDecisions[asset.symbol].crashFundAmount) || 0), riskReduction: 0, redirectedToSpy: 0, cashRetained: 0, finalAmount: adjusted, reasonCodes: [], factorChain: [] };
      var blocked = adjusted <= 0 && original > 0 || (finite(actual[asset.symbol]) || 0) >= p.limits.single_stock_block_pct || (satelliteActual >= p.limits.satellite_enhancement_block_pct && adjusted > original) || (asset.sector === "technology" && techActual >= p.limits.technology_enhancement_block_pct && adjusted > original) || budget.blockedSymbols && budget.blockedSymbols.indexOf(asset.symbol) >= 0;
      if (blocked) { row.riskReduction = row.finalAmount; row.finalAmount = 0; reason(row, "SATELLITE_RISK_BLOCKED"); redirect += original; }
      else { normalRemaining = money(Math.max(0, normalRemaining - Math.min(original, row.finalAmount))); }
      rows.push(row);
    });
    var satelliteTotal = rows.slice(1).reduce(function (sum, row) { return sum + row.finalAmount; }, 0), satelliteCap = money(Math.max(0, baseBudget - rows[0].finalAmount));
    if (satelliteTotal > satelliteCap) rows.slice(1).forEach(function (row) { row.finalAmount = money(row.finalAmount * satelliteCap / satelliteTotal); reason(row, "NORMAL_POOL_BUDGET_APPLIED"); });
    var redirected = spyUsable && spyActual < p.limits.spy_max_current_pct ? money(Math.min(redirect, normalRemaining + redirect)) : 0;
    if (spyUsable && spyActual < p.limits.spy_max_current_pct) { rows[0].redirectedToSpy = redirected; rows[0].finalAmount = money(rows[0].finalAmount + redirected); reason(rows[0], "SATELLITE_BASE_REDIRECTED_TO_SPY"); }
    var retained = money(redirect - redirected);
    if (retained) rows.forEach(function (row) { if (row.symbol !== spy && row.finalAmount === 0) row.cashRetained = money(row.cashRetained + retained / Math.max(1, rows.length - 1)); });
    var enhancement = money(Math.min(crashBudget, Math.max(0, spyBase * (p.limits.spy_enhancement_max_multiple - 1)), money(budget.spyCrashEnhancement)));
    if (spyUsable) { rows[0].crashFundEnhancement = enhancement; rows[0].finalAmount = money(rows[0].finalAmount + enhancement); } else { enhancement = 0; }
    var total = money(rows.reduce(function (s, row) { return s + row.finalAmount; }, 0)), source = money(baseBudget + crashBudget), cash = money(Math.max(0, source - total));
    if (Math.abs(total + cash - source) > EPSILON) throw new Error("core-satellite plan violates conservation");
    return { version: p.version, items: rows, spyBase: spyBase, spyRedirected: redirected, crashFundUsed: enhancement, cashRetained: money(cash), totalPlanned: total, conservation: { source: source, allocated: total, cash: cash, balanced: true }, summary: { coreTargetPct: p.core.target_allocation * 100, satelliteTargetPct: 40, satelliteActualPct: satelliteActual, technologyActualPct: techActual, spyActualPct: spyActual, qqqGeneratesBuyAmount: false } };
  }
  return Object.freeze({ PRESET: PRESET, validatePreset: validatePreset, normalizedPreset: normalizedPreset, loadPreset: loadPreset, rowsForPreset: rowsForPreset, plan: plan, money: money });
}));
