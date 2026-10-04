const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const indicator = require('../take-profit-indicator.js');
const parity = require('./fixtures/take-profit-parity.json');

function closeTo(actual, expected, label = '') {
  assert.equal(typeof actual, 'number', label);
  assert.ok(Number.isFinite(actual), label);
  assert.ok(Math.abs(actual - expected) <= 1e-11 * Math.max(1, Math.abs(expected)), `${label}: ${actual} != ${expected}`);
}

function equivalent(actual, expected, label = '') {
  if (typeof expected === 'number') return closeTo(actual, expected, label);
  if (Array.isArray(expected)) {
    assert.equal(actual.length, expected.length, label);
    return expected.forEach((value, index) => equivalent(actual[index], value, `${label}[${index}]`));
  }
  if (expected && typeof expected === 'object') {
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), label);
    return Object.keys(expected).forEach((key) => equivalent(actual[key], expected[key], `${label}.${key}`));
  }
  assert.equal(actual, expected, label);
}

function dateFor(index) {
  return new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10);
}

function rawBar(index, close, factor = 1, range = 1) {
  return { date: dateFor(index), open: close, high: close + range, low: close - range, close, adjusted_close: close * factor };
}

function positionRows(closes, factors = []) {
  return Array.from({ length: 14 }, (_, index) => rawBar(index, 100, factors[index] || 1, 2))
    .concat(closes.map((close, index) => rawBar(index + 14, close, factors[index + 14] || 1)));
}

function evaluate(rows, options = {}) {
  return indicator.evaluatePosition({ rows, entryDate: dateFor(14), entryPrice: 100, expectedSession: rows.at(-1).date, ...options });
}

test('Python-generated fixture records the actual source and matches every state', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', parity.source), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(crypto.createHash('sha256').update(source).digest('hex'), parity.sourceSha256);
  assert.equal(parity.version, 'take-profit-v1');
  assert.equal(parity.states.length, 4);
  for (const fixture of parity.states) {
    let state = indicator.newPosition(fixture.entryPrice, fixture.entryATR, { parameters: fixture.parameters, entryDate: fixture.entryDate });
    fixture.closes.forEach((close, index) => {
      state = indicator.updateTakeProfit(state, close, fixture.atrs[index], { date: fixture.dates[index] });
      equivalent(state, fixture.states[index], fixture.name + '[' + index + ']');
    });
  }
});

test('normalized adjusted OHLC and the full ATR14 series match actual Python output', () => {
  for (const fixture of parity.barCases) {
    const bars = indicator.normalizeAdjustedBars(fixture.rows);
    equivalent(bars, fixture.normalized, 'adjusted bars');
    equivalent(indicator.wilderATR(bars, fixture.period), fixture.atr, 'ATR14');
  }
});

test('Wilder seed and gaps match independently calculated arithmetic', () => {
  const bars = [
    { date: dateFor(0), open: 100, high: 102, low: 98, close: 100 },
    { date: dateFor(1), open: 106, high: 108, low: 104, close: 106 },
    { date: dateFor(2), open: 94, high: 96, low: 92, close: 94 },
    { date: dateFor(3), open: 95, high: 99, low: 93, close: 98 },
  ];
  const atr = indicator.wilderATR(bars, 3);
  assert.deepEqual(atr.slice(0, 2), [null, null]);
  closeTo(atr[2], (4 + 8 + 14) / 3);
  closeTo(atr[3], (((4 + 8 + 14) / 3) * 2 + 6) / 3);
  const fourteen = Array.from({ length: 14 }, (_, index) => rawBar(index, 100, 1, 2));
  const full = indicator.wilderATR(indicator.normalizeAdjustedBars(fourteen.concat(rawBar(14, 105, 1, 2))));
  assert.deepEqual(full.slice(0, 13), Array(13).fill(null));
  assert.equal(full[13], 4);
  closeTo(full[14], (4 * 13 + 7) / 14);
});

test('activation requires both the percent and entry ATR gains and stays latched', () => {
  for (const [entryATR, before, exact] of [[1, 104.99, 105], [4, 107.99, 108]]) {
    let state = indicator.updateTakeProfit(indicator.newPosition(100, entryATR), before, 1);
    assert.equal(state.active, false);
    assert.equal(state.line, null);
    state = indicator.updateTakeProfit(state, 50, 20);
    assert.equal(state.signal, false);
    state = indicator.updateTakeProfit(state, exact, 1);
    assert.equal(state.active, true);
    state = indicator.updateTakeProfit(state, exact - 1, 40);
    assert.equal(state.active, true);
  }
});

