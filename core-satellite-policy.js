(function (root, factory) { if (typeof module === "object" && module.exports) module.exports = factory(); else root.CoreSatellitePolicy = factory(); }(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  var EPSILON = 0.005, ALLOCATION_EPSILON = 1e-9;
  var SYMBOLS = ["SPY", "QQQ", "NVDA", "AAPL", "ASML", "KO"];
  var STOCK_SYMBOLS = ["NVDA", "AAPL", "ASML", "KO"], TECH_SYMBOLS = ["NVDA", "AAPL", "ASML"];
  var PRESET = { version: "core-satellite-v5", research_only: true, qqq_dual_role: true,
    core: { symbol: "SPY", target_allocation: .40, asset_type: "core_etf", bucket: "core", signal_role: "market_core" },
    growth_etfs: [{ symbol: "QQQ", target_allocation: .10, asset_type: "growth_etf", bucket: "growth_etf", signal_role: "market_risk_and_dca" }],
    satellites: [
      { symbol: "NVDA", target_allocation: .125, asset_type: "individual_stock", bucket: "satellite", sector: "technology", signal_role: "satellite_dca_l2" },
      { symbol: "AAPL", target_allocation: .125, asset_type: "individual_stock", bucket: "satellite", sector: "technology", signal_role: "satellite_dca_l2" },
      { symbol: "ASML", target_allocation: .125, asset_type: "individual_stock", bucket: "satellite", sector: "technology", signal_role: "satellite_dca_l2" },
      { symbol: "KO", target_allocation: .125, asset_type: "individual_stock", bucket: "satellite", sector: "consumer_staples", signal_role: "satellite_dca_l2" }
    ], limits: { spy_min_target_pct: 40, spy_max_target_pct: 80, satellite_min_target_pct: 20, satellite_max_target_pct: 60, single_stock_max_target_pct: 15, single_stock_block_pct: 18, satellite_enhancement_block_pct: 60, technology_max_target_pct: 45, technology_enhancement_block_pct: 40, spy_max_current_pct: 70, spy_enhancement_max_multiple: 1.25 },
    shortcuts: { "40": { SPY: .40, QQQ: .10, NVDA: .125, AAPL: .125, ASML: .125, KO: .125 }, "50": { SPY: .50, QQQ: .10, NVDA: .10, AAPL: .10, ASML: .10, KO: .10 }, "60": { SPY: .60, QQQ: .10, NVDA: .075, AAPL: .075, ASML: .075, KO: .075 } } };
  if (typeof module === "object" && module.exports && typeof require === "function") { try { PRESET = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "data", "core-satellite-v5.json"), "utf8")); } catch (_) {} }
  function finite(value) { var n = Number(value); return Number.isFinite(n) ? n : null; }
  function money(value) { var n = finite(value); return n === null ? 0 : Math.round((Math.max(0, n) + 1e-10) * 100) / 100; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function pct(value) { var n = finite(value); return n === null ? null : Math.round((n * 100 + 1e-9) * 100) / 100; }
  function ratioFromPct(value) { return Math.round((Number(value) + 1e-9) * 100) / 10000; }
  function allAssets(p) { return [p.core].concat(p.growth_etfs || [], p.satellites || []); }
  function validatePreset(preset) {
    if (!preset || preset.version !== "core-satellite-v5" || !preset.core || !Array.isArray(preset.growth_etfs) || !Array.isArray(preset.satellites) || preset.core.symbol !== "SPY" || preset.growth_etfs.length !== 1 || preset.growth_etfs[0].symbol !== "QQQ" || preset.satellites.length !== 4) return false;
    var assets = allAssets(preset), total = assets.reduce(function (sum, row) { return sum + Number(row.target_allocation); }, 0);
    return Number.isFinite(total) && Math.abs(total - 1) <= ALLOCATION_EPSILON && preset.core.asset_type === "core_etf" && preset.growth_etfs[0].asset_type === "growth_etf" && preset.satellites.every(function (row) { var value = Number(row.target_allocation); return Number.isFinite(value) && value >= 0 && value <= .15 + ALLOCATION_EPSILON && row.asset_type === "individual_stock" && row.bucket === "satellite"; });
  }
  function normalizedPreset(preset) { return validatePreset(preset) ? clone(preset) : null; }
  function loadPreset(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error("preset fetch failed"); return r.json(); }).then(function (v) { var result = normalizedPreset(v); if (!result) throw new Error("invalid core-satellite preset"); return result; }); }
  function rowsForPreset(preset) { var p = normalizedPreset(preset) || clone(PRESET); return allAssets(p).map(function (row) { return Object.assign({}, row, { allocation: row.target_allocation, preset_version: p.version }); }); }
  function allocationMetrics(allocations) { var values = allocations || {}, rounded = {}; SYMBOLS.forEach(function (s) { rounded[s] = pct(values[s]) === null ? 0 : pct(values[s]); }); var allocated = SYMBOLS.reduce(function (sum, s) { return sum + rounded[s]; }, 0); return { allocated: allocated, remaining: Math.max(0, 100 - allocated), overage: Math.max(0, allocated - 100), core: rounded.SPY, growthEtf: rounded.QQQ, satellite: STOCK_SYMBOLS.reduce(function (s, x) { return s + rounded[x]; }, 0), technology: TECH_SYMBOLS.reduce(function (s, x) { return s + rounded[x]; }, 0), NVDA: rounded.NVDA, AAPL: rounded.AAPL, ASML: rounded.ASML, KO: rounded.KO }; }
  function validateAllocations(allocations) { var values = allocations || {}, errors = []; SYMBOLS.forEach(function (s) { var raw = values[s], n = finite(raw); if (raw === "" || raw === null || raw === undefined || n === null || n < 0) errors.push(s + " 目标比例必须是非负数字"); }); var metrics = allocationMetrics(values), limits = PRESET.limits; if (Math.abs(metrics.allocated - 100) > ALLOCATION_EPSILON) errors.push("六项比例合计必须严格等于 100.00%"); if (metrics.core < limits.spy_min_target_pct - ALLOCATION_EPSILON || metrics.core > limits.spy_max_target_pct + ALLOCATION_EPSILON) errors.push("SPY 目标比例必须在 40.00% 至 80.00% 之间"); if (metrics.satellite < limits.satellite_min_target_pct - ALLOCATION_EPSILON || metrics.satellite > limits.satellite_max_target_pct + ALLOCATION_EPSILON) errors.push("个股合计比例必须在 20.00% 至 60.00% 之间"); STOCK_SYMBOLS.forEach(function (s) { if (metrics[s] > limits.single_stock_max_target_pct + ALLOCATION_EPSILON) errors.push(s + " 目标为 " + metrics[s].toFixed(2) + "%，超过单股上限 " + limits.single_stock_max_target_pct.toFixed(2) + "%"); }); if (metrics.technology > limits.technology_max_target_pct + ALLOCATION_EPSILON) errors.push("科技个股合计为 " + metrics.technology.toFixed(2) + "%，超过上限 " + limits.technology_max_target_pct.toFixed(2) + "%"); return { valid: errors.length === 0, errors: errors, metrics: metrics }; }
  function allocationsForCore(corePercent) { var core = finite(corePercent); if (core === null || core < 40 || core > 80) return null; var shortcut = PRESET.shortcuts[String(core)]; return shortcut ? clone(shortcut) : averageSatelliteAllocations(core); }
  function averageSatelliteAllocations(corePercent) { var core = finite(corePercent); if (core === null || core < 40 || core > 80) return null; var result = { SPY: ratioFromPct(core), QQQ: .10 }, each = ratioFromPct((90 - core) / 4); STOCK_SYMBOLS.forEach(function (s) { result[s] = each; }); return result; }
  function recommendedAllocations() { return clone(PRESET.shortcuts["40"]); }
  function presetFromAllocations(allocations, basePreset) { var p = normalizedPreset(basePreset) || clone(PRESET), result = clone(p), values = allocations || {}; allAssets(result).forEach(function (row) { row.target_allocation = ratioFromPct(pct(values[row.symbol]) || 0); }); return validatePreset(result) ? result : null; }
  function reason(row, code) { row.reasonCodes = row.reasonCodes || []; if (row.reasonCodes.indexOf(code) < 0) row.reasonCodes.push(code); }
  function canRedirect(decision, allocation, threshold) {
    const codes = decision.reasonCodes || [];
    if (decision.hardBlocked || codes.some(code => /^(HARD_BLOCK|DATA_|POLICY_|NORMAL_POOL|CASH_|PORTFOLIO_CASH|ACTION_)/.test(code))) return false;
    return Number(allocation) >= threshold || codes.some(code => /^CONCENTRATION_/.test(code));
  }

  // Work in integer cents so six rounded rows can never exceed a cash cap.
  function capComponent(rows, field, limit, code) {
    const values = rows.map(row => Math.round(money(row[field]) * 100));
    const total = values.reduce((a, b) => a + b, 0);
    const cents = Math.max(0, Math.floor(limit * 100 + 1e-7));
    if (total <= cents) return;
    const parts = values.map(value => value * cents / total);
    const allocated = parts.map(Math.floor);
    let tail = cents - allocated.reduce((a, b) => a + b, 0);
    parts.map((value, index) => ({ index, fraction: value - allocated[index] }))
      .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
      .forEach(item => { if (tail > 0 && values[item.index] > 0) { allocated[item.index]++; tail--; } });
    rows.forEach((row, index) => { row[field] = allocated[index] / 100; if (allocated[index] < values[index]) reason(row, code); });
  }

  function finalize(rows, budget, p, spyBase, spyActual, stockActual, techActual, baseBudget, crashBudget) {
    const decisions = budget.satelliteDecisions || budget.satellite_decisions || {};
    const normal = budget.normalPoolRemaining == null ? baseBudget : money(budget.normalPoolRemaining);
    const cashCap = budget.portfolioCashCap == null ? null : money(budget.portfolioCashCap);
    const feeRate = Math.max(0, Number(budget.commissionBps) || 0) / 10000;
    rows.forEach(row => {
      if (budget.safetyBlocked) { row.finalAmount = 0; reason(row, "PLAN_SAFETY_BLOCK"); }
      const decision = decisions[row.symbol] || {};
      row.crashFundAmount = Math.min(row.finalAmount, money(row.crashFundEnhancement));
      const normalAmount = money(row.finalAmount - row.crashFundAmount);
      row.extraAmount = Math.min(normalAmount, money(decision.extraAmount));
      row.baseAmount = money(normalAmount - row.extraAmount);
    });
    const sum = field => money(rows.reduce((total, row) => total + row[field], 0));
    capComponent(rows, 'baseAmount', normal, 'NORMAL_POOL_BASE_BUDGET_APPLIED');
    capComponent(rows, 'extraAmount', money(normal - sum('baseAmount')), 'NORMAL_POOL_EXTRA_BUDGET_APPLIED');
    capComponent(rows, 'crashFundAmount', crashBudget, 'CRASH_FUND_BUDGET_APPLIED');
    if (cashCap !== null) {
      const affordable = Math.floor(cashCap / (1 + feeRate) * 100 + 1e-7) / 100;
      for (const field of ['crashFundAmount', 'extraAmount', 'baseAmount']) {
        const total = sum('baseAmount') + sum('extraAmount') + sum('crashFundAmount');
        if (total > affordable) capComponent(rows, field, Math.max(0, sum(field) - (total - affordable)), 'PORTFOLIO_CASH_CAP_APPLIED');
      }
    }
    rows.forEach(row => {
      row.finalAmount = money(row.baseAmount + row.extraAmount + row.crashFundAmount);
      row.crashFundEnhancement = row.crashFundAmount;
      row.redirectedToSpy = Math.min(row.redirectedToSpy, row.baseAmount);
      row.riskReduction = money(row.dcaAdjustedAmount + row.redirectedToSpy - row.finalAmount);
      row.factorChain.push('final:' + row.finalAmount.toFixed(2));
    });
    const total = sum('finalAmount'), plannedNormal = money(sum('baseAmount') + sum('extraAmount'));
    const source = money(Math.min(normal, Math.max(baseBudget, plannedNormal)) + crashBudget), cash = money(source - total);
    return { version: p.version, items: rows, spyBase, spyRedirected: rows[0].redirectedToSpy,
      crashFundUsed: sum('crashFundAmount'), plannedNormal, plannedCrash: sum('crashFundAmount'),
      normalPoolRemaining: normal, crashFundRemaining: crashBudget, portfolioCashCap: cashCap,
      estimatedCommission: money(total * feeRate), cashRetained: cash, totalPlanned: total,
      conservation: { source, allocated: total, cash, balanced: total <= source + EPSILON && (cashCap === null || total * (1 + feeRate) <= cashCap + 1e-7) },
      summary: { coreTargetPct: p.core.target_allocation * 100, growthEtfTargetPct: (p.growth_etfs || []).reduce((s, r) => s + r.target_allocation, 0) * 100,
        satelliteTargetPct: p.satellites.reduce((s, r) => s + r.target_allocation, 0) * 100, satelliteActualPct: stockActual, technologyActualPct: techActual, spyActualPct: spyActual, qqqGeneratesBuyAmount: true } };
  }
  function plan(input) {
    input = input || {};
    input = { ...input, normalPoolRemaining: input.normalPoolRemaining ?? input.normal_pool_remaining,
      portfolioCashCap: input.portfolioCashCap ?? input.portfolio_cash_cap, commissionBps: input.commissionBps ?? input.commission_bps,
      safetyBlocked: input.safetyBlocked ?? input.safety_blocked, qqqDataValid: input.qqqDataValid ?? input.qqq_data_valid };

    var p = normalizedPreset(input && input.preset) || clone(PRESET), budget = input || {}, baseBudget = money(budget.baseBudget == null ? budget.base_budget : budget.baseBudget), crashBudget = money(budget.crashFundRemaining == null ? budget.crash_fund_remaining : budget.crashFundRemaining), actual = budget.actualAllocations || budget.actual_allocations || {}, decisions = budget.satelliteDecisions || budget.satellite_decisions || {}, cashOnly = budget.cashOnlySymbols || [], spy = p.core.symbol, spyUsable = (budget.spyDataValid == null ? budget.spy_data_valid !== false : budget.spyDataValid !== false) && budget.safetyBlocked !== true, qqqUsable = budget.qqqDataValid == null ? true : budget.qqqDataValid !== false, spyActual = finite(actual[spy]) || 0, stockActual = STOCK_SYMBOLS.reduce(function (s, x) { return s + (finite(actual[x]) || 0); }, 0), techActual = TECH_SYMBOLS.reduce(function (s, x) { return s + (finite(actual[x]) || 0); }, 0);
    var rawBase = allAssets(p).map(function (asset) { return { asset: asset, amount: baseBudget * Number(asset.target_allocation) }; }), roundedBase = rawBase.map(function (x) { return money(x.amount); }), baseTail = Math.round((baseBudget - roundedBase.reduce(function (s, n) { return s + n; }, 0)) * 100) / 100;
    var spyBase = money(roundedBase[0] + baseTail), rows = [{ symbol: spy, bucket: "core", asset_type: "core_etf", originalBaseAmount: spyBase, dcaAdjustedAmount: spyBase, crashFundEnhancement: 0, riskReduction: 0, redirectedToSpy: 0, cashRetained: 0, finalAmount: spyUsable ? spyBase : 0, reasonCodes: spyUsable ? [] : ["SPY_DATA_OR_SAFETY_BLOCK"], factorChain: ["base:" + p.core.target_allocation * 100 + "%"] }], redirect = 0;
    function addAsset(asset, amount) { var isQqq = asset.symbol === "QQQ", decision = decisions[asset.symbol] || {}, adjusted = money(decision.finalAmount == null ? amount : decision.finalAmount), row = { symbol: asset.symbol, bucket: asset.bucket, asset_type: asset.asset_type, originalBaseAmount: amount, dcaAdjustedAmount: adjusted, crashFundEnhancement: isQqq ? 0 : money(decision.crashFundAmount || 0), riskReduction: 0, redirectedToSpy: 0, cashRetained: 0, finalAmount: adjusted, reasonCodes: (decision.reasonCodes || []).slice(), factorChain: [] }, blocked = (isQqq && !qqqUsable) || (adjusted <= 0 && amount > 0) || (!isQqq && (finite(actual[asset.symbol]) || 0) >= p.limits.single_stock_block_pct) || (!isQqq && stockActual >= p.limits.satellite_enhancement_block_pct && adjusted > amount) || (!isQqq && asset.sector === "technology" && techActual >= p.limits.technology_enhancement_block_pct && adjusted > amount) || (budget.blockedSymbols && budget.blockedSymbols.indexOf(asset.symbol) >= 0);
      if (blocked) { row.riskReduction = adjusted; row.finalAmount = 0; reason(row, isQqq && !qqqUsable ? "QQQ_DATA_OR_SAFETY_BLOCK" : cashOnly.indexOf(asset.symbol) >= 0 ? "ETF_LOOKTHROUGH_LIMIT" : "SATELLITE_RISK_BLOCKED"); if (!isQqq && cashOnly.indexOf(asset.symbol) < 0 && canRedirect(decision, actual[asset.symbol], p.limits.single_stock_block_pct)) redirect += amount; else row.cashRetained = amount; } rows.push(row); }
    (p.growth_etfs || []).forEach(function (asset, i) { addAsset(asset, roundedBase[i + 1]); }); p.satellites.forEach(function (asset, i) { addAsset(asset, roundedBase[i + 2]); });
    var redirected = spyUsable && spyActual < p.limits.spy_max_current_pct ? money(redirect) : 0; if (redirected) { rows[0].redirectedToSpy = redirected; rows[0].finalAmount = money(rows[0].finalAmount + redirected); reason(rows[0], "SATELLITE_BASE_REDIRECTED_TO_SPY"); }
    var enhancement = spyUsable ? money(Math.min(crashBudget, Math.max(0, spyBase * (p.limits.spy_enhancement_max_multiple - 1)), money(budget.spyCrashEnhancement))) : 0; rows[0].crashFundEnhancement = enhancement; rows[0].finalAmount = money(rows[0].finalAmount + enhancement);
    return finalize(rows, budget, p, spyBase, spyActual, stockActual, techActual, baseBudget, crashBudget);

  }
  return Object.freeze({ PRESET: PRESET, validatePreset: validatePreset, normalizedPreset: normalizedPreset, loadPreset: loadPreset, rowsForPreset: rowsForPreset, allocationMetrics: allocationMetrics, validateAllocations: validateAllocations, allocationsForCore: allocationsForCore, averageSatelliteAllocations: averageSatelliteAllocations, recommendedAllocations: recommendedAllocations, presetFromAllocations: presetFromAllocations, plan: plan, money: money, SYMBOLS: SYMBOLS, STOCK_SYMBOLS: STOCK_SYMBOLS });
}));
