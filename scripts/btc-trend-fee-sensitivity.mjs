// Research only: how sensitive is the BTC weekly trend rule to trading cost?
// Reuses the live rule (btc-trend-signal.js) unchanged and only varies the
// per-switch fee. Usage: node scripts/btc-trend-fee-sensitivity.mjs [snapshot.json] [--json]
import fs from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const signal = require("../btc-trend-signal.js");

export const FEES = [0.001, 0.005, 0.01, 0.015, 0.02, 0.03];
const WEEKS_PER_YEAR = 365.25 / 7;

// rows[i].position is decided at week i's close and held over week i+1.
// A fee is charged on the full balance at every switch and once on entry for
// buy & hold; open positions are not charged a closing fee at the end.
export function simulate(rows, fee, from, to) {
  const slice = rows.filter((row) => row.weekEnd >= from && row.weekEnd <= to);
  let rule = 1;
  let hold = 1 - fee;
  let rulePeak = 1;
  let holdPeak = hold;
  let ruleDd = 0;
  let holdDd = 0;
  let switches = 0;
  let heldWeeks = 0;
  // The rule starts flat; a position already open at `from` is bought there.
  if (slice[0].position === 1) {
    rule *= 1 - fee;
    switches += 1;
  }
  for (let i = 1; i < slice.length; i += 1) {
    const growth = slice[i].close / slice[i - 1].close;
    if (slice[i - 1].position === 1) {
      rule *= growth;
      heldWeeks += 1;
    }
    hold *= growth;
    if (slice[i].position !== slice[i - 1].position) {
      rule *= 1 - fee;
      switches += 1;
    }
    rulePeak = Math.max(rulePeak, rule);
    holdPeak = Math.max(holdPeak, hold);
    ruleDd = Math.min(ruleDd, rule / rulePeak - 1);
    holdDd = Math.min(holdDd, hold / holdPeak - 1);
  }
  const years = (slice.length - 1) / WEEKS_PER_YEAR;
  const cagr = (value) => Math.pow(value, 1 / years) - 1;
  return {
    from: slice[0].weekEnd,
    to: slice[slice.length - 1].weekEnd,
    years,
    switches,
    timeInMarket: heldWeeks / (slice.length - 1),
    rule: { multiple: rule, cagr: cagr(rule), maxDrawdown: ruleDd },
    hold: { multiple: hold, cagr: cagr(hold), maxDrawdown: holdDd },
  };
}

// Per-switch fee at which the rule's final balance equals buy & hold's.
export function breakEvenFee(rows, from, to) {
  let low = 0;
  let high = 0.5;
  const gap = (fee) => {
    const result = simulate(rows, fee, from, to);
    return result.rule.multiple - result.hold.multiple;
  };
  if (gap(low) <= 0) return 0;
  if (gap(high) > 0) return null;
  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    if (gap(mid) > 0) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

export const REPORT_START = "2015-08-23"; // start week that reproduces the 2026-10-20 report baseline

export function buildReport(snapshot) {
  const { rows } = signal.evaluate(snapshot.weeks);
  const first = rows[0].weekEnd;
  const last = rows[rows.length - 1].weekEnd;
  const periods = [
    ["full history", first, last],
    ["report baseline", REPORT_START, last],
    ["2015-08 to 2019", REPORT_START, "2019-12-29"],
    ["2020 to 2022", "2019-12-29", "2022-12-25"],
    ["2023 to latest", "2022-12-25", last],
  ];
  return {
    source: snapshot.source,
    weeks: snapshot.weeks.length,
    rule: signal.DEFAULTS,
    periods: periods.map(([name, from, to]) => ({
      name,
      breakEvenFee: breakEvenFee(rows, from, to),
      fees: FEES.map((fee) => ({ fee, ...simulate(rows, fee, from, to) })),
    })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const file =
    args.find((arg) => !arg.startsWith("--")) ||
    new URL("../tests/fixtures/btc-weekly-v1.json", import.meta.url);
  const report = buildReport(JSON.parse(fs.readFileSync(file, "utf8")));
  if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    const pct = (value, digits = 1) => (value * 100).toFixed(digits) + "%";
    for (const period of report.periods) {
      const head = period.fees[0];
      console.log(
        `\n${period.name}: ${head.from} to ${head.to} (${head.years.toFixed(1)} y), ` +
          `${head.switches} switches, in market ${pct(head.timeInMarket, 0)}, ` +
          `break-even fee ${period.breakEvenFee === null ? ">50%" : pct(period.breakEvenFee, 2)}`,
      );
      console.log("fee/side | rule CAGR | rule maxDD | hold CAGR | hold maxDD | rule - hold");
      for (const row of period.fees)
        console.log(
          [
            pct(row.fee).padStart(8),
            pct(row.rule.cagr).padStart(9),
            pct(row.rule.maxDrawdown).padStart(10),
            pct(row.hold.cagr).padStart(9),
            pct(row.hold.maxDrawdown).padStart(10),
            ((row.rule.cagr - row.hold.cagr) * 100).toFixed(1).padStart(8) + " pt",
          ].join(" | "),
        );
    }
  }
}
