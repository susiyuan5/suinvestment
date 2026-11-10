'use strict';
// Research only: compares index drawdown ladder rules. Never writes live config or places orders.
// Part 1 replays the Crash Fund sleeve alone on SPY/QQQ since 1999 (own small simulator).
// Part 2 reruns the live multi-asset backtest (base_reserve_v4) with alternative step ladders.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const D = require('../dca-policy');
const M = require('../market-analysis');
const Backtest = require('./weekly-dca-backtest');
const ROOT = path.join(__dirname, '..');
const WEIGHTS = { SPY: 0.8, QQQ: 0.2 }, MONTHLY = 100, CAP_MONTHS = 3;
const tiers = rows => rows.map(([min, factor, weekly, access]) => ({ min, factor, weekly, access: access ?? 1 }));
const STEP = [[10, 0.5, 0.25], [20, 1, 0.25], [35, 1, 0.5]];
// interp: release factor rises linearly between the listed points; access: share of the carried reserve a tier may use.
const SLEEVE_VARIANTS = {
  no_reserve_dca: { none: true },
  current: { tiers: tiers(STEP) },
  active_split: { tiers: tiers(STEP), split: 'active' },
  smooth10: { tiers: tiers(STEP), interp: [[10, 0.5], [20, 1]] },
  tier5: { tiers: tiers([[5, 0.25, 0.25], ...STEP]) },
  tier5_smooth: { tiers: tiers([[5, 0.25, 0.25], ...STEP]), interp: [[5, 0.25], [10, 0.5], [20, 1]] },
  fast20: { tiers: tiers([[10, 0.5, 0.25], [20, 1, 0.5], [35, 1, 0.5]]) },
  all100_from10: { tiers: tiers([[10, 1, 0.25], [35, 1, 0.5]]) },
  hold_for_deep_0_50_100: { tiers: tiers([[10, 0.5, 0.25, 0], [20, 1, 0.25, 0.5], [35, 1, 0.5, 1]]) },
  hold_for_deep_33_67_100: { tiers: tiers([[10, 0.5, 0.25, 1 / 3], [20, 1, 0.25, 2 / 3], [35, 1, 0.5, 1]]) }
};
const WINDOWS = [['1999-03-10'], ['2000-03-01'], ['2003-01-01'], ['2007-10-01'], ['2010-01-01'], ['2015-01-01'], ['2020-01-01'], ['2022-01-01'],
  ['2000-03-01', '2003-12-31'], ['2007-10-01', '2010-12-31'], ['2020-01-01', '2021-06-30'], ['2022-01-01', '2023-12-31'], ['2025-01-01']];