test('ATR expansion cannot lower the line and a new position explicitly resets it', () => {
  let state = indicator.updateTakeProfit(indicator.newPosition(100, 1), 120, 1);
  assert.equal(state.line, 117);
  for (const [close, atr] of [[119, 4], [125, 10], [121, 50]]) {
    const prior = state.line;
    state = indicator.updateTakeProfit(state, close, atr);
    assert.ok(state.line >= prior);
  }
  assert.equal(state.line, 117);
  const reset = indicator.newPosition(150, 3);
  assert.equal(reset.active, false);
  assert.equal(reset.line, null);
  assert.ok(Object.isFrozen(reset));
  assert.ok(Object.isFrozen(reset.parameters));
});

test('score is bounded drawdown to line, not a probability', () => {
  let state = indicator.updateTakeProfit(indicator.newPosition(100, 1), 120, 2);
  assert.equal(state.line, 114);
  assert.equal(state.score, 0);
  state = indicator.updateTakeProfit(state, 117, 2);
  assert.equal(state.score, 50);
  state = indicator.updateTakeProfit(state, 90, 15);
  assert.equal(state.score, 100);
  assert.equal(state.signal, true);
  assert.equal(state.line, 114);
});

test('strict adjustment aliases agree, full adjusted fields win and partial fields reject', () => {
  const raw = rawBar(0, 200, 0.5, 4);
  assert.deepEqual(indicator.normalizeAdjustedBars([raw])[0], { date: dateFor(0), open: 100, high: 102, low: 98, close: 100 });
  const adjustedAlias = { ...raw, adjusted: 100 };
  assert.deepEqual(indicator.normalizeAdjustedBars([adjustedAlias]), indicator.normalizeAdjustedBars([raw]));
  assert.throws(() => indicator.normalizeAdjustedBars([{ ...raw, adjusted: 99 }]));
  assert.throws(() => indicator.normalizeAdjustedBars([{ ...raw, adjusted_open: 100 }]));
  const full = { ...raw, adjusted_open: 100, adjusted_high: 102, adjusted_low: 98, adjusted_close: 100 };
  assert.deepEqual(indicator.normalizeAdjustedBars([full]), indicator.normalizeAdjustedBars([raw]));
  const missing = { ...raw }; delete missing.adjusted_close;
  assert.throws(() => indicator.normalizeAdjustedBars([missing]));
});

test('split normalization avoids a fabricated volatility spike', () => {
  const bars = indicator.normalizeAdjustedBars([rawBar(0, 200, 0.5, 4), rawBar(1, 100, 1, 2)]);
  assert.deepEqual(indicator.wilderATR(bars, 1), [4, 4]);
  assert.deepEqual(indicator.wilderATR([rawBar(0, 200, 1, 4), rawBar(1, 100, 1, 2)], 1), [8, 102]);
});

test('invalid dates, duplicate rows and invalid OHLC never normalize', () => {
  const valid = rawBar(0, 100);
  for (const invalid of [
    { ...valid, close: NaN }, { ...valid, open: Infinity },
    { ...valid, low: 0 }, { ...valid, high: 99 },
    { ...valid, open: true }, { ...valid, adjusted_close: null },
    { ...valid, date: '2026-02-30' }, { ...valid, date: '20260101' },
    { ...valid, date: '0000-01-01' }, { ...valid, close: [100] },
  ]) assert.throws(() => indicator.normalizeAdjustedBars([invalid]));
  assert.throws(() => indicator.normalizeAdjustedBars([valid, valid]));
  assert.throws(() => indicator.normalizeAdjustedBars([rawBar(1, 100), valid]));
});

