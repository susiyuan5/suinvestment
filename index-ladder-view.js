(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.IndexLadderView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Display model for the index drawdown ladder. Reads the plan the engine
  // already produced; it never changes an amount or a rule.
  const BLOCKS = [
    ['INDEX_LADDER_DATA_BLOCKED', '数据缺失或过期，本周不加仓'],
    ['INDEX_LADDER_MANUAL_BLOCK', '人工暂停或恐慌开关已开启，本周不加仓'],
    ['INDEX_LADDER_HOLDINGS_UNKNOWN', '完整持仓未知，无法确认占比，本周不加仓'],
    ['INDEX_LADDER_CONCENTRATION', '持仓占比已到上限，本周不加仓'],
    ['INDEX_LADDER_NO_BASE', '本周没有基础定投金额，不加仓']
  ];
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;
  const pct = value => round(value, 1).toFixed(1) + '%';
  const share = value => Math.round(value * 100) + '%';

  function model(input) {
    const ladder = input && input.ladder;
    if (!ladder || !Array.isArray(ladder.rows) || !Array.isArray(ladder.tiers) || !ladder.tiers.length) return { available: false, rows: [], tiers: [] };
    const tiers = ladder.tiers.slice().sort((a, b) => a.minDrawdownPct - b.minDrawdownPct);
    const safe = input.safe === true, amounts = input.amounts || {}, prices = input.prices || {};
    const scaleMax = Math.max(tiers.at(-1).minDrawdownPct * 1.2, 1);
    const position = value => round(Math.max(0, Math.min(100, value / scaleMax * 100)), 1);
    const rows = ladder.rows.map(row => {
      const dd = finite(row.drawdownPct) ? row.drawdownPct : null;
      const price = finite(prices[row.symbol]) && prices[row.symbol] > 0 ? prices[row.symbol] : null;
      const tier = tiers.findLast(candidate => dd !== null && dd >= candidate.minDrawdownPct) || null;
      const next = dd === null ? null : tiers.find(candidate => candidate.minDrawdownPct > dd) || null;
      const block = BLOCKS.find(entry => (row.reasonCodes || []).includes(entry[0]));
      const amount = safe && finite(amounts[row.symbol]) ? amounts[row.symbol] : 0;
      const claim = finite(row.plannedCrash) ? row.plannedCrash : 0;
      const state = dd === null ? 'unknown' : block ? 'blocked' : tier ? 'active' : 'waiting';
      let nextStep = null;
      if (next && dd < 100) {
        // Further fall from today's price that takes the 52-week drawdown to the next threshold.
        const moreDropPct = (1 - (1 - next.minDrawdownPct / 100) / (1 - dd / 100)) * 100;
        nextStep = { minDrawdownPct: next.minDrawdownPct, releaseFactor: next.crashReleaseFactor, weeklyReleasePct: next.weeklyReleasePct,
          moreDropPct: round(moreDropPct, 1), triggerPrice: price === null ? null : round(price * (1 - moreDropPct / 100), 2) };
      }
      const status = dd === null ? '回撤数据暂缺'
        : '离 52 周高点 −' + pct(dd) + ' · ' + (tier ? tier.minDrawdownPct + '% 档，领取本周额度的 ' + share(tier.crashReleaseFactor) : '未到 ' + tiers[0].minDrawdownPct + '% 档');
      let nextText = '';
      if (nextStep) {
        const where = '再跌约 ' + pct(nextStep.moreDropPct) + (nextStep.triggerPrice === null ? '' : '（约 ' + nextStep.triggerPrice.toFixed(2) + '）');
        const sameShare = tier && nextStep.releaseFactor === tier.crashReleaseFactor;
        nextText = !tier ? where + '开始加仓，领取本周额度的 ' + share(nextStep.releaseFactor)
          : where + '进入 ' + nextStep.minDrawdownPct + '% 档，' + (sameShare
            ? '本周额度提高到暴跌备用金的 ' + share(nextStep.weeklyReleasePct) : '领取比例升到 ' + share(nextStep.releaseFactor));
      } else if (tier) nextText = '已在最深一档';
      let note = block ? block[1] : '';
      if (!note && !safe && tier) note = '本周计划已暂停，金额按 0 显示';
      else if (!note && tier && amount + 0.005 < claim) note = '按规则可领 ' + claim.toFixed(2) + '，已按现金上限或备用金余额削减';
      else if (!note && tier && finite(row.baseShare) && row.baseShare < 1) note = '按基础定投占比分得额度的 ' + share(row.baseShare);
      return { symbol: row.symbol, state, drawdownPct: dd, tierMinDrawdownPct: tier ? tier.minDrawdownPct : null,
        releaseFactor: tier ? tier.crashReleaseFactor : 0, baseShare: finite(row.baseShare) ? row.baseShare : null,
        amount, claim, next: nextStep, status, nextText, note, markerPct: dd === null ? null : position(dd) };
    });
    return { available: true, safe, rows, weeklyLimit: finite(ladder.crashLimit) ? ladder.crashLimit : 0,
      weeklyReleasePct: finite(ladder.weeklyReleasePct) ? ladder.weeklyReleasePct : null,
      total: round(rows.reduce((sum, row) => sum + row.amount, 0), 2),
      tiers: tiers.map(tier => ({ minDrawdownPct: tier.minDrawdownPct, releaseFactor: tier.crashReleaseFactor,
        weeklyReleasePct: tier.weeklyReleasePct, markerPct: position(tier.minDrawdownPct) })) };
  }
  return Object.freeze({ model });
});
