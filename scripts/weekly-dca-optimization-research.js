'use strict';
// Explicit factorial research; never apply a target preset or alter old reports.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { run, weeklyRows } = require('./weekly-dca-backtest');
const C = require('../core-satellite-policy');
const W = require('../weekly-dca-engine');
const VARIANTS = [
  { name: 'cash_correction_only', cashPolicyMode: 'base_priority', allocationMode: 'target' },
  { name: 'gap_allocation_only', cashPolicyMode: 'legacy', allocationMode: 'gap' },
  { name: 'cash_and_gap', cashPolicyMode: 'base_priority', allocationMode: 'gap' }
];
// Independent illustrative targets using the same asset list; not account settings.
const EXAMPLE_NINE = { SPY: .20, QQQ: .15, NVDA: .15, AAPL: .10, ASML: .10, QNT: .075, JOBY: .075, PEP: .075, CBRS: .075 };
const DRAFT_ELEVEN = { SPY: .20, QQQ: .10, NVDA: .11, AAPL: .09, ASML: .09, PEP: .09, KO: .09, WMT: .08, QNT: .05, CBRS: .05, JOBY: .05 };
function coverage(payload, allocations, asOf = '2026-09-11') {
  const symbols = Object.keys(allocations), issues = [], rows = {};
  for (const symbol of symbols) {
    const source = payload.symbols?.[symbol];
    const series = Array.isArray(source) ? source.filter(r => r.date <= asOf).slice().sort((a, b) => a.date.localeCompare(b.date)) : [];
    rows[symbol] = { rows: series.length, first: series[0]?.date || null, last: series.at(-1)?.date || null,
      weeklyCloses: series.length ? weeklyRows(series, asOf).length : 0,
      firstFullRiskDate: series.length ? (weeklyRows(series, asOf)[51]?.date || null) : null };
    if (!series.length) issues.push({ symbol, reason: 'missing_daily_history' });
    else {
      if (new Set(series.map(r => r.date)).size !== series.length || series.some(r => !Number.isFinite(r.adjusted_close) || r.adjusted_close <= 0 || !Number.isFinite(r.adjusted_open) || r.adjusted_open <= 0)) issues.push({ symbol, reason: 'invalid_daily_history' });
      if (rows[symbol].weeklyCloses < 52) issues.push({ symbol, reason: 'insufficient_52_week_lookback', availableWeeks: rows[symbol].weeklyCloses, requiredWeeks: 52 });
    }
  }
  const present = Object.values(rows).filter(r => r.rows);
  const complete = present.length === symbols.length;
  const commonStart = complete ? present.map(r => r.first).sort().at(-1) : null;
  const commonEnd = complete ? present.map(r => r.last).sort()[0] : null;
  if (complete) {
    const calendar = (payload.symbols.QQQ || payload.symbols.SPY || payload.symbols[symbols[0]])
      .filter(r => r.date >= commonStart && r.date <= commonEnd).map(r => r.date);
    for (const symbol of symbols) {
      const dates = new Set(payload.symbols[symbol].map(r => r.date));
      const missing = calendar.filter(date => !dates.has(date));
      if (missing.length) issues.push({ symbol, reason: 'missing_common_valuation_bars', count: missing.length, first: missing[0] });
    }
  }
  return { allocations, symbols: rows, commonStart: complete ? present.map(r => r.first).sort().at(-1) : null,
    commonEnd, earliestFullRiskStart: complete && present.every(r => r.firstFullRiskDate) ? present.map(r => r.firstFullRiskDate).sort().at(-1) : null,
    validForCurrentStrategyReturn: complete && !issues.length,
    performance: null, issues,
    explanation: 'No pre-listing rows, synthetic prices, proxy substitution, or annualized short-IPO return. Full strategy return requires all symbols and the 52-week risk lookback.' };
}
function diagnostics(result) {
  return Object.fromEntries(Object.entries(result.strategies).map(([name, strategy]) => {
    const components = { base: 0, extra: 0, crash: 0 };
    for (const trade of strategy.trades) for (const key of Object.keys(components)) components[key] += trade[key];
    for (const key of Object.keys(components)) components[key] = C.money(components[key]);
    const reasonWeeks = {}, assetReasonRows = {};
    let lowBase90 = 0, lowBase50 = 0, zeroWeeks = 0;
    for (const decision of strategy.decisions) {
      const base = W.weeklyBudget(result.budget.normalPool, decision.plannedDate);
      if (decision.plan.totalPlanned < base * .9) lowBase90++;
      if (decision.plan.totalPlanned < base * .5) lowBase50++;
      if (decision.plan.totalPlanned === 0) zeroWeeks++;
      const seen = new Set();
      for (const item of decision.plan.items) for (const code of new Set(item.reasonCodes)) { assetReasonRows[code] = (assetReasonRows[code] || 0) + 1; seen.add(code); }
      for (const code of seen) reasonWeeks[code] = (reasonWeeks[code] || 0) + 1;
    }
    return [name, { components, planWeeks: strategy.decisions.length, lowBase90, lowBase50, zeroWeeks, reasonWeeks, assetReasonRows }];
  }));
}
function compare(payload, settings = {}) {
  return run(payload, { ...settings, preset: settings.preset || C.PRESET, variants: VARIANTS,
    strategyNames: ['fixed_same_reserve', 'balanced_weekly_v2', ...VARIANTS.map(v => v.name)] });
}
function main() {
  const args = process.argv.slice(2), option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const input = option('--prices', 'data/v2/backtest-adjusted-daily.json');
  const extended = option('--coverage-prices', 'results/weekly_dca_optimization_2026-09-30/research-prices.json');
  const output = option('--output', 'results/weekly_dca_optimization_2026-09-30');
  const absoluteOutput = path.resolve(output);
  if (absoluteOutput === path.resolve('results/weekly_dca_v2') || absoluteOutput === path.resolve('results/weekly_dca_v1')) throw new Error('Do not overwrite frozen prior research reports');
  const raw = fs.readFileSync(input), payload = JSON.parse(raw);
  const covered = fs.existsSync(extended) ? JSON.parse(fs.readFileSync(extended)) : payload;
  const cases = ['2022-06-01', '2023-01-01', '2024-01-01', '2025-01-01'].map(start => ({ start, commissionBps: 10, slippageBps: 5 }));
  cases.push({ start: '2022-06-01', commissionBps: 100, slippageBps: 25 });
  const results = cases.map(settings => {
    const result = compare(payload, settings);
    return { settings, valid: result.valid, start: result.start, end: result.end, events: result.events, allocations: result.allocations,
      budget: result.budget, summaries: result.summaries, diagnostics: diagnostics(result), issues: result.issues, assumptions: result.assumptions };
  });
  const coverageReport = { exampleNine: coverage(covered, EXAMPLE_NINE), draftEleven: coverage(covered, DRAFT_ELEVEN),
    frozenSix: coverage(payload, Object.fromEntries(C.rowsForPreset(C.PRESET).map(a => [a.symbol, a.allocation]))),
    exampleConfiguration: 'Independent illustrative nine-asset targets using the same asset list; not user account settings.',
    draftAppliedToLive: false, exampleNinePerformance: null, draftElevenPerformance: null };
  const result = { researchOnly: true, promotionAllowed: false, engineVersion: W.version,
    selection: 'Prespecified cash/allocation factorial. Same deposits, target preset, reserve budget, costs, calendar and hard action gates within every comparison. Starts overlap and are not independent out-of-sample evidence.',
    coverage: coverageReport, results, provenance: { generatedAt: new Date().toISOString(), inputHash: crypto.createHash('sha256').update(raw).digest('hex'),
      coverageInputHash: crypto.createHash('sha256').update(fs.readFileSync(fs.existsSync(extended) ? extended : input)).digest('hex'),
      codeHashes: Object.fromEntries(['weekly-dca-engine.js', 'weekly-signal-model.js', 'scripts/weekly-dca-backtest.js', 'scripts/weekly-dca-optimization-research.js', 'core-satellite-policy.js', 'portfolio-policy.js', 'dca-policy.js'].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')])) } };
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'comparison.json'), JSON.stringify(result, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'coverage.json'), JSON.stringify(coverageReport, null, 2) + '\n');
  console.log(JSON.stringify({ output, allComparisonsValid: results.every(r => r.valid), coverage: { exampleNine: coverageReport.exampleNine.validForCurrentStrategyReturn, draftEleven: coverageReport.draftEleven.validForCurrentStrategyReturn }, summaries: results[0].summaries }, null, 2));
  if (results.some(r => !r.valid)) process.exitCode = 1;
}
module.exports = { coverage, diagnostics, compare, VARIANTS, EXAMPLE_NINE, DRAFT_ELEVEN };
if (require.main === module) main();
