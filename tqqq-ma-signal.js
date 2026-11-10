(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TqqqMaSignal = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // TQQQ 200-day moving-average rule (manual decision support, never an order).
  // Buy when SPY and QQQ both close at least buyPct above their own 200-day
  // average; sell when either closes at least |sellPct| below; otherwise keep
  // the last state. The QQQ overheat levels are shown as price levels only and
  // do not change the state. Basis: docs/TQQQ_MA_SIGNAL_2026-11-10.md
  const DEFAULTS = Object.freeze({
    maPeriod: 200,
    buyPct: 4,
    sellPct: -3,
    heatHalfPct: 30,
    heatExitPct: 40,
    staleDays: 4,
    chartDays: 252,
  });
  // Position cap chosen by Su on 2026-11-10 (manual, never an order).
  // Basis: docs/TQQQ_MA_BACKTEST_2026-11-10.md
  const PLAN = Object.freeze({
    lossLimit: 0.1, // largest loss of total wealth accepted from the TQQQ budget
    referenceDrawdown: 0.858, // rule's worst drawdown since 2000 (synthetic 3x QQQ before 2010)
    realDrawdown: 0.481, // rule's worst drawdown on real TQQQ, 2010-02 onwards
  });
  const DAY_MS = 86400000;

  // Largest TQQQ budget, as a share of total wealth, that keeps a drawdown of
  // `drawdown` within `lossLimit`. Rounded down to a whole percent.
  function budgetCap(lossLimit, drawdown) {
    if (!(Number.isFinite(lossLimit) && lossLimit > 0 && lossLimit <= 1))
      throw new Error("invalid loss limit");
    if (!(Number.isFinite(drawdown) && drawdown > 0 && drawdown <= 1))
      throw new Error("invalid drawdown");
    return Math.min(1, Math.floor((lossLimit / drawdown) * 100 + 1e-9) / 100);
  }

  function plan(input) {
    const p = Object.assign({}, PLAN, input || {});
    return {
      lossLimit: p.lossLimit,
      referenceDrawdown: p.referenceDrawdown,
      realDrawdown: p.realDrawdown,
      budgetCap: budgetCap(p.lossLimit, p.referenceDrawdown),
      realHistoryBudgetCap: budgetCap(p.lossLimit, p.realDrawdown),
    };
  }

  function options(input) {
    const merged = Object.assign({}, DEFAULTS, input || {});
    if (!Number.isInteger(merged.maPeriod) || merged.maPeriod < 2)
      throw new Error("invalid option maPeriod");
    if (!(merged.buyPct > 0 && merged.sellPct < 0))
      throw new Error("buy line must be above and sell line below the average");
    return merged;
  }

  function deviation(close, average) {
    return (close / average - 1) * 100;
  }

  function validDays(days) {
    if (!Array.isArray(days)) return false;
    let previous = "";
    for (const row of days) {
      if (!row || !/^\d{4}-\d{2}-\d{2}$/.test(row.date || "")) return false;
      if (!Number.isFinite(Date.parse(row.date + "T00:00:00Z"))) return false;
      if (row.date <= previous) return false;
      for (const key of ["spy", "qqq"])
        if (!(Number.isFinite(row[key]) && row[key] > 0)) return false;
      previous = row.date;
    }
    return true;
  }

  // Zone of one deviation against the two lines.
  function zone(value, opt) {
    if (value >= opt.buyPct) return "above";
    if (value <= opt.sellPct) return "below";
    return "between";
  }

  // Runs the rule over completed daily closes. A signal forms at a day's close
  // and is acted on the next session (no look-ahead).
  function evaluate(days, input) {
    const opt = options(input);
    if (!validDays(days)) throw new Error("daily closes are invalid");
    if (days.length < opt.maPeriod + 1)
      throw new Error("not enough sessions for the moving average");
    const rows = [];
    const transitions = [];
    let spySum = 0;
    let qqqSum = 0;
    let state = "cash";
    for (let i = 0; i < days.length; i += 1) {
      spySum += days[i].spy;
      qqqSum += days[i].qqq;
      if (i >= opt.maPeriod) {
        spySum -= days[i - opt.maPeriod].spy;
        qqqSum -= days[i - opt.maPeriod].qqq;
      }
      if (i < opt.maPeriod - 1) continue;
      const spyMa = spySum / opt.maPeriod;
      const qqqMa = qqqSum / opt.maPeriod;
      const spyPct = deviation(days[i].spy, spyMa);
      const qqqPct = deviation(days[i].qqq, qqqMa);
      let event = null;
      if (state === "cash" && spyPct >= opt.buyPct && qqqPct >= opt.buyPct) {
        state = "hold";
        event = "buy";
      } else if (state === "hold" && (spyPct <= opt.sellPct || qqqPct <= opt.sellPct)) {
        state = "cash";
        event = "sell";
      }
      const row = { date: days[i].date, spy: days[i].spy, spyMa, spyPct, qqq: days[i].qqq, qqqMa, qqqPct, state, event };
      rows.push(row);
      if (event) transitions.push(row);
    }
    const last = rows[rows.length - 1];
    const lastTransition = transitions[transitions.length - 1] || null;
    const side = (close, ma, pct) => ({
      close,
      ma200: ma,
      pct,
      zone: zone(pct, opt),
      sellLine: ma * (1 + opt.sellPct / 100),
      buyLine: ma * (1 + opt.buyPct / 100),
      // Percent the close must rise to reach the buy line (negative: already above).
      toBuyPct: ((ma * (1 + opt.buyPct / 100)) / close - 1) * 100,
      // Percent the close can fall before reaching the sell line (negative: already below).
      toSellPct: (1 - (ma * (1 + opt.sellPct / 100)) / close) * 100,
    });
    const qqqHeat = last.qqqPct >= opt.heatExitPct ? "exit" : last.qqqPct >= opt.heatHalfPct ? "half" : "none";
    return {
      options: opt,
      rows,
      transitions,
      current: {
        asof: last.date,
        state: last.state,
        since: lastTransition ? lastTransition.date : null,
        // True when the latest close itself formed the signal.
        signalToday: !!lastTransition && lastTransition.date === last.date,
        spy: side(last.spy, last.spyMa, last.spyPct),
        qqq: side(last.qqq, last.qqqMa, last.qqqPct),
        heat: {
          state: qqqHeat,
          halfLine: last.qqqMa * (1 + opt.heatHalfPct / 100),
          exitLine: last.qqqMa * (1 + opt.heatExitPct / 100),
        },
      },
      history: rows.slice(-opt.chartDays).map((row) => ({ date: row.date, spyPct: row.spyPct, qqqPct: row.qqqPct })),
    };
  }

  // Age in days since the 21:00 UTC close of the latest session.
  function freshness(asof, now, staleDays) {
    const end = Date.parse(asof + "T21:00:00Z");
    if (!Number.isFinite(end)) return { stale: true, ageDays: null };
    const ageDays = Math.floor((now.getTime() - end) / DAY_MS);
    return { stale: ageDays >= (staleDays || DEFAULTS.staleDays), ageDays };
  }

  function fromSnapshot(snapshot, now, input) {
    if (!snapshot || snapshot.schema !== "tqqq-ma-daily-v1")
      throw new Error("TQQQ 均线数据格式不兼容");
    const result = evaluate(snapshot.days, input);
    result.freshness = freshness(result.current.asof, now || new Date(), result.options.staleDays);
    result.generatedAt = snapshot.generatedAt || null;
    return result;
  }

  // Manual check from four hand-entered numbers. It cannot know the previous
  // state, so between the lines it reports "none".
  function manual(values, input) {
    const opt = options(input);
    const ok = (x) => Number.isFinite(x) && x > 0;
    const out = { spy: null, qqq: null, verdict: null };
    if (!(ok(values.spyClose) && ok(values.spyMa))) return out;
    const spyPct = deviation(values.spyClose, values.spyMa);
    out.spy = { pct: spyPct, zone: zone(spyPct, opt) };
    if (!(ok(values.qqqClose) && ok(values.qqqMa))) return out;
    const qqqPct = deviation(values.qqqClose, values.qqqMa);
    out.qqq = { pct: qqqPct, zone: zone(qqqPct, opt) };
    out.verdict =
      out.spy.zone === "above" && out.qqq.zone === "above"
        ? "buy"
        : out.spy.zone === "below" || out.qqq.zone === "below"
          ? "sell"
          : "none";
    return out;
  }

  return { DEFAULTS, PLAN, budgetCap, deviation, evaluate, freshness, fromSnapshot, manual, plan, validDays, zone };
});
