// Research only: core holding + trend-following portion, and what BTC share of
// total wealth a given loss limit allows. The live rule (btc-trend-signal.js)
// is reused unchanged. Usage: node scripts/btc-core-trend-research.mjs [--json]
import fs from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const signal = require("../btc-trend-signal.js");

export const CORES = [0, 0.25, 0.5, 0.75, 1];
export const FEE = 0.001; // OKX regular spot tier, staying in USDT when out
export const SHARES = [0.05, 0.1, 0.2, 0.3, 0.5];
const WEEKS_PER_YEAR = 365.25 / 7;
const DAY_MS = 86400000;
const fixture = (name) => new URL("../tests/fixtures/" + name, import.meta.url);

// The rule validates Sunday week ends. Kraken weekly bars end on Wednesday, so
// their labels are moved to the following Sunday for validation only; closes
// and order are Kraken's own and `actualEnd` keeps the real date.
export function rowsFor(snapshot) {
  const sample = new Date(snapshot.weeks[0].week_end + "T00:00:00Z");
  const shift = (7 - sample.getUTCDay()) % 7;
  const weeks = snapshot.weeks.map((week) => ({
    close: week.close,
    week_end: new Date(Date.parse(week.week_end + "T00:00:00Z") + shift * DAY_MS)
      .toISOString()
      .slice(0, 10),
  }));
  const offset = snapshot.weeks.length - signal.evaluate(weeks).rows.length;
  return signal
    .evaluate(weeks)
    .rows.map((row, i) => ({ ...row, actualEnd: snapshot.weeks[i + offset].week_end }));
}

// `core` of the balance stays in BTC at all times; the rest follows the rule.
// Entering: all cash buys BTC. Exiting: BTC is cut back to `core` of the
// balance. No rebalancing between switches. The fee applies to the amount
// traded. core = 0 is the pure rule, core = 1 is buy & hold.
export function simulate(rows, core, fee, from, to) {
  const slice = rows.filter((row) => row.actualEnd >= from && row.actualEnd <= to);
  const target = (position) => (position === 1 ? 1 : core);
  let btc = target(slice[0].position) * (1 - fee);
  let cash = 1 - target(slice[0].position);
  let traded = target(slice[0].position);
  let peak = btc + cash;
  let maxDrawdown = 0;
  let trades = target(slice[0].position) > 0 ? 1 : 0;
  let exposureWeeks = 0;
  for (let i = 1; i < slice.length; i += 1) {
    exposureWeeks += btc / (btc + cash);
    btc *= slice[i].close / slice[i - 1].close;
    if (slice[i].position !== slice[i - 1].position && core < 1) {
      if (slice[i].position === 1) {
        traded += cash;
        btc += cash * (1 - fee);
        cash = 0;
      } else {
        const sell = btc - core * (btc + cash);
        traded += sell;
        btc -= sell;
        cash += sell * (1 - fee);
      }
      trades += 1;
    }
    peak = Math.max(peak, btc + cash);
    maxDrawdown = Math.min(maxDrawdown, (btc + cash) / peak - 1);
  }
  const years = (slice.length - 1) / WEEKS_PER_YEAR;
  const multiple = btc + cash;
  const cagr = Math.pow(multiple, 1 / years) - 1;
  return {
    from: slice[0].actualEnd,
    to: slice[slice.length - 1].actualEnd,
    years,
    trades,
    multiple,
    cagr,
    maxDrawdown,
    cagrPerDrawdown: cagr / Math.abs(maxDrawdown),
    averageExposure: exposureWeeks / (slice.length - 1),
  };
}

export const SOURCES = [
  {
    name: "Yahoo BTC-USD (Mon-Sun weeks)",
    file: "btc-weekly-v1.json",
    periods: [
      ["report baseline", "2015-08-23", "9999"],
      ["2015-08 to 2019", "2015-08-23", "2019-12-29"],
      ["2020 to 2022", "2019-12-29", "2022-12-25"],
      ["2023 to latest", "2022-12-25", "9999"],
    ],
  },
  {
    name: "Kraken XBTUSD (Thu-Wed weeks)",
    file: "btc-weekly-kraken-research-v1.json",
    periods: [
      ["report baseline", "2014-09-17", "9999"],
      ["2015-08 to 2019", "2015-08-26", "2020-01-01"],
      ["2020 to 2022", "2020-01-01", "2022-12-28"],
      ["2023 to latest", "2022-12-28", "9999"],
    ],
  },
];

export function buildReport() {
  const sources = SOURCES.map((source) => {
    const rows = rowsFor(JSON.parse(fs.readFileSync(fixture(source.file), "utf8")));
    return {
      name: source.name,
      periods: source.periods.map(([name, from, to]) => ({
        name,
        mixes: CORES.map((core) => ({ core, ...simulate(rows, core, FEE, from, to) })),
      })),
    };
  });
  // Position size: with the rest of the portfolio assumed flat, a BTC share w
  // that falls by d costs w * d of total wealth. Uses the worse drawdown of the
  // two sources over each source's longest window.
  const sizing = CORES.map((core) => {
    const drawdown = Math.min(
      ...sources.map((source) => source.periods[0].mixes.find((mix) => mix.core === core).maxDrawdown),
    );
    return {
      core,
      drawdown,
      lossByShare: SHARES.map((share) => ({ share, loss: share * drawdown })),
      shareForLoss: [0.05, 0.1, 0.2].map((limit) => ({ limit, share: Math.min(1, limit / Math.abs(drawdown)) })),
    };
  });
  return { fee: FEE, rule: signal.DEFAULTS, sources, sizing };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = buildReport();
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    const pct = (value, digits = 1) => (value * 100).toFixed(digits) + "%";
    for (const source of report.sources)
      for (const period of source.periods) {
        const head = period.mixes[0];
        console.log(`\n${source.name} | ${period.name}: ${head.from} to ${head.to} (${head.years.toFixed(1)} y)`);
        console.log("core | CAGR | maxDD | CAGR/DD | trades | avg exposure | multiple");
        for (const mix of period.mixes)
          console.log(
            [
              pct(mix.core, 0).padStart(4),
              pct(mix.cagr).padStart(7),
              pct(mix.maxDrawdown).padStart(7),
              mix.cagrPerDrawdown.toFixed(2).padStart(5),
              String(mix.trades).padStart(3),
              pct(mix.averageExposure, 0).padStart(4),
              mix.multiple.toFixed(1) + "x",
            ].join(" | "),
          );
      }
    console.log("\nLoss of total wealth = BTC share x worst historical drawdown (rest of portfolio flat)");
    console.log("core | drawdown | " + SHARES.map((s) => "share " + pct(s, 0)).join(" | ") + " | share for 5% / 10% / 20% loss limit");
    for (const row of report.sizing)
      console.log(
        [
          pct(row.core, 0).padStart(4),
          pct(row.drawdown).padStart(7),
          ...row.lossByShare.map((cell) => pct(cell.loss).padStart(9)),
          row.shareForLoss.map((cell) => pct(cell.share, 0)).join(" / "),
        ].join(" | "),
      );
  }
}
