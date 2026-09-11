"use strict";
const fs = require("node:fs"),
  crypto = require("node:crypto");
const S = require("../dip-strategy"),
  L = require("../dip-ledger"),
  W = require("../weekly-dca-engine"),
  D = require("../dca-policy"),
  C = require("../core-satellite-policy"),
  M = require("../market-analysis"),
  Metrics = require("../performance-metrics");
const Legacy = require("./weekly-dca-backtest");
const sum = (xs) => xs.reduce((a, b) => a + b, 0),
  DAY = 86400000;
function run(payload, options = {}) {
  const start = options.start || "2021-06-01",
    end = options.end || "2026-09-04",
    fx = options.cad ? 0.015 : 0,
    commission = (options.commissionBps ?? 10) / 10000,
    slippage = (options.slippageBps ?? 5) / 10000;
  const assets = C.rowsForPreset(C.PRESET),
    targets = Object.fromEntries(assets.map((a) => [a.symbol, a.allocation]));
  const all = {},
    lookup = {};
  for (const symbol of S.symbols) {
    all[symbol] = (payload.symbols[symbol] || [])
      .filter((r) => r.date <= end)
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date));
    lookup[symbol] = Object.fromEntries(all[symbol].map((r) => [r.date, r]));
    if (
      !all[symbol].length ||
      Object.keys(lookup[symbol]).length !== all[symbol].length ||
      all[symbol].some(
        (r) =>
          ![r.adjusted_close, r.adjusted_open, r.close].every(
            (v) => Number.isFinite(v) && v > 0,
          ),
      )
    )
      throw Error("Invalid history " + symbol);
  }
  const calendar = all.SPY.map((r) => r.date),
    dates = calendar.filter((d) => d >= start);
  for (const date of dates)
    for (const s of S.symbols)
      if (!lookup[s][date]) throw Error("Missing valuation " + s + " " + date);
  const schedule = new Map();
  for (let t = Date.parse(start); t <= Date.parse(end); t += DAY) {
    const day = new Date(t);
    if (day.getUTCDay() !== 2) continue;
    const planned = day.toISOString().slice(0, 10),
      execution = dates.find(
        (d) => d >= planned && Date.parse(d) <= t + 3 * DAY,
      ),
      signalDate = calendar[calendar.indexOf(execution) - 1];
    if (execution && signalDate)
      schedule.set(execution, { planned, signalDate });
  }
  const names = [
    "fixed_400",
    "current_400",
    "dip_100",
    "fixed_500",
    "current_400_cash_100",
    "current_400_dip_100",
  ];
  const strategies = Object.fromEntries(
    names.map((name) => [
      name,
      {
        name,
        oldCash: 0,
        dipCash: 0,
        holdings: Object.fromEntries(S.symbols.map((s) => [s, 0])),
        book: L.blank(),
        flows: [],
        curve: [],
        trades: [],
        decisions: [],
        normalUsed: 0,
        crashUsed: 0,
        policyState: {},
        invested: 0,
        fees: 0,
        slippage: 0,
        eligibleWeeks: 0,
        oldEligibleWeeks: 0,
      },
    ]),
  );
  let month = "";
  const config = D.getL2Config();
  const issues = [];
  for (const date of dates) {
    const depositNow = date.slice(0, 7) !== month;
    month = date.slice(0, 7);
    const event = schedule.get(date),
      now = Date.parse(date + "T14:00:00Z");
    for (const strategy of Object.values(strategies)) {
      const fixed = strategy.name.startsWith("fixed"),
        dipOnly = strategy.name === "dip_100",
        hasDip = dipOnly || strategy.name === "current_400_dip_100",
        hasExtra = hasDip || strategy.name === "current_400_cash_100";
      let deposit = 0;
      if (depositNow) {
        const base = dipOnly ? 0 : strategy.name === "fixed_500" ? 500 : 400;
        strategy.oldCash += base;
        strategy.dipCash += hasExtra ? 100 : 0;
        deposit = base + (hasExtra ? 100 : 0);
        strategy.flows.push({ date, amount: -deposit });
        strategy.normalUsed = 0;
        strategy.crashUsed = 0;
        if (hasDip) strategy.book = L.ensure(strategy.book, now);
      }
      if (event) {
        const signalDate = event.signalDate,
          values = Object.fromEntries(
            S.symbols.map((s) => [
              s,
              strategy.holdings[s] * lookup[s][signalDate].adjusted_close,
            ]),
          );
        const totalValue = sum(Object.values(values));
        let oldOrders = [];
        if (fixed) {
          const monthly = strategy.name === "fixed_500" ? 500 : 400,
            amount = Math.max(
              0,
              Math.min(
                W.weeklyBudget(monthly, event.planned),
                monthly - strategy.normalUsed,
                strategy.oldCash / (1 + commission + fx),
              ),
            );
          oldOrders = assets.map((a) => ({
            symbol: a.symbol,
            finalAmount: amount * a.allocation,
            baseAmount: amount * a.allocation,
            extraAmount: 0,
            crashFundAmount: 0,
          }));
        } else if (!dipOnly) {
          const weekly = Object.fromEntries(
            S.symbols.map((s) => [s, Legacy.weeklyRows(all[s], signalDate)]),
          );
          const regime = M.marketRegime(weekly.QQQ) ||
            M.marketRegime(weekly.SPY) || { type: "Neutral" };
          const signals = Object.fromEntries(
            S.symbols.map((s) => [
              s,
              Legacy.signal(all[s], weekly[s], signalDate, regime),
            ]),
          );
          const actual = Object.fromEntries(
            S.symbols.map((s) => [
              s,
              totalValue + strategy.oldCash > 0
                ? C.money((values[s] / (totalValue + strategy.oldCash)) * 100)
                : 0,
            ]),
          );
          const baseBudget = W.weeklyBudget(300, event.planned);
          const inputs = assets.map((a) => {
            const sig = signals[a.symbol];
            return {
              symbol: a.symbol,
              actionBlocked: sig.actionBlocked,
              input: {
                baseAmount: C.money(baseBudget * a.allocation),
                price: lookup[a.symbol][signalDate].adjusted_close,
                dataStatus: "fresh",
                marketRegime: regime.type,
                panicActive: false,
                drawdownPct: sig.algorithm.drawdown,
                volatilityPct: sig.algorithm.realized_weekly_volatility,
                trendStatus: sig.algorithm.trend.status,
                currentAllocationPct: actual[a.symbol],
                normalPool: 300,
                normalPoolUsed: strategy.normalUsed,
                crashFundInitial: 100,
                crashFundUsed: strategy.crashUsed,
                crashFundBalance: Math.max(0, 100 - strategy.crashUsed),
                date: signalDate,
                availableCashProvided: true,
                availableCash: strategy.oldCash,
              },
            };
          });
          const result = W.plan({
            inputs,
            config,
            policyState: strategy.policyState,
            preset: C.PRESET,
            baseBudget,
            commissionBps: (commission + fx) * 10000,
            budget: {
              normalPool: 300,
              normalPoolUsed: strategy.normalUsed,
              crashFund: 100,
              crashFundUsed: strategy.crashUsed,
              portfolioCashCap: strategy.oldCash * config.cashUsageCap,
            },
            core: {
              actualAllocations: actual,
              spyDataValid: true,
              qqqDataValid: true,
              cashOnlySymbols: [],
            },
          });
          strategy.policyState = result.policyState;
          oldOrders = result.plan.items;
        }
        if (oldOrders.some((r) => r.finalAmount > 0))
          strategy.oldEligibleWeeks++;
        for (const row of oldOrders) {
          if (row.finalAmount <= 0) continue;
          const amount = row.finalAmount,
            fees = amount * (commission + fx),
            price = lookup[row.symbol][date].adjusted_open * (1 + slippage),
            quantity = amount / price;
          if (amount + fees > strategy.oldCash + 1e-6)
            throw Error("Old plan overspends");
          strategy.oldCash -= amount + fees;
          strategy.holdings[row.symbol] += quantity;
          strategy.invested += amount;
          strategy.fees += fees;
          strategy.slippage += amount * slippage;
          strategy.normalUsed += row.baseAmount + row.extraAmount;
          strategy.crashUsed += row.crashFundAmount;
          strategy.trades.push({
            date,
            signalDate,
            symbol: row.symbol,
            pool: "existing",
            quantity,
            notional: amount,
            amountUSD: amount + fees,
            fees,
          });
        }
        if (hasDip) {
          // Budget ledger is isolated; holdings already include old-plan orders but are valued at the prior close.
          strategy.book = L.ensure(strategy.book, now);
          const ledger = L.summary(strategy.book, now);
          const signalInput = Object.fromEntries(
            S.symbols.map((s) => [
              s,
              S.signal(
                all[s].filter((r) => r.date <= signalDate),
                now,
              ),
            ]),
          );
          if (
            !S.symbols.every((s) => signalInput[s].valid) &&
            strategy === strategies.dip_100
          )
            issues.push({ date, reason: "warmup_or_weekly_history_missing" });
          const securities = Object.fromEntries(
            S.symbols.map((s) => [
              s,
              { accountId: "research", currency: "USD", fractional: true },
            ]),
          );
          const quotes = Object.fromEntries(
            S.symbols.map((s) => [
              s,
              {
                price: lookup[s][signalDate].adjusted_close,
                asOf: new Date(now - 3600000).toISOString(),
              },
            ]),
          );
          const postOldValues = Object.fromEntries(
            S.symbols.map((s) => [
              s,
              values[s] +
                sum(
                  oldOrders
                    .filter((r) => r.symbol === s)
                    .map((r) => r.finalAmount),
                ),
            ]),
          );
          const plan = S.plan({
            now,
            signals: signalInput,
            targets,
            values: postOldValues,
            ledger,
            quotes,
            securities,
            accounts: {
              research: {
                currency: options.cad ? "CAD" : "USD",
                type: "NON_REGISTERED",
                cash: strategy.dipCash * (options.cad ? 1.35 : 1),
                reserved: 0,
              },
            },
            fxRate: 1.35,
            fxAsOf: new Date(now - 3600000).toISOString(),
          });
          if (plan.rows.some((r) => r.eligible)) strategy.eligibleWeeks++;
          strategy.decisions.push({ date, signalDate, plan });
          for (const row of plan.rows) {
            if (row.amountUSD <= 0) continue;
            const amountUSD = row.amountUSD,
              notional = amountUSD / (1 + commission + fx),
              fees = amountUSD - notional,
              price = lookup[row.symbol][date].adjusted_open * (1 + slippage),
              quantity = notional / price;
            if (amountUSD > strategy.dipCash + 0.001)
              throw Error("Dip cash overspend");
            const trade = {
              id: date + ":" + row.symbol,
              symbol: row.symbol,
              quantity,
              price,
              accountCurrency: "USD",
              accountDebit: amountUSD,
              fxFee: notional * fx,
              commissionFee: notional * commission,
              tradeAt: date + "T14:00:00Z",
              tier: row.tier,
            };
            strategy.book = L.buy(strategy.book, trade, now);
            strategy.dipCash -= amountUSD;
            strategy.holdings[row.symbol] += quantity;
            strategy.invested += notional;
            strategy.fees += fees;
            strategy.slippage += notional * slippage;
            strategy.trades.push({
              date,
              signalDate,
              symbol: row.symbol,
              pool: "dip",
              quantity,
              notional,
              amountUSD,
              fees,
              fxFeeUSD: notional * fx,
            });
          }
        }
      }
      const cash = strategy.oldCash + strategy.dipCash,
        value =
          cash +
          sum(
            S.symbols.map(
              (s) => strategy.holdings[s] * lookup[s][date].adjusted_close,
            ),
          );
      strategy.curve.push({
        date,
        value,
        cash,
        deposit,
        dipReserve: strategy.dipCash,
      });
    }
  }
  const summaries = {};
  for (const [name, s] of Object.entries(strategies)) {
    const recovered = [];
    let unrecovered = 0;
    for (const trade of s.trades) {
      const recovery = all[trade.symbol].find(
        (r) =>
          r.date >= trade.date &&
          r.adjusted_close * trade.quantity >= trade.amountUSD,
      );
      trade.recoveryDate = recovery?.date || null;
      if (recovery)
        recovered.push(
          (Date.parse(recovery.date) - Date.parse(trade.date)) / DAY,
        );
      else unrecovered++;
    }
    const deposits = -sum(s.flows.map((f) => f.amount));
    const dipTrades = s.trades.filter((t) => t.pool === "dip"),
      dipRecovered = dipTrades.filter((t) => t.recoveryDate);
    summaries[name] = {
      externalDeposits: deposits,
      finalValue: C.money(s.curve.at(-1).value),
      invested: C.money(s.invested),
      investmentRatio: s.invested / deposits,
      idleReserve: C.money(s.dipCash),
      totalCash: C.money(s.oldCash + s.dipCash),
      fees: C.money(s.fees),
      slippage: C.money(s.slippage),
      trades: s.trades.length,
      dipTrades: s.trades.filter((t) => t.pool === "dip").length,
      dipInvestmentRatio:
        deposits && s.name.includes("dip")
          ? sum(dipTrades.map((t) => t.amountUSD)) / (s.flows.length * 100)
          : null,
      dipAverageRecoveryDays: dipRecovered.length
        ? sum(
            dipRecovered.map(
              (t) => (Date.parse(t.recoveryDate) - Date.parse(t.date)) / DAY,
            ),
          ) / dipRecovered.length
        : null,
      dipUnrecoveredRatio: dipTrades.length
        ? 1 - dipRecovered.length / dipTrades.length
        : null,
      eligibleDipWeeks: s.eligibleWeeks,
      existingTriggerWeeks: s.oldEligibleWeeks,
      averageRecoveryDays: recovered.length
        ? sum(recovered) / recovered.length
        : null,
      unrecoveredRatio: s.trades.length ? unrecovered / s.trades.length : null,
      ...Metrics.performance(s.curve, s.flows),
    };
  }
  return {
    researchOnly: true,
    valid: dates.length > 0 && schedule.size > 0,
    version: S.version,
    start: dates[0],
    end: dates.at(-1),
    summaries,
    issues,
    strategies,
    assumptions: {
      signal:
        "Dip: completed adjusted weeks before prior session; existing: unchanged raw partial-week signals",
      execution:
        "Tuesday adjusted open with slippage; holidays shift through Friday",
      cashYield: 0,
      commissionBps: commission * 10000,
      slippageBps: slippage * 10000,
      currency: options.cad
        ? "USD accounting; constant USD/CAD 1.35 and 1.5% FX scenario"
        : "USD",
      fractional: true,
      manualPanicHistory: false,
      extraCashExcludedFromOldStrategy: true,
      recovery:
        "First closing value covering all-in entry cost; unsold; unrecovered included",
      exclusions: [
        "historical manual overrides/news/fundamentals",
        "historical account rules",
        "historical CAD FX",
      ],
      promotionAllowed: false,
    },
  };
}
function main() {
  const raw = fs.readFileSync("data/v2/backtest-adjusted-daily.json"),
    payload = JSON.parse(raw),
    warmPath = "data/dip-warmup-daily.json";
  const warm = fs.existsSync(warmPath)
    ? JSON.parse(fs.readFileSync(warmPath))
    : { symbols: {}, errors: { missing: true } };
  for (const s of S.symbols)
    payload.symbols[s] = [...(warm.symbols[s] || []), ...payload.symbols[s]];
  const output = "results/independent_dip_v1";
  fs.mkdirSync(output, { recursive: true });
  const files = [
    "dip-strategy.js",
    "dip-ledger.js",
    "scripts/independent-dip-backtest.js",
    "scripts/weekly-dca-backtest.js",
    "market-analysis.js",
    "wealthsimple-execution-policy.js",
    "weekly-dca-engine.js",
    "weekly-signal-model.js",
    "dca-policy.js",
    "portfolio-policy.js",
    "core-satellite-policy.js",
    "data/dca-l2-policy-config.json",
    "data/core-satellite-v5.json",
    "performance-metrics.js",
  ];
  const provenance = {
    generatedAt: new Date().toISOString(),
    hashNormalization: "UTF-8 text with LF newlines",
    inputHash: crypto
      .createHash("sha256")
      .update(raw.toString("utf8").replace(/\r\n/g, "\n"))
      .digest("hex"),
    warmupErrors: warm.errors,
    warmupHash: fs.existsSync(warmPath)
      ? crypto
          .createHash("sha256")
          .update(fs.readFileSync(warmPath, "utf8").replace(/\r\n/g, "\n"))
          .digest("hex")
      : null,
    codeHashes: Object.fromEntries(
      files.map((f) => [
        f,
        crypto
          .createHash("sha256")
          .update(fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n"))
          .digest("hex"),
      ]),
    ),
  };
  for (const cad of [false, true]) {
    const result = run(payload, { cad }),
      { strategies, ...summary } = result,
      name = cad ? "cad_scenario" : "usd";
    summary.provenance = provenance;
    fs.writeFileSync(
      `${output}/${name}-summary.json`,
      JSON.stringify(summary, null, 2),
    );
    for (const kind of ["trades", "curve", "decisions"])
      fs.writeFileSync(
        `${output}/${name}-${kind}.json`,
        JSON.stringify(
          Object.fromEntries(
            Object.entries(strategies).map(([n, s]) => [n, s[kind]]),
          ),
        ),
      );
    console.log(JSON.stringify({ scenario: name, ...summary }, null, 2));
    if (!result.valid) process.exitCode = 1;
  }
}
module.exports = { run, main };
if (require.main === module) main();
