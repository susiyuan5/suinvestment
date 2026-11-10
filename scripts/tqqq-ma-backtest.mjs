// Research only: backtest of the TQQQ 200-day moving-average rule shown on the
// TQQQ view. The live rule (tqqq-ma-signal.js) is reused unchanged; signals use
// plain closes as on the page, returns use dividend-adjusted closes.
// Usage: node scripts/tqqq-ma-backtest.mjs [--json]
import fs from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const signal = require("../tqqq-ma-signal.js");

export const FEE = 0.001; // per trade, on the amount traded
export const FEES = [0, 0.001, 0.005, 0.015];
export const LAG = 1; // sessions between the signal's close and the trade's close
const DAYS_PER_YEAR = 252;
const fixture = new URL("../tests/fixtures/tqqq-backtest-daily-research-v1.json", import.meta.url);

export function loadSeries(file = fixture) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  return data.rows.map(([date, spy, qqq, spyAdj, qqqAdj, tqqqAdj]) => ({ date, spy, qqq, spyAdj, qqqAdj, tqqqAdj }));
}

// Synthetic 3x daily-reset QQQ: each day earns 3x QQQ's adjusted return minus a
// constant daily drag. The drag is fitted so the synthetic series ends where the
// real TQQQ does over their shared history, then applied to the earlier years.
export function leveragedSeries(series) {
  const first = series.findIndex((row) => row.tqqqAdj !== null);
  const end = series.length - 1;
  const grow = (drag, from, to, start = 1) => {
    let value = start;
    for (let i = from + 1; i <= to; i += 1)
      value *= Math.max(0, 1 + 3 * (series[i].qqqAdj / series[i - 1].qqqAdj - 1) - drag);
    return value;
  };
  const target = series[end].tqqqAdj / series[first].tqqqAdj;
  let low = 0;
  let high = 0.001;
  for (let i = 0; i < 80; i += 1) {
    const mid = (low + high) / 2;
    if (grow(mid, first, end) > target) low = mid;
    else high = mid;
  }
  const drag = (low + high) / 2;
  // Splice: synthetic before TQQQ existed, real afterwards, joined at `first`.
  const values = new Array(series.length);
  values[first] = series[first].tqqqAdj;
  for (let i = first + 1; i <= end; i += 1) values[i] = series[i].tqqqAdj;
  for (let i = first - 1; i >= 0; i -= 1)
    values[i] = values[i + 1] / Math.max(1e-9, 1 + 3 * (series[i + 1].qqqAdj / series[i].qqqAdj - 1) - drag);
  // Tracking check over the shared history: largest gap between synthetic and real growth.
  let synthetic = 1;
  let worstGap = 0;
  for (let i = first + 1; i <= end; i += 1) {
    synthetic *= Math.max(0, 1 + 3 * (series[i].qqqAdj / series[i - 1].qqqAdj - 1) - drag);
    worstGap = Math.max(worstGap, Math.abs(synthetic / (series[i].tqqqAdj / series[first].tqqqAdj) - 1));
  }
  return { values, drag, annualDrag: drag * DAYS_PER_YEAR, firstReal: series[first].date, worstGap };
}

// Daily positions from the live rule. evaluate() starts at the first session
// with a 200-day average; earlier sessions are flat.
export function positions(series, options) {
  const days = series.map((row) => ({ date: row.date, spy: row.spy, qqq: row.qqq }));
  const result = signal.evaluate(days, options);
  const offset = series.length - result.rows.length;
  return {
    offset,
    held: series.map((_, i) => (i >= offset && result.rows[i - offset].state === "hold" ? 1 : 0)),
    // One reading of the overheat levels, which the page only displays: while
    // the rule holds, be half invested when QQQ is 30% or more above its
    // average and out at 40% or more, and return to full size as soon as QQQ
    // is back under 30%. The rule itself does not define the buy-back.
    heldWithHeat: series.map((_, i) => {
      if (i < offset) return 0;
      const row = result.rows[i - offset];
      if (row.state !== "hold") return 0;
      if (row.qqqPct >= result.options.heatExitPct) return 0;
      return row.qqqPct >= result.options.heatHalfPct ? 0.5 : 1;
    }),
    rows: result.rows,
    transitions: result.transitions,
  };
}

