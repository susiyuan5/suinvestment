(function (root, factory) { if (typeof module === "object" && module.exports) module.exports = factory(); else root.CoreSatellitePolicy = factory(); }(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  var EPSILON = 0.005, ALLOCATION_EPSILON = 1e-9;
  var SYMBOLS = ["SPY", "NVDA", "AAPL", "ASML", "KO", "BYDDY"];
  var SATELLITE_SYMBOLS = SYMBOLS.slice(1), TECH_SYMBOLS = ["NVDA", "AAPL", "ASML"];
  var PRESET = { version: "core-satellite-v3", research_only: true, qqq_signal_only: true,
    core: { symbol: "SPY", target_allocation: .40, asset_type: "index_etf", bucket: "core", signal_role: "market_core" },
    satellites: [
      { symbol: "NVDA", target_allocation: .14, asset_type: "stock", bucket: "satellite", sector: "technology", signal_role: "satellite_dca_l2" },
      { symbol: "AAPL", target_allocation: .14, asset_type: "stock", bucket: "satellite", sector: "technology", signal_role: "satellite_dca_l2" },
      { symbol: "ASML", target_allocation: .12, asset_type: "stock", bucket: "satellite", sector: "technology", signal_role: "satellite_dca_l2" },
      { symbol: "KO", target_allocation: .10, asset_type: "stock", bucket: "satellite", sector: "consumer_staples", signal_role: "satellite_dca_l2" },
      { symbol: "BYDDY", target_allocation: .10, asset_type: "stock", bucket: "satellite", sector: "consumer_discretionary", signal_role: "satellite_dca_l2" }
    ], limits: { spy_min_target_pct: 40, spy_max_target_pct: 80, satellite_min_target_pct: 20, satellite_max_target_pct: 60, single_stock_max_target_pct: 15, single_stock_block_pct: 18, satellite_enhancement_block_pct: 60, technology_max_target_pct: 40, technology_enhancement_block_pct: 40, spy_max_current_pct: 70, spy_enhancement_max_multiple: 1.25 },
    shortcuts: { "40": { SPY: .40, NVDA: .14, AAPL: .14, ASML: .12, KO: .10, BYDDY: .10 }, "50": { SPY: .50, NVDA: .10, AAPL: .10, ASML: .10, KO: .10, BYDDY: .10 }, "60": { SPY: .60, NVDA: .08, AAPL: .08, ASML: .08, KO: .08, BYDDY: .08 } } };
  if (typeof module === "object" && module.exports && typeof require === "function") {
    try { PRESET = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "data", "core-satellite-v3.json"), "utf8")); } catch (error) { /* browser-compatible fallback remains available */ }
  }
  function finite(value) { var n = Number(value); return Number.isFinite(n) ? n : null; }
  function money(value) { var n = finite(value); return n === null ? 0 : Math.round((Math.max(0, n) + 1e-10) * 100) / 100; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function pct(value) { var n = finite(value); return n === null ? null : Math.round((n * 100 + 1e-9) * 100) / 100; }
  function ratioFromPct(value) { return Math.round((Number(value) + 1e-9) * 100) / 10000; }
  function validatePreset(preset) {
    if (!preset || preset.version !== "core-satellite-v3" || !preset.core || !Array.isArray(preset.satellites) || preset.core.symbol !== "SPY" || preset.satellites.length !== 5) return false;
    var total = Number(preset.core.target_allocation) + preset.satellites.reduce(function (sum, row) { return sum + Number(row.target_allocation); }, 0);
    return Number.isFinite(total) && Math.abs(total - 1) <= ALLOCATION_EPSILON && preset.satellites.every(function (row) { var value = Number(row.target_allocation); return Number.isFinite(value) && value >= 0 && value <= .15 + ALLOCATION_EPSILON && row.bucket === "satellite"; });
  }
  function normalizedPreset(preset) { return validatePreset(preset) ? clone(preset) : null; }
  function loadPreset(url) { return fetch(url).then(function (response) { if (!response.ok) throw new Error("preset fetch failed"); return response.json(); }).then(function (value) { var result = normalizedPreset(value); if (!result) throw new Error("invalid core-satellite preset"); return result; }); }
  function rowsForPreset(preset) { var p = normalizedPreset(preset) || clone(PRESET); return [p.core].concat(p.satellites).map(function (row) { return Object.assign({}, row, { allocation: row.target_allocation, preset_version: p.version }); }); }
  function allocationMetrics(allocations) {
    var values = allocations || {}, rounded = {};
    SYMBOLS.forEach(function (symbol) { rounded[symbol] = pct(values[symbol]) === null ? 0 : pct(values[symbol]); });
    var allocated = SYMBOLS.reduce(function (sum, symbol) { return sum + rounded[symbol]; }, 0), tech = TECH_SYMBOLS.reduce(function (sum, symbol) { return sum + rounded[symbol]; }, 0);
    return { allocated: allocated, remaining: Math.max(0, 100 - allocated), overage: Math.max(0, allocated - 100), core: rounded.SPY, satellite: allocated - rounded.SPY, technology: tech, NVDA: rounded.NVDA, AAPL: rounded.AAPL, ASML: rounded.ASML, KO: rounded.KO, BYDDY: rounded.BYDDY };
  }
  function validateAllocations(allocations) {
    var values = allocations || {}, errors = [];
    SYMBOLS.forEach(function (symbol) { var raw = values[symbol], n = finite(raw); if (raw === "" || raw === null || raw === undefined || n === null || n < 0) errors.push(symbol + " 目标比例必须是非负数字"); });
    var metrics = allocationMetrics(values), limits = PRESET.limits;
    if (Math.abs(metrics.allocated - 100) > ALLOCATION_EPSILON) errors.push("六项比例合计必须严格等于 100.00%");
    if (metrics.core < limits.spy_min_target_pct - ALLOCATION_EPSILON || metrics.core > limits.spy_max_target_pct + ALLOCATION_EPSILON) errors.push("SPY 目标比例必须在 40.00% 至 80.00% 之间");
    if (metrics.satellite < limits.satellite_min_target_pct - ALLOCATION_EPSILON || metrics.satellite > limits.satellite_max_target_pct + ALLOCATION_EPSILON) errors.push("个股合计比例必须在 20.00% 至 60.00% 之间");
    SATELLITE_SYMBOLS.forEach(function (symbol) { if (metrics[symbol] > limits.single_stock_max_target_pct + ALLOCATION_EPSILON) errors.push(symbol + " 目标为 " + metrics[symbol].toFixed(2) + "%，超过单股上限 " + limits.single_stock_max_target_pct.toFixed(2) + "%"); });
    if (metrics.technology > limits.technology_max_target_pct + ALLOCATION_EPSILON) errors.push("科技个股合计为 " + metrics.technology.toFixed(2) + "%，超过上限 " + limits.technology_max_target_pct.toFixed(2) + "%");
    return { valid: errors.length === 0, errors: errors, metrics: metrics };
  }
  function allocationsForCore(corePercent) { var core = finite(corePercent); if (core === null || core < 40 || core > 80) return null; var shortcut = PRESET.shortcuts[String(core)]; if (shortcut) return clone(shortcut); return averageSatelliteAllocations(core); }
  function averageSatelliteAllocations(corePercent) { var core = finite(corePercent); if (core === null || core < 40 || core > 80) return null; var result = { SPY: ratioFromPct(core), NVDA: 0, AAPL: 0, ASML: 0, KO: 0, BYDDY: 0 }, each = ratioFromPct((100 - core) / 5); SATELLITE_SYMBOLS.forEach(function (symbol) { result[symbol] = each; }); return result; }
  function recommendedAllocations() { return clone(PRESET.shortcuts["40"]); }
  function presetFromAllocations(allocations, basePreset) { var p = normalizedPreset(basePreset) || clone(PRESET), result = clone(p), values = allocations || {}; result.core.target_allocation = ratioFromPct(pct(values.SPY) || 0); result.satellites.forEach(function (row) { row.target_allocation = ratioFromPct(pct(values[row.symbol]) || 0); }); return validatePreset(result) ? result : null; }
  function reason(row, code) { row.reasonCodes = row.reasonCodes || []; if (row.reasonCodes.indexOf(code) < 0) row.reasonCodes.push(code); }
  function plan(input) {
    var p = normalizedPreset(input && input.preset) || clone(PRESET), budget = input || {}, baseBudget = money(budget.baseBudget == null ? budget.base_budget : budget.baseBudget), crashBudget = money(budget.crashFundRemaining == null ? budget.crash_fund_remaining : budget.crashFundRemaining), spy = p.core.symbol;
    var actual = budget.actualAllocations || budget.actual_allocations || {}, decisions = budget.satelliteDecisions || budget.satellite_decisions || {}, spyUsable = (budget.spyDataValid == null ? budget.spy_data_valid !== false : budget.spyDataValid !== false) && budget.safetyBlocked !== true, spyActual = finite(actual[spy]) || 0, satelliteActual = p.satellites.reduce(function (s, x) { return s + (finite(actual[x.symbol]) || 0); }, 0), techActual = p.satellites.filter(function (x) { return x.sector === "technology"; }).reduce(function (s, x) { return s + (finite(actual[x.symbol]) || 0); }, 0);
    var rows = [], normalRemaining = baseBudget, redirect = 0, spyBase = money(baseBudget * p.core.target_allocation);
    rows.push({ symbol: spy, bucket: "core", originalBaseAmount: spyBase, dcaAdjustedAmount: spyBase, crashFundEnhancement: 0, riskReduction: 0, redirectedToSpy: 0, cashRetained: 0, finalAmount: spyUsable ? spyBase : 0, reasonCodes: spyUsable ? [] : ["SPY_DATA_OR_SAFETY_BLOCK"], factorChain: ["base:" + p.core.target_allocation * 100 + "%"] }); normalRemaining = money(Math.max(0, normalRemaining - spyBase));
    p.satellites.forEach(function (asset) { var original = money(baseBudget * asset.target_allocation), decision = decisions[asset.symbol] || {}, adjusted = money(decision.finalAmount == null ? original : decision.finalAmount), row = { symbol: asset.symbol, bucket: "satellite", originalBaseAmount: original, dcaAdjustedAmount: adjusted, crashFundEnhancement: money(decision.crashFundAmount || 0), riskReduction: 0, redirectedToSpy: 0, cashRetained: 0, finalAmount: adjusted, reasonCodes: [], factorChain: [] };
      var blocked = (adjusted <= 0 && original > 0) || (finite(actual[asset.symbol]) || 0) >= p.limits.single_stock_block_pct || (satelliteActual >= p.limits.satellite_enhancement_block_pct && adjusted > original) || (asset.sector === "technology" && techActual >= p.limits.technology_enhancement_block_pct && adjusted > original) || (budget.blockedSymbols && budget.blockedSymbols.indexOf(asset.symbol) >= 0);
      if (blocked) { row.riskReduction = row.finalAmount; row.finalAmount = 0; reason(row, "SATELLITE_RISK_BLOCKED"); redirect += original; } else normalRemaining = money(Math.max(0, normalRemaining - Math.min(original, row.finalAmount))); rows.push(row); });
    var satelliteTotal = rows.slice(1).reduce(function (sum, row) { return sum + row.finalAmount; }, 0), satelliteCap = money(Math.max(0, baseBudget - rows[0].finalAmount));
    if (satelliteTotal > satelliteCap && satelliteTotal > 0) rows.slice(1).forEach(function (row) { row.finalAmount = money(row.finalAmount * satelliteCap / satelliteTotal); reason(row, "NORMAL_POOL_BUDGET_APPLIED"); });
    var redirected = spyUsable && spyActual < p.limits.spy_max_current_pct ? money(Math.min(redirect, normalRemaining + redirect)) : 0; if (redirected) { rows[0].redirectedToSpy = redirected; rows[0].finalAmount = money(rows[0].finalAmount + redirected); reason(rows[0], "SATELLITE_BASE_REDIRECTED_TO_SPY"); }
    var retained = money(redirect - redirected); if (retained) rows.forEach(function (row) { if (row.symbol !== spy && row.finalAmount === 0) row.cashRetained = money(row.cashRetained + retained / Math.max(1, rows.length - 1)); });
    var enhancement = money(Math.min(crashBudget, Math.max(0, spyBase * (p.limits.spy_enhancement_max_multiple - 1)), money(budget.spyCrashEnhancement))); if (spyUsable) { rows[0].crashFundEnhancement = enhancement; rows[0].finalAmount = money(rows[0].finalAmount + enhancement); } else enhancement = 0;
    var total = money(rows.reduce(function (s, row) { return s + row.finalAmount; }, 0)), source = money(baseBudget + crashBudget), cash = money(Math.max(0, source - total)); if (Math.abs(total + cash - source) > EPSILON) throw new Error("core-satellite plan violates conservation");
    return { version: p.version, items: rows, spyBase: spyBase, spyRedirected: redirected, crashFundUsed: enhancement, cashRetained: cash, totalPlanned: total, conservation: { source: source, allocated: total, cash: cash, balanced: true }, summary: { coreTargetPct: p.core.target_allocation * 100, satelliteTargetPct: (1 - p.core.target_allocation) * 100, satelliteActualPct: satelliteActual, technologyActualPct: techActual, spyActualPct: spyActual, qqqGeneratesBuyAmount: false } };
  }
  return Object.freeze({ PRESET: PRESET, validatePreset: validatePreset, normalizedPreset: normalizedPreset, loadPreset: loadPreset, rowsForPreset: rowsForPreset, allocationMetrics: allocationMetrics, validateAllocations: validateAllocations, allocationsForCore: allocationsForCore, averageSatelliteAllocations: averageSatelliteAllocations, recommendedAllocations: recommendedAllocations, presetFromAllocations: presetFromAllocations, plan: plan, money: money });
}));
