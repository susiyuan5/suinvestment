'use strict';
// Isolated research runner. Never writes a live snapshot or places orders.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const W = require('../weekly-dca-engine');
const D = require('../dca-policy');
const C = require('../core-satellite-policy');
const M = require('../market-analysis');
const S = require('../signal-engine');
const Model = require('../weekly-signal-model');
const Metrics = require('../performance-metrics');
const DAY = 86400000;
const iso = ms => new Date(ms).toISOString().slice(0, 10);
const sum = values => values.reduce((a, b) => a + b, 0);
function weeklyRows(rows, date) {
  const weeks = new Map();
  for (const row of rows) {
    if (row.date > date) break;
    weeks.set(D.isoWeekId(row.date), { date: row.date, close: row.close ?? row.adjusted_close });
  }
  return [...weeks.values()];
}
function signal(rows, weekly, date, regime) {
  const daily = rows.filter(row => row.date <= date).map(row => row.close ?? row.adjusted_close);
  const moves = S.marketSignals(daily);
  const algorithm = Model.calculateEnhancedLowFrequencyMultiplier(weekly, moves.decisionChange, moves.dailyChange, moves.weeklyChange, regime);
  const value = { decision_change: moves.decisionChange, daily_change: moves.dailyChange, weekly_change: moves.weeklyChange,
    multiplier: algorithm.multiplier, algorithm, data_source: 'Historical adjusted prices', data_freshness: 'fresh', panic_active: false };
  value.signal_score = S.score({ decisionChange: value.decision_change, weeklyChange: value.weekly_change,
    dailyChange: value.daily_change, multiplier: value.multiplier, algorithm, dataAgeHours: 0, dataSource: value.data_source }, Model.ALGORITHM_PARAMS);
  value.risk_level = Model.calculateRiskLevel(value);
  value.suggested_action = Model.getSuggestedAction(value);
  value.actionBlocked = Model.getActionLabelFromMultiplier(value).cls === 'action-pause-buy' || ['HOLD', 'DO_NOT_BUY'].includes(value.suggested_action);
  return value;
}
function run(payload, options = {}) {
  const config = JSON.parse(JSON.stringify(D.getL2Config()));
  const preset = options.preset || C.PRESET, assets = C.rowsForPreset(preset), symbols = assets.map(x => x.symbol);
  const commissionBps = options.commissionBps ?? 10, slippageBps = options.slippageBps ?? 5;
  if (![commissionBps, slippageBps].every(x => Number.isFinite(x) && x >= 0)) throw new Error('Invalid costs');
  const all = {}, lookup = {};
  for (const symbol of symbols) {
    const rows = payload.symbols[symbol];
    if (!Array.isArray(rows) || !rows.length) throw new Error('Missing required symbol: ' + symbol);
    all[symbol] = rows.filter(row => !options.asOf || row.date <= options.asOf).slice().sort((a, b) => a.date.localeCompare(b.date));
    lookup[symbol] = Object.fromEntries(all[symbol].map(row => [row.date, row]));
    if (Object.keys(lookup[symbol]).length !== all[symbol].length) throw new Error('Duplicate dates: ' + symbol);
    if (all[symbol].some(row => !(row.adjusted_close > 0) || !Number.isFinite(row.adjusted_close))) throw new Error('Invalid adjusted close: ' + symbol);
  }
  const calendar = all.QQQ.map(row => row.date);
  const start = options.start || calendar[0];
  const dates = calendar.filter(date => date >= start);
  if (!dates.length) throw new Error('No dates in selected interval');
  // QQQ supplies a trading calendar. Missing asset bars are errors, not fabricated holidays.
  for (const date of dates) for (const symbol of symbols) if (!lookup[symbol][date]) throw new Error('Missing valuation bar: ' + symbol + ' ' + date);
  const events = new Map(), issues = [];
  let cursor = Date.parse(dates[0]);
  cursor += (2 - new Date(cursor).getUTCDay() + 7) % 7 * DAY;
  for (; cursor <= Date.parse(dates.at(-1)); cursor += 7 * DAY) {
    const plannedDate = iso(cursor);
    const execution = dates.find(date => date >= plannedDate && date <= iso(cursor + 3 * DAY));
    if (!execution) { issues.push({ plannedDate, reason: 'no_trading_day_this_week' }); continue; }
    const signalDate = calendar[calendar.indexOf(execution) - 1];
    if (!signalDate || symbols.some(symbol => !lookup[symbol][signalDate])) continue;
    if (symbols.some(symbol => !(lookup[symbol][execution].adjusted_open > 0))) {
      issues.push({ plannedDate, reason: 'missing_adjusted_open' }); continue;
    }
    events.set(execution, { signalDate, plannedDate });
  }
  const names = ['fixed_full_budget', 'fixed_same_reserve', 'current_v5_price_only', 'no_redirection', 'underweight_contributions', 'stable_base_limited_extra'];
  const strategies = Object.fromEntries(names.map(name => [name, { cash: 0, holdings: Object.fromEntries(symbols.map(s => [s, 0])), invested: 0,
    fees: 0, slippage: 0, normalUsed: 0, crashUsed: 0, policyState: {}, deposits: 0, flows: [], curve: [], decisions: [], trades: [] }]));
  let lastMonth = '';
  for (const date of dates) {
    const month = date.slice(0, 7), deposit = month !== lastMonth ? 400 : 0;
    lastMonth = month;
    for (const strategy of Object.values(strategies)) {
      if (deposit) { strategy.cash += deposit; strategy.deposits += deposit; strategy.flows.push({ date, amount: -deposit }); strategy.normalUsed = 0; strategy.crashUsed = 0; }
    }
    const event = events.get(date);
    if (event) {
      const weekly = Object.fromEntries(symbols.map(s => [s, weeklyRows(all[s], event.signalDate)]));
      const regime = M.marketRegime(weekly.QQQ) || M.marketRegime(weekly.SPY) || { type: 'Neutral' };
      const signals = Object.fromEntries(symbols.map(s => [s, signal(all[s], weekly[s], event.signalDate, regime)]));
      for (const [name, strategy] of Object.entries(strategies)) {
        const baseBudget = W.weeklyBudget(config.budget.defaultNormalPool, event.plannedDate);
        const values = Object.fromEntries(symbols.map(s => [s, strategy.holdings[s] * lookup[s][event.signalDate].adjusted_close]));
        const assetValue = sum(Object.values(values));
        const actual = Object.fromEntries(symbols.map(s => [s, assetValue + strategy.cash > 0 ? C.money(values[s] / (assetValue + strategy.cash) * 100) : 0]));
        let orders;
        if (name.startsWith('fixed_') || name === 'underweight_contributions') {
          const allowance = name === 'fixed_full_budget' ? 400 : 300;
          const amount = Math.min(W.weeklyBudget(allowance, event.plannedDate), allowance - strategy.normalUsed, strategy.cash / (1 + commissionBps / 10000));
          let weights = assets.map(asset => asset.allocation);
          if (name === 'underweight_contributions') {
            const gaps = assets.map(asset => Math.max(0, (assetValue + amount) * asset.allocation - values[asset.symbol]));
            weights = gaps.map(value => sum(gaps) > 0 ? value / sum(gaps) : 0);
          }
          orders = assets.map((asset, i) => ({ symbol: asset.symbol, baseAmount: Math.max(0, amount * weights[i]), extraAmount: 0, crashFundAmount: 0, finalAmount: Math.max(0, amount * weights[i]) }));
        } else {
          const inputs = assets.map(asset => {
            const sig = signals[asset.symbol];
            return { symbol: asset.symbol, actionBlocked: sig.actionBlocked, input: {
              baseAmount: C.money(baseBudget * asset.allocation), price: lookup[asset.symbol][event.signalDate].adjusted_close,
              dataStatus: 'fresh', marketRegime: regime.type, panicActive: false,
              drawdownPct: sig.algorithm.drawdown, volatilityPct: sig.algorithm.realized_weekly_volatility,
              trendStatus: sig.algorithm.trend.status, currentAllocationPct: actual[asset.symbol],
              normalPool: 300, normalPoolUsed: strategy.normalUsed, crashFundInitial: 100,
              crashFundUsed: strategy.crashUsed, crashFundBalance: Math.max(0, 100 - strategy.crashUsed),
              date: event.signalDate, availableCashProvided: true, availableCash: strategy.cash } };
          });
          let policyConfig = config;
          if (name === 'stable_base_limited_extra') {
            // Research-only ablation: price action labels do not cancel Base, defensive Base remains 100%.
            policyConfig = { ...config, base: { ...config.base, defensive: 1 } };
            inputs.forEach(item => { item.actionBlocked = false; });
          }
          const result = W.plan({ inputs, config: policyConfig, policyState: strategy.policyState, preset, baseBudget, commissionBps,
            budget: { normalPool: 300, normalPoolUsed: strategy.normalUsed, crashFund: 100, crashFundUsed: strategy.crashUsed,
              portfolioCashCap: strategy.cash * config.cashUsageCap },
            core: { actualAllocations: actual, spyDataValid: true, qqqDataValid: true, cashOnlySymbols: name === 'no_redirection' ? symbols : [] } });
          strategy.policyState = result.policyState;
          orders = result.plan.items;
          strategy.decisions.push({ date, signalDate: event.signalDate, plannedDate: event.plannedDate, inputs, plan: result.plan });
        }
        for (const row of orders) {
          if (row.finalAmount <= 0) continue;
          const amount = row.finalAmount, fee = amount * commissionBps / 10000;
          if (amount + fee > strategy.cash + 1e-7) throw new Error('Plan exceeds available cash');
          const price = lookup[row.symbol][date].adjusted_open * (1 + slippageBps / 10000);
          strategy.cash -= amount + fee; strategy.holdings[row.symbol] += amount / price;
          strategy.invested += amount; strategy.fees += fee; strategy.slippage += amount * slippageBps / 10000;
          strategy.normalUsed += row.baseAmount + row.extraAmount; strategy.crashUsed += row.crashFundAmount;
          strategy.trades.push({ date, signalDate: event.signalDate, symbol: row.symbol, amount, fee,
            base: row.baseAmount, extra: row.extraAmount, crash: row.crashFundAmount });
        }
      }
    }
    for (const strategy of Object.values(strategies)) {
      const value = strategy.cash + sum(symbols.map(symbol => strategy.holdings[symbol] * lookup[symbol][date].adjusted_close));
      strategy.curve.push({ date, value, cash: strategy.cash, deposit });
    }
  }
  const summaries = Object.fromEntries(Object.entries(strategies).map(([name, strategy]) => [name, {
    externalDeposits: strategy.deposits, invested: C.money(strategy.invested), finalValue: C.money(strategy.curve.at(-1).value), cash: C.money(strategy.cash),
    investmentRatio: strategy.invested / strategy.deposits, costs: C.money(strategy.fees + strategy.slippage), trades: strategy.trades.length,
    ...Metrics.performance(strategy.curve, strategy.flows) }]));
  return { researchOnly: true, valid: events.size > 0 && strategies.current_v5_price_only.trades.length > 0 && !issues.some(x => x.reason === 'missing_adjusted_open'),
    engineVersion: W.version, configVersion: config.version, presetVersion: preset.version, start: dates[0], end: dates.at(-1), events: events.size, summaries, issues,
    assumptions: { signal: 'prior raw close and weekly raw closes as on dashboard (adjusted fallback in synthetic fixtures); adjusted OHLC for total-return execution and valuation', execution: 'Tuesday open, holiday through Friday',
      deposits: '400 at first trading day of each calendar month, before returns', budget: 'calendar Tuesdays; missing execution does not redistribute its budget',
      commissionBps, slippageBps, cashYield: 0, currency: 'constant currency research units; no historical CAD FX series',
      exclusions: ['historical news and fundamentals overlays', 'manual panic/overrides', 'broker execution restrictions', 'live portfolio overlay history'],
      promotionAllowed: false }, strategies };
}
if (require.main === module && !process.argv.includes('--dip')) {
  const args = process.argv.slice(2), option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const prices = option('--prices', 'data/v2/backtest-adjusted-daily.json');
  const output = option('--output', 'results/weekly_dca_v1');
  const raw = fs.readFileSync(prices);
  const result = run(JSON.parse(raw), { start: option('--start', '2022-06-01'), asOf: option('--as-of', undefined),
    commissionBps: Number(option('--commission-bps', 10)), slippageBps: Number(option('--slippage-bps', 5)) });
  const { strategies, ...summary } = result;
  summary.provenance = { inputHash: crypto.createHash('sha256').update(raw).digest('hex'), generatedAt: new Date().toISOString(),
    codeHashes: Object.fromEntries(['weekly-dca-engine.js','weekly-signal-model.js','core-satellite-policy.js','dca-policy.js','portfolio-policy.js','market-analysis.js','signal-engine.js','data/dca-l2-policy-config.json','data/core-satellite-v5.json','performance-metrics.js','scripts/weekly-dca-backtest.js'].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', file))).digest('hex')])) };
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(output, 'trades.json'), JSON.stringify(Object.fromEntries(Object.entries(strategies).map(([name, s]) => [name, s.trades]))));
  fs.writeFileSync(path.join(output, 'curves.json'), JSON.stringify(Object.fromEntries(Object.entries(strategies).map(([name, s]) => [name, s.curve]))));
  fs.writeFileSync(path.join(output, 'decisions.json'), JSON.stringify(Object.fromEntries(Object.entries(strategies).filter(([, s]) => s.decisions.length).map(([name, s]) => [name, s.decisions]))));
  if (args.includes('--sensitivity')) {
    const cases = ['2022-06-01','2023-01-01','2024-01-01','2025-01-01'].map(start => ({ start, commissionBps: 10, slippageBps: 5 }));
    cases.push({ start: '2022-06-01', commissionBps: 100, slippageBps: 25 });
    const results = cases.map(settings => {
      const value = run(JSON.parse(raw), settings);
      return { ...settings, end: value.end, valid: value.valid, summaries: value.summaries };
    });
    fs.writeFileSync(path.join(output, 'sensitivity.json'), JSON.stringify({ researchOnly: true, provenance: summary.provenance,
      selection: 'prespecified starts; no parameter fitting; overlapping periods are not independent OOS evidence', results }, null, 2));
  }
  console.log(JSON.stringify(summary, null, 2));
  if (!result.valid) process.exitCode = 1;
}
module.exports = { run, weeklyRows, signal };
if (require.main === module && process.argv.includes('--dip')) require('./independent-dip-backtest').main();
