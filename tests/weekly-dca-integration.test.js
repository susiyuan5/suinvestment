const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../dca-policy');
const P = require('../portfolio-policy');
const C = require('../core-satellite-policy');
function run(cash, used = 0) {
  const items = C.rowsForPreset(C.PRESET).map(stock => ({ entry: { signal: { symbol: stock.symbol } }, currentAllocationPct: 0,
    decision: D.evaluateDcaL2Policy({ baseAmount: Math.round(69.23 * stock.allocation * 100) / 100, price: 100,
      dataStatus: 'fresh', marketRegime: 'Neutral', volatilityPct: 1, drawdownPct: 0, normalPool: 300,
      normalPoolUsed: used, crashFundInitial: 100, availableCashProvided: cash !== null, availableCash: cash }, {}) }));
  const intermediate = P.allocateDcaL2Plan(items, { normalPool: 300, normalPoolUsed: used, crashFund: 100, portfolioCashCap: cash === null ? null : cash * .3 });
  return C.plan({ baseBudget: 69.23, crashFundRemaining: 100, normalPoolRemaining: 300 - used,
    portfolioCashCap: cash === null ? null : cash * .3, satelliteDecisions: Object.fromEntries(intermediate.items.map(x => [x.entry.signal.symbol, x.decision])) });
}
test('final chain obeys cash cap including zero and fractional cents', () => {
  for (const cash of [0, .01, 1, 10, 100, 1000]) {
    const plan = run(cash);
    assert.ok(plan.totalPlanned <= cash * .3 + 1e-8);
    assert.ok(plan.conservation.balanced);
    for (const row of plan.items) assert.ok(Math.abs(row.baseAmount + row.extraAmount + row.crashFundAmount - row.finalAmount) < 1e-8);
  }
});
test('exhausted normal budget cannot be recreated as SPY redirection', () => assert.equal(run(1000, 300).totalPlanned, 0));
test('unspecified cash is not interpreted as zero cash', () => assert.ok(run(null).totalPlanned > 60));
test('data and action blocks retain cash instead of redirecting', () => {
  for (const code of ['HARD_BLOCK_INVALID_DATA', 'ACTION_REQUIRES_ZERO_AMOUNT', 'NORMAL_POOL_BUDGET_APPLIED']) {
    const plan = C.plan({ baseBudget: 100, crashFundRemaining: 0, satelliteDecisions: { NVDA: { finalAmount: 0, reasonCodes: [code] } } });
    assert.equal(plan.spyRedirected, 0);
  }
});
test('final budget keeps crash and normal funding separate and reserves fees', () => {
  const plan = C.plan({ baseBudget: 100, normalPoolRemaining: 50, crashFundRemaining: 2, portfolioCashCap: 40, commissionBps: 100,
    satelliteDecisions: { NVDA: { finalAmount: 30, extraAmount: 5, crashFundAmount: 10 } } });
  assert.ok(plan.plannedNormal <= 50);
  assert.ok(plan.plannedCrash <= 2);
  assert.ok(plan.totalPlanned * 1.01 <= 40);
  assert.equal(plan.crashFundUsed, plan.plannedCrash);
});