function prepare(payload) {
  const data = {}, index = {};
  for (const symbol of Object.keys(WEIGHTS)) {
    data[symbol] = payload.symbols[symbol].map(([date, close, adjOpen, adjClose]) => ({ date, close, adjOpen, adjClose }));
    index[symbol] = Object.fromEntries(data[symbol].map((row, i) => [row.date, i]));
  }
  const dates = data.QQQ.map(row => row.date).filter(date => index.SPY[date] != null);
  // Same convention as the live plan: buy at the first session from Tuesday on, decide on the prior close.
  const events = [], seen = new Set();
  for (let i = 1; i < dates.length; i++) {
    const day = new Date(dates[i] + 'T00:00:00Z').getUTCDay(), week = D.isoWeekId(dates[i]);
    if (day >= 2 && day <= 5 && !seen.has(week)) { seen.add(week); events.push({ date: dates[i], signal: dates[i - 1] }); }
  }
  const drawdown = (symbol, date) => {
    const rows = data[symbol], end = index[symbol][date], closes = [];
    let week = null;
    for (let i = Math.max(0, end - 400); i <= end; i++) {
      const id = D.isoWeekId(rows[i].date);
      if (id === week) closes[closes.length - 1] = rows[i].close; else { closes.push(rows[i].close); week = id; }
    }
    return M.recentDrawdown(closes, 52);
  };
  return { data, index, events, drawdown };
}
function factorOf(variant, tier, dd) {
  if (!variant.interp) return tier.factor;
  const points = variant.interp, i = points.findLastIndex(point => dd >= point[0]);
  if (i < 0) return 0;
  if (i === points.length - 1) return points[i][1];
  return points[i][1] + (points[i + 1][1] - points[i][1]) * (dd - points[i][0]) / (points[i + 1][0] - points[i][0]);
}
function sleeve(market, variant, start, end) {
  const { data, index, drawdown } = market, events = market.events.filter(event => event.date >= start && (!end || event.date <= end));
  const perMonth = {}, holdings = { SPY: 0, QQQ: 0 };
  events.forEach(event => { const month = event.date.slice(0, 7); perMonth[month] = (perMonth[month] || 0) + 1; });
  let carried = 0, used = 0, pool = MONTHLY, month = '', overflow = 0, cash = 0, deposits = 0, ladderSpent = 0, ladderDepth = 0;
  const buy = (symbol, amount, date) => { if (amount > 0) { holdings[symbol] += amount / data[symbol][index[symbol][date]].adjOpen; cash -= amount; } };
  for (const event of events) {
    const current = event.date.slice(0, 7);
    if (current !== month) {
      if (month) { const unused = Math.max(0, pool - used); carried = Math.min(MONTHLY * CAP_MONTHS, unused); overflow = unused - carried; }
      month = current; pool = MONTHLY + carried; used = 0; cash += MONTHLY; deposits += MONTHLY;
    }
    const weeks = perMonth[current];
    if (variant.none) { for (const symbol in WEIGHTS) buy(symbol, MONTHLY / weeks * WEIGHTS[symbol], event.date); used += MONTHLY / weeks; continue; }
    // Reserve above the cap joins the normal weekly contribution.
    for (const symbol in WEIGHTS) buy(symbol, overflow / weeks * WEIGHTS[symbol], event.date);
    const active = Object.keys(WEIGHTS).map(symbol => {
      const dd = drawdown(symbol, event.signal), tier = variant.tiers.findLast(candidate => dd >= candidate.min);
      return { symbol, dd, tier };
    }).filter(row => row.tier);
    if (!active.length) continue;
    const release = Math.max(0.25, ...active.map(row => row.tier.weekly));
    const usable = MONTHLY + carried * Math.max(...active.map(row => row.tier.access));
    const limit = Math.max(0, Math.min(usable - used, usable * release));
    const denominator = variant.split === 'active' ? active.reduce((total, row) => total + WEIGHTS[row.symbol], 0) : 1;
    for (const row of active) {
      const claim = Math.floor(limit * factorOf(variant, row.tier, row.dd) * WEIGHTS[row.symbol] / denominator * 100) / 100;
      buy(row.symbol, claim, event.date); used += claim; ladderSpent += claim; ladderDepth += claim * row.dd;
    }
  }
  const last = events.at(-1).date;
  const value = cash + Object.keys(WEIGHTS).reduce((total, symbol) => total + holdings[symbol] * data[symbol][index[symbol][last]].adjClose, 0);
  return { finalValue: Math.round(value * 100) / 100, deposits, ladderSpent: Math.round(ladderSpent), averageDrawdownAtPurchase: ladderSpent ? Math.round(ladderDepth / ladderSpent * 10) / 10 : null };
}
function sleeveStudy(payload) {
  const market = prepare(payload), results = {};
  for (const [name, variant] of Object.entries(SLEEVE_VARIANTS)) results[name] = WINDOWS.map(([start, end]) => ({ start, end: end || null, ...sleeve(market, variant, start, end) }));
  const table = Object.fromEntries(Object.entries(results).map(([name, rows]) => {
    const versusCurrentPct = rows.map((row, i) => Math.round((row.finalValue / results.current[i].finalValue - 1) * 10000) / 100);
    return [name, { versusCurrentPct, windowsAhead: versusCurrentPct.filter(value => value > 0.005).length, worstPct: Math.min(...versusCurrentPct),
      ladderSpent: rows[0].ladderSpent, averageDrawdownAtPurchase: rows[0].averageDrawdownAtPurchase }];
  }));
  return { windows: WINDOWS.map(([start, end]) => ({ start, end: end || null })), table, results };
}
function multiAssetStudy(raw) {
  const live = JSON.parse(JSON.stringify(D.getL2Config()));
  const config = (rows, cap = live.crashFund.reserveCapMonths) => ({ ...live, crashFund: { ...live.crashFund, reserveCapMonths: cap },
    indexDrawdownLadder: { ...live.indexDrawdownLadder, tiers: rows.map(([minDrawdownPct, crashReleaseFactor, weeklyReleasePct]) => ({ minDrawdownPct, crashReleaseFactor, weeklyReleasePct })) } });
  const variants = { current: config(STEP), tier5: config([[5, 0.25, 0.25], ...STEP]), fast20: config([[10, 0.5, 0.25], [20, 1, 0.5], [35, 1, 0.5]]),
    all100_from10: config([[10, 1, 0.25], [35, 1, 0.5]]), reserve_cap_0: config(STEP, 0), reserve_cap_1: config(STEP, 1), reserve_cap_2: config(STEP, 2), reserve_cap_6: config(STEP, 6) };
  const starts = ['2022-06-01', '2023-01-01', '2024-01-01', '2025-01-01'];
  return { strategy: 'base_reserve_v4 with the listed ladder / reserve cap', starts, table: Object.fromEntries(Object.entries(variants).map(([name, value]) => [name, starts.map(start => {
    const summary = Backtest.run(JSON.parse(raw), { start, config: value, strategyNames: ['base_reserve_v4'] }).summaries.base_reserve_v4;
    return { xirrPct: Math.round(summary.xirr * 10000) / 100, maxDrawdownPct: Math.round(summary.maxDrawdown * 10000) / 100, finalValue: summary.finalValue };
  })])) };
}
if (require.main === module) {
  const longRaw = fs.readFileSync(path.join(ROOT, 'data/v2/index-ladder-long-history.json'));
  const multiRaw = fs.readFileSync(path.join(ROOT, 'data/v2/backtest-adjusted-daily.json'), 'utf8');
  const output = path.join(ROOT, 'results/index_ladder_research');
  const summary = { researchOnly: true, promotionAllowed: false,
    assumptions: { sleeve: MONTHLY + ' Crash Fund per month, reserve cap ' + CAP_MONTHS + ' months, overflow invested as normal weekly contribution, SPY/QQQ ' + WEIGHTS.SPY + '/' + WEIGHTS.QQQ + ', no costs, 52-week drawdown on weekly raw closes',
      selection: 'overlapping windows are not independent evidence' },
    provenance: { longHistoryHash: crypto.createHash('sha256').update(longRaw).digest('hex'), multiAssetHash: crypto.createHash('sha256').update(multiRaw).digest('hex') },
    sleeve: sleeveStudy(JSON.parse(longRaw)), multiAsset: multiAssetStudy(multiRaw) };
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  for (const [name, row] of Object.entries(summary.sleeve.table)) console.log(name.padEnd(26), row.versusCurrentPct.map(value => value.toFixed(2).padStart(7)).join(''), ' ahead', row.windowsAhead, 'worst', row.worstPct);
  for (const [name, rows] of Object.entries(summary.multiAsset.table)) console.log(name.padEnd(26), rows.map(row => (row.xirrPct.toFixed(2) + '/' + row.maxDrawdownPct.toFixed(1)).padStart(13)).join(''));
}
module.exports = { sleeveStudy, multiAssetStudy, SLEEVE_VARIANTS };
