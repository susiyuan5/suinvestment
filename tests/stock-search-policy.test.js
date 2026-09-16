const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../stock-search-policy');

test('normalizes providers into one result shape and rejects unsupported securities', () => {
  const stock = S.normalize({ symbol: 'msft', longname: 'Microsoft', exchange: 'NMS', quoteType: 'EQUITY', currency: 'USD', regularMarketPrice: 420, regularMarketTime: 1700000000 }, 'Yahoo');
  assert.deepEqual({ symbol: stock.symbol, exchange: stock.canonicalExchange, type: stock.instrumentType, currency: stock.currency, price: stock.price }, { symbol: 'MSFT', exchange: 'NASDAQ', type: 'EQUITY', currency: 'USD', price: 420 });
  assert.equal(stock.eligibility, 'pending');
  assert.equal(S.normalize({ symbol: 'MSFT', exchange: 'NASDAQ NMS - GLOBAL MARKET', quoteType: 'EQUITY' }, 'Finnhub').canonicalExchange, 'NASDAQ');
  assert.equal(S.normalize({ symbol: 'SPY', quoteType: 'ETF' }, 'Yahoo').reasonCode, 'unsupported_type');
  assert.equal(S.normalize({ symbol: 'SHOP.TO', quoteType: 'EQUITY', currency: 'CAD' }, 'Yahoo').reasonCode, 'unsupported_currency');
  assert.equal(S.normalize({ symbol: 'ABCD', quoteType: 'EQUITY', currency: 'USD', exchange: 'PNK' }, 'Yahoo').reasonCode, 'unsupported_exchange');
});

test('merges duplicate providers and ranks exact symbol, prefix and names deterministically', () => {
  const rows = S.mergeAndRank([
    [S.normalize({ symbol: 'META', name: 'Meta Platforms' }, 'Local'), S.normalize({ symbol: 'MSFT', name: 'Microsoft' }, 'Local')],
    [S.normalize({ symbol: 'MSFT', longname: 'Microsoft Corporation', exchange: 'NMS', quoteType: 'EQUITY', currency: 'USD', regularMarketPrice: 400 }, 'Yahoo')]
  ], 'MSFT');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].symbol, 'MSFT');
  assert.equal(rows[0].price, 400);
  assert.equal(rows[0].canonicalExchange, 'NASDAQ');
  assert.deepEqual(S.localResults('微软').map(row => row.symbol), ['MSFT']);
  assert.deepEqual(S.localResults('特斯拉').map(row => row.symbol), ['TSLA']);
});

test('final validation requires USD equity, supported exchange, price and trusted freshness', () => {
  const candidate = S.normalize({ symbol: 'MSFT', name: 'Microsoft' }, 'Local');
  const quote = { exchange: 'NMS', instrumentType: 'EQUITY', currency: 'USD', price: 420, quoteTimestamp: '2026-09-15T20:00:00Z', source: 'Yahoo' };
  assert.equal(S.validate(candidate, quote, 'validated').eligibility, 'eligible');
  assert.match(S.validate(candidate, quote, 'market_closed_last_close').reasonText, /休市/);
  assert.equal(S.validate(candidate, quote, 'stale').reasonCode, 'stale_quote');
  assert.equal(S.validate(candidate, { ...quote, price: 0 }, 'validated').reasonCode, 'missing_price');
  assert.equal(S.validate(candidate, { ...quote, currency: 'CAD' }, 'validated').reasonCode, 'unsupported_currency');
  assert.equal(S.validate(candidate, { ...quote, instrumentType: 'ETF' }, 'validated').reasonCode, 'unsupported_type');
});

test('recent additions are versioned, deduplicated and capped at five without queries', () => {
  let recent = null;
  for (let i = 0; i < 7; i++) recent = S.addRecent(recent, { symbol: 'T' + i, name: 'Test ' + i, exchange: 'NASDAQ' }, Date.UTC(2026, 8, i + 1));
  recent = S.addRecent(recent, { symbol: 'T4', name: 'Updated', exchange: 'NYSE' }, Date.UTC(2026, 8, 9));
  assert.equal(recent.version, S.VERSION);
  assert.equal(recent.items.length, 5);
  assert.equal(recent.items[0].symbol, 'T4');
  assert.equal(recent.items[0].name, 'Updated');
  assert.equal(S.normalizeRecent(recent).length, 5);
  assert.deepEqual(S.normalizeRecent({ version: 'other', items: recent.items }), []);
});