test('parameters, position numbers and dated updates reject invalid inputs', () => {
  for (const parameters of [{ atrMultiple: 0 }, { activationPct: -1 }, { activationATR: Infinity }, { retainProfit: 0 }, { retainProfit: 1 }, { retainProfit: true }, { atr_multipler: 3 }]) assert.throws(() => indicator.newPosition(100, 1, { parameters }));
  for (const [cost, atr] of [[0, 1], [100, 0], [NaN, 2], [100, -1]]) assert.throws(() => indicator.newPosition(cost, atr));
  for (const period of [0, -1, 2.5, true]) assert.throws(() => indicator.wilderATR([], period));
  let state = indicator.newPosition(100, 1, { entryDate: dateFor(14) });
  state = indicator.updateTakeProfit(state, 101, 1, { date: dateFor(14) });
  for (const date of [dateFor(14), dateFor(13), null]) assert.throws(() => indicator.updateTakeProfit(state, 102, 1, { date }));
  assert.throws(() => indicator.updateTakeProfit(state, 102, -1, { date: dateFor(15) }));
  assert.throws(() => indicator.updateTakeProfit({ ...state, parameters: {} }, 102, 1, { date: dateFor(15) }));
  assert.throws(() => indicator.updateTakeProfit({ ...state, entryPrice: '100' }, 102, 1, { date: dateFor(15) }));
});

test('ATR and position updates are invariant to later bars', () => {
  const fixture = parity.barCases[0];
  const bars = indicator.normalizeAdjustedBars(fixture.rows);
  const full = indicator.wilderATR(bars);
  for (let length = 1; length <= bars.length; length++) assert.deepEqual(indicator.wilderATR(bars.slice(0, length)), full.slice(0, length));
  let prefix = indicator.newPosition(100, 2);
  const states = [];
  for (const close of [103, 106, 120, 117]) {
    prefix = indicator.updateTakeProfit(prefix, close, 2);
    states.push(prefix);
  }
  let short = indicator.newPosition(100, 2);
  for (const close of [103, 106]) short = indicator.updateTakeProfit(short, close, 2);
  assert.deepEqual(short, states[1]);
});

test('evaluator needs fourteen completed prior bars and uses prior ATR', () => {
  const rows = positionRows([110]);
  const result = evaluate(rows);
  assert.equal(result.status, 'active');
  assert.equal(result.entryATR, 4);
  assert.equal(result.activationPrice, 108);
  assert.equal(result.line, 105);
  assert.equal(result.currentPrice, 110);
  assert.equal(result.gainPct, 10);
  assert.equal(evaluate(rows, { entryDate: dateFor(13) }).reasonCode, 'insufficient_prior_bars');
});

test('inactive position has no stop or profit signal before gaining enough', () => {
  const result = evaluate(positionRows([107.99, 70]));
  assert.equal(result.status, 'inactive');
  assert.equal(result.line, null);
  assert.equal(result.score, null);
  assert.equal(result.signal, false);
  assert.equal(result.activationPrice, 108);
});

test('entry cost rather than entry close sets position profit reference', () => {
  const result = evaluate(positionRows([110]), { entryPrice: 150 });
  assert.equal(result.entryInputPrice, 150);
  assert.equal(result.costPrice, 150);
  assert.equal(result.peakPrice, 150);
  assert.equal(result.status, 'inactive');
  closeTo(result.gainPct, -100 * 40 / 150);
});

test('dividend-adjusted internal line and cost convert to latest raw USD coordinate', () => {
  const factors = Array(15).fill(0.9).concat(1);
  const result = evaluate(positionRows([110, 100], factors));
  assert.equal(result.status, 'active');
  assert.equal(result.entryInputPrice, 100);
  closeTo(result.entryFactor, 0.9);
  assert.equal(result.latestFactor, 1);
  assert.equal(result.costPrice, 90);
  assert.equal(result.currentPrice, 100);
  assert.equal(result.peakPrice, 100);
  assert.equal(result.line, 95);
  closeTo(result.activationPrice, 97.2);
  closeTo(result.gainPct, (100 / 90 - 1) * 100);
  assert.match(result.adjustmentExplanation, /股息/);
});

test('first historical trigger remains sticky and freezes line/peak after price recovery', () => {
  const rows = positionRows([110, 120, 110, 140]);
  const result = evaluate(rows);
  assert.equal(result.status, 'triggered');
  assert.equal(result.signalDate, dateFor(16));
  assert.equal(result.firstSignalDate, dateFor(16));
  assert.equal(result.lastDate, dateFor(17));
  assert.equal(result.historicalTrigger, true);
  assert.equal(result.peakPrice, 120);
  assert.equal(result.line, 110);
  assert.equal(result.score, 100);
  assert.equal(result.currentPrice, 140);
  assert.equal(result.gainPct, 40);
  const prefix = evaluate(rows.slice(0, -1));
  assert.equal(prefix.signalDate, result.signalDate);
  assert.equal(prefix.line, result.line);
  assert.equal(prefix.historicalTrigger, false);
});

