(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TakeProfitIndicator = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Causal Python V1 port. Thresholds are research signals, never fill prices.
  // Cost inputs use the historical source's split basis; this is not raw cost
  // per share before a later split. Execution gaps, fees and taxes can lose gains.
  const DEFAULT_PARAMETERS = Object.freeze({
    atrMultiple: 3,
    activationPct: 0.05,
    activationATR: 2,
    retainProfit: 0.5,
  });
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

  function number(value, name, allowZero = false) {
    if (typeof value !== "number" && typeof value !== "string") throw new Error(name + " must be a finite number");
    if (typeof value === "string" && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) throw new Error(name + " must be a finite number");
    const result = Number(value);
    if (!Number.isFinite(result) || result < 0 || (!allowZero && result === 0)) throw new Error(name + " must be finite and " + (allowZero ? "nonnegative" : "positive"));
    return result;
  }

  function isoDate(value, name = "date") {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 4) === "0000") throw new Error(name + " must use YYYY-MM-DD");
    const parsed = new Date(value + "T00:00:00Z");
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(name + " must be a valid calendar date");
    return value;
  }

  function ohlc(row, prefix = "") {
    const output = {};
    for (const key of ["open", "high", "low", "close"]) {
      const field = prefix + key;
      if (!own(row, field)) throw new Error("missing required " + field);
      output[key] = number(row[field], field);
    }
    if (output.low > Math.min(output.open, output.close) || output.high < Math.max(output.open, output.close)) throw new Error("OHLC must satisfy low <= open/close <= high");
    return output;
  }

  function normalizeAdjustedBars(rows) {
    if (!Array.isArray(rows)) throw new Error("rows must be an array");
    let previousDate = null;
    return rows.map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("each bar must be a mapping");
      const date = isoDate(row.date);
      if (previousDate !== null && date <= previousDate) throw new Error("bar dates must be strictly increasing");
      if (own(row, "adjusted") && own(row, "adjusted_close") && number(row.adjusted, "adjusted") !== number(row.adjusted_close, "adjusted_close")) throw new Error("adjusted and adjusted_close must agree");
      let values;
      if (["adjusted_open", "adjusted_high", "adjusted_low"].some((key) => own(row, key))) values = ohlc(row, "adjusted_");
      else {
        const raw = ohlc(row);
        if (!own(row, "adjusted") && !own(row, "adjusted_close")) throw new Error("missing required adjusted close");
        const key = own(row, "adjusted_close") ? "adjusted_close" : "adjusted";
        const adjustedClose = number(row[key], key);
        const factor = adjustedClose / raw.close;
        values = {};
        for (const field of ["open", "high", "low", "close"]) values[field] = number(raw[field] * factor, "adjusted " + field);
        values.close = adjustedClose;
        for (const field of ["open", "high", "low"]) if (raw[field] === raw.close) values[field] = adjustedClose;
      }
      previousDate = date;
      return Object.assign({ date }, values);
    });
  }

  function validatedBars(bars) {
    if (!Array.isArray(bars)) throw new Error("bars must be an array");
    let previousDate = null;
    return bars.map((bar) => {
      if (!bar || typeof bar !== "object" || Array.isArray(bar)) throw new Error("each standardized bar must be a mapping");
      const date = isoDate(bar.date);
      if (previousDate !== null && date <= previousDate) throw new Error("bar dates must be strictly increasing");
      previousDate = date;
      return Object.assign({ date }, ohlc(bar));
    });
  }

  function preciseSum(values) {
    let sum = 0, compensation = 0;
    for (const value of values) {
      const corrected = value - compensation;
      const next = sum + corrected;
      compensation = (next - sum) - corrected;
      sum = next;
    }
    return sum;
  }

  function wilderATR(bars, period = 14) {
    if (!Number.isInteger(period) || period < 1) throw new Error("period must be a positive integer");
    const validated = validatedBars(bars);
    const result = Array(validated.length).fill(null), ranges = [];
    let previousClose = null, previousATR = null;
    validated.forEach((bar, index) => {
      let range = bar.high - bar.low;
      if (previousClose !== null) range = Math.max(range, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
      if (index < period) {
        ranges.push(range);
        if (index === period - 1) {
          previousATR = preciseSum(ranges.map((value) => value / period));
          result[index] = previousATR;
        }
      } else {
        previousATR = previousATR * ((period - 1) / period) + range / period;
        result[index] = previousATR;
      }
      previousClose = bar.close;
    });
    return result;
  }

  function parameters(values = DEFAULT_PARAMETERS) {
    if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("parameters must be an object");
    if (Object.keys(values).some((key) => !own(DEFAULT_PARAMETERS, key))) throw new Error("unknown take-profit parameter");
    const output = {};
    for (const key of Object.keys(DEFAULT_PARAMETERS)) output[key] = number(own(values, key) ? values[key] : DEFAULT_PARAMETERS[key], key);
    if (output.retainProfit >= 1) throw new Error("retainProfit must be strictly between 0 and 1");
    return Object.freeze(output);
  }

  function validateState(state) {
    if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("state must be a position object");
    for (const key of ["entryPrice", "entryATR", "peakClose"]) {
      if (number(state[key], key) !== state[key]) throw new Error("state " + key + " must be numeric");
    }
    if (state.peakClose < state.entryPrice) throw new Error("peakClose cannot be below entryPrice");
    if (typeof state.active !== "boolean" || typeof state.signal !== "boolean") throw new Error("active and signal must be booleans");
    const validatedParameters = parameters(state.parameters);
    for (const key of Object.keys(DEFAULT_PARAMETERS)) if (state.parameters[key] !== validatedParameters[key]) throw new Error("state parameters must contain every validated numeric field");
    if (state.active) {
      if (number(state.line, "line") !== state.line || number(state.score, "score", true) !== state.score) throw new Error("active state line and score must be numeric");
      if (state.line > state.peakClose || state.score > 100) throw new Error("active line cannot exceed peak; score must be 0..100");
    } else if (state.line !== null || state.score !== null || state.signal) throw new Error("inactive states cannot have a line, score or signal");
    for (const key of ["entryDate", "lastDate"]) if (state[key] !== null) isoDate(state[key], key);
    if (state.entryDate !== null && state.lastDate !== null && state.lastDate < state.entryDate) throw new Error("lastDate cannot precede entryDate");
  }

  function newPosition(entryPrice, entryATR, options = {}) {
    const state = {
      entryPrice: number(entryPrice, "entryPrice"),
      entryATR: number(entryATR, "entryATR"),
      peakClose: number(entryPrice, "entryPrice"),
      parameters: parameters(options.parameters),
      active: false, line: null, signal: false, score: null,
      entryDate: options.entryDate == null ? null : isoDate(options.entryDate, "entryDate"),
      lastDate: null,
    };
    return Object.freeze(state);
  }

  function updateTakeProfit(state, close, currentATR, options = {}) {
    validateState(state);
    close = number(close, "close");
    currentATR = number(currentATR, "currentATR", true);
    const date = options.date == null ? null : isoDate(options.date);
    if (date !== null) {
      if (state.entryDate !== null && date < state.entryDate) throw new Error("update date cannot precede entry date");
      if (state.lastDate !== null && date <= state.lastDate) throw new Error("update dates must be strictly increasing");
    } else if (state.lastDate !== null || state.entryDate !== null) throw new Error("dated positions require a date for every update");
    const params = state.parameters;
    const peak = Math.max(state.peakClose, close);
    const threshold = Math.max(params.activationPct * state.entryPrice, params.activationATR * state.entryATR);
    if (!Number.isFinite(threshold)) throw new Error("activation threshold exceeds finite numeric range");
    const active = state.active || peak - state.entryPrice >= threshold;
    if (!active) return Object.freeze(Object.assign({}, state, { peakClose: peak, lastDate: date }));
    const retainedLine = state.entryPrice + params.retainProfit * (peak - state.entryPrice);
    let line = Math.max(peak - params.atrMultiple * currentATR, retainedLine);
    if (state.line !== null) line = Math.max(line, state.line);
    const signal = close <= line, gap = peak - line;
    const score = gap > 0 ? Math.min(100, Math.max(0, 100 * ((peak - close) / gap))) : (signal ? 100 : 0);
    return Object.freeze(Object.assign({}, state, { peakClose: peak, active: true, line, signal, score, lastDate: date }));
  }

  const REASONS = Object.freeze({
    expected_session_missing: "交易日历尚未确认最近完整交易日，暂停计算。",
    expected_session_invalid: "最近完整交易日格式无效，暂停计算。",
    rows_missing: "缺少经过验证的复权日线数据。",
    invalid_daily_bars: "日线日期、OHLC 或复权字段无效，暂停计算。",
    stale_daily_bars: "日线尚未覆盖最近完整交易日，暂停计算。",
    future_daily_bars: "日线含未完成或未来交易日，暂停计算。",
    entry_date_missing: "请填写持仓起始交易日。",
    entry_date_invalid: "持仓起始日期无效。",
    entry_date_not_observed: "起始日期不在已验证日线中，请选择实际交易日。",
    entry_date_after_expected_session: "起始日期晚于最近完整交易日。",
    insufficient_prior_bars: "入场前需要至少 14 根完整日线计算 ATR。",
    invalid_entry_price: "请填写有效的美元每股成本。",
    invalid_adjustment_factor: "复权价格与原始价格无法换算，暂停计算。",
    invalid_position_calculation: "持仓数值无法完成有效计算，暂停计算。",
    awaiting_activation: "尚未达到止盈启动条件。",
    trailing_active: "止盈线已启动，等待完整收盘触及。",
    first_trigger: "历史完整收盘已触发，请结合首次触发日期人工复核。",
  });

  // Calendar authority is deliberately provided by the caller. Mixed snapshots
  // containing even one bar later than expectedSession are blocked as a whole.
  function evaluatePosition(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) input = {};
    const output = {
      version: "take-profit-v1", researchOnly: true, noTrade: true,
      status: "blocked", reasonCode: null, reason: null, reasonDetail: null,
      entryDate: input.entryDate || null, expectedSession: input.expectedSession || null,
      entryInputPrice: null, lastDate: null, signalDate: null, firstSignalDate: null,
      historicalTrigger: false, active: false, signal: false,
      currentPrice: null, peakPrice: null, line: null, costPrice: null,
      activationPrice: null, gainPct: null, score: null, entryATR: null,
      entryFactor: null, latestFactor: null, ignoredFutureRows: 0,
      parameters: DEFAULT_PARAMETERS,
      priceBasis: "latest_raw_usd", costBasis: "current_share_split_basis_usd",
      adjustmentExplanation: "先按起始日 adjusted close / raw close 将成本转为复权坐标；止盈线、峰值和可比成本除以最新同类复权因子，换算到最新原始美元报价。含股息复权影响，不代表可保证的成交收益。",
    };
    function blocked(code, detail = null) {
      return Object.freeze(Object.assign({}, output, { reasonCode: code, reason: REASONS[code], reasonDetail: detail }));
    }
    if (!input.expectedSession) return blocked("expected_session_missing");
    try { isoDate(input.expectedSession, "expectedSession"); } catch (error) { return blocked("expected_session_invalid", error.message); }
    if (!Array.isArray(input.rows) || input.rows.length === 0) return blocked("rows_missing");
    let bars;
    try { bars = normalizeAdjustedBars(input.rows); } catch (error) { return blocked("invalid_daily_bars", error.message); }
    output.lastDate = bars[bars.length - 1].date;
    if (output.lastDate > input.expectedSession) return blocked("future_daily_bars");
    if (output.lastDate < input.expectedSession) return blocked("stale_daily_bars");
    if (!input.entryDate) return blocked("entry_date_missing");
    try { isoDate(input.entryDate, "entryDate"); } catch (error) { return blocked("entry_date_invalid", error.message); }
    if (input.entryDate > input.expectedSession) return blocked("entry_date_after_expected_session");
    const entryIndex = bars.findIndex((bar) => bar.date === input.entryDate);
    if (entryIndex < 0) return blocked("entry_date_not_observed");
    if (entryIndex < 14) return blocked("insufficient_prior_bars");
    try { output.entryInputPrice = number(input.entryPrice, "entryPrice"); } catch (error) { return blocked("invalid_entry_price", error.message); }
    const latestIndex = bars.length - 1;
    try {
      output.entryFactor = number(bars[entryIndex].close / number(input.rows[entryIndex].close, "entry raw close"), "entryFactor");
      output.latestFactor = number(bars[latestIndex].close / number(input.rows[latestIndex].close, "latest raw close"), "latestFactor");
    } catch (error) { return blocked("invalid_adjustment_factor", error.message); }
    try {
      const atr = wilderATR(bars);
      output.entryATR = number(atr[entryIndex - 1], "entryATR");
      let state = newPosition(output.entryInputPrice * output.entryFactor, output.entryATR, { entryDate: input.entryDate });
      for (let index = entryIndex; index < bars.length; index++) {
        state = updateTakeProfit(state, bars[index].close, atr[index], { date: bars[index].date });
        if (state.signal) {
          output.signalDate = state.lastDate;
          output.firstSignalDate = state.lastDate;
          break; // Keep the first trigger's line/peak/score even after recovery.
        }
      }
      const raw = (value) => value === null ? null : number(value / output.latestFactor, "latest raw level");
      output.currentPrice = number(input.rows[latestIndex].close, "latest raw close");
      output.peakPrice = raw(state.peakClose);
      output.line = raw(state.line);
      output.costPrice = raw(state.entryPrice);
      const activationGain = Math.max(state.parameters.activationPct * state.entryPrice, state.parameters.activationATR * state.entryATR);
      output.activationPrice = raw(state.entryPrice + activationGain);
      output.gainPct = ((bars[latestIndex].close - state.entryPrice) / state.entryPrice) * 100;
      if (!Number.isFinite(output.gainPct)) throw new Error("gainPct exceeds finite numeric range");
      output.score = state.score;
      output.active = state.active;
      output.signal = output.signalDate !== null;
      output.historicalTrigger = output.signalDate !== null && output.signalDate < output.lastDate;
      output.status = output.signal ? "triggered" : (state.active ? "active" : "inactive");
      output.reasonCode = output.signal ? "first_trigger" : (state.active ? "trailing_active" : "awaiting_activation");
      output.reason = REASONS[output.reasonCode];
      return Object.freeze(output);
    } catch (error) {
      // Keep partially calculated values out of any blocked result.
      output.currentPrice = output.peakPrice = output.line = output.costPrice = output.activationPrice = output.gainPct = output.score = null;
      output.signalDate = output.firstSignalDate = null;
      output.signal = output.active = output.historicalTrigger = false;
      return blocked("invalid_position_calculation", error.message);
    }
  }

  return Object.freeze({ DEFAULT_PARAMETERS, REASONS, normalizeAdjustedBars, wilderATR, newPosition, updateTakeProfit, evaluatePosition });
});
