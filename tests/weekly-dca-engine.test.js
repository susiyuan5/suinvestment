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
