const test = require('node:test');
const assert = require('node:assert/strict');
const plan = require('../short-term-trade-plan.js');

function rows(values) { return values.map((close, index) => ({ date: `2026-01-${String(index + 1).padStart(2, '0')}`, high: close + 1, low: close - 1, close, volume: 100 })); }
const config = { indicators: { atr_period: 14 }, sizing: { risk_budget_pct_assets: .0025, maximum_notional_pct_assets: .02, maximum_experiment_pct_assets: .05 } };

test('safe payload and research-only status labels are stable', () => {
  assert.equal(plan.statusLabel('conditional_review'), '条件满足，待人工确认');
  assert.equal(plan.statusLabel('simulation_only'), '\u4ec5\u7814\u7a76\u6f14\u7ec3');
  assert.equal(plan.statusLabel('blocked'), '\u6570\u636e\u963b\u65ad');
  assert.equal(plan.safePayload({ schema_version: 'short-term-trade-plan-v1', research_only: true, no_trade: true, plans: [] }).schema_version, 'short-term-trade-plan-v1');
  assert.equal(plan.safePayload({ schema_version: 'short-term-trade-plan-v1.1', research_only: true, no_trade: true, plans: [] }).schema_version, 'short-term-trade-plan-v1.1');
  assert.equal(plan.safePayload({ schema_version: 'short-term-trade-plan-v1.2', research_only: true, no_trade: true, plans: [] }).schema_version, 'short-term-trade-plan-v1.2');
  assert.equal(plan.safePayload({ schema_version: 'short-term-trade-plan-v1.3', research_only: true, no_trade: true, plans: [] }).schema_version, 'short-term-trade-plan-v1.3');
  assert.equal(plan.safePayload({ schema_version: 'short-term-trade-plan-v2', research_only: true, no_trade: true, plans: [] }), null);
});

test('three-strategy labels remain conditional and never imply calibrated prediction', () => {
  assert.equal(plan.strategyStatusLabel({ status: 'historical_edge_failed' }), '已触发但历史优势未通过');
  assert.equal(plan.strategyStatusLabel({ status: 'waiting' }), '等待全部条件触发');
  assert.equal(plan.statusLabel('historical_review'), '历史 OOS 已通过，可人工研究');
  assert.equal(plan.statusLabel('historical_watch'), '历史 OOS 初步为正，仅供观察');
  const memory = new Map();
  global.localStorage = { getItem: key => memory.has(key) ? memory.get(key) : null, setItem: (key, value) => memory.set(key, value) };
  plan.saveSelection('tsm', 'oneil_volume_breakout');
  assert.equal(plan.loadSelections().TSM, 'oneil_volume_breakout');
  delete global.localStorage;
});

test('historical screen eligibility remains visibly separate from the research grade', () => {
  assert.equal(plan.eligibilityLabel({ research_eligibility: { mode: 'historical_screen_override', research_grade: 'C_SCREEN' } }), '历史 OOS 候选通道（原研究等级 C_SCREEN）');
  assert.equal(plan.eligibilityLabel({ research_eligibility: { mode: 'research_grade', research_grade: 'B_WATCH' } }), '研究等级门禁（B_WATCH）');
  assert.equal(plan.eligibilityLabel({}), '尚未满足短线筛选资格');
  assert.equal(plan.reasonLabel('valuation_gate_not_eligible'), '估值／预期门禁未通过，暂不进入短线候选');
});

test('strategy condition values use readable financial units', () => {
  assert.equal(plan.conditionValue({ code: 'relative_return_20', current: 0.03456 }), '3.46%');
  assert.equal(plan.conditionValue({ code: 'volume_ratio', current: 1.234 }), '1.23x');
  assert.equal(plan.conditionValue({ code: 'close_above_sma20', current: 123.456 }), '123.46');
  assert.equal(plan.conditionValue({ code: 'market_regime', current: 'green' }), 'green');
});

test('v1.2 style labels and yellow-regime sizing remain research-only', () => {
  assert.equal(plan.modelLabel('vcp_darvas_breakout'), 'VCP / 箱体放量突破');
  assert.equal(plan.reasonLabel('trend_template_failed'), '趋势模板尚未通过');
  const full = plan.calculatePositionSize(100000, 10000, 100, 95, config, 0, 1);
  const half = plan.calculatePositionSize(100000, 10000, 100, 95, config, 0, .5);
  assert.equal(half.risk_budget, full.risk_budget / 2);
  assert.ok(half.shares <= full.shares);
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

test('short-term status labels never imply a research grade', () => {
  assert.equal(plan.statusLabel('waiting_breakout'), '等待突破');
  assert.equal(plan.statusLabel('event_blocked'), '财报风险阻断');
  assert.equal(plan.statusLabel('manual_review_ready'), '条件满足，待人工确认');
});

test('blocked plans expose one prioritized Chinese reason', () => {
  const blocked = { status: 'blocked', reason_codes: ['TSM:rows_missing', 'common_trading_date_alignment_insufficient', 'short_term_daily_bars_unavailable'] };
  assert.equal(plan.planSummary(blocked), '主要阻断：缺少经过验证的日线 OHLCV 数据');
  assert.deepEqual(plan.prioritizedReasons(blocked), ['short_term_daily_bars_unavailable', 'TSM:rows_missing', 'common_trading_date_alignment_insufficient']);
  assert.equal(plan.reasonLabel('TSM:rows_missing'), 'TSM 日线数据缺失');
  assert.equal(plan.planSummary({ status: 'waiting_breakout', reason_codes: ['event_date_unknown', 'no_trigger'] }), '当前条件：尚未满足突破或回踩条件');
});