test('gap below cost can trigger; positive reference line does not guarantee a gain', () => {
  const result = evaluate(positionRows([110, 120, 90]));
  assert.equal(result.status, 'triggered');
  assert.equal(result.line, 110);
  assert.equal(result.currentPrice, 90);
  assert.equal(result.gainPct, -10);
  assert.equal(result.noTrade, true);
  assert.equal(result.researchOnly, true);
});

test('evaluator blocks missing calendar, stale bars and all mixed future-bar snapshots', () => {
  const rows = positionRows([110, 120, 110, 200]);
  for (const [expectedSession, code] of [[null, 'expected_session_missing'], ['2026-02-30', 'expected_session_invalid'], [dateFor(18), 'stale_daily_bars'], [dateFor(16), 'future_daily_bars']]) {
    const result = evaluate(rows, { expectedSession });
    assert.equal(result.status, 'blocked');
    assert.equal(result.reasonCode, code);
    assert.equal(result.signal, false);
    assert.equal(result.line, null);
    assert.equal(result.score, null);
    assert.equal(result.signalDate, null);
  }
  assert.equal(evaluate(rows.slice(0, -1)).signalDate, dateFor(16));
});

test('future malformed rows are not silently filtered or used to choose a price basis', () => {
  const rows = positionRows([110, 120]);
  const future = { ...rawBar(16, 500), high: null };
  const result = evaluate([...rows, future], { expectedSession: rows.at(-1).date });
  assert.equal(result.status, 'blocked');
  assert.equal(result.reasonCode, 'invalid_daily_bars');
  assert.equal(result.currentPrice, null);
  assert.equal(result.line, null);
});

test('safe evaluator rejects invalid entry sessions, costs, adjustments and empty data', () => {
  const rows = positionRows([110]);
  const skipped = rows.filter((row) => row.date !== dateFor(14));
  for (const [overrides, code] of [
    [{ entryDate: null }, 'entry_date_missing'], [{ entryDate: '2026-02-30' }, 'entry_date_invalid'],
    [{ entryDate: dateFor(15) }, 'entry_date_after_expected_session'],
    [{ entryPrice: 0 }, 'invalid_entry_price'], [{ entryPrice: null }, 'invalid_entry_price'],
    [{ rows: [] }, 'rows_missing'],
  ]) {
    const result = evaluate(rows, overrides);
    assert.equal(result.status, 'blocked');
    assert.equal(result.reasonCode, code);
    assert.equal(result.signal, false);
    assert.equal(result.line, null);
  }
  const longer = positionRows([110, 111]);
  assert.equal(evaluate(longer.filter((row) => row.date !== dateFor(14))).reasonCode, 'entry_date_not_observed');
  assert.equal(indicator.evaluatePosition(null).status, 'blocked');
  const fullOnly = rows.map((row) => ({ date: row.date, adjusted_open: row.open, adjusted_high: row.high, adjusted_low: row.low, adjusted_close: row.close }));
  assert.equal(evaluate(fullOnly).reasonCode, 'invalid_adjustment_factor');
});

test('flat warmup ATR cannot initialize a position or expose a partial line', () => {
  const rows = Array.from({ length: 15 }, (_, index) => ({ date: dateFor(index), open: 100, high: 100, low: 100, close: 100, adjusted_close: 100 }));
  const result = evaluate(rows);
  assert.equal(result.status, 'blocked');
  assert.equal(result.reasonCode, 'invalid_position_calculation');
  assert.equal(result.line, null);
  assert.equal(result.signal, false);
});

test('UMD publishes the same pure API in a browser without CommonJS or network access', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'take-profit-indicator.js'), 'utf8'), context);
  assert.equal(typeof context.TakeProfitIndicator.evaluatePosition, 'function');
  assert.equal(typeof context.TakeProfitIndicator.wilderATR, 'function');
  assert.equal(context.TakeProfitIndicator.DEFAULT_PARAMETERS.atrMultiple, 3);
  assert.equal(context.TakeProfitIndicator.evaluatePosition().status, 'blocked');
});
