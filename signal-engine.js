(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SignalEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const finite = Number.isFinite;
  const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
  const clamp = (value, lower, upper) => Math.min(Math.max(value, lower), upper);

  function decisionChange() {
    const values = Array.prototype.slice.call(arguments).filter(finite);
    return values.length ? Math.min.apply(null, values) : null;
  }

  function marketSignals(closes) {
    if (!Array.isArray(closes) || closes.length < 2 || closes.some((value) => !finite(value) || value <= 0)) {
      throw new TypeError("marketSignals requires at least two finite positive closes");
    }
    const latestClose = closes.at(-1);
    const previousClose = closes.at(-2);
    const lookback = Math.min(5, closes.length - 1);
    const weekAgoClose = closes[closes.length - 1 - lookback];
    const dailyChange = round2(((latestClose - previousClose) / previousClose) * 100);
    const weeklyChange = round2(((latestClose - weekAgoClose) / weekAgoClose) * 100);
    return { latestClose, previousClose, weekAgoClose, dailyChange, weeklyChange, decisionChange: decisionChange(weeklyChange, dailyChange) };
  }

  function score(input, params) {
    if (!finite(input.decisionChange)) return 10;
    const config = params || {};
    let value = 50;
    const move = input.decisionChange;
    if (move < 0) value += Math.min(36, Math.abs(move) * 2.4);
    if (move > 0) value -= Math.min(36, move * 2.8);
    if (finite(input.weeklyChange) && input.weeklyChange <= -20) value += 4;
    if (finite(input.dailyChange) && input.dailyChange <= -8) value += 3;
    if (finite(input.weeklyChange) && Math.abs(input.weeklyChange) >= config.extremeWeeklyThreshold) value -= 12;
    if (finite(input.dailyChange) && Math.abs(input.dailyChange) >= config.volatilityDailyThreshold) value -= 5;
    const algorithm = input.algorithm || {};
    const trend = algorithm.trend || {};
    const regime = algorithm.market_regime || {};
    if (trend.status === "healthy_pullback") value += 9;
    if (trend.status === "strong_downtrend") value -= trend.severe ? 18 : 12;
    if (finite(algorithm.realized_weekly_volatility) && algorithm.realized_weekly_volatility >= 6) value -= 8;
    if (finite(algorithm.drawdown)) {
      if (algorithm.drawdown > 35) value -= 20;
      else if (algorithm.drawdown >= 20) value -= 10;
      else if (algorithm.drawdown >= 10) value -= 3;
    }
    if (regime.type === "Bull") value += 4;
    if (regime.type === "Correction") value -= 7;
    if (regime.type === "Bear") value -= 15;
    if (finite(input.dataAgeHours)) value -= input.dataAgeHours > 24 ? 20 : input.dataAgeHours > 6 ? 8 : 0;
    else value -= 25;
    if (/cache/i.test(input.dataSource || "")) value -= 15;
    if (/manual/i.test(input.dataSource || "") || input.manualOverrideActive) value -= 10;
    if (/unavailable/i.test(input.dataSource || "")) value -= 45;
    if (input.panicActive) value += 6;
    value += ((finite(input.multiplier) ? input.multiplier : 1) - 1) * 18;
    return clamp(Math.round(value), 0, 100);
  }

  return Object.freeze({ decisionChange, marketSignals, score });
});
