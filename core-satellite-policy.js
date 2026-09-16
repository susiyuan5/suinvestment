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
    if (!preset || preset.version !== "core-satellite-v5" || !preset.core || !Array.isArray(preset.growth_etfs) || !Array.isArray(preset.satellites) || preset.core.symbol !== "SPY" || preset.growth_etfs.length !== 1 || preset.growth_etfs[0].symbol !== "QQQ" || !STOCK_SYMBOLS.every(s => preset.satellites.some(row => row.symbol === s))) return false;
    var assets = allAssets(preset), total = assets.reduce(function (sum, row) { return sum + Number(row.target_allocation); }, 0);
    return new Set(assets.map(row => row.symbol)).size === assets.length && Number.isFinite(total) && Math.abs(total - 1) <= ALLOCATION_EPSILON && assets.every(row => /^[A-Z][A-Z0-9.-]{0,14}$/.test(row.symbol) && Number.isFinite(Number(row.target_allocation)) && row.target_allocation >= 0 && row.target_allocation <= 1) && preset.core.asset_type === "core_etf" && preset.growth_etfs[0].asset_type === "growth_etf" && preset.satellites.every(function (row) { var value = Number(row.target_allocation); return Number.isFinite(value) && value >= 0 && value <= 1 + ALLOCATION_EPSILON && row.asset_type === "individual_stock" && row.bucket === "satellite"; });
  }
  function normalizedPreset(preset) { return validatePreset(preset) ? clone(preset) : null; }
  function loadPreset(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error("preset fetch failed"); return r.json(); }).then(function (v) { var result = normalizedPreset(v); if (!result) throw new Error("invalid core-satellite preset"); return result; }); }
  function rowsForPreset(preset) { var p = normalizedPreset(preset) || clone(PRESET); return allAssets(p).map(function (row) { return Object.assign({}, row, { allocation: row.target_allocation, preset_version: p.version }); }); }
  function allocationSymbols(values) { return Array.from(new Set(SYMBOLS.concat(Object.keys(values || {})))); }
  // Unclassified additions count toward the technology ceiling until classified.
  function technologySymbol(symbol) { return TECH_SYMBOLS.includes(symbol) || !SYMBOLS.includes(symbol); }
  function allocationMetrics(allocations) {
    const values = allocations || {}, symbols = allocationSymbols(values), rounded = {};
    symbols.forEach(s => { rounded[s] = pct(values[s]) || 0; });
    const allocated = symbols.reduce((sum, s) => sum + Math.round(rounded[s] * 100), 0) / 100;
    return { ...rounded, allocated, remaining: Math.max(0, 100 - allocated), overage: Math.max(0, allocated - 100), core: rounded.SPY, growthEtf: rounded.QQQ,
      satellite: symbols.filter(s => s !== 'SPY' && s !== 'QQQ').reduce((sum, s) => sum + rounded[s], 0),
      technology: symbols.filter(technologySymbol).reduce((sum, s) => sum + rounded[s], 0) };
  }
  function validateAllocations(allocations) {
    const values = allocations || {}, errors = [], symbols = allocationSymbols(values), metrics = allocationMetrics(values), limits = PRESET.limits;
    symbols.forEach(s => { const raw = values[s], n = finite(raw); if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(s) || raw === '' || raw == null || n === null || n < 0 || n > 1) errors.push(s + ' 目标比例必须是 0% 至 100% 的数字'); });
    if (Math.abs(metrics.allocated - 100) > ALLOCATION_EPSILON) errors.push('全部比例合计必须严格等于 100.00%');
    return { valid: errors.length === 0, errors, metrics };
  }
  // Integer basis points, proportional water filling with nested group limits.
  function rebalanceAllocations(allocations, symbol, percent) {
    const values = { ...allocations }, requested = Number(percent);
    if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol) || percent == null || typeof percent === 'boolean' || String(percent).trim() === '' || !Number.isFinite(requested) || requested < 0 || requested > 100 || Math.abs(requested * 100 - Math.round(requested * 100)) > 1e-7) return { valid: false, errors: ['请输入有效比例，最多两位小数。'] };
    if (!(symbol in values)) values[symbol] = 0;
    const symbols = allocationSymbols(values), fixed = Math.round(requested * 100);
    const leaf = s => ({ key: s, min: s === symbol ? fixed : 0, max: s === symbol ? fixed : 10000, weight: Math.max(0, Number(values[s]) || 0) });
    const group = (key, children, min, max) => ({ key, children, min: Math.max(min, children.reduce((n, x) => n + x.min, 0)), max: Math.min(max, children.reduce((n, x) => n + x.max, 0)), weight: children.reduce((n, x) => n + x.weight, 0) });
    const tree = group('total', symbols.map(leaf), 10000, 10000), result = {};
    function distribute(node, total) {
      if (node.min > node.max || total < node.min || total > node.max) throw Error('现有限制下无法分配此比例，请调整目标比例。');
      if (!node.children) { result[node.key] = total / 10000; return; }
      const rows = node.children;
      if (rows.some(r => r.min > r.max) || total < rows.reduce((n, r) => n + r.min, 0) || total > rows.reduce((n, r) => n + r.max, 0)) throw Error('现有限制下无法分配此比例，请调整目标比例。');
      if (!rows.length) return;
      const value = (r, scale) => Math.max(r.min, Math.min(r.max, scale * (r.weight || 1e-9)));
      let lo = 0, hi = 1e14;
      for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (rows.reduce((n, r) => n + value(r, mid), 0) < total) lo = mid; else hi = mid; }
      const amounts = rows.map(r => Math.floor(value(r, hi) + 1e-7));
      let tail = total - amounts.reduce((a, b) => a + b, 0);
      rows.map((r, i) => ({ i, fraction: value(r, hi) - amounts[i], key: r.key })).sort((a, b) => b.fraction - a.fraction || a.key.localeCompare(b.key)).forEach(({ i }) => { if (tail > 0 && amounts[i] < rows[i].max) { amounts[i]++; tail--; } });
      if (tail) throw Error('比例舍入未能守恒，请重新输入。');
      rows.forEach((r, i) => distribute(r, amounts[i]));
    }
    try { distribute(tree, 10000); } catch (error) { return { valid: false, errors: [error.message] }; }
    const validation = validateAllocations(result);
    return { ...validation, allocations: result };
  }
  function allocationsForCore(corePercent) { var core = finite(corePercent); if (core === null || core < 40 || core > 80) return null; var shortcut = PRESET.shortcuts[String(core)]; return shortcut ? clone(shortcut) : averageSatelliteAllocations(core); }
  function averageSatelliteAllocations(corePercent) { var core = finite(corePercent); if (core === null || core < 40 || core > 80) return null; var result = { SPY: ratioFromPct(core), QQQ: .10 }, each = ratioFromPct((90 - core) / 4); STOCK_SYMBOLS.forEach(function (s) { result[s] = each; }); return result; }
  function recommendedAllocations() { return clone(PRESET.shortcuts["40"]); }
  function presetFromAllocations(allocations, basePreset) { var p = normalizedPreset(basePreset) || clone(PRESET), result = clone(p), values = allocations || {}; result.satellites = result.satellites.filter(row => SYMBOLS.includes(row.symbol) || Object.hasOwn(values, row.symbol)); allocationSymbols(values).filter(s => !allAssets(result).some(row => row.symbol === s)).forEach(symbol => result.satellites.push({ symbol, asset_type: 'individual_stock', bucket: 'satellite', sector: 'unclassified', signal_role: 'satellite_dca_l2' })); allAssets(result).forEach(function (row) { row.target_allocation = ratioFromPct(pct(values[row.symbol]) || 0); }); return validatePreset(result) ? result : null; }
  function reason(row, code) { row.reasonCodes = row.reasonCodes || []; if (row.reasonCodes.indexOf(code) < 0) row.reasonCodes.push(code); }
  function canRedirect(decision, allocation, threshold) {
    const codes = decision.reasonCodes || [];
    if (decision.hardBlocked || codes.some(code => /^(HARD_BLOCK|DATA_|POLICY_|NORMAL_POOL|CASH_|PORTFOLIO_CASH|ACTION_)/.test(code))) return false;
    return Number(allocation) >= threshold || codes.some(code => /^CONCENTRATION_/.test(code));
  }

  // Work in integer cents so rounded rows can never exceed a cash cap.
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

    var p = normalizedPreset(input && input.preset) || clone(PRESET), budget = input || {}, baseBudget = money(budget.baseBudget == null ? budget.base_budget : budget.baseBudget), crashBudget = money(budget.crashFundRemaining == null ? budget.crash_fund_remaining : budget.crashFundRemaining), actual = budget.actualAllocations || budget.actual_allocations || {}, decisions = budget.satelliteDecisions || budget.satellite_decisions || {}, cashOnly = budget.cashOnlySymbols || [], spy = p.core.symbol, spyUsable = (budget.spyDataValid == null ? budget.spy_data_valid !== false : budget.spyDataValid !== false) && budget.safetyBlocked !== true, qqqUsable = budget.qqqDataValid == null ? true : budget.qqqDataValid !== false, spyActual = finite(actual[spy]) || 0, stockActual = p.satellites.map(row => row.symbol).reduce(function (s, x) { return s + (finite(actual[x]) || 0); }, 0), techActual = p.satellites.filter(row => technologySymbol(row.symbol)).map(row => row.symbol).reduce(function (s, x) { return s + (finite(actual[x]) || 0); }, 0);
    var rawBase = allAssets(p).map(function (asset) { return { asset: asset, amount: baseBudget * Number(asset.target_allocation) }; }), roundedBase = rawBase.map(function (x) { return money(x.amount); }), baseTail = Math.round((baseBudget - roundedBase.reduce(function (s, n) { return s + n; }, 0)) * 100) / 100;
    var spyBase = money(roundedBase[0] + baseTail), rows = [{ symbol: spy, bucket: "core", asset_type: "core_etf", originalBaseAmount: spyBase, dcaAdjustedAmount: spyBase, crashFundEnhancement: 0, riskReduction: 0, redirectedToSpy: 0, cashRetained: 0, finalAmount: spyUsable ? spyBase : 0, reasonCodes: spyUsable ? [] : ["SPY_DATA_OR_SAFETY_BLOCK"], factorChain: ["base:" + p.core.target_allocation * 100 + "%"] }], redirect = 0;
    function addAsset(asset, amount) { var isQqq = asset.symbol === "QQQ", decision = decisions[asset.symbol] || {}, adjusted = money(decision.finalAmount == null ? amount : decision.finalAmount), row = { symbol: asset.symbol, bucket: asset.bucket, asset_type: asset.asset_type, originalBaseAmount: amount, dcaAdjustedAmount: adjusted, crashFundEnhancement: isQqq ? 0 : money(decision.crashFundAmount || 0), riskReduction: 0, redirectedToSpy: 0, cashRetained: 0, finalAmount: adjusted, reasonCodes: (decision.reasonCodes || []).slice(), factorChain: [] }, blocked = (isQqq && !qqqUsable) || (adjusted <= 0 && amount > 0) || (!isQqq && (finite(actual[asset.symbol]) || 0) >= p.limits.single_stock_block_pct) || (!isQqq && stockActual >= p.limits.satellite_enhancement_block_pct && adjusted > amount) || (!isQqq && technologySymbol(asset.symbol) && techActual >= p.limits.technology_enhancement_block_pct && adjusted > amount) || (budget.blockedSymbols && budget.blockedSymbols.indexOf(asset.symbol) >= 0);
      if (blocked) { row.riskReduction = adjusted; row.finalAmount = 0; reason(row, isQqq && !qqqUsable ? "QQQ_DATA_OR_SAFETY_BLOCK" : cashOnly.indexOf(asset.symbol) >= 0 ? "ETF_LOOKTHROUGH_LIMIT" : "SATELLITE_RISK_BLOCKED"); if (!isQqq && cashOnly.indexOf(asset.symbol) < 0 && canRedirect(decision, actual[asset.symbol], p.limits.single_stock_block_pct)) redirect += amount; else row.cashRetained = amount; } rows.push(row); }
    (p.growth_etfs || []).forEach(function (asset, i) { addAsset(asset, roundedBase[i + 1]); }); p.satellites.forEach(function (asset, i) { addAsset(asset, roundedBase[i + 2]); });
    var redirected = spyUsable && spyActual < p.limits.spy_max_current_pct ? money(redirect) : 0; if (redirected) { rows[0].redirectedToSpy = redirected; rows[0].finalAmount = money(rows[0].finalAmount + redirected); reason(rows[0], "SATELLITE_BASE_REDIRECTED_TO_SPY"); }
    var enhancement = spyUsable ? money(Math.min(crashBudget, Math.max(0, spyBase * (p.limits.spy_enhancement_max_multiple - 1)), money(budget.spyCrashEnhancement))) : 0; rows[0].crashFundEnhancement = enhancement; rows[0].finalAmount = money(rows[0].finalAmount + enhancement);
    return finalize(rows, budget, p, spyBase, spyActual, stockActual, techActual, baseBudget, crashBudget);

  }
  return Object.freeze({ PRESET: PRESET, rebalanceAllocations: rebalanceAllocations, allocationSymbols: allocationSymbols, validatePreset: validatePreset, normalizedPreset: normalizedPreset, loadPreset: loadPreset, rowsForPreset: rowsForPreset, allocationMetrics: allocationMetrics, validateAllocations: validateAllocations, allocationsForCore: allocationsForCore, averageSatelliteAllocations: averageSatelliteAllocations, recommendedAllocations: recommendedAllocations, presetFromAllocations: presetFromAllocations, plan: plan, money: money, SYMBOLS: SYMBOLS, STOCK_SYMBOLS: STOCK_SYMBOLS });
}));
