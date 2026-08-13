(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ShortTermDailyBars = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  function number(value) { var result = Number(value); return Number.isFinite(result) ? result : null; }
  function validateRows(rows, minimum) {
    var errors = [], normalized = [], previous = "";
    if (!Array.isArray(rows)) return { rows: [], errors: ["rows_missing"] };
    rows.forEach(function (raw, index) {
      var values = raw && { open: number(raw.open), high: number(raw.high), low: number(raw.low), close: number(raw.close), volume: number(raw.volume), adjusted: number(raw.adjusted) };
      if (!values || Object.keys(values).some(function (key) { return values[key] === null || values[key] <= 0; })) { errors.push("row_" + index + "_ohlcv_missing"); return; }
      var date = String(raw.date || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { errors.push("row_" + index + "_date_invalid"); return; }
      if (previous && date <= previous) errors.push("dates_not_strictly_increasing"); previous = date;
      if (values.high < Math.max(values.open, values.close) || values.low > Math.min(values.open, values.close)) errors.push("row_" + index + "_ohlc_inconsistent");
      normalized.push(Object.assign({ date: date }, values));
    });
    if (normalized.length < (minimum || 252)) errors.push("insufficient_daily_history");
    return { rows: normalized, errors: Array.from(new Set(errors)) };
  }
  function validateSnapshot(payload, symbols, benchmark) {
    if (!payload || payload.schema_version !== "short-term-daily-bars-v1" || payload.research_only !== true) return { valid: false, errors: ["snapshot_schema_invalid"] };
    if (payload.frequency !== "1d" || payload.adjustment !== "split_and_dividend_adjusted") return { valid: false, errors: ["snapshot_adjustment_or_frequency_invalid"] };
    var all = (symbols || []).concat([benchmark || "QQQ"]), errors = [], coverage = {};
    all.forEach(function (symbol) { var result = validateRows(payload.symbols && payload.symbols[symbol], 252); coverage[symbol] = { rows: result.rows.length, valid: result.errors.length === 0 }; result.errors.forEach(function (error) { errors.push(symbol + ":" + error); }); });
    return { valid: errors.length === 0, errors: Array.from(new Set(errors)), coverage: coverage };
  }
  return { validateRows: validateRows, validateSnapshot: validateSnapshot };
});
