(function (root, factory) {
  const api = typeof module === 'object' && module.exports
    ? factory(require('./dca-policy'), require('./portfolio-policy'), require('./core-satellite-policy'), require('./market-analysis'))
    : factory(root.DcaPolicy, root.PortfolioPolicy, root.CoreSatellitePolicy, root.MarketAnalysis);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WeeklyDcaEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (D, P, C, M) {
  'use strict';
  const money = C.money;
  function planWeeksInMonth(date) {
    const match = /^(\d{4})-(\d{2})/.exec(date);
    if (!match) throw new Error('An ISO plan date is required');
    const year = Number(match[1]), month = Number(match[2]) - 1;
    let count = 0;
    for (let day = 1; day <= new Date(Date.UTC(year, month + 1, 0)).getUTCDate(); day++) {
      if (new Date(Date.UTC(year, month, day)).getUTCDay() === 2) count++;
    }
    return count;
  }
  function weeklyBudget(normalPool, date) { return money(normalPool / planWeeksInMonth(date)); }
  function indicators(rows, decisionChange) {
    const closes = rows.map(row => row.close);
    const vol = M.weeklyVolatility(closes, 12), dd = M.recentDrawdown(closes, 52);
    return { rawDrawdownPct: dd, rawWeeklyVolatility: vol, trend: M.tickerTrend(closes, decisionChange),
      volatilityPct: vol === null ? null : money(vol * 100), drawdownPct: dd === null ? null : money(dd) };
  }
  function plan(options) {
    const rawConfig = options.config || D.getL2Config();
    const config = { ...rawConfig, configValid: rawConfig.configValid !== false && D.validateL2Config(rawConfig) };
    const state = { ...(options.policyState || {}) };
    const inputs = options.inputs || [];
    const evaluate = item => D.evaluateDcaL2Policy(item.input, state, config);
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
    const eligible = initial.map((row, i) => row.crashFundAmount > 0 && !inputs[i].actionBlocked ? inputs[i].input.baseAmount : 0);
    const deepBase = eligible.reduce((a, b) => a + b, 0);
    const rows = inputs.map((item, i) => {
      const decision = evaluate({ input: { ...item.input, crashFundWeight: deepBase > 0 ? eligible[i] / deepBase : 0 } });
      if (item.actionBlocked) {
        decision.baseAmount = decision.extraAmount = decision.crashFundAmount = decision.finalAmount = 0;
        decision.reasonCodes.push('ACTION_REQUIRES_ZERO_AMOUNT');
      }
      return { symbol: item.symbol, decision, currentAllocationPct: item.input.currentAllocationPct };
    });
    const budget = P.allocateDcaL2Plan(rows, options.budget);
    const decisions = Object.fromEntries(budget.items.map(row => [row.symbol, row.decision]));
    const core = C.plan({ ...options.core, preset: options.preset || C.PRESET, baseBudget: options.baseBudget,
      normalPoolRemaining: budget.normalPoolRemaining, crashFundRemaining: budget.crashFundRemaining,
      portfolioCashCap: options.budget.portfolioCashCap, commissionBps: options.commissionBps || 0, satelliteDecisions: decisions });
    for (const row of core.items) {
      const decision = decisions[row.symbol];
      if (!decision) continue;
      Object.assign(decision, { baseAmount: row.baseAmount, extraAmount: row.extraAmount, crashFundAmount: row.crashFundAmount,
        finalAmount: row.finalAmount, status: decision.state, l2: true,
        multiplier: inputs.find(item => item.symbol === row.symbol).input.baseAmount > 0 ? row.finalAmount / inputs.find(item => item.symbol === row.symbol).input.baseAmount : 0,
        reasonCodes: [...new Set(decision.reasonCodes.concat(row.reasonCodes))] });
    }
    budget.items.forEach(row => { row.finalAmount = row.decision.finalAmount; });
    return { plan: core, decisions, policyState: state, budgetReport: { ...budget,
      plannedNormal: core.plannedNormal, plannedCrash: core.plannedCrash, totalPlanned: core.totalPlanned,
      unallocatedCash: money(budget.normalPoolRemaining + budget.crashFundRemaining - core.totalPlanned) } };
  }
  return Object.freeze({ plan, indicators, planWeeksInMonth, weeklyBudget, version: 'weekly-dca-v1' });
});
