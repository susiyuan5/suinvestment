'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../index-ladder-view');

const tiers = [{ minDrawdownPct: 10, crashReleaseFactor: 0.5, weeklyReleasePct: 0.25 },
  { minDrawdownPct: 20, crashReleaseFactor: 1, weeklyReleasePct: 0.25 }, { minDrawdownPct: 35, crashReleaseFactor: 1, weeklyReleasePct: 0.5 }];
const ladder = rows => ({ weeklyReleasePct: 0.25, crashLimit: 100, tiers, rows });
const row = (symbol, drawdownPct, plannedCrash = 0, reasonCodes = []) => ({ symbol, drawdownPct, plannedCrash, reasonCodes, baseShare: 0.5 });

test('missing ladder hides the panel', () => {
  assert.equal(V.model({}).available, false);
  assert.equal(V.model({ ladder: { rows: [], tiers: [] } }).available, false);
});
test('below the first tier shows the distance and trigger price', () => {
  const view = V.model({ safe: true, prices: { SPY: 460 }, amounts: { SPY: 0 },
    ladder: ladder([row('SPY', 8, 0, ['INDEX_LADDER_BELOW_THRESHOLD'])]) });
  const spy = view.rows[0];
  assert.equal(spy.state, 'waiting');
  // 52-week high 500: the 10% threshold is 450, 2.2% below 460.
  assert.deepEqual([spy.next.minDrawdownPct, spy.next.moreDropPct, spy.next.triggerPrice], [10, 2.2, 450]);
  assert.match(spy.status, /−8\.0% · 未到 10% 档/);
  assert.match(spy.nextText, /再跌约 2\.2%（约 450\.00）开始加仓，领取本周额度的 50%/);
  assert.equal(view.weeklyLimit, 100);
});
test('active tiers show the funded amount and the next step', () => {
  const view = V.model({ safe: true, prices: {}, amounts: { SPY: 40, QQQ: 20 },
    ladder: ladder([row('SPY', 15, 40), row('QQQ', 25, 20), row('DEEP', 40, 0)]) });
  assert.deepEqual(view.rows.map(item => [item.state, item.tierMinDrawdownPct, item.amount]), [['active', 10, 40], ['active', 20, 20], ['active', 35, 0]]);
  assert.match(view.rows[0].nextText, /进入 20% 档，领取比例升到 100%/);
  assert.equal(view.rows[0].next.triggerPrice, null);
  assert.match(view.rows[1].nextText, /进入 35% 档，本周额度提高到暴跌备用金的 50%/);
  assert.equal(view.rows[2].nextText, '已在最深一档');
  assert.equal(view.total, 60);
});
test('blocks, cuts and a paused plan are explained and never show an amount the plan did not keep', () => {
  let view = V.model({ safe: true, amounts: { SPY: 0, QQQ: 5 },
    ladder: ladder([row('SPY', 30, 0, ['INDEX_LADDER_CONCENTRATION']), row('QQQ', 30, 20)]) });
  assert.equal(view.rows[0].state, 'blocked');
  assert.match(view.rows[0].note, /持仓占比已到上限/);
  assert.match(view.rows[1].note, /按规则可领 20\.00，已按现金上限或备用金余额削减/);
  view = V.model({ safe: false, amounts: { QQQ: 20 }, ladder: ladder([row('QQQ', 30, 20), row('SPY', null)]) });
  assert.equal(view.rows[0].amount, 0);
  assert.match(view.rows[0].note, /本周计划已暂停/);
  assert.deepEqual([view.rows[1].state, view.rows[1].markerPct, view.rows[1].next], ['unknown', null, null]);
});
