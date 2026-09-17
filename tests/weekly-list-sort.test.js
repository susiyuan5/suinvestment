const test = require('node:test');
const assert = require('node:assert/strict');
const Sort = require('../weekly-list-sort');

const rows = [
  { symbol: 'SPY', suggested: 20, target: 40, current: 30, marketValue: 300, price: 500 },
  { symbol: 'AAPL', suggested: 5, target: 20, current: 10, marketValue: 100, price: 200 },
  { symbol: 'JOBY', suggested: 5, target: 5, current: 0, marketValue: undefined, price: 6 },
];

test('default is suggested amount descending with symbol tie break', () => {
  assert.deepEqual(Sort.rows(rows, null).map(row => row.symbol), ['SPY', 'AAPL', 'JOBY']);
});

test('all sort fields and directions are stable and missing values stay last', () => {
  assert.deepEqual(Sort.rows(rows, { version: 1, field: 'price', direction: 'asc' }).map(row => row.symbol), ['JOBY', 'AAPL', 'SPY']);
  assert.deepEqual(Sort.rows(rows, { version: 1, field: 'marketValue', direction: 'desc' }).map(row => row.symbol), ['SPY', 'AAPL', 'JOBY']);
  assert.deepEqual(Sort.rows(rows, { version: 1, field: 'symbol', direction: 'desc' }).map(row => row.symbol), ['SPY', 'JOBY', 'AAPL']);
});

test('invalid persisted preferences fall back safely', () => {
  assert.deepEqual(Sort.normalize({ version: 9, field: 'unknown', direction: 'sideways' }), Sort.DEFAULT);
});
