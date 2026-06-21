(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DcaPolicy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_CONFIG = Object.freeze({
    enabled: true,
    default_multiplier: 1.0,
    min_multiplier: 0.0,
    max_multiplier: 2.0,
    poor_data_max_multiplier: 1.0,
    unknown_market_max_multiplier: 1.0,
    bull_market_max_multiplier: 2.0,
    neutral_market_max_multiplier: 1.5,
    bear_market_max_multiplier: 1.0,
    panic_market_max_multiplier: 0.75,
    extreme_drawdown_max_multiplier: 1.2,
    extreme_volatility_max_multiplier: 1.0,
    manual_review_blocks_extra_buy: true,
    trend_proxy_periods: 40,
    rsi_periods: 14,
    volatility_periods: 12,
    elevated_weekly_volatility_pct: 4.0,
    extreme_weekly_volatility_pct: 6.0,
    high_exposure_pct: 25.0,
    very_high_exposure_pct: 35.0,
    very_high_exposure_max_multiplier: 0.75,
    max_available_cash_use_ratio: 0.30,
    show_original_amount: true,
    show_factor_chain: true,
    no_broker_no_auto_trade: true
  });

  function evaluateDcaPolicy(input, overrides) {
    const config = Object.assign({}, DEFAULT_CONFIG, overrides || {});
    const baseAmount = roundMoney(nonNegative(input && input.baseAmount));
    const fallback = createFallback(baseAmount, config);

    if (!config.enabled) {
      return Object.assign(fallback, {
        status: "disabled",
        multiplier: 1,
        finalAmount: baseAmount,
        warnings: ["DCA multiplier disabled; using base manual amount"],
        factorChain: [factor("kill_switch", "disabled", "Base manual amount preserved")]
      });
    }

    try {
      const data = input || {};
      const warnings = [];
      const chain = [];
      const caps = [config.max_multiplier];
      let manualReview = false;
      let caution = false;

      if (!isFinitePositive(data.currentPrice)) {
        return {
          status: "blocked",
          multiplier: 0,
          baseAmount,
          finalAmount: 0,
          rawDipMultiplier: 0,
          drawdownPct: null,
          sma200Proxy: null,
          trendDistancePct: null,
          rsi14: null,
          volatilityPct: null,
          concentrationStatus: "not_evaluated",
          factorChain: [factor("data_quality_gate", "blocked", "Missing price data")],
          warnings: ["Missing price data; DCA manual amount blocked"]
        };
      }

      const quality = String(data.dataQuality || "unknown").toLowerCase();
      if (quality === "missing") {
        return {
          status: "blocked",
          multiplier: 0,
          baseAmount,
          finalAmount: 0,
          rawDipMultiplier: 0,
          drawdownPct: null,
          sma200Proxy: null,
          trendDistancePct: null,
          rsi14: null,
          volatilityPct: null,
          concentrationStatus: "not_evaluated",
          factorChain: [factor("data_quality_gate", "blocked", "Required market data missing")],
          warnings: ["Required market data missing; DCA manual amount blocked"]
        };
      }

      if (quality !== "fresh") {
        caps.push(config.poor_data_max_multiplier);
        manualReview = true;
        warnings.push("Poor data quality; no extra buy allowed");
        chain.push(factor("data_quality_gate", "manual_review", "Multiplier capped at 1.00x"));
      } else {
        chain.push(factor("data_quality_gate", "fresh", "Fresh data accepted"));
      }

      const market = marketCap(data.marketRegime, data.marketContextAvailable !== false, data.panicActive === true, config);
      caps.push(market.cap);
      chain.push(factor("market_environment", market.status, market.detail));
      if (market.manualReview) {
        manualReview = true;
        warnings.push(market.warning);
      }

      const closes = validCloses(data.closes);
      const drawdown = calculateDrawdown(closes, data.currentPrice, 52);
      const dip = drawdownTier(drawdown);
      let multiplier = dip.multiplier;
      chain.push(factor("drawdown_tier", dip.status, dip.detail));
      if (dip.manualReview) {
        manualReview = true;
        warnings.push(dip.status === "extreme_drawdown"
          ? "Extreme drawdown; value-trap risk requires manual review"
          : "Drawdown unavailable; manual review required");
        caps.push(config.extreme_drawdown_max_multiplier);
      }

      const trend = trendAdjustment(closes, data.currentPrice, config.trend_proxy_periods);
      multiplier *= trend.adjustment;
      if (Number.isFinite(trend.cap)) caps.push(trend.cap);
      chain.push(factor("trend_filter", trend.status, trend.detail));
      if (trend.manualReview) {
        manualReview = true;
        warnings.push(trend.warning);
      } else if (trend.adjustment < 1) {
        caution = true;
      }

      const rsi = calculateRsi(closes, config.rsi_periods);
      const rsiResult = rsiAdjustment(rsi, quality === "fresh" && !market.manualReview);
      multiplier *= rsiResult.adjustment;
      if (Number.isFinite(rsiResult.cap)) caps.push(rsiResult.cap);
      chain.push(factor("rsi_filter", rsiResult.status, rsiResult.detail));
      if (rsiResult.manualReview) {
        manualReview = true;
        warnings.push(rsiResult.warning);
      }

      const volatility = Number.isFinite(data.volatilityPct)
        ? data.volatilityPct
        : calculateWeeklyVolatilityPct(closes, config.volatility_periods);
      const volatilityResult = volatilityAdjustment(volatility, config);
      multiplier *= volatilityResult.adjustment;
      if (Number.isFinite(volatilityResult.cap)) caps.push(volatilityResult.cap);
      chain.push(factor("volatility_guard", volatilityResult.status, volatilityResult.detail));
      if (volatilityResult.manualReview) {
        manualReview = true;
        warnings.push(volatilityResult.warning);
      } else if (volatilityResult.adjustment < 1) {
        caution = true;
      }

      const concentration = concentrationGuard(data, config);
      if (Number.isFinite(concentration.cap)) caps.push(concentration.cap);
      chain.push(factor("concentration_guard", concentration.status, concentration.detail));
      if (concentration.manualReview) {
        manualReview = true;
        warnings.push(concentration.warning);
      } else if (concentration.status === "caution") {
        caution = true;
      }

      let cap = Math.min.apply(null, caps.filter(Number.isFinite));
      if (manualReview && config.manual_review_blocks_extra_buy) cap = Math.min(cap, 1.0);
      multiplier = clamp(multiplier, config.min_multiplier, cap);
      multiplier = roundMultiplier(multiplier);
      const finalAmount = roundMoney(baseAmount * multiplier);
      const status = manualReview ? "manual_review" : caution ? "caution" : "active";

      chain.push(factor("final_clamp", status, "Applied cap " + cap.toFixed(2) + "x; final " + multiplier.toFixed(2) + "x"));
      chain.push(factor("final_manual_amount", status, money(baseAmount) + " x " + multiplier.toFixed(2) + " = " + money(finalAmount)));

      return {
        status,
        multiplier,
        baseAmount,
        finalAmount,
        rawDipMultiplier: dip.multiplier,
        drawdownPct: nullableRound(drawdown),
        sma200Proxy: nullableRound(trend.sma),
        trendDistancePct: nullableRound(trend.distancePct),
        rsi14: nullableRound(rsi),
        volatilityPct: nullableRound(volatility),
        concentrationStatus: concentration.status,
        factorChain: chain,
        warnings: unique(warnings)
      };
    } catch (error) {
      fallback.warnings = ["DCA multiplier unavailable; using base manual amount"];
      fallback.factorChain = [factor("safety_fallback", "manual_review", "Policy error; base manual amount preserved")];
      return fallback;
    }
  }

  function createFallback(baseAmount, config) {
    return {
      status: "manual_review",
      multiplier: clamp(config.default_multiplier, config.min_multiplier, config.max_multiplier),
      baseAmount,
      finalAmount: baseAmount,
      rawDipMultiplier: 1,
      drawdownPct: null,
      sma200Proxy: null,
      trendDistancePct: null,
      rsi14: null,
      volatilityPct: null,
      concentrationStatus: "not_evaluated",
      factorChain: [],
      warnings: ["DCA multiplier unavailable; using base manual amount"]
    };
  }

  function marketCap(label, available, panic, config) {
    if (panic) return { cap: config.panic_market_max_multiplier, status: "manual_review", manualReview: true, detail: "Panic/severe stress cap 0.75x", warning: "Panic market; reduced DCA cap and manual review required" };
    if (!available) return { cap: config.unknown_market_max_multiplier, status: "manual_review", manualReview: true, detail: "Market context unavailable; cap 1.00x", warning: "Market context unavailable" };
    const value = String(label || "").toLowerCase();
    if (/bull|favorable|risk.?on/.test(value)) return { cap: config.bull_market_max_multiplier, status: "bull", manualReview: false, detail: "Favorable market cap 2.00x" };
    if (/neutral|sideways/.test(value)) return { cap: config.neutral_market_max_multiplier, status: "neutral", manualReview: false, detail: "Neutral market cap 1.50x" };
    if (/correction|weak|bear|risk.?off/.test(value)) return { cap: config.bear_market_max_multiplier, status: "weak", manualReview: false, detail: "Weak/bear market cap 1.00x" };
    return { cap: config.unknown_market_max_multiplier, status: "manual_review", manualReview: true, detail: "Unknown market label; cap 1.00x", warning: "Unknown market regime" };
  }

  function drawdownTier(drawdown) {
    if (!Number.isFinite(drawdown)) return { multiplier: 1, status: "unavailable", manualReview: true, detail: "Drawdown unavailable; no dip bonus" };
    if (drawdown < 5) return { multiplier: 1, status: "normal", manualReview: false, detail: "Drawdown below 5%; raw 1.00x" };
    if (drawdown < 10) return { multiplier: 1.10, status: "small_dip", manualReview: false, detail: "Drawdown 5-10%; raw 1.10x" };
    if (drawdown < 20) return { multiplier: 1.25, status: "medium_dip", manualReview: false, detail: "Drawdown 10-20%; raw 1.25x" };
    if (drawdown < 35) return { multiplier: 1.50, status: "deep_dip", manualReview: false, detail: "Drawdown 20-35%; raw 1.50x" };
    return { multiplier: 1.20, status: "extreme_drawdown", manualReview: true, detail: "Drawdown 35%+; raw 1.20x with value-trap review" };
  }

  function trendAdjustment(closes, currentPrice, periods) {
    if (closes.length < periods) return { adjustment: 1, cap: 1, status: "manual_review", manualReview: true, sma: null, distancePct: null, detail: "Insufficient history for SMA200 proxy; cap 1.00x", warning: "Trend history insufficient" };
    const sma = average(closes.slice(-periods));
    const distance = sma > 0 ? ((currentPrice - sma) / sma) * 100 : null;
    if (!Number.isFinite(distance)) return { adjustment: 1, cap: 1, status: "manual_review", manualReview: true, sma, distancePct: null, detail: "Trend unavailable; cap 1.00x", warning: "Trend unavailable" };
    if (distance >= 0) return { adjustment: 1, cap: null, status: "above_sma", manualReview: false, sma, distancePct: distance, detail: "Price above SMA200 proxy; no penalty" };
    if (distance >= -10) return { adjustment: 0.90, cap: null, status: "below_sma", manualReview: false, sma, distancePct: distance, detail: "0-10% below SMA200 proxy; x0.90" };
    if (distance >= -20) return { adjustment: 0.75, cap: null, status: "manual_review", manualReview: true, sma, distancePct: distance, detail: "10-20% below SMA200 proxy; x0.75", warning: "Material downtrend; manual review required" };
    return { adjustment: 1, cap: 1, status: "manual_review", manualReview: true, sma, distancePct: distance, detail: "More than 20% below SMA200 proxy; cap 1.00x", warning: "Severe downtrend; manual review required" };
  }

  function rsiAdjustment(rsi, bonusAllowed) {
    if (!Number.isFinite(rsi)) return { adjustment: 1, cap: null, status: "unavailable", manualReview: false, detail: "RSI14 unavailable; no bonus" };
    if (rsi < 25) return { adjustment: 1, cap: 1, status: "manual_review", manualReview: true, detail: "RSI14 below 25; cap 1.00x", warning: "Extreme oversold reading; manual review required" };
    if (rsi < 35) return bonusAllowed
      ? { adjustment: 1.10, cap: null, status: "oversold", manualReview: false, detail: "RSI14 25-35; x1.10" }
      : { adjustment: 1, cap: 1, status: "capped", manualReview: false, detail: "RSI14 bonus blocked by data/market gate" };
    if (rsi <= 45) return { adjustment: 1.05, cap: null, status: "soft_oversold", manualReview: false, detail: "RSI14 35-45; x1.05" };
    if (rsi > 60) return { adjustment: 1, cap: 1, status: "no_dip_support", manualReview: false, detail: "RSI14 above 60; extra-buy support capped" };
    return { adjustment: 1, cap: null, status: "neutral", manualReview: false, detail: "RSI14 neutral; no adjustment" };
  }

  function volatilityAdjustment(value, config) {
    if (!Number.isFinite(value)) return { adjustment: 1, cap: null, status: "unavailable", manualReview: false, detail: "Volatility unavailable; no bonus" };
    if (value >= config.extreme_weekly_volatility_pct) return { adjustment: 1, cap: config.extreme_volatility_max_multiplier, status: "manual_review", manualReview: true, detail: "Extreme weekly volatility; cap 1.00x", warning: "Extreme volatility; manual review required" };
    if (value >= config.elevated_weekly_volatility_pct) return { adjustment: 0.85, cap: null, status: "elevated", manualReview: false, detail: "Elevated weekly volatility; x0.85" };
    return { adjustment: 1, cap: null, status: "normal", manualReview: false, detail: "Normal weekly volatility; no penalty" };
  }

  function concentrationGuard(data, config) {
    if (!data.concentrationEvaluated || !Number.isFinite(data.currentAllocationPct)) {
      return { cap: null, status: "not_evaluated", manualReview: false, detail: "Concentration not evaluated; holdings data unavailable" };
    }
    if (data.currentAllocationPct >= config.very_high_exposure_pct) return { cap: config.very_high_exposure_max_multiplier, status: "manual_review", manualReview: true, detail: "Very high exposure; cap 0.75x", warning: "Very high symbol exposure" };
    if (data.currentAllocationPct >= config.high_exposure_pct) return { cap: 1, status: "caution", manualReview: false, detail: "High exposure; cap 1.00x" };
    return { cap: null, status: "clear", manualReview: false, detail: "Position exposure within guard" };
  }

  function calculateDrawdown(closes, currentPrice, lookback) {
    const window = closes.slice(Math.max(0, closes.length - lookback));
    if (!window.length) return null;
    const high = Math.max.apply(null, window.concat([currentPrice]));
    return high > 0 ? ((high - currentPrice) / high) * 100 : null;
  }

  function calculateRsi(closes, periods) {
    if (closes.length <= periods) return null;
    const slice = closes.slice(-(periods + 1));
    let gains = 0;
    let losses = 0;
    for (let index = 1; index < slice.length; index += 1) {
      const change = slice[index] - slice[index - 1];
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }
    const averageGain = gains / periods;
    const averageLoss = losses / periods;
    if (averageLoss === 0) return averageGain > 0 ? 100 : 50;
    const relativeStrength = averageGain / averageLoss;
    return 100 - (100 / (1 + relativeStrength));
  }

  function calculateWeeklyVolatilityPct(closes, periods) {
    if (closes.length < 3) return null;
    const start = Math.max(1, closes.length - periods);
    const returns = [];
    for (let index = start; index < closes.length; index += 1) {
      if (closes[index - 1] > 0) returns.push((closes[index] - closes[index - 1]) / closes[index - 1]);
    }
    if (returns.length < 2) return null;
    const mean = average(returns);
    const variance = returns.reduce(function (sum, value) { return sum + Math.pow(value - mean, 2); }, 0) / (returns.length - 1);
    return Math.sqrt(variance) * 100;
  }

  function validCloses(values) {
    return Array.isArray(values) ? values.map(Number).filter(isFinitePositive) : [];
  }

  function factor(stage, status, detail) {
    return { stage, status, detail };
  }

  function nonNegative(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function isFinitePositive(value) {
    return Number.isFinite(Number(value)) && Number(value) > 0;
  }

  function average(values) {
    return values.reduce(function (sum, value) { return sum + value; }, 0) / values.length;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function roundMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  function roundMultiplier(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  function nullableRound(value) {
    return Number.isFinite(value) ? Math.round((value + Number.EPSILON) * 100) / 100 : null;
  }

  function money(value) {
    return "CAD " + roundMoney(value).toFixed(2);
  }

  function unique(values) {
    return values.filter(function (value, index) { return value && values.indexOf(value) === index; });
  }

  return {
    DEFAULT_CONFIG,
    evaluateDcaPolicy,
    calculateRsi,
    calculateWeeklyVolatilityPct
  };
});
