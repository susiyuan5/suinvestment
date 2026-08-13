const test = require('node:test');
const assert = require('node:assert/strict');
const plan = require('../short-term-trade-plan.js');

function rows(values) { return values.map((close, index) => ({ date: `2026-01-${String(index + 1).padStart(2, '0')}`, high: close + 1, low: close - 1, close, volume: 100 })); }
const config = { indicators: { atr_period: 14 }, sizing: { risk_budget_pct_assets: .0025, maximum_notional_pct_assets: .02, maximum_experiment_pct_assets: .05 } };

test('safe payload and research-only status labels are stable', () => {
  assert.equal(plan.statusLabel('conditional_review'), '条件满足，待人工确认');
  assert.equal(plan.statusLabel('simulation_only'), '仅作研究演练');
  assert.equal(plan.statusLabel('blocked'), '安全门禁阻断');
  assert.equal(plan.safePayload({ schema_version: 'short-term-trade-plan-v1', research_only: true, no_trade: true, plans: [] }).schema_version, 'short-term-trade-plan-v1');
});

test('indicators and position sizing are deterministic', () => {
  const stock = rows(Array.from({ length: 80 }, (_, index) => 100 + index * .2));
  const qqq = rows(Array.from({ length: 80 }, (_, index) => 100 + index * .1));
  const indicators = plan.computeIndicators(stock, qqq, config);
  assert.ok(indicators.atr14 > 0);
  assert.equal(indicators.signal_date, '2026-01-80');
  const size = plan.calculatePositionSize(100000, 10000, 100, 95, { sizing: { risk_budget_pct_assets: .0025, maximum_notional_pct_assets: .02, maximum_experiment_pct_assets: .05 } });
  assert.ok(size.shares >= 0);
  assert.ok(size.notional <= 2000);
});

test('missing sizing inputs never become an order', () => {
  const size = plan.calculatePositionSize(null, 1000, 100, 95, { sizing: { risk_budget_pct_assets: .0025, maximum_notional_pct_assets: .02, maximum_experiment_pct_assets: .05 } });
  assert.equal(size.shares, null);
  const payload = { schema_version: 'short-term-trade-plan-v1', research_only: true, no_trade: true, plans: [{ ticker: 'AAPL', status: 'simulation_only', reason_codes: ['event_date_unknown'] }] };
  assert.equal(plan.planForTicker(payload, 'aapl').status, 'simulation_only');
});
