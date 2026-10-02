(function (root, factory) {
  const api = typeof module === 'object' && module.exports
    ? factory(require('./dca-policy'), require('./portfolio-policy'), require('./core-satellite-policy'), require('./market-analysis'))
    : factory(root.DcaPolicy, root.PortfolioPolicy, root.CoreSatellitePolicy, root.MarketAnalysis);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WeeklyDcaEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (D, P, C, M) {
  'use strict';
  const money = C.money;
  function monthSchedule(date) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!match) throw new Error('An ISO plan date is required');
    const year = Number(match[1]), month = Number(match[2]) - 1;
    const parsed = new Date(date + 'T00:00:00Z');
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('Invalid plan date');
    const days = [];
    for (let day = 1; day <= new Date(Date.UTC(year, month + 1, 0)).getUTCDate(); day++) {
      if (new Date(Date.UTC(year, month, day)).getUTCDay() === 2) days.push(day);
    }
    // Preview the Tuesday of this ISO week, clamped to this month's schedule.
    const tuesday = Number(match[3]) + 2 - (parsed.getUTCDay() || 7);
    const index = Math.max(0, days.findLastIndex(day => day <= tuesday));
    return { days, index, planDate: date.slice(0, 8) + String(days[index]).padStart(2, '0') };
  }
  function planWeeksInMonth(date) { return monthSchedule(date).days.length; }
  function weeklyBudget(normalPool, date) {
    const { days, index } = monthSchedule(date), cents = Math.round(money(normalPool) * 100);
    return (Math.floor(cents / days.length) + (index < cents % days.length ? 1 : 0)) / 100;
  }
  function fundingPlan(normalPool, normalUsed, date, baseBudget, weekUsed = 0) {
    const { days, index, planDate } = monthSchedule(date);
    const cents = Math.round(money(normalPool) * 100), unit = Math.floor(cents / days.length), tail = cents % days.length;
    const futureReserved = ((days.length - index - 1) * unit + Math.max(0, tail - index - 1)) / 100;
    const remaining = money(normalPool - normalUsed);
    const scheduledBase = Math.min(money(baseBudget), weeklyBudget(normalPool, date));
    // Catch-up is bounded: at most 25% above this week's scheduled base, and
    // only already unspent funding can finance extras. Never borrow future Base.
    const weeklyLimit = Math.floor(scheduledBase * 1.25 * 100 + 1e-7) / 100;
    return { planDate, scheduledBase, futureReserved, normalRemaining: remaining,
      normalLimit: money(Math.min(Math.max(0, remaining - futureReserved), Math.max(0, weeklyLimit - money(weekUsed)))),
      weeklyLimit, weekUsed: money(weekUsed) };
  }
  function indicators(rows, decisionChange) {
    const closes = rows.map(row => row.close);
    const vol = M.weeklyVolatility(closes, 12), dd = M.recentDrawdown(closes, 52);
    return { rawDrawdownPct: dd, rawWeeklyVolatility: vol, trend: M.tickerTrend(closes, decisionChange),
      volatilityPct: vol === null ? null : money(vol * 100), drawdownPct: dd === null ? null : money(dd) };
  }
  function affordableBaseCents(input) {
    const base = input.baseBudget, normal = input.normalLimit == null ? base : input.normalLimit;
    const feeBps = input.commissionBps == null ? 0 : input.commissionBps, cash = input.portfolioCashCap;
    if (![base, normal, feeBps].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)
      || (cash != null && (typeof cash !== 'number' || !Number.isFinite(cash) || cash < 0))) return null;
    const affordable = cash == null ? base : cash / (1 + feeBps / 10000);
    const cents = Math.floor(Math.min(base, normal, affordable) * 100 + 1e-7);
    return Number.isSafeInteger(cents) ? cents : null;
  }
  // Base is a weekly funding allocation. Holdings affect safety gates later,
  // but cannot change these saved contribution weights.
  function contributionBasePlan(options) {
    const allocationMode = 'weekly_contribution';
    const fail = code => ({ valid: false, reasonCodes: [code], baseBudget: 0, baseAmounts: null, allocationMode });
    if (!options || typeof options !== 'object' || Array.isArray(options)) return fail('CONTRIBUTION_BUDGET_INVALID');
    let preset;
    try { preset = C.normalizedPreset(options.preset == null ? C.PRESET : options.preset); }
    catch (_) { return fail('CONTRIBUTION_PRESET_INVALID'); }
    if (!preset) return fail('CONTRIBUTION_PRESET_INVALID');
    const cents = affordableBaseCents(options);
    if (cents === null) return fail('CONTRIBUTION_BUDGET_INVALID');
    const baseBudget = cents / 100;
    const assets = C.rowsForPreset(preset), totalWeight = assets.reduce((sum, asset) => sum + Number(asset.target_allocation), 0);
    const parts = assets.map(asset => {
      const exact = Number(asset.target_allocation) / totalWeight * cents, amount = Math.floor(exact);
      return { symbol: asset.symbol, weight: Number(asset.target_allocation), amount, remainder: exact - amount };
    });
    let tail = cents - parts.reduce((sum, part) => sum + part.amount, 0);
    parts.slice().sort((a, b) => b.remainder - a.remainder || (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0)).forEach(part => {
      if (tail > 0 && part.weight > 0) { part.amount++; tail--; }
    });
    if (tail !== 0) return fail('CONTRIBUTION_BUDGET_INVALID');
    const baseAmounts = Object.fromEntries(parts.map(part => [part.symbol, part.amount / 100]));
    if (!C.validateBaseAmounts(baseAmounts, preset, baseBudget)) return fail('CONTRIBUTION_BUDGET_INVALID');
    return { valid: true, reasonCodes: [], baseBudget, baseAmounts, allocationMode };
  }
  // Callers supply a complete, verified US/USD holdings universe. It includes
  // held securities outside the buy list; cash never enters this denominator.
  function gapBasePlan(options) {
    const input = options || {}, preset = C.normalizedPreset(input.preset || C.PRESET);
    const fail = code => ({ valid: false, reasonCodes: [code], baseBudget: 0, securitiesValue: null, gaps: {}, baseAmounts: null });
    const positions = input.eligibleUSPositions;
    if (!preset) return fail('GAP_PRESET_INVALID');
    if (input.holdingsComplete !== true || !positions || typeof positions !== 'object' || Array.isArray(positions)) return fail('GAP_HOLDINGS_UNAVAILABLE');
    const values = {};
    for (const [symbol, position] of Object.entries(positions)) {
      const value = typeof position === 'object' && position !== null ? position.current_value : position;
      if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol) || typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fail('GAP_HOLDINGS_INVALID');
      values[symbol] = value;
    }
    const cents = affordableBaseCents(input);
    if (cents === null) return fail('GAP_BUDGET_INVALID');
    const baseBudget = cents / 100;
    const totalSecurities = Object.values(values).reduce((sum, value) => sum + value, 0);
    if (!Number.isFinite(totalSecurities) || !Number.isSafeInteger(Math.round(totalSecurities * 100))) return fail('GAP_HOLDINGS_INVALID');
    const securitiesValue = money(totalSecurities);
    const assets = C.rowsForPreset(preset), gaps = {}, baseAmounts = {};
    assets.forEach(asset => {
      gaps[asset.symbol] = Math.max(0, asset.target_allocation * (securitiesValue + baseBudget) - (values[asset.symbol] || 0));
      baseAmounts[asset.symbol] = 0;
    });
    const totalGap = Object.values(gaps).reduce((sum, value) => sum + value, 0);
    if (cents && totalGap > 0) {
      const parts = assets.map(asset => {
        const exact = gaps[asset.symbol] / totalGap * cents;
        return { symbol: asset.symbol, amount: Math.floor(exact), remainder: exact - Math.floor(exact) };
      });
      let tail = cents - parts.reduce((sum, part) => sum + part.amount, 0);
      parts.slice().sort((a, b) => b.remainder - a.remainder || (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0)).forEach(part => {
        if (tail > 0 && gaps[part.symbol] > 0) { part.amount++; tail--; }
      });
      parts.forEach(part => { baseAmounts[part.symbol] = part.amount / 100; });
    }
    return { valid: true, reasonCodes: totalGap > 0 || !cents ? [] : ['GAP_NO_POSITIVE_DEFICIT'], baseBudget, securitiesValue, gaps, baseAmounts };
  }
  function plan(options) {
    const rawConfig = options.config || D.getL2Config();
    const config = { ...rawConfig, configValid: rawConfig.configValid !== false && D.validateL2Config(rawConfig) };
    const state = { ...(options.policyState || {}) };
    const balanced = options.policyMode !== 'legacy';
    const cashBasePriority = balanced && options.cashPolicyMode !== 'legacy';
    const assets = C.rowsForPreset(options.preset || C.PRESET);
    const hasBaseAmounts = Object.hasOwn(options, 'baseAmounts');
    const baseAmountsValid = !hasBaseAmounts || C.validateBaseAmounts(options.baseAmounts, options.preset || C.PRESET, options.baseBudget);
    const inputs = (options.inputs || []).map(item => hasBaseAmounts ? { ...item, input: { ...item.input,
      baseAmount: baseAmountsValid ? options.baseAmounts[item.symbol] || 0 : 0 } } : item);
    const date = options.plannedDate || (inputs[0] && inputs[0].input.date);
    const funding = balanced ? fundingPlan(options.budget.normalPool, options.budget.normalPoolUsed || 0,
      date, options.baseBudget, options.budget.weekNormalUsed || 0) : null;
    const evaluate = item => {
      // Market timing does not halve the scheduled contribution. Explicit
      // action/data/concentration blocks still win; defensive states disable extras.
      const policy = balanced ? { ...config, base: { ...config.base, defensive: 1 } } : config;
      const decision = D.evaluateDcaL2Policy({ ...item.input, deferPortfolioCashCap: cashBasePriority }, state, policy);
      if (balanced && decision.reasonCodes.includes('DEFENSIVE_BASE_50')) {
        decision.reasonCodes = decision.reasonCodes.filter(code => code !== 'DEFENSIVE_BASE_50');
        decision.reasonCodes.push('SCHEDULED_BASE_PRESERVED');
      }
      return decision;
    };
    let initial = inputs.map(evaluate);
    if (initial.some(row => row.defensiveNow)) {
      state.defensiveLatched = true; state.recoveryConfirmations = 0; state.lastRecoveryWeek = '';
    } else if (state.defensiveLatched && inputs.length && inputs.every(item => item.input.dataStatus === 'fresh')) {
      // The evaluator counts distinct consecutive weeks; persist its result once per plan.
      const candidate = initial[0];
      state.recoveryConfirmations = candidate.recoveryConfirmations;
      const week = D.isoWeekId(inputs[0].input.date);
      if (week) state.lastRecoveryWeek = week;
      state.defensiveLatched = state.recoveryConfirmations < Number(config.recovery.requiredDistinctPlanWeeks || 2);
    }
    initial = inputs.map(evaluate);
    const eligible = initial.map((row, i) => row.crashFundAmount > 0 && !inputs[i].actionBlocked && !inputs[i].extraBlocked
      && (!balanced || assets.some(asset => asset.symbol === inputs[i].symbol && asset.bucket === 'satellite')) ? inputs[i].input.baseAmount : 0);
    const deepBase = eligible.reduce((a, b) => a + b, 0);
    const rows = inputs.map((item, i) => {
      const decision = evaluate({ input: { ...item.input, crashFundWeight: deepBase > 0 ? eligible[i] / deepBase : 0 } });
      if (balanced && item.extraBlocked) {
        decision.extraAmount = decision.crashFundAmount = 0;
        decision.finalAmount = decision.baseAmount;
        decision.reasonCodes.push('PRICE_SIGNAL_BLOCKS_EXTRA_ONLY');
      }
      if (item.actionBlocked) {
        decision.baseAmount = decision.extraAmount = decision.crashFundAmount = decision.finalAmount = 0;
        decision.reasonCodes.push('ACTION_REQUIRES_ZERO_AMOUNT');
      }
      return { symbol: item.symbol, decision, currentAllocationPct: item.input.currentAllocationPct };
    });
    // Account funding is applied once in Core, after any asset redirection.
    const budget = P.allocateDcaL2Plan(rows, cashBasePriority ? { ...options.budget, portfolioCashCap: null } : options.budget);
    const crashLimit = balanced ? money(Math.min(budget.crashFundRemaining,
      Math.max(0, Number(options.budget.crashFund) * Number(config.crashFund.weeklyReleaseInitialMonthlyBudgetPct) - money(options.budget.weekCrashUsed)))) : budget.crashFundRemaining;
    if (funding) funding.crashLimit = crashLimit;
    const decisions = Object.fromEntries(budget.items.map(row => [row.symbol, row.decision]));
    const core = C.plan({ ...options.core, preset: options.preset || C.PRESET, baseBudget: options.baseBudget,
      ...(hasBaseAmounts ? { baseAmounts: options.baseAmounts } : {}),
      normalPoolRemaining: funding ? Math.min(budget.normalPoolRemaining, funding.normalLimit) : budget.normalPoolRemaining, crashFundRemaining: crashLimit,
      portfolioCashCap: options.budget.portfolioCashCap, optionalCashCap: cashBasePriority ? options.budget.optionalCashCap : null,
      commissionBps: options.commissionBps || 0, satelliteDecisions: decisions });
    for (const row of core.items) {
      const decision = decisions[row.symbol];
      if (!decision) continue;
      Object.assign(decision, { baseAmount: row.baseAmount, extraAmount: row.extraAmount, crashFundAmount: row.crashFundAmount,
        finalAmount: row.finalAmount, status: decision.state, l2: true,
        multiplier: inputs.find(item => item.symbol === row.symbol).input.baseAmount > 0 ? row.finalAmount / inputs.find(item => item.symbol === row.symbol).input.baseAmount : 0,
        reasonCodes: [...new Set(decision.reasonCodes.concat(row.reasonCodes))] });
      if (funding && row.reasonCodes.some(code => /^NORMAL_POOL_/.test(code))) {
        decision.reasonCodes.push('FUTURE_BASE_RESERVED');
        row.reasonCodes.push('FUTURE_BASE_RESERVED');
      }
    }
    budget.items.forEach(row => { row.finalAmount = row.decision.finalAmount; });
    core.funding = funding;
    return { plan: core, decisions, policyState: state, budgetReport: { ...budget, funding,
      plannedNormal: core.plannedNormal, plannedCrash: core.plannedCrash, plannedOptional: core.plannedOptional,
      portfolioCashCap: core.portfolioCashCap, optionalCashCap: core.optionalCashCap, totalPlanned: core.totalPlanned,
      unallocatedCash: money(budget.normalPoolRemaining + budget.crashFundRemaining - core.totalPlanned) } };
  }
  return Object.freeze({ plan, indicators, planWeeksInMonth, weeklyBudget, fundingPlan, contributionBasePlan, gapBasePlan, version: 'weekly-dca-v2' });
});
