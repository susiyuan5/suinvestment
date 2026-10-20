(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BtcTrendSignal = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // BTC weekly trend rule (research-only, manual decision support).
  // Backtest basis: docs/BTC_WEEKLY_TREND_SIGNAL_2026-10-20.md
  const DEFAULTS = Object.freeze({
    maPeriod: 20, // 20-week simple moving average of complete weekly closes
    entryWeeks: 2, // enter after N consecutive closes above the MA
    exitWeeks: 1, // exit after N consecutive closes below the MA
    staleDays: 9, // latest complete week older than this → stale
  });
  const DAY_MS = 86400000;

  function options(input) {
    const merged = Object.assign({}, DEFAULTS, input || {});
    for (const key of ["maPeriod", "entryWeeks", "exitWeeks"]) {
      if (!Number.isInteger(merged[key]) || merged[key] < 1)
        throw new Error("invalid option " + key);
    }
    return merged;
  }

  function validWeeks(weeks) {
    if (!Array.isArray(weeks)) return false;
    let previous = null;
    for (const row of weeks) {
      if (!row || !/^\d{4}-\d{2}-\d{2}$/.test(row.week_end || "")) return false;
      if (!(Number.isFinite(row.close) && row.close > 0)) return false;
      const stamp = Date.parse(row.week_end + "T00:00:00Z");
      if (!Number.isFinite(stamp) || new Date(stamp).getUTCDay() !== 0)
        return false;
      if (previous !== null && stamp - previous !== 7 * DAY_MS) return false;
      previous = stamp;
    }
    return true;
  }

  // Runs the state machine over complete weekly closes. The signal formed at
  // a week's close applies from the following week (no look-ahead).
  function evaluate(weeks, input) {
    const opt = options(input);
    if (!validWeeks(weeks)) throw new Error("weekly closes are invalid");
    if (weeks.length < opt.maPeriod + 1)
      throw new Error("not enough complete weeks for the moving average");
    const rows = [];
    const transitions = [];
    let sum = 0;
    let position = 0;
    let aboveStreak = 0;
    let belowStreak = 0;
    for (let i = 0; i < weeks.length; i += 1) {
      sum += weeks[i].close;
      if (i >= opt.maPeriod) sum -= weeks[i - opt.maPeriod].close;
      if (i < opt.maPeriod - 1) continue;
      const ma = sum / opt.maPeriod;
      const close = weeks[i].close;
      const above = close > ma;
      if (above) {
        aboveStreak += 1;
        belowStreak = 0;
      } else {
        belowStreak += 1;
        aboveStreak = 0;
      }
      let event = null;
      if (position === 0 && aboveStreak >= opt.entryWeeks) {
        position = 1;
        event = "enter";
      } else if (position === 1 && belowStreak >= opt.exitWeeks) {
        position = 0;
        event = "exit";
      }
      const row = {
        weekEnd: weeks[i].week_end,
        close,
        ma,
        above,
        aboveStreak,
        belowStreak,
        position,
        event,
      };
      rows.push(row);
      if (event) transitions.push(row);
    }
    const last = rows[rows.length - 1];
    // Next week's MA includes next week's close x: MA' = (S + x) / N where S is
    // the sum of the latest N-1 closes. x > MA' ⇔ x > S / (N - 1).
    const recent = weeks.slice(-(opt.maPeriod - 1));
    const threshold =
      opt.maPeriod > 1
        ? recent.reduce((total, row) => total + row.close, 0) / recent.length
        : last.close;
    let nextStep;
    if (last.position === 1) {
      nextStep = {
        kind: "exit-watch",
        price: threshold,
        weeksNeeded: Math.max(1, opt.exitWeeks - last.belowStreak),
      };
    } else {
      nextStep = {
        kind: "entry-watch",
        price: threshold,
        weeksNeeded: Math.max(1, opt.entryWeeks - last.aboveStreak),
      };
    }
    return {
      options: opt,
      rows,
      transitions,
      current: {
        weekEnd: last.weekEnd,
        close: last.close,
        ma: last.ma,
        distancePct: (last.close / last.ma - 1) * 100,
        state: last.position === 1 ? "holding" : "cash",
        aboveStreak: last.aboveStreak,
        belowStreak: last.belowStreak,
        lastTransition: transitions[transitions.length - 1] || null,
      },
      nextStep,
    };
  }

  function freshness(lastWeekEnd, now, staleDays) {
    const end = Date.parse(lastWeekEnd + "T23:59:59Z");
    if (!Number.isFinite(end)) return { stale: true, ageDays: null };
    const ageDays = Math.floor((now.getTime() - end) / DAY_MS);
    return {
      stale: ageDays > (staleDays || DEFAULTS.staleDays),
      ageDays,
    };
  }

  function fromSnapshot(snapshot, now, input) {
    if (!snapshot || snapshot.schema !== "btc-weekly-v1")
      throw new Error("BTC 周线数据格式不兼容");
    const result = evaluate(snapshot.weeks, input);
    result.freshness = freshness(
      result.current.weekEnd,
      now || new Date(),
      result.options.staleDays,
    );
    result.partial =
      snapshot.partial && Number.isFinite(snapshot.partial.close)
        ? snapshot.partial
        : null;
    result.generatedAt = snapshot.generatedAt || null;
    return result;
  }

  return { DEFAULTS, evaluate, freshness, fromSnapshot, validWeeks };
});
