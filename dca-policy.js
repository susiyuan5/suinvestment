(function (root, factory) {
  "use strict";
  const api = factory(typeof module === "object" && module.exports ? module : null);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DcaPolicy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (runtimeModule) {
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

  const SAFE_L2_CONFIG = Object.freeze({
    version: "dca-l2-v1",
    cashUsageCap: 0.30,
    base: { normal: 1.0, defensive: 0.5 },
    drawdown: { smallStartPct: 5, smallEndPct: 10, mediumEndPct: 20, deepEndPct: 35, smallExtraEndPct: 0.125, mediumExtraEndPct: 0.25, deepExtraEndPct: 0.5 },
    volatility: { elevatedPct: 4, extremePct: 6 },
    concentration: { highPct: 25, veryHighPct: 35 },
    crashFund: { weeklyReleaseInitialMonthlyBudgetPct: 0.25 },
    recovery: { requiredDistinctPlanWeeks: 2, requiredDistinctTradingDays: 2 },
    budget: { defaultNormalPool: 300, defaultCrashFund: 100, schedule: "weekly_tuesday" },
    configValid: false
  });
  let DEFAULT_L2_CONFIG = loadNodeL2Config() || SAFE_L2_CONFIG;

  function loadNodeL2Config() {
    if (!runtimeModule || typeof runtimeModule.require !== "function") return null;
    try {
      const fs = runtimeModule.require("node:fs");
      const path = runtimeModule.require("node:path");
      const configPath = path.join(__dirname, "data", "dca-l2-policy-config.json");
      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
      return validateL2Config(parsed) ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function validateL2Config(config) {
    return !!config && (config.version === "dca-l2-v1" || config.version === "dca-l2-v2") && config.concentration && Number.isFinite(Number(config.concentration.veryHighPct)) && config.recovery && Number.isFinite(Number(config.recovery.requiredDistinctPlanWeeks || config.recovery.requiredDistinctTradingDays));
  }

  function setL2Config(config) {
    DEFAULT_L2_CONFIG = validateL2Config(config) ? Object.freeze({ ...config, configValid: true }) : SAFE_L2_CONFIG;
    return DEFAULT_L2_CONFIG;
  }

  function getL2Config() { return DEFAULT_L2_CONFIG; }

  function evaluateDcaL2Policy(input, policyState, overrides) {
    const config = mergeL2Config(overrides || DEFAULT_L2_CONFIG);
    const data = input || {};
    const state = { ...(policyState || {}) };
    if (state.crashFundInitial === undefined && Number.isFinite(Number(data.crashFundInitial))) state.crashFundInitial = Number(data.crashFundInitial);
    if (state.crashFundBalance === undefined && Number.isFinite(Number(data.crashFundBalance))) state.crashFundBalance = Number(data.crashFundBalance);
    configureL2BudgetState(data, state, config);
    const baseOriginal = roundMoney(nonNegative(data.baseAmount));
    const price = Number(data.price);
    const quality = String(data.dataStatus || "invalid").toLowerCase();
    const cashProvided = data.availableCashProvided === true;
    const availableCash = Number(data.availableCash);
    const reasons = [];
    const chain = [];
    if (!isFinitePositive(price)) return l2Blocked("HARD_BLOCK_INVALID_PRICE", "invalid price");
    if (["invalid", "missing", "future"].includes(quality)) return l2Blocked("HARD_BLOCK_INVALID_DATA", "invalid or missing data");
    if (cashProvided && (!Number.isFinite(availableCash) || availableCash <= 0)) return l2Blocked("HARD_BLOCK_ZERO_CASH", "available cash is zero");

    const drawdown = Math.max(0, Number(data.drawdownPct) || 0);
    const volatility = Math.max(0, Number(data.volatilityPct) || 0);
    const market = String(data.marketRegime || "Unknown").toLowerCase();
    const panic = data.panicActive === true;
    const trend = String(data.trendStatus || "unavailable").toLowerCase();
    const concentration = Number(data.currentAllocationPct);
    const stale = ["stale", "fallback", "manual", "poor"].includes(quality);
    const closed = quality === "market_closed_last_close";
    const defensiveNow = panic || ["bear", "weak", "risk_off"].includes(market) || volatility >= config.volatility.extremePct;
    const recovery = updateL2Recovery(state, String(data.date || ""), quality, defensiveNow, config);
    const defensive = defensiveNow || recovery.latched;
    let base = baseOriginal;
    if (config.configValid === false) {
      reasons.push("POLICY_CONFIG_UNAVAILABLE");
      chain.push(l2Stage("config", "manual_review", "base amount only; extra and Crash Fund blocked"));
      return l2Finish("manual_review", base, 0, 0, reasons, chain, config, recovery, availableCash, cashProvided, state);
    }
    if (stale) {
      reasons.push("DATA_MANUAL_REVIEW");
      chain.push(l2Stage("data_quality", "manual_review", "base preserved; extra blocked"));
      return l2Finish("manual_review", base, 0, 0, reasons, chain, config, recovery, availableCash, cashProvided, state);
    }
    if (closed) {
      reasons.push("MARKET_CLOSED_LAST_CLOSE");
      chain.push(l2Stage("market_session", "market_closed", "base preserved; extra blocked"));
      return l2Finish("normal", base, 0, 0, reasons, chain, config, recovery, availableCash, cashProvided, state);
    }
    if (defensive) {
      base = roundMoney(baseOriginal * config.base.defensive);
      reasons.push(defensiveNow ? "DEFENSIVE_BASE_50" : "RECOVERY_LATCH_ACTIVE");
      chain.push(l2Stage("defensive_state", "active", "bear/panic/extreme volatility"));
      const result = l2Finish("panic_bear_extreme_volatility", base, 0, 0, reasons, chain, config, recovery, availableCash, cashProvided, state);
      result.defensiveNow = defensiveNow;
      return result;
    }
    if (drawdown >= config.drawdown.deepEndPct) {
      reasons.push("EXTREME_DRAWDOWN_REVIEW");
      chain.push(l2Stage("drawdown", "manual_review", "35%+ value-trap review"));
      return l2Finish("extreme_drawdown_review", base, 0, 0, reasons, chain, config, recovery, availableCash, cashProvided, state);
    }
    const strongDowntrend = ["strong_downtrend", "severe_downtrend", "manual_review"].includes(trend);
    const veryHighConcentration = Number.isFinite(concentration) && concentration >= config.concentration.veryHighPct;
    const highConcentration = Number.isFinite(concentration) && concentration >= config.concentration.highPct;
    const elevated = volatility >= config.volatility.elevatedPct;
    if (veryHighConcentration) {
      reasons.push("CONCENTRATION_VERY_HIGH_BLOCKED");
      chain.push(l2Stage("concentration", "manual_review", "veryHighPct reached; all components blocked"));
      return l2Finish("concentration_blocked", 0, 0, 0, reasons, chain, config, recovery, availableCash, cashProvided, state);
    }
    let tier = l2ExtraTier(drawdown, config);
    let extraPct = tier.pct;
    if (strongDowntrend) { extraPct = 0; reasons.push("EXTRA_BLOCKED_STRONG_DOWNTREND"); }
    if (highConcentration) { extraPct = 0; reasons.push("EXTRA_BLOCKED_CONCENTRATION"); }
    if (elevated) { extraPct = Math.min(extraPct, config.drawdown.mediumExtraEndPct); reasons.push("ELEVATED_VOLATILITY_EXTRA_CAP"); }
    const extra = roundMoney(base * extraPct);
    let crash = 0;
    if (tier.state === "deep_drawdown" && !strongDowntrend && !highConcentration && !elevated) {
      const configuredInitial = Number.isFinite(Number(data.crashFundInitial))
        ? Number(data.crashFundInitial)
        : (Number.isFinite(Number(state.crashFundInitial)) ? Number(state.crashFundInitial) : (Number(config.budget && config.budget.defaultCrashFund) || Number(data.monthlyBudget) || 0));
      const weeklyLimit = roundMoney(configuredInitial * config.crashFund.weeklyReleaseInitialMonthlyBudgetPct);
      const weightInfo = crashFundWeight(data);
      if (weightInfo.reason) reasons.push(weightInfo.reason);
      const balance = Number.isFinite(Number(data.crashFundBalance)) ? Number(data.crashFundBalance) : (Number.isFinite(Number(state.crashFundBalance)) ? Number(state.crashFundBalance) : 0);
      crash = roundMoney(Math.min(weeklyLimit, Math.max(0, balance)) * weightInfo.value);
      reasons.push(crash > 0 ? "CRASH_FUND_PLANNED" : "CRASH_FUND_EMPTY");
    }
    if (extra > 0) reasons.push("EXTRA_DIP_BUY");
    chain.push(l2Stage("drawdown", tier.state, "extra " + (extraPct * 100).toFixed(2) + "%"));
    return l2Finish(tier.state, base, extra, crash, reasons, chain, config, recovery, availableCash, cashProvided, state);
  }

  function mergeL2Config(overrides) {
    const source = overrides || {};
    return {
      ...DEFAULT_L2_CONFIG,
      ...source,
      base: { ...DEFAULT_L2_CONFIG.base, ...(source.base || {}) },
      drawdown: { ...DEFAULT_L2_CONFIG.drawdown, ...(source.drawdown || {}) },
      volatility: { ...DEFAULT_L2_CONFIG.volatility, ...(source.volatility || {}) },
      concentration: { ...DEFAULT_L2_CONFIG.concentration, ...(source.concentration || {}) },
      crashFund: { ...DEFAULT_L2_CONFIG.crashFund, ...(source.crashFund || {}) },
      recovery: { ...DEFAULT_L2_CONFIG.recovery, ...(source.recovery || {}) }
    };
  }

  function updateL2Recovery(state, date, quality, defensiveNow, config) {
    if (defensiveNow) return { latched: true, confirmations: 0, lastWeek: "" };
    if (!state.defensiveLatched) return { latched: false, confirmations: 0, lastWeek: "" };
    const valid = quality === "fresh" && !!date;
    const week = valid ? isoWeekId(date) : "";
    const priorWeek = String(state.lastRecoveryWeek || "");
    let count = Number(state.recoveryConfirmations) || 0;
    if (week && week !== priorWeek) {
      if (priorWeek && !consecutiveIsoWeeks(priorWeek, week)) count = 0;
      count += 1;
    }
    const required = Math.max(1, Number(config.recovery.requiredDistinctPlanWeeks || config.recovery.requiredDistinctTradingDays || 2));
    return { latched: count < required, confirmations: count, lastWeek: week || priorWeek };
  }

  function configureL2BudgetState(data, state, config) {
    const crashInitial = Number.isFinite(Number(data.crashFundInitial))
      ? Number(data.crashFundInitial)
      : (Number.isFinite(Number(state.crashFundInitial)) ? Number(state.crashFundInitial) : (Number.isFinite(Number(data.crashFund)) ? Number(data.crashFund) : Number(config.budget && config.budget.defaultCrashFund) || 0));
    const monthly = Number(data.monthlyBudget);
    const normalPool = Number.isFinite(Number(data.normalPool))
      ? Number(data.normalPool)
      : (Number.isFinite(monthly) ? Math.max(0, monthly - crashInitial) : Number(config.budget && config.budget.defaultNormalPool) || 0);
    const normalUsed = Number.isFinite(Number(data.normalPoolUsed)) ? Number(data.normalPoolUsed) : (Number(state.normalPoolUsed) || 0);
    const crashUsed = Number.isFinite(Number(data.crashFundUsed)) ? Number(data.crashFundUsed) : (Number(state.crashFundUsed) || 0);
    state._normalPoolRemaining = roundMoney(Math.max(0, normalPool - normalUsed));
    state._crashFundRemaining = roundMoney(Math.max(0, crashInitial - crashUsed));
  }

  function isoWeekId(value) {
    const parsed = new Date(String(value) + "T00:00:00Z");
    if (!Number.isFinite(parsed.getTime())) return "";
    const day = parsed.getUTCDay() || 7;
    parsed.setUTCDate(parsed.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(parsed.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((parsed - yearStart) / 86400000) + 1) / 7);
    return parsed.getUTCFullYear() + "-W" + String(week).padStart(2, "0");
  }

  function consecutiveIsoWeeks(previous, current) {
    const parse = function (value) {
      const match = /^([0-9]{4})-W([0-9]{2})$/.exec(value);
      if (!match) return null;
      const date = new Date(Date.UTC(Number(match[1]), 0, 4));
      const day = date.getUTCDay() || 7;
      date.setUTCDate(date.getUTCDate() - day + 1 + (Number(match[2]) - 1) * 7);
      return date;
    };
    const prior = parse(previous); const next = parse(current);
    return !!prior && !!next && next.getTime() - prior.getTime() === 7 * 86400000;
  }

  function l2ExtraTier(drawdown, config) {
    const d = config.drawdown;
    if (drawdown < d.smallStartPct) return { state: "normal", pct: 0 };
    if (drawdown < d.smallEndPct) return { state: "small_drawdown", pct: l2Interpolate(drawdown, d.smallStartPct, d.smallEndPct, 0, d.smallExtraEndPct) };
    if (drawdown < d.mediumEndPct) return { state: "medium_drawdown", pct: l2Interpolate(drawdown, d.smallEndPct, d.mediumEndPct, d.smallExtraEndPct, d.mediumExtraEndPct) };
    return { state: "deep_drawdown", pct: l2Interpolate(drawdown, d.mediumEndPct, d.deepEndPct, d.mediumExtraEndPct, d.deepExtraEndPct) };
  }

  function l2Interpolate(value, start, end, low, high) { return low + (high - low) * Math.min(1, Math.max(0, (value - start) / (end - start))); }
  function l2Stage(stage, status, detail) { return { stage, status, detail }; }
  function l2Blocked(reason, detail) { return { state: "hard_block", baseAmount: 0, extraAmount: 0, crashFundAmount: 0, preCapAmount: 0, finalAmount: 0, cashCapAmount: 0, reasonCodes: [reason], factorChain: [l2Stage("hard_block", "blocked", detail)], manualReview: false, hardBlocked: true, recoveryConfirmations: 0, crashFundBalance: 0, crashFundWeeklyLimit: 0 }; }

  function crashFundWeight(data) {
    if (!Object.prototype.hasOwnProperty.call(data, "crashFundWeight")) return { value: 1, reason: null };
    const value = Number(data.crashFundWeight);
    if (!Number.isFinite(value) || value < 0) return { value: 0, reason: "CRASH_FUND_WEIGHT_INVALID_MANUAL_REVIEW" };
    return { value, reason: null };
  }
  function l2Finish(stateName, base, extra, crash, reasons, chain, config, recovery, availableCash, cashProvided, policyState) {
    const preCap = roundMoney(base + extra + crash);
    const normalRemaining = Number.isFinite(Number(policyState._normalPoolRemaining)) ? roundMoney(policyState._normalPoolRemaining) : null;
    const crashRemaining = Number.isFinite(Number(policyState._crashFundRemaining)) ? roundMoney(policyState._crashFundRemaining) : null;
    if (normalRemaining !== null) {
      const originalBase = base;
      base = roundMoney(Math.min(base, normalRemaining));
      extra = roundMoney(Math.min(extra, Math.max(0, normalRemaining - base)));
      if (base < originalBase || extra < Math.max(0, preCap - originalBase - crash)) reasons.push("NORMAL_POOL_BUDGET_APPLIED");
    }
    if (crashRemaining !== null) {
      const originalCrash = crash;
      crash = roundMoney(Math.min(crash, crashRemaining));
      if (crash < originalCrash) reasons.push("CRASH_FUND_BUDGET_APPLIED");
    }
    const cap = cashProvided && Number.isFinite(availableCash) ? roundMoney(availableCash * config.cashUsageCap) : null;
    let finalBase = base, finalExtra = extra, finalCrash = crash;
    if (cap !== null && finalBase + finalExtra + finalCrash > cap) {
      let reduction = finalBase + finalExtra + finalCrash - cap;
      const crashReduction = Math.min(finalCrash, reduction); finalCrash = roundMoney(finalCrash - crashReduction); reduction -= crashReduction;
      const extraReduction = Math.min(finalExtra, reduction); finalExtra = roundMoney(finalExtra - extraReduction); reduction -= extraReduction;
      finalBase = roundMoney(Math.max(0, finalBase - reduction));
      reasons.push("CASH_CAP_APPLIED"); chain.push(l2Stage("cash_cap", "capped", "cap " + cap.toFixed(2)));
    }
    const finalAmount = roundMoney(finalBase + finalExtra + finalCrash);
    return { state: stateName, baseAmount: roundMoney(finalBase), extraAmount: roundMoney(finalExtra), crashFundAmount: roundMoney(finalCrash), preCapAmount: preCap, finalAmount, cashCapAmount: cap, reasonCodes: l2OrderedReasons(reasons), factorChain: chain.concat([l2Stage("final_amount", stateName, finalAmount.toFixed(2))]), manualReview: ["manual_review", "extreme_drawdown_review", "concentration_blocked"].includes(stateName) || reasons.includes("CRASH_FUND_WEIGHT_INVALID_MANUAL_REVIEW"), hardBlocked: false, recoveryConfirmations: recovery.confirmations, crashFundBalance: roundMoney(Number(policyState.crashFundBalance) || 0), crashFundWeeklyLimit: roundMoney((Number(policyState.crashFundInitial) || 0) * config.crashFund.weeklyReleaseInitialMonthlyBudgetPct) };
  }
  function l2OrderedReasons(reasons) { const order = ["HARD_BLOCK", "DEFENSIVE", "EXTREME", "DATA", "MARKET", "CONCENTRATION", "EXTRA", "CRASH", "NORMAL", "CASH", "ELEVATED", "PORTFOLIO"]; const rank = function (value) { const primary = order.findIndex(x => value.startsWith(x)); const secondary = value === "CRASH_FUND_WEIGHT_INVALID_MANUAL_REVIEW" ? 0 : (value === "CRASH_FUND_EMPTY" ? 1 : 0); return (primary < 0 ? order.length : primary) * 10 + secondary; }; return Array.from(new Set(reasons)).sort((a, b) => rank(a) - rank(b)); }

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
    const number = Number(value);
    return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) / 100 : 0;
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
    DEFAULT_L2_CONFIG,
    SAFE_L2_CONFIG,
    setL2Config,
    getL2Config,
    validateL2Config,
    evaluateDcaPolicy,
    evaluateDcaL2Policy,
    calculateRsi,
    calculateWeeklyVolatilityPct
  };
});
