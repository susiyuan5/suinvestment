const test = require('node:test');
const assert = require('node:assert/strict');
const bars = require('../short-term-daily-bars.js');

test('missing volume is a hard data failure', () => {
  const result = bars.validateRows([{ date: '2026-01-02', open: 1, high: 2, low: 0.5, close: 1.5, adjusted: 1.5 }], 1);
  assert.ok(result.errors.includes('row_0_ohlcv_missing'));
});

test('unavailable snapshot cannot pass validation', () => {
  const result = bars.validateSnapshot({ schema_version: 'short-term-daily-bars-v1', research_only: true, frequency: '1d', adjustment: 'split_and_dividend_adjusted', symbols: {} }, ['AAPL']);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('rows_missing')));
});
