const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { run } = require('../scripts/weekly-dca-backtest');
const { coverage, compare, VARIANTS, EXAMPLE_NINE, DRAFT_ELEVEN } = require('../scripts/weekly-dca-optimization-research');
const C = require('../core-satellite-policy');
function fixture() {
  const rows = [];
  for (let ms = Date.parse('2024-01-01'); ms <= Date.parse('2026-03-31'); ms += 86400000) {
    if ([0, 6].includes(new Date(ms).getUTCDay())) continue;
    rows.push({ date: new Date(ms).toISOString().slice(0, 10), close: 100, adjusted_close: 100, adjusted_open: 100 });
  }
  return { symbols: Object.fromEntries(C.rowsForPreset(C.PRESET).map(a => [a.symbol, rows.map(r => ({ ...r }))])) };
}
test('research factorial matches funds, preset and costs while preserving hard action blocks', () => {
  const data = fixture();
  // A real historical crash scenario, not a replacement action API.
  for (const rows of Object.values(data.symbols)) for (const row of rows) if (row.date >= '2026-02-02') row.close = row.adjusted_close = row.adjusted_open = 50;
  const result = compare(data, { start: '2026-01-01', normalPool: 600, crashFund: 200 });
  assert.equal(result.valid, true);
  assert.deepEqual(result.budget, { normalPool: 600, crashFund: 200, monthlyDeposit: 800 });
  const funds = Object.values(result.strategies).map(s => s.deposits);
  assert.ok(funds.every(v => v === 2400));
  assert.equal(result.summaries.fixed_same_reserve.invested, 1800);
  assert.ok(result.summaries.balanced_weekly_v2.invested > 0);
  assert.ok(result.summaries.cash_correction_only.invested > 0);
  for (const name of ['balanced_weekly_v2', ...VARIANTS.map(v => v.name)]) {
    for (const decision of result.strategies[name].decisions) {
      assert.ok(decision.plan.conservation.balanced);
      for (const input of decision.inputs) if (input.actionBlocked) assert.equal(decision.plan.items.find(r => r.symbol === input.symbol).finalAmount, 0);
    }
    assert.ok(result.strategies[name].curve.every(r => r.cash >= -1e-7));
  }
});
test('cash and gap research decisions remain causal under future price truncation', () => {
  const data = fixture(), cutoff = '2026-02-27';
  const full = compare(data, { start: '2026-01-01' }), prefix = compare(data, { start: '2026-01-01', asOf: cutoff });
  for (const name of Object.keys(full.strategies)) assert.deepEqual(full.strategies[name].trades.filter(t => t.date <= cutoff), prefix.strategies[name].trades);
});
test('custom preset is shared by every fixed and factorial comparison', () => {
  const preset = C.presetFromAllocations(C.PRESET.shortcuts['50'], C.PRESET);
  const result = compare(fixture(), { start: '2026-01-01', preset });
  assert.equal(result.allocations.SPY, .5);
  const fixed = result.strategies.fixed_same_reserve.trades.filter(t => t.date === '2026-01-06');
  assert.equal(fixed.find(t => t.symbol === 'SPY').amount, 37.5);
  assert.ok(result.strategies.cash_and_gap.decisions.every(r => r.plan.summary.coreTargetPct === 50));
});
test('short IPO or absent history produces coverage failure and never a return', () => {
  const data = fixture();
  data.symbols.QNT = data.symbols.SPY.filter(r => r.date >= '2026-01-01');
  const short = coverage(data, { SPY: .5, QNT: .5 }, '2026-03-31');
  assert.equal(short.commonStart, '2026-01-01');
  assert.equal(short.validForCurrentStrategyReturn, false);
  assert.equal(short.performance, null);
  assert.ok(short.issues.some(i => i.symbol === 'QNT' && i.reason === 'insufficient_52_week_lookback'));
  assert.equal(coverage(data, EXAMPLE_NINE).validForCurrentStrategyReturn, false);
  assert.equal(coverage(data, DRAFT_ELEVEN).performance, null);
  data.symbols.SPY[0].adjusted_open = Infinity;
  assert.ok(coverage(data, { SPY: 1 }).issues.some(i => i.reason === 'invalid_daily_history'));
});
test('research rejects invalid budgets, duplicate variants and nonfinite execution prices', () => {
  assert.throws(() => run(fixture(), { normalPool: -1 }), /budget/);
  assert.throws(() => run(fixture(), { variants: [VARIANTS[0], VARIANTS[0]] }), /Duplicate/);
  const data = fixture(); data.symbols.NVDA.find(r => r.date === '2026-01-06').adjusted_open = Infinity;
  assert.equal(compare(data, { start: '2026-01-01' }).valid, false);
});
test('read-only research run preserves frozen price input and prior v2 result', () => {
  const files = ['data/v2/backtest-adjusted-daily.json', 'results/weekly_dca_v2/summary.json'];
  const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const before = files.map(hash);
  compare(fixture(), { start: '2026-01-01', asOf: '2026-01-30' });
  assert.deepEqual(files.map(hash), before);
});
test('explicit legacy cash baseline reproduces the frozen six-asset v2 evidence', () => {
  const payload = JSON.parse(fs.readFileSync('data/v2/backtest-adjusted-daily.json'));
  const frozen = JSON.parse(fs.readFileSync('results/weekly_dca_v2/summary.json'));
  const result = compare(payload, { start: '2022-06-01' });
  for (const name of ['balanced_weekly_v2', 'fixed_same_reserve']) {
    for (const field of ['externalDeposits', 'invested', 'finalValue', 'xirr', 'maxDrawdown']) assert.ok(Math.abs(result.summaries[name][field] - frozen.summaries[name][field]) < 1e-9, name + ' ' + field);
  }
});
