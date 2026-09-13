const test = require('node:test');
const assert = require('node:assert/strict');
const { isWeekendClose } = require('../market-data');
test('weekend accepts latest Friday close, not an older or intraday quote', () => {
  const now = Date.parse('2026-09-13T18:00:00Z');
  assert.equal(isWeekendClose(Date.parse('2026-09-11T20:00:00Z'), now), true);
  for (const quote of ['2026-09-10T20:00:00Z', '2026-09-11T13:30:00Z', '2026-09-14T20:00:00Z']) assert.equal(isWeekendClose(Date.parse(quote), now), false);
  assert.equal(isWeekendClose(Date.parse('2026-09-11T20:00:00Z'), Date.parse('2026-09-14T18:00:00Z')), false);
});
test('weekend uses New York day and daylight saving time', () => {
  assert.equal(isWeekendClose(Date.parse('2026-01-09T21:00:00Z'), Date.parse('2026-01-11T18:00:00Z')), true);
  assert.equal(isWeekendClose(Date.parse('2026-09-11T20:00:00Z'), Date.parse('2026-09-12T02:00:00Z')), false);
  assert.equal(isWeekendClose(NaN), false);
});
