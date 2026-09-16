const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core-satellite-policy');
const W = require('../weekly-dca-engine');

test('adding a stock locks its percentage and conserves integer basis points', () => {
  const before = C.recommendedAllocations();
  const added = C.rebalanceAllocations(before, 'MSFT', 5.55);
  assert.equal(added.valid, true);
  assert.equal(added.allocations.MSFT, .0555);
  assert.equal(Object.values(added.allocations).reduce((sum, n) => sum + Math.round(n * 10000), 0), 10000);
  assert.deepEqual(before, C.recommendedAllocations());
});
test('all symbols accept zero to one hundred; invalid values never silently change the request', () => {
  for (const [symbol, pct] of [['SPY', 101], ['NVDA', 100.01], ['MSFT', -1], ['MSFT', ''], ['MSFT', NaN], ['MSFT', null], ['MSFT', false], ['MSFT', '  '], ['MSFT', 1.234], ['<script>', 5]]) {
    assert.equal(C.rebalanceAllocations(C.recommendedAllocations(), symbol, pct).valid, false, symbol + ':' + pct);
  }
  for (const [symbol, pct] of [['SPY', 0], ['SPY', 100], ['QQQ', 0], ['QQQ', 100], ['NVDA', 55], ['MSFT', 75]]) {
    const result = C.rebalanceAllocations(C.recommendedAllocations(), symbol, pct);
    assert.equal(result.valid, true, symbol);
    assert.equal(result.allocations[symbol], pct / 100);
    assert.equal(C.validateAllocations(result.allocations).valid, true);
  }
});
test('repeated edits and zero-weight fallback preserve exact totals', () => {
  let values = { SPY: .8, QQQ: 0, NVDA: 0, AAPL: 0, ASML: .1, KO: .1 };
  for (let i = 0; i < 300; i++) {
    const symbol = ['MSFT', 'NVDA', 'AAPL', 'TSLA', 'KO'][i % 5];
    const pct = (i * 137 % 10001) / 100;
    const next = C.rebalanceAllocations(values, symbol, pct);
    assert.equal(next.valid, true, JSON.stringify(next));
    assert.equal(Math.round(next.allocations[symbol] * 10000), Math.round(pct * 100));
    assert.equal(Math.round(Object.values(next.allocations).reduce((s, n) => s + n, 0) * 10000), 10000);
    values = next.allocations;
  }
});
test('custom stock reaches the shared planner and is included in concentration gates', () => {
  const values = C.rebalanceAllocations(C.recommendedAllocations(), 'MSFT', 10).allocations;
  const preset = C.presetFromAllocations(values);
  assert.equal(C.validatePreset(preset), true);
  const result = C.plan({ preset, baseBudget: 100, actualAllocations: {}, crashFundRemaining: 0 });
  assert.equal(result.items.length, 7);
  assert.equal(result.items.find(row => row.symbol === 'MSFT').originalBaseAmount, 10);
  assert.equal(result.items.find(row => row.symbol === 'MSFT').finalAmount, 10);
  assert.equal(result.conservation.balanced, true);
  const blocked = C.plan({ preset, baseBudget: 100, actualAllocations: { MSFT: 18 } });
  assert.equal(blocked.items.find(row => row.symbol === 'MSFT').finalAmount, 0);
  const groupBlocked = C.plan({ preset, baseBudget: 100, actualAllocations: { MSFT: 41 }, satelliteDecisions: { AAPL: { finalAmount: 15 } } });
  assert.equal(groupBlocked.items.find(row => row.symbol === 'AAPL').finalAmount, 0);
  const full = W.plan({ preset, baseBudget: 100, policyState: {}, budget: { normalPool: 100, crashFund: 0 }, core: {}, inputs: C.rowsForPreset(preset).map(row => ({ symbol: row.symbol, input: { baseAmount: row.allocation * 100, price: 100, dataStatus: 'fresh', marketRegime: 'Bull', currentAllocationPct: 0, date: '2026-09-15', drawdownPct: 0, volatilityPct: 2, trendStatus: 'above_sma' } })) });
  assert.equal(full.plan.items.length, 7);
  assert.ok(full.plan.totalPlanned <= 100);
});