function stats(curve, years) {
  let peak = curve[0];
  let maxDrawdown = 0;
  for (const value of curve) {
    peak = Math.max(peak, value);
    maxDrawdown = Math.min(maxDrawdown, value / peak - 1);
  }
  const multiple = curve[curve.length - 1] / curve[0];
  return { multiple, cagr: Math.pow(multiple, 1 / years) - 1, maxDrawdown };
}

// held[i] is the share invested (0 to 1) after day i's close. With lag L the
// trade happens at the close of day i+L, so day j earns that share of the
// asset's return for held[j-1-L]. The fee is charged on the share traded.
export function simulate(series, asset, held, { from, to, fee = FEE, lag = LAG }) {
  const start = series.findIndex((row) => row.date >= from);
  let end = series.length - 1;
  while (series[end].date > to) end -= 1;
  let value = 1;
  let trades = 0;
  let heldDays = 0;
  const curve = [1];
  const at = (i) => (i >= 0 ? held[i] : 0);
  let previous = 0; // the window starts flat
  for (let j = start + 1; j <= end; j += 1) {
    const state = at(j - 1 - lag);
    if (state !== previous) {
      value *= 1 - fee * Math.abs(state - previous);
      trades += 1;
      previous = state;
    }
    if (state > 0) {
      value *= 1 + state * (asset[j] / asset[j - 1] - 1);
      heldDays += state;
    }
    curve.push(value);
  }
  const years = (end - start) / DAYS_PER_YEAR;
  return { from: series[start].date, to: series[end].date, years, trades, timeInMarket: heldDays / (end - start), ...stats(curve, years) };
}

export function buyAndHold(series, asset, { from, to, fee = FEE }) {
  const start = series.findIndex((row) => row.date >= from);
  let end = series.length - 1;
  while (series[end].date > to) end -= 1;
  const curve = [];
  for (let j = start; j <= end; j += 1) curve.push((asset[j] / asset[start]) * (1 - fee));
  const years = (end - start) / DAYS_PER_YEAR;
  return { from: series[start].date, to: series[end].date, years, trades: 1, timeInMarket: 1, ...stats(curve, years) };
}

export const PERIODS = [
  ["real TQQQ", "2010-02-11", "9999"],
  ["with synthetic 3x QQQ before 2010", "2000-01-03", "9999"],
  ["2000 to 2002 (synthetic)", "2000-01-03", "2002-12-31"],
  ["2003 to 2007 (synthetic)", "2002-12-31", "2007-12-31"],
  ["2008 to 2009 (synthetic)", "2007-12-31", "2009-12-31"],
  ["2010 to 2019", "2010-02-11", "2019-12-31"],
  ["2020 to 2021", "2019-12-31", "2021-12-31"],
  ["2022", "2021-12-31", "2022-12-30"],
  ["2023 to latest", "2022-12-30", "9999"],
];
export const GRID = { buy: [2, 4, 6], sell: [-1, -3, -5] };

