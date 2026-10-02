const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const W = require('../weekly-dca-engine');
const D = require('../dca-policy');
const C = require('../core-satellite-policy');
const { xirr, performance } = require('../performance-metrics');
const { run, weeklyRows } = require('../scripts/weekly-dca-backtest');
function input(date = '2026-01-05') {
  return { config: D.getL2Config(), preset: C.PRESET, baseBudget: 75, policyState: {},
    inputs: C.rowsForPreset(C.PRESET).map(asset => ({ symbol: asset.symbol, input: { date, price: 100, baseAmount: 75 * asset.allocation,
      dataStatus: 'fresh', volatilityPct: 2, drawdownPct: 12, marketRegime: 'Bull', currentAllocationPct: 0, normalPool: 300, crashFundInitial: 100 } })),
    budget: { normalPool: 300, crashFund: 100, portfolioCashCap: 3 }, core: { spyDataValid: true, qqqDataValid: true } };
}
test('browser and Node execute the same full weekly amount chain', () => {
  const context = vm.createContext({});
  for (const file of ['dca-policy.js','portfolio-policy.js','core-satellite-policy.js','market-analysis.js','weekly-dca-engine.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  const options = input();
  const browser = JSON.parse(JSON.stringify(context.WeeklyDcaEngine.plan(options)));
  assert.deepEqual(browser, JSON.parse(JSON.stringify(W.plan(options))));
  assert.ok(browser.plan.totalPlanned <= 3);
});
test('calendar month budgeting is independent of missing price rows', () => {
  assert.equal(W.weeklyBudget(300, '2026-09-01'), 60);
  assert.equal(W.weeklyBudget(300, '2026-02-03'), 75);
});
test('recovery does not advance on refresh or a missing fresh input', () => {
  const options = input(); options.policyState = { defensiveLatched: true, recoveryConfirmations: 0, lastRecoveryWeek: '' };
  let result = W.plan(options);
  assert.equal(result.policyState.recoveryConfirmations, 1);
  options.policyState = result.policyState;
  assert.equal(W.plan(options).policyState.recoveryConfirmations, 1);
  options.inputs.forEach(row => { row.input.date = '2026-01-12'; });
  options.inputs[1].input.dataStatus = 'stale';
  assert.equal(W.plan(options).policyState.recoveryConfirmations, 1);
});
test('XIRR and time weighted drawdown separate investment performance from deposits', () => {
  assert.ok(Math.abs(xirr([{ date:'2025-01-01', amount:-100 }, { date:'2026-01-01', amount:110 }]) - .1) < 1e-10);
  assert.equal(xirr([{ date:'2025-01-01', amount:100 }]), null);
  const flat = performance([{date:'2025-01-01',value:100,cash:100,deposit:100},{date:'2026-01-01',value:200,cash:200,deposit:100}], [{date:'2025-01-01',amount:-100},{date:'2026-01-01',amount:-100}]);
  assert.ok(Math.abs(flat.xirr) < 1e-10); assert.equal(flat.timeWeightedReturn, 0);
  const down = performance([{date:'2025-01-01',value:100,cash:0,deposit:100},{date:'2025-01-02',value:180,cash:0,deposit:100}], []);
  assert.ok(Math.abs(down.maxDrawdown - .1) < 1e-10);
});
function fixture() {
  const rows = [];
  for(let ms=Date.parse('2025-01-01'); ms<=Date.parse('2026-03-31'); ms+=86400000) {
    const day=new Date(ms).getUTCDay(); if(day===0||day===6) continue;
    rows.push({date:new Date(ms).toISOString().slice(0,10),adjusted_close:100,adjusted_open:100});
  }
  return {symbols:Object.fromEntries(C.SYMBOLS.map(s=>[s,rows.map(x=>({...x}))]))};
}
test('backtest decisions are prefix invariant when future prices change', () => {
  const data=fixture(), cutoff='2026-02-27';
  const full=run(data,{start:'2026-01-01'}), prefix=run(data,{start:'2026-01-01',asOf:cutoff});
  for (const name of Object.keys(full.strategies)) {
    assert.deepEqual(full.strategies[name].trades.filter(row=>row.date<=cutoff), prefix.strategies[name].trades);
    assert.equal(prefix.summaries[name].externalDeposits, 800);
  }
  assert.ok(Math.abs(full.summaries.fixed_same_reserve.timeWeightedReturn) < .01);
});
test('missing execution open is reported without inflating other weeks', () => {
  const data=fixture(); data.symbols.NVDA.find(row=>row.date==='2026-01-06').adjusted_open=null;
  const result=run(data,{start:'2026-01-01',asOf:'2026-01-30'});
  assert.equal(result.valid,false);
  assert.equal(result.summaries.fixed_same_reserve.invested,225);
});
test('weekly indicators never read a future close', () => {
  const rows=[{date:'2026-01-05',adjusted_close:100},{date:'2026-01-09',adjusted_close:999}];
  assert.deepEqual(weeklyRows(rows,'2026-01-05'),[{date:'2026-01-05',close:100}]);
});

test('five weekly contributions preserve all future base funding despite dip signals', () => {
  let used = 0;
  for (const date of ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29']) {
    const options = input(date);
    options.baseBudget = 60;
    options.budget = { normalPool: 300, normalPoolUsed: used, crashFund: 100 };
    options.inputs.forEach((row, i) => { row.input.baseAmount = 60 * C.rowsForPreset(C.PRESET)[i].allocation; row.input.normalPoolUsed = used; });
    const result = W.plan(options);
    assert.equal(result.plan.plannedNormal, 60);
    used += result.plan.plannedNormal;
    assert.ok(result.budgetReport.normalPoolRemaining - result.plan.plannedNormal >= result.budgetReport.funding.futureReserved);
  }
  assert.equal(used, 300);
});

test('monthly cents conserve exactly and funding uses the plan month rather than quote month', () => {
  const dates = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29'];
  assert.equal(dates.reduce((sum, date) => sum + Math.round(W.weeklyBudget(300.03, date) * 100), 0), 30003);
  assert.throws(() => W.weeklyBudget(300, '2026-13-01'));
  assert.throws(() => W.weeklyBudget(300, '2026-02-30'));
  const options = input('2026-08-31');
  options.plannedDate = '2026-09-01'; options.baseBudget = 60;
  options.budget.portfolioCashCap = null;
  const result = W.plan(options);
  assert.equal(result.budgetReport.funding.futureReserved, 240);
  assert.ok(result.plan.plannedNormal <= 60);
});

test('unspent earlier funding allows only a bounded extra and recorded weekly use consumes its allowance', () => {
  assert.deepEqual(W.fundingPlan(300, 0, '2026-09-08', 60), { planDate: '2026-09-08', scheduledBase: 60,
    futureReserved: 180, normalRemaining: 300, normalLimit: 75, weeklyLimit: 75, weekUsed: 0 });
  assert.equal(W.fundingPlan(300, 75, '2026-09-08', 60, 75).normalLimit, 0);
  assert.equal(W.fundingPlan(300, 250, '2026-09-15', 60).normalLimit, 0);
});

test('market defence preserves Base while explicit action and data blocks still stop buys', () => {
  const options = input('2026-02-03'); options.budget.portfolioCashCap = null;
  options.inputs.forEach(row => { row.input.marketRegime = 'Bear'; row.extraBlocked = true; });
  let result = W.plan(options);
  assert.equal(result.plan.plannedNormal, 75);
  assert.equal(result.plan.plannedCrash, 0);
  assert.ok(result.decisions.NVDA.reasonCodes.includes('SCHEDULED_BASE_PRESERVED'));
  assert.ok(!result.decisions.NVDA.reasonCodes.includes('DEFENSIVE_BASE_50'));
  for (const row of options.inputs) row.actionBlocked = true;
  assert.equal(W.plan(options).plan.totalPlanned, 0);
  options.inputs.forEach(row => { row.actionBlocked = false; row.input.dataStatus = 'invalid'; });
  assert.equal(W.plan(options).plan.totalPlanned, 0);
});

test('weekly funding remains affordable over fractional cash caps and keeps report components aligned', () => {
  for (let cents = 0; cents <= 200; cents++) {
    const options = input('2026-02-03'), cap = cents / 100 * .3;
    options.budget.portfolioCashCap = cap;
    const result = W.plan(options);
    assert.ok(result.plan.totalPlanned <= cap + 1e-8, 'cash cap ' + cap);
    assert.equal(result.plan.plannedNormal, result.budgetReport.plannedNormal);
    assert.equal(result.plan.totalPlanned, result.budgetReport.totalPlanned);
    result.plan.items.forEach(row => assert.equal(Math.round((row.baseAmount + row.extraAmount + row.crashFundAmount) * 100), Math.round(row.finalAmount * 100)));
  }
});

test('Crash funding excludes ETF allocations and confirmed use cannot reopen the same weekly allowance', () => {
  const options = input('2026-02-03'); options.budget.portfolioCashCap = null;
  options.inputs.forEach(row => { row.input.drawdownPct = 25; row.input.trendStatus = 'above_sma'; row.input.crashFundBalance = 100; });
  let result = W.plan(options);
  assert.equal(result.plan.plannedCrash, 25);
  for (const symbol of ['SPY', 'QQQ']) assert.equal(result.decisions[symbol].crashFundAmount, 0);
  options.budget.weekCrashUsed = 20;
  options.budget.crashFundUsed = 20;
  result = W.plan(options);
  assert.equal(result.plan.plannedCrash, 5);
  options.budget.weekCrashUsed = 25;
  options.budget.crashFundUsed = 25;
  result = W.plan(options);
  assert.equal(result.plan.plannedCrash, 0);
  assert.equal(result.budgetReport.crashFundRemaining, 75);
});

test('account cash no longer reduces an affordable scheduled Base to thirty percent', () => {
  let used = 0, cash = 400;
  for (const date of ['2026-02-03', '2026-02-10', '2026-02-17', '2026-02-24']) {
    const options = input(date);
    options.budget = { normalPool: 300, normalPoolUsed: used, crashFund: 100,
      portfolioCashCap: cash, optionalCashCap: cash * .3 };
    options.inputs.forEach(row => Object.assign(row.input, { drawdownPct: 0, normalPoolUsed: used,
      availableCashProvided: true, availableCash: cash }));
    const result = W.plan(options);
    assert.equal(result.plan.plannedNormal, 75);
    assert.equal(result.plan.plannedOptional, 0);
    assert.ok(result.plan.conservation.balanced);
    used += result.plan.plannedNormal; cash -= result.plan.totalPlanned;
  }
  assert.equal(used, 300);
  assert.equal(cash, 100);
});

test('legacy cash mode preserves the old limit with balanced weekly funding', () => {
  const options = input('2026-02-24'); options.cashPolicyMode = 'legacy';
  options.budget = { normalPool: 300, normalPoolUsed: 225, crashFund: 100, portfolioCashCap: 52.5, optionalCashCap: 0 };
  options.inputs.forEach(row => Object.assign(row.input, { drawdownPct: 0, normalPoolUsed: 225,
    availableCashProvided: true, availableCash: 175 }));
  const result = W.plan(options);
  assert.equal(result.plan.plannedNormal, 52.5);
  assert.equal(result.plan.optionalCashCap, null);
});

test('cash priority preserves Base proportions when actual cash is scarce', () => {
  const options = input('2026-02-03');
  options.budget.portfolioCashCap = 1; options.budget.optionalCashCap = .3;
  options.inputs.forEach(row => Object.assign(row.input, { drawdownPct: 0, availableCashProvided: true, availableCash: 1 }));
  const result = W.plan(options);
  assert.equal(result.plan.totalPlanned, 1);
  assert.equal(result.decisions.SPY.baseAmount, .4);
  assert.ok(result.plan.items.every(row => !row.reasonCodes.includes('CASH_CAP_APPLIED')));
});

test('shared optional cap remains separate from cash and weekly Crash allowances', () => {
  const options = input('2026-02-10');
  options.budget = { normalPool: 300, normalPoolUsed: 0, crashFund: 100, portfolioCashCap: 100, optionalCashCap: 5 };
  options.inputs.forEach(row => Object.assign(row.input, { drawdownPct: 25, trendStatus: 'above_sma',
    crashFundBalance: 100, availableCashProvided: true, availableCash: 100 }));
  const result = W.plan(options);
  assert.equal(result.plan.items.reduce((sum, row) => sum + row.baseAmount, 0), 75);
  assert.equal(result.plan.plannedOptional, 5);
  assert.ok(result.plan.totalPlanned <= 100);
  assert.ok(result.plan.plannedCrash <= 25);
  assert.equal(result.budgetReport.plannedOptional, 5);
});

test('gap Base uses all supplied eligible securities and excludes account cash', () => {
  const preset = C.presetFromAllocations({ SPY: .2, QQQ: .2, NVDA: .15, AAPL: .15, ASML: .15, KO: .15 });
  const result = W.gapBasePlan({ preset, eligibleUSPositions: { SPY: { current_value: 60 }, AAPL: 120, KO: 10, WMT: 10 },
    holdingsComplete: true, baseBudget: 30, normalLimit: 30, portfolioCashCap: 100 });
  assert.equal(result.valid, true);
  assert.equal(result.securitiesValue, 200);
  assert.equal(result.gaps.SPY, 0);
  assert.equal(result.baseAmounts.SPY, 0);
  assert.equal(Object.values(result.baseAmounts).reduce((sum, value) => sum + Math.round(value * 100), 0), 3000);
  assert.equal(result.baseAmounts.WMT, undefined, 'outside-plan holding never becomes a buy');
  const otherCash = W.gapBasePlan({ preset, eligibleUSPositions: { SPY: 60, AAPL: 120, KO: 10, WMT: 10 },
    holdingsComplete: true, baseBudget: 30, normalLimit: 30, portfolioCashCap: 1000 });
  assert.deepEqual(otherCash.baseAmounts, result.baseAmounts);
});

test('gap Base computes affordable funding before gaps and distributes cents deterministically', () => {
  const options = { eligibleUSPositions: {}, holdingsComplete: true, baseBudget: 75, normalLimit: 20.03,
    portfolioCashCap: 10, commissionBps: 100 };
  const result = W.gapBasePlan(options);
  assert.equal(result.baseBudget, 9.9);
  assert.equal(result.securitiesValue, 0);
  assert.equal(Object.values(result.baseAmounts).reduce((sum, value) => sum + Math.round(value * 100), 0), 990);
  assert.deepEqual(W.gapBasePlan(options), result);
  const zero = W.gapBasePlan({ ...options, baseBudget: 0 });
  assert.equal(zero.valid, true);
  assert.ok(Object.values(zero.baseAmounts).every(value => value === 0));
});

test('unknown holdings or invalid values cannot be treated as an empty portfolio', () => {
  for (const values of [undefined, null, { SPY: null }, { SPY: {} }, { SPY: { current_value: null } },
    { SPY: NaN }, { SPY: -1 }, { SPY: '10' }, { SPY: 1e308, KO: 1e308 }]) {
    const result = W.gapBasePlan({ eligibleUSPositions: values, holdingsComplete: true, baseBudget: 60, normalLimit: 60 });
    assert.equal(result.valid, false);
    assert.equal(result.baseAmounts, null);
  }
  assert.equal(W.gapBasePlan({ eligibleUSPositions: {}, holdingsComplete: false, baseBudget: 60 }).valid, false);
});

test('shared gap overrides survive the full chain and blocked contributions stay in cash', () => {
  const options = input('2026-02-03');
  options.budget.portfolioCashCap = 100;
  options.baseAmounts = { SPY: 0, QQQ: 15, NVDA: 15, AAPL: 15, ASML: 15, KO: 15 };
  options.inputs.forEach(row => Object.assign(row.input, { drawdownPct: 0, availableCashProvided: true, availableCash: 100 }));
  options.inputs.find(row => row.symbol === 'NVDA').input.currentAllocationPct = 18;
  options.core.actualAllocations = { NVDA: 18 };
  const result = W.plan(options);
  assert.equal(result.plan.spyRedirected, 0);
  assert.equal(result.decisions.SPY.finalAmount, 0);
  assert.equal(result.decisions.NVDA.finalAmount, 0);
  assert.equal(result.plan.totalPlanned, 60);
  assert.equal(result.decisions.QQQ.baseAmount, 15);
  assert.equal(options.inputs.find(row => row.symbol === 'SPY').input.baseAmount, 30, 'caller inputs are not mutated');
  const invalid = W.plan({ ...options, baseAmounts: { SPY: 0 } });
  assert.equal(invalid.plan.totalPlanned, 0);
  assert.ok(invalid.plan.items.every(row => row.reasonCodes.includes('BASE_AMOUNTS_INVALID')));
});

function contributionInput(date = '2026-02-03') {
  const options = input(date);
  options.preset = C.presetFromAllocations({ SPY: .2, QQQ: .1, NVDA: .15, AAPL: .15, ASML: .15, KO: .25 });
  options.baseBudget = 53.74;
  options.budget.portfolioCashCap = 100;
  options.budget.optionalCashCap = 30;
  options.inputs.forEach(row => Object.assign(row.input, { drawdownPct: 0, availableCashProvided: true, availableCash: 100 }));
  const base = W.contributionBasePlan({ preset: options.preset, baseBudget: options.baseBudget,
    normalLimit: W.fundingPlan(300, 0, date, options.baseBudget).normalLimit, portfolioCashCap: 100 });
  assert.equal(base.valid, true);
  options.baseBudget = base.baseBudget;
  options.baseAmounts = base.baseAmounts;
  return options;
}

test('weekly contribution weights allocate the whole affordable budget using deterministic cents', () => {
  const options = contributionInput(), result = W.contributionBasePlan({ preset: options.preset, baseBudget: 53.74 });
  assert.equal(result.allocationMode, 'weekly_contribution');
  assert.deepEqual(result.reasonCodes, []);
  assert.equal(result.baseBudget, 53.74);
  assert.equal(result.baseAmounts.SPY, 10.75, '20% of weekly funding rounds to $10.75');
  assert.equal(Object.values(result.baseAmounts).reduce((sum, amount) => sum + Math.round(amount * 100), 0), 5374);
  assert.deepEqual(W.contributionBasePlan({ preset: options.preset, baseBudget: 53.74 }), result);
  assert.ok(C.validateBaseAmounts(result.baseAmounts, options.preset, result.baseBudget));
});

test('holdings above the contribution weight cannot turn SPY Base into a holdings gap', () => {
  const options = contributionInput();
  options.inputs.find(row => row.symbol === 'SPY').input.currentAllocationPct = 26.61;
  options.core.actualAllocations = { SPY: 26.61 };
  const baseOptions = { preset: options.preset, baseBudget: 53.74, portfolioCashCap: 100 };
  const withoutHoldings = W.contributionBasePlan(baseOptions);
  assert.deepEqual(W.contributionBasePlan({ ...baseOptions, holdingsComplete: false,
    eligibleUSPositions: { SPY: 100000, KO: null } }), withoutHoldings, 'contribution funding does not inspect holdings');
  const result = W.plan(options);
  assert.equal(result.decisions.SPY.baseAmount, 10.75);
  assert.equal(result.plan.totalPlanned, 53.74);
  assert.equal(result.plan.spyRedirected, 0);
  assert.ok(result.plan.conservation.balanced);
});

test('unconstrained account cash changes do not change weekly contribution proportions', () => {
  const preset = contributionInput().preset;
  const smallCash = W.contributionBasePlan({ preset, baseBudget: 53.74, portfolioCashCap: 100 });
  const largeCash = W.contributionBasePlan({ preset, baseBudget: 53.74, portfolioCashCap: 10000 });
  assert.deepEqual(largeCash, smallCash);
});

test('weekly contribution funding uses real cash including fees and preserves monthly reservations', () => {
  const cashLimited = W.contributionBasePlan({ baseBudget: 75, normalLimit: 75, portfolioCashCap: 10, commissionBps: 100 });
  assert.equal(cashLimited.baseBudget, 9.9);
  assert.ok(cashLimited.baseBudget * 1.01 <= 10);
  assert.equal(Object.values(cashLimited.baseAmounts).reduce((sum, amount) => sum + Math.round(amount * 100), 0), 990);
  const funding = W.fundingPlan(300, 115, '2026-09-08', 60);
  assert.equal(funding.futureReserved, 180);
  const monthLimited = W.contributionBasePlan({ baseBudget: 60, normalLimit: funding.normalLimit, portfolioCashCap: 100 });
  assert.equal(monthLimited.baseBudget, 5);
  const fullyRecorded = W.fundingPlan(300, 75, '2026-09-08', 60, 75);
  const repeat = W.contributionBasePlan({ baseBudget: 60, normalLimit: fullyRecorded.normalLimit, portfolioCashCap: 100 });
  assert.equal(repeat.baseBudget, 0);
  assert.ok(Object.values(repeat.baseAmounts).every(amount => amount === 0));
  for (const dates of [['2026-02-03', '2026-02-10', '2026-02-17', '2026-02-24'],
    ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29']]) {
    let used = 0;
    for (const date of dates) {
      const baseBudget = W.weeklyBudget(300.03, date), funding = W.fundingPlan(300.03, used, date, baseBudget);
      const base = W.contributionBasePlan({ baseBudget, normalLimit: funding.normalLimit, portfolioCashCap: 10000 });
      assert.equal(base.baseBudget, baseBudget);
      used = Math.round((used + base.baseBudget) * 100) / 100;
      assert.ok(300.03 - used + 1e-8 >= funding.futureReserved);
    }
    assert.equal(used, 300.03, dates.length + '-week month funding is conserved');
  }
});

test('zero contribution weights never receive a rounding remainder', () => {
  const preset = C.presetFromAllocations({ SPY: 0, QQQ: 0, NVDA: .5, AAPL: .5, ASML: 0, KO: 0 });
  const result = W.contributionBasePlan({ preset, baseBudget: .01 });
  assert.equal(result.valid, true);
  assert.deepEqual(result.baseAmounts, { SPY: 0, QQQ: 0, NVDA: 0, AAPL: .01, ASML: 0, KO: 0 });
});

test('invalid contribution inputs fail safely without constructing a buy map', () => {
  for (const options of [undefined, null, [], 12, {}, { baseBudget: -1 }, { baseBudget: NaN }, { baseBudget: Infinity },
    { baseBudget: '10' }, { baseBudget: 1e308 }, { baseBudget: 10, normalLimit: -1 },
    { baseBudget: 10, portfolioCashCap: -1 }, { baseBudget: 10, portfolioCashCap: '100' },
    { baseBudget: 10, commissionBps: Infinity }, { baseBudget: 10, commissionBps: -1 },
    { baseBudget: 10, preset: {} }, { baseBudget: 10, preset: { ...C.PRESET, satellites: [null] } },
    { baseBudget: 10, preset: { ...C.PRESET, core: { ...C.PRESET.core, target_allocation: .2 } } }]) {
    const result = W.contributionBasePlan(options);
    assert.equal(result.valid, false);
    assert.equal(result.baseBudget, 0);
    assert.equal(result.baseAmounts, null);
    assert.equal(result.allocationMode, 'weekly_contribution');
  }
});

test('blocked weighted contributions remain in cash and never enlarge SPY allocation', () => {
  const options = contributionInput();
  options.inputs.find(row => row.symbol === 'NVDA').input.currentAllocationPct = 18;
  options.core.actualAllocations = { NVDA: 18 };
  const result = W.plan(options);
  assert.equal(result.decisions.NVDA.finalAmount, 0);
  assert.equal(result.decisions.SPY.finalAmount, options.baseAmounts.SPY);
  assert.equal(result.plan.spyRedirected, 0);
  assert.equal(result.plan.totalPlanned, 45.68);
  assert.equal(result.plan.items.find(row => row.symbol === 'NVDA').cashRetained, 8.06);
  assert.ok(result.plan.conservation.balanced);
});

test('weighted Base preserves existing data, action and global safety gates', () => {
  const scenarios = [
    options => { options.core.safetyBlocked = true; },
    options => { options.inputs.forEach(row => { row.actionBlocked = true; }); },
    options => { options.inputs.forEach(row => { row.input.dataStatus = 'invalid'; }); },
    options => { options.inputs.forEach(row => { row.input.availableCash = 0; }); }
  ];
  for (const block of scenarios) {
    const options = contributionInput();
    block(options);
    const result = W.plan(options);
    assert.equal(result.plan.totalPlanned, 0);
    assert.equal(result.plan.spyRedirected, 0);
  }
  const deep = contributionInput();
  deep.inputs.find(row => row.symbol === 'NVDA').input.drawdownPct = 35;
  deep.core.blockedSymbols = ['NVDA'];
  deep.inputs.find(row => row.symbol === 'NVDA').actionBlocked = true;
  assert.equal(W.plan(deep).decisions.NVDA.finalAmount, 0, 'explicit 35% application safety gate still wins');
});

test('weighted Base does not consume the enhancement cash allowance', () => {
  const options = contributionInput('2026-02-10');
  options.budget.optionalCashCap = 5;
  options.inputs.forEach(row => Object.assign(row.input, { drawdownPct: 25, trendStatus: 'above_sma', crashFundBalance: 100 }));
  const result = W.plan(options);
  assert.equal(result.plan.items.reduce((sum, row) => sum + Math.round(row.baseAmount * 100), 0), 5374);
  assert.equal(result.plan.plannedOptional, 5);
  assert.ok(result.plan.totalPlanned <= 100);
  assert.ok(result.plan.conservation.balanced);
});

test('recorded weekly use is subtracted once when weighted Base enters the shared planner', () => {
  const options = input('2026-09-08');
  options.preset = contributionInput().preset;
  options.baseBudget = W.weeklyBudget(300, '2026-09-08');
  options.budget = { normalPool: 300, normalPoolUsed: 50, weekNormalUsed: 50,
    crashFund: 100, portfolioCashCap: 100, optionalCashCap: 0 };
  options.inputs.forEach(row => Object.assign(row.input, { drawdownPct: 0, normalPoolUsed: 50,
    availableCashProvided: true, availableCash: 100 }));
  const funding = W.fundingPlan(300, 50, '2026-09-08', options.baseBudget, 50);
  assert.equal(funding.normalLimit, 25);
  const base = W.contributionBasePlan({ preset: options.preset, baseBudget: funding.scheduledBase,
    normalLimit: funding.normalLimit, portfolioCashCap: 100 });
  assert.equal(base.baseBudget, 25);
  options.baseAmounts = base.baseAmounts;
  assert.equal(options.baseBudget, 60, 'shared planner keeps the scheduled weekly budget');
  let result = W.plan(options);
  assert.equal(result.plan.totalPlanned, 25, 'remaining weekly funding is not subtracted a second time');
  assert.equal(result.plan.funding.normalLimit, 25);
  assert.equal(result.decisions.SPY.baseAmount, 5);
  assert.ok(result.plan.conservation.balanced);
  options.inputs.find(row => row.symbol === 'NVDA').actionBlocked = true;
  result = W.plan(options);
  assert.equal(result.plan.totalPlanned, 21.25);
  assert.equal(result.decisions.SPY.baseAmount, 5);
  assert.equal(result.plan.spyRedirected, 0);
  assert.equal(result.plan.items.find(row => row.symbol === 'NVDA').cashRetained, 3.75);
});

test('browser and Node allocate the same weekly contribution cents', () => {
  const context = vm.createContext({});
  for (const file of ['dca-policy.js', 'portfolio-policy.js', 'core-satellite-policy.js', 'market-analysis.js', 'weekly-dca-engine.js'])
    vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  const options = { preset: contributionInput().preset, baseBudget: 53.74, normalLimit: 53.74, portfolioCashCap: 100 };
  assert.deepEqual(JSON.parse(JSON.stringify(context.WeeklyDcaEngine.contributionBasePlan(options))), W.contributionBasePlan(options));
});
