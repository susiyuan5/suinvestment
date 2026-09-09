(function(root, factory) {
 const api = typeof module === 'object' && module.exports ? factory(require('./weekly-dca-engine')) : factory(root.WeeklyDcaEngine);
 if (typeof module === 'object' && module.exports) module.exports = api;
 if (root) root.WeeklySignalModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(WeeklyDcaEngine) {
 'use strict';
 const isFiniteNumber = Number.isFinite;
 const round2 = value => Math.round((value + Number.EPSILON) * 100) / 100;
 const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
  const ALGORITHM_PARAMS = {
    sensitivity: 4,
    minMultiplier: 0.3,
    maxMultiplier: 2.0,
    strongDropThreshold: -15,
    strongRiseThreshold: 10,
    volatilityDailyThreshold: 8,
    volatilityWeeklyThreshold: 15,
    extremeWeeklyThreshold: 25,
    maxDowntrendMultiplier: 1.5,
    severeDowntrendMultiplier: 1.2,
    crashBoost: 0.12,
    volatilityReduction: 0.9,
    underAllocationScoreBonus: 5,
    overAllocationScorePenalty: 10,
    farOverAllocationScorePenalty: 25
  };
  const LOW_FREQ_ALGO_PARAMS = {
    marketRegimeEnabled: true,
    trendFilterEnabled: true,
    volatilityAdjustmentEnabled: true,
    drawdownFilterEnabled: true,
    targetWeeklyVolatility: 0.04,
    maxBullMultiplier: 2.0,
    maxNeutralMultiplier: 1.5,
    maxCorrectionMultiplier: 1.3,
    maxBearMultiplier: 1.1,
    maxDrawdown20Multiplier: 1.3,
    maxDrawdown35Multiplier: 1.1,
    overTargetReduceThreshold: 0.05,
    overTargetBlockThreshold: 0.10,
    overTargetSellWatchThreshold: 0.15
  };
  function calculateSmoothMultiplier(decisionChange, dailyChange, weeklyChange) {
    if (!isFiniteNumber(decisionChange)) {
      return {
        multiplier: 1,
        rawMultiplier: 1,
        volatilityReduced: false,
        downtrendCapped: false,
        severeDowntrend: false,
        crashBoostApplied: false
      };
    }

    let multiplier = 1 - ALGORITHM_PARAMS.sensitivity * decisionChange / 100;
    const crashBoostApplied = decisionChange <= ALGORITHM_PARAMS.strongDropThreshold;
    if (crashBoostApplied) multiplier += ALGORITHM_PARAMS.crashBoost;

    const volatilityReduced = (
      isFiniteNumber(dailyChange) && Math.abs(dailyChange) >= ALGORITHM_PARAMS.volatilityDailyThreshold
    );
    if (volatilityReduced) multiplier *= ALGORITHM_PARAMS.volatilityReduction;

    const weeklyAbs = isFiniteNumber(weeklyChange) ? Math.abs(weeklyChange) : 0;
    const severeDowntrend = isFiniteNumber(weeklyChange) && weeklyChange <= -ALGORITHM_PARAMS.extremeWeeklyThreshold;
    const downtrendCapped = (
      isFiniteNumber(weeklyChange) &&
      isFiniteNumber(dailyChange) &&
      weeklyChange <= -ALGORITHM_PARAMS.volatilityWeeklyThreshold &&
      dailyChange < 0
    );

    if (severeDowntrend) {
      multiplier = Math.min(multiplier, ALGORITHM_PARAMS.severeDowntrendMultiplier);
    } else if (downtrendCapped || weeklyAbs >= ALGORITHM_PARAMS.extremeWeeklyThreshold) {
      multiplier = Math.min(multiplier, ALGORITHM_PARAMS.maxDowntrendMultiplier);
    }

    return {
      multiplier: round2(clamp(multiplier, ALGORITHM_PARAMS.minMultiplier, ALGORITHM_PARAMS.maxMultiplier)),
      rawMultiplier: round2(multiplier),
      volatilityReduced,
      downtrendCapped: downtrendCapped || severeDowntrend,
      severeDowntrend,
      crashBoostApplied
    };
  }

  function getMarketRegimeMultiplierCap(type) {
    if (type === "Bull") return LOW_FREQ_ALGO_PARAMS.maxBullMultiplier;
    if (type === "Correction") return LOW_FREQ_ALGO_PARAMS.maxCorrectionMultiplier;
    if (type === "Bear") return LOW_FREQ_ALGO_PARAMS.maxBearMultiplier;
    return LOW_FREQ_ALGO_PARAMS.maxNeutralMultiplier;
  }

  function calculateRiskLevel(signal) {
    if (signal.data_source === "Unavailable" || signal.data_freshness === "missing" || !isFiniteNumber(signal.decision_change)) return "Extreme";
    if (signal.data_freshness === "stale") return "High";

    let risk = 0;
    if (/cache|manual/i.test(signal.data_source) || signal.manual_override_active) risk += 1;
    if (isFiniteNumber(signal.weekly_change) && Math.abs(signal.weekly_change) >= ALGORITHM_PARAMS.extremeWeeklyThreshold) risk += 3;
    else if (isFiniteNumber(signal.weekly_change) && Math.abs(signal.weekly_change) >= ALGORITHM_PARAMS.volatilityWeeklyThreshold) risk += 2;
    if (isFiniteNumber(signal.decision_change) && Math.abs(signal.decision_change) >= 15) risk += 2;
    else if (isFiniteNumber(signal.decision_change) && Math.abs(signal.decision_change) >= 8) risk += 1;
    if (isFiniteNumber(signal.daily_change) && Math.abs(signal.daily_change) >= ALGORITHM_PARAMS.volatilityDailyThreshold) risk += 1;
    if (signal.algorithm && signal.algorithm.downtrendCapped) risk += 1;
    if (signal.algorithm && signal.algorithm.trend && signal.algorithm.trend.status === "strong_downtrend") risk += signal.algorithm.trend.severe ? 2 : 1;
    if (signal.algorithm && isFiniteNumber(signal.algorithm.realized_weekly_volatility) && signal.algorithm.realized_weekly_volatility >= 6) risk += 1;
    if (signal.algorithm && isFiniteNumber(signal.algorithm.drawdown)) {
      if (signal.algorithm.drawdown > 35) risk += 3;
      else if (signal.algorithm.drawdown >= 20) risk += 2;
      else if (signal.algorithm.drawdown >= 10) risk += 1;
    }
    if (signal.algorithm && signal.algorithm.market_regime && signal.algorithm.market_regime.type === "Correction") risk += 1;
    if (signal.algorithm && signal.algorithm.market_regime && signal.algorithm.market_regime.type === "Bear") risk += 2;
    if (signal.panic_active) risk += 1;
    if (signal.multiplier >= 2) risk += 2;
    else if (signal.multiplier > 1.5) risk += 1;

    if (risk >= 5) return "Extreme";
    if (risk >= 3) return "High";
    if (risk >= 1) return "Medium";
    return "Low";
  }

  function getSuggestedAction(signal) {
    if (signal.data_source === "Unavailable" || signal.data_freshness === "missing" || signal.data_freshness === "stale") return "DO_NOT_BUY";
    if (!isFiniteNumber(signal.decision_change)) return "DO_NOT_BUY";
    if (signal.decision_change >= 15) return "CONSIDER_SELL";
    if (signal.risk_level === "Extreme") return "DO_NOT_BUY";
    if (signal.algorithm && isFiniteNumber(signal.algorithm.drawdown) && signal.algorithm.drawdown > 35) return "DO_NOT_BUY";
    if (signal.algorithm && signal.algorithm.trend && signal.algorithm.trend.status === "strong_downtrend" && signal.signal_score <= 60) return "REDUCE_BUY";
    if (signal.signal_score <= 20) return "DO_NOT_BUY";
    if (signal.signal_score <= 40) return "REDUCE_BUY";
    if (signal.signal_score <= 60) return "NORMAL_BUY";
    if (signal.signal_score <= 80) return "BUY";
    if (signal.algorithm && signal.algorithm.market_regime && signal.algorithm.market_regime.type === "Bear") return "BUY";
    return "STRONG_BUY";
  }

  function getActionLabelFromMultiplier(signal) {
    const m = isFiniteNumber(signal.multiplier) ? signal.multiplier : 1;
    const sc = isFiniteNumber(signal.signal_score) ? signal.signal_score : 0;
    const rl = signal.risk_level || "Low";
    const wc = isFiniteNumber(signal.weekly_change) ? signal.weekly_change : 0;

    if (m >= 0.90 && m < 1.00) return { label: "低于基准投入", cls: "action-light-reduce" };

    // Hard stops
    if (m < 0.40) return { label: "暂停买入", cls: "action-pause-buy" };
    if (sc < 20 && wc < 0) return { label: "暂停买入", cls: "action-pause-buy" };
    if (rl === "Extreme") return { label: "暂停买入", cls: "action-pause-buy" };

    // Base label from multiplier
    var label, cls;
    if (m >= 1.60) { label = "强烈买入"; cls = "action-strong-buy"; }
    else if (m >= 1.20) { label = "买入"; cls = "action-buy"; }
    else if (m >= 1.00) { label = "小幅买入"; cls = "action-light-buy"; }
    else if (m >= 0.90) { label = "观望"; cls = "action-watch"; }
    else if (m >= 0.70) { label = "小幅减少买入"; cls = "action-light-reduce"; }
    else if (m >= 0.40) { label = "减少买入"; cls = "action-reduce"; }
    else { label = "暂停买入"; cls = "action-pause-buy"; }

    // Level map: higher number = more cautious
    var LEVELS = { "action-strong-buy": 1, "action-buy": 2, "action-light-buy": 3, "action-watch": 4, "action-light-reduce": 5, "action-reduce": 6, "action-pause-buy": 7 };
    var currentLevel = LEVELS[cls] || 7;

    // High risk safety caps
    if (rl === "High") {
      var cap = 7;
      if (sc < 30) cap = 5;
      else if (sc < 45) cap = 4;

      if (currentLevel < cap) {
        var capMap = { 4: { label: "观望", cls: "action-watch" }, 5: { label: "小幅减少买入", cls: "action-light-reduce" } };
        return capMap[cap] || { label: label, cls: cls };
      }

      // Strong buy downgrade for High risk
      if (cls === "action-strong-buy" && m >= 1.60 && !(sc >= 80 && wc > 0)) {
        return { label: "买入", cls: "action-buy" };
      }
    }

    return { label: label, cls: cls };
  }

  function calculateEnhancedLowFrequencyMultiplier(history, decisionChange, dailyChange, weeklyChange, marketRegime) {
    const smooth = calculateSmoothMultiplier(decisionChange, dailyChange, weeklyChange);
    const closes = history.map(function (row) { return row.close; });
    const sharedIndicators = WeeklyDcaEngine.indicators(history, decisionChange);
    const trend = sharedIndicators.trend;
    const realizedVolatility = sharedIndicators.rawWeeklyVolatility;
    const drawdown = sharedIndicators.rawDrawdownPct;

    let multiplier = smooth.multiplier;
    let volatilityAdjustment = 1;
    let regimeCap = LOW_FREQ_ALGO_PARAMS.maxBullMultiplier;
    let trendCap = ALGORITHM_PARAMS.maxMultiplier;
    let drawdownCap = ALGORITHM_PARAMS.maxMultiplier;

    if (LOW_FREQ_ALGO_PARAMS.volatilityAdjustmentEnabled && isFiniteNumber(realizedVolatility) && realizedVolatility > 0) {
      volatilityAdjustment = clamp(
        LOW_FREQ_ALGO_PARAMS.targetWeeklyVolatility / realizedVolatility,
        0.7,
        1.1
      );
      multiplier *= volatilityAdjustment;
    }

    if (LOW_FREQ_ALGO_PARAMS.marketRegimeEnabled) {
      regimeCap = getMarketRegimeMultiplierCap(marketRegime && marketRegime.type);
      multiplier = Math.min(multiplier, regimeCap);
    }

    if (LOW_FREQ_ALGO_PARAMS.trendFilterEnabled && trend.status === "strong_downtrend") {
      trendCap = trend.severe ? ALGORITHM_PARAMS.severeDowntrendMultiplier : ALGORITHM_PARAMS.maxDowntrendMultiplier;
      multiplier = Math.min(multiplier, trendCap);
    }

    if (LOW_FREQ_ALGO_PARAMS.drawdownFilterEnabled && isFiniteNumber(drawdown)) {
      if (drawdown > 35) drawdownCap = LOW_FREQ_ALGO_PARAMS.maxDrawdown35Multiplier;
      else if (drawdown >= 20) drawdownCap = LOW_FREQ_ALGO_PARAMS.maxDrawdown20Multiplier;
      multiplier = Math.min(multiplier, drawdownCap);
    }

    const finalMultiplier = round2(clamp(multiplier, ALGORITHM_PARAMS.minMultiplier, ALGORITHM_PARAMS.maxMultiplier));
    return {
      multiplier: finalMultiplier,
      rawMultiplier: smooth.rawMultiplier,
      raw_smooth_multiplier: smooth.multiplier,
      volatility_adjustment: round2(volatilityAdjustment),
      regime_adjustment: round2(regimeCap),
      trend_adjustment: round2(trendCap),
      drawdown_adjustment: round2(drawdownCap),
      portfolio_adjustment: 1,
      final_multiplier: finalMultiplier,
      volatilityReduced: smooth.volatilityReduced || volatilityAdjustment < 0.99,
      downtrendCapped: smooth.downtrendCapped || trend.status === "strong_downtrend",
      severeDowntrend: smooth.severeDowntrend || (trend.status === "strong_downtrend" && trend.severe),
      crashBoostApplied: smooth.crashBoostApplied,
      trend,
      market_regime: marketRegime || { type: "Neutral" },
      realized_weekly_volatility: isFiniteNumber(realizedVolatility) ? round2(realizedVolatility * 100) : null,
      drawdown: isFiniteNumber(drawdown) ? round2(drawdown) : null,
      explanation: ""
    };
  }

 return Object.freeze({ ALGORITHM_PARAMS, LOW_FREQ_ALGO_PARAMS, calculateSmoothMultiplier, getMarketRegimeMultiplierCap,
   calculateRiskLevel, getSuggestedAction, getActionLabelFromMultiplier, calculateEnhancedLowFrequencyMultiplier });
});