export function buildReport() {
  const series = loadSeries();
  const leveraged = leveragedSeries(series);
  const tqqq = leveraged.values;
  const qqq = series.map((row) => row.qqqAdj);
  const base = positions(series);
  const window = (name) => {
    const [, from, to] = PERIODS.find((period) => period[0] === name);
    return { from, to };
  };
  const periods = PERIODS.map(([name, from, to]) => ({
    name,
    rule: simulate(series, tqqq, base.held, { from, to }),
    ruleWithHeat: simulate(series, tqqq, base.heldWithHeat, { from, to }),
    holdTqqq: buyAndHold(series, tqqq, { from, to }),
    holdQqq: buyAndHold(series, qqq, { from, to }),
  }));
  const long = window("with synthetic 3x QQQ before 2010");
  const real = window("real TQQQ");
  const sensitivity = {
    fees: FEES.map((fee) => ({ fee, real: simulate(series, tqqq, base.held, { ...real, fee }), long: simulate(series, tqqq, base.held, { ...long, fee }) })),
    lags: [0, 1, 2].map((lag) => ({ lag, real: simulate(series, tqqq, base.held, { ...real, lag }), long: simulate(series, tqqq, base.held, { ...long, lag }) })),
    thresholds: GRID.buy.flatMap((buyPct) =>
      GRID.sell.map((sellPct) => {
        const held = positions(series, { buyPct, sellPct }).held;
        return { buyPct, sellPct, real: simulate(series, tqqq, held, real), long: simulate(series, tqqq, held, long) };
      }),
    ),
  };
  // How often QQQ reached the overheat levels the page only displays.
  const heat = { half: 0, exit: 0, halfWhileHeld: 0, exitWhileHeld: 0, lastHalf: null, lastExit: null };
  for (const row of base.rows) {
    if (row.qqqPct >= signal.DEFAULTS.heatHalfPct) {
      heat.half += 1;
      heat.lastHalf = row.date;
      if (row.state === "hold") heat.halfWhileHeld += 1;
    }
    if (row.qqqPct >= signal.DEFAULTS.heatExitPct) {
      heat.exit += 1;
      heat.lastExit = row.date;
      if (row.state === "hold") heat.exitWhileHeld += 1;
    }
  }
  return {
    rule: signal.DEFAULTS,
    fee: FEE,
    lag: LAG,
    sessions: series.length,
    first: series[0].date,
    last: series[series.length - 1].date,
    synthetic: { annualDrag: leveraged.annualDrag, firstReal: leveraged.firstReal, worstGap: leveraged.worstGap },
    signals: base.transitions.map((row) => ({ date: row.date, event: row.event })),
    periods,
    sensitivity,
    heat,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = buildReport();
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    const pct = (value, digits = 1) => (value * 100).toFixed(digits) + "%";
    const cell = (r) => `${pct(r.cagr).padStart(7)} / ${pct(r.maxDrawdown).padStart(7)}`;
    console.log(`${report.sessions} sessions ${report.first} to ${report.last}; fee ${pct(report.fee)} per trade, trade ${report.lag} session after the signal`);
    console.log(`synthetic 3x QQQ: fitted drag ${pct(report.synthetic.annualDrag, 2)}/yr, worst gap to real TQQQ ${pct(report.synthetic.worstGap)} since ${report.synthetic.firstReal}`);
    console.log(`signals: ${report.signals.map((s) => s.date + " " + s.event).join(", ")}`);
    console.log("\nperiod | rule CAGR / maxDD | trades | in market | rule + overheat reading | hold TQQQ | hold QQQ");
    for (const p of report.periods)
      console.log(`${p.name} (${p.rule.from} to ${p.rule.to}) | ${cell(p.rule)} | ${p.rule.trades} | ${pct(p.rule.timeInMarket, 0)} | ${cell(p.ruleWithHeat)} (${p.ruleWithHeat.trades}) | ${cell(p.holdTqqq)} | ${cell(p.holdQqq)}`);
    console.log("\nfee per trade | real TQQQ window | long window");
    for (const row of report.sensitivity.fees) console.log(`${pct(row.fee)} | ${cell(row.real)} | ${cell(row.long)}`);
    console.log("\ntrade lag (sessions) | real TQQQ window | long window");
    for (const row of report.sensitivity.lags) console.log(`${row.lag} | ${cell(row.real)} | ${cell(row.long)}`);
    console.log("\nbuy / sell line | real TQQQ window (trades) | long window (trades)");
    for (const row of report.sensitivity.thresholds)
      console.log(`+${row.buyPct}% / ${row.sellPct}% | ${cell(row.real)} (${row.real.trades}) | ${cell(row.long)} (${row.long.trades})`);
    console.log(`\noverheat: QQQ >= +30% on ${report.heat.half} sessions (${report.heat.halfWhileHeld} while held, last ${report.heat.lastHalf}); >= +40% on ${report.heat.exit} (${report.heat.exitWhileHeld} while held, last ${report.heat.lastExit})`);
  }
}
