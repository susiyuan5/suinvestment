(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MarketAnalysis = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const finite = Number.isFinite;
  const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

  function movingAverage(closes, length, offset) {
    if (!Array.isArray(closes) || closes.length < length + offset) return null;
    const end = closes.length - offset;
    const values = closes.slice(end - length, end);
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function percentChange(closes, periods) {
    if (!Array.isArray(closes) || closes.length <= periods) return null;
    const current = closes.at(-1);
    const previous = closes[closes.length - 1 - periods];
    return finite(current) && finite(previous) && previous > 0 ? ((current - previous) / previous) * 100 : null;
  }

  function weeklyVolatility(closes, periods) {
    if (!Array.isArray(closes) || closes.length < 3) return null;
    const start = Math.max(1, closes.length - periods);
    const returns = [];
    for (let index = start; index < closes.length; index += 1) {
      const previous = closes[index - 1];
      const current = closes[index];
      if (finite(previous) && finite(current) && previous > 0 && current > 0) returns.push((current - previous) / previous);
    }
    if (returns.length < 2) return null;
    const average = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance = returns.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) / (returns.length - 1);
    return Math.sqrt(variance);
  }

  function recentDrawdown(closes, lookback) {
    if (!Array.isArray(closes) || !closes.length || closes.some((value) => !finite(value) || value <= 0)) return null;
    const values = closes.slice(Math.max(0, closes.length - lookback));
    const high = Math.max.apply(null, values);
    return high > 0 ? ((high - closes.at(-1)) / high) * 100 : null;
  }

  function tickerTrend(closes, decisionChange) {
    if (!Array.isArray(closes) || closes.length < 21) return { status: "mixed", return_4w: null, return_12w: null, ma20_trend: null, severe: false, healthy_pullback: false };
    const latest = closes.at(-1);
    const return4 = percentChange(closes, 4);
    const return12 = percentChange(closes, 12);
    const ma20 = movingAverage(closes, 20, 0);
    const priorMa20 = movingAverage(closes, 20, 4);
    const ma20Trend = finite(ma20) && finite(priorMa20) && priorMa20 > 0 ? ((ma20 - priorMa20) / priorMa20) * 100 : null;
    const strongDowntrend = (finite(return4) && return4 <= -8 && finite(return12) && return12 <= -12)
      || (finite(ma20) && latest < ma20 && finite(ma20Trend) && ma20Trend < 0 && finite(return12) && return12 < 0);
    const severe = finite(return12) && return12 <= -25;
    const healthyPullback = finite(decisionChange) && decisionChange < 0 && finite(return12) && return12 > 5
      && finite(ma20) && latest >= ma20 * 0.95 && (!finite(ma20Trend) || ma20Trend >= 0);
    return {
      status: strongDowntrend ? "strong_downtrend" : healthyPullback ? "healthy_pullback" : "mixed",
      return_4w: finite(return4) ? round2(return4) : null,
      return_12w: finite(return12) ? round2(return12) : null,
      ma20_trend: finite(ma20Trend) ? round2(ma20Trend) : null,
      severe: strongDowntrend && severe,
      healthy_pullback: !strongDowntrend && healthyPullback
    };
  }

  function marketRegime(rows) {
    const validRows = Array.isArray(rows) ? rows.flatMap((row) => {
      const close = Number(row && row.close);
      return row && row.date && finite(close) && close > 0 ? [{ date: row.date, close }] : [];
    }) : [];
    if (validRows.length < 50) return null;
    const closes = validRows.map((row) => row.close);
    const latest = closes.at(-1);
    const ma20 = movingAverage(closes, 20, 0);
    const ma50 = movingAverage(closes, 50, 0);
    const drawdown = recentDrawdown(closes, 52);
    let type = "Neutral";
    if (finite(drawdown) && drawdown > 20) type = "Bear";
    else if (finite(ma50) && latest < ma50) type = "Bear";
    else if (finite(ma20) && finite(ma50) && latest > ma20 && ma20 > ma50) type = "Bull";
    else if (finite(ma20) && latest < ma20) type = "Correction";
    return { type, rows: validRows, latest: round2(latest), ma20: round2(ma20), ma50: round2(ma50), drawdown: finite(drawdown) ? round2(drawdown) : null };
  }

  return Object.freeze({ movingAverage, percentChange, weeklyVolatility, recentDrawdown, tickerTrend, marketRegime });
});
