(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.WealthsimpleCurrency = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  var KEY = "su-investment-pro:wealthsimple-currency-v1";
  var USD_MIGRATION_VERSION = "usd-planning-v2";
  var DEFAULTS = { planningCurrency: "USD", accountCurrency: "CAD", displayCurrency: "CAD", clientTier: "Core", usdAccountEnabled: false, fxRate: null, fxAsOf: null, fxFeeRate: 0.015, fxMaxAgeDays: 3, planningMigrationVersion: null, planningMigrationPending: false, migrationNoticeShown: false };
  function finite(value) { return typeof value === "number" && Number.isFinite(value); }
  function read(storage) { try { var raw = storage && storage.getItem(KEY); return raw ? JSON.parse(raw) : {}; } catch (_) { return {}; } }
  function normalize(input) {
    var value = input && typeof input === "object" ? input : {};
    return Object.assign({}, DEFAULTS, value, {
      planningCurrency: ["CAD", "USD"].includes(value.planningCurrency) ? value.planningCurrency : DEFAULTS.planningCurrency,
      accountCurrency: ["CAD", "USD"].includes(value.accountCurrency) ? value.accountCurrency : "CAD",
      displayCurrency: ["CAD", "USD"].includes(value.displayCurrency) ? value.displayCurrency : "CAD",
      clientTier: ["Core", "Premium", "Generation"].includes(value.clientTier) ? value.clientTier : "Core",
      usdAccountEnabled: value.usdAccountEnabled === true,
      fxRate: finite(Number(value.fxRate)) && Number(value.fxRate) > 0 ? Number(value.fxRate) : null,
      fxFeeRate: finite(Number(value.fxFeeRate)) && Number(value.fxFeeRate) >= 0 ? Number(value.fxFeeRate) : DEFAULTS.fxFeeRate,
      fxMaxAgeDays: finite(Number(value.fxMaxAgeDays)) && Number(value.fxMaxAgeDays) >= 0 ? Number(value.fxMaxAgeDays) : DEFAULTS.fxMaxAgeDays
    });
  }
  function load(storage) { return normalize(read(storage)); }
  function save(value, storage) { var next = normalize(value); try { storage.setItem(KEY, JSON.stringify(next)); } catch (_) {} return next; }
  function rateIsValid(settings, now) {
    if (!finite(settings.fxRate) || settings.fxRate <= 0 || !settings.fxAsOf) return false;
    var at = Date.parse(settings.fxAsOf), current = now || Date.now(), age = (current - at) / 86400000;
    return Number.isFinite(at) && age >= 0 && age <= settings.fxMaxAgeDays;
  }
  function convert(amount, from, to, settings, now) {
    var value = Number(amount);
    if (!finite(value)) return { ok: false, amount: null, reason: "金额不可用" };
    if (from === to) return { ok: true, amount: value, rate: 1 };
    if (!rateIsValid(settings, now)) return { ok: false, amount: null, reason: "汇率不可用或已过期" };
    return { ok: true, amount: from === "CAD" && to === "USD" ? value / settings.fxRate : value * settings.fxRate, rate: settings.fxRate };
  }
  function feeRate(amount, settings) {
    var value = Math.abs(Number(amount));
    if (settings.accountCurrency !== "USD" || !settings.usdAccountEnabled) return settings.fxFeeRate;
    var tiers = settings.usdFeeTiers || [{ below: 10000, fee: .015 }, { below: 25000, fee: .01 }, { below: 100000, fee: .005 }, { below: null, fee: 0 }];
    var tier = tiers.find(function (item) { return item.below === null || value < item.below; });
    return tier ? Number(tier.fee) : 0;
  }
  function estimateFxCost(amount, from, to, settings) {
    var conversion = convert(amount, from, to, settings);
    if (!conversion.ok || from === to) return { ok: conversion.ok, cost: conversion.ok ? 0 : null, feeRate: 0, reason: conversion.ok ? "无需换汇" : conversion.reason };
    var rate = feeRate(amount, settings);
    return { ok: true, cost: Math.abs(Number(amount)) * rate, feeRate: rate, convertedAmount: conversion.amount, reason: "预计换汇费用" };
  }
  function annualUsdCost(settings) { return settings.usdAccountEnabled && settings.clientTier === "Core" ? 120 : 0; }
  function format(amount, from, settings) {
    var conversion = convert(amount, from, settings.displayCurrency, settings);
    if (!conversion.ok) return { text: from + " " + Number(amount).toFixed(2), converted: false, warning: "汇率不可用，禁止生成可执行核对清单" };
    return { text: settings.displayCurrency + " " + Number(conversion.amount).toFixed(2), converted: settings.displayCurrency !== from, warning: "" };
  }
  function parseJson(storage, key, fallback) { try { var raw = storage && storage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; } }
  function divideMoney(value, rate) { var number = Number(value); return finite(number) ? Math.round(number / rate * 100) / 100 : value; }
  function migrateStoredPlanningCurrency(storage, now) {
    var raw = read(storage), current = normalize(raw);
    if (raw.planningMigrationVersion === USD_MIGRATION_VERSION) return { complete: true, migrated: false, settings: current };
    if (!Object.keys(raw).length || current.planningCurrency === "USD") {
      var initialized = normalize(Object.assign({}, current, { planningCurrency: "USD", planningMigrationVersion: USD_MIGRATION_VERSION, planningMigrationPending: false }));
      save(initialized, storage);
      return { complete: true, migrated: false, settings: initialized };
    }
    if (!rateIsValid(current, now)) {
      var cachedFx = parseJson(storage, "su-investment-pro:fx-rate-cache-v1", null);
      if (cachedFx) current = normalize(Object.assign({}, current, { fxRate: Number(cachedFx.rate), fxAsOf: cachedFx.asOf, fxFetchedAt: cachedFx.fetchedAt, fxSource: cachedFx.source, fxSourceKind: cachedFx.sourceKind }));
    }
    if (!rateIsValid(current, now)) return { complete: false, migrated: false, pending: true, reason: "汇率不可用或已过期", settings: normalize(Object.assign({}, current, { planningMigrationPending: true })) };
    var deploymentKey = "su-investment-pro:deployment", portfolioKey = "su-investment-pro:portfolio-risk";
    var deployment = parseJson(storage, deploymentKey, null), portfolio = parseJson(storage, portfolioKey, null), nextDeployment = deployment, nextPortfolio = portfolio;
    if (deployment && typeof deployment === "object") {
      nextDeployment = Object.assign({}, deployment);
      ["monthlyBudget", "normalPool", "crashFund", "weeklyDeployment"].forEach(function (field) { if (Object.prototype.hasOwnProperty.call(nextDeployment, field)) nextDeployment[field] = divideMoney(nextDeployment[field], current.fxRate); });
    }
    if (portfolio && typeof portfolio === "object") {
      nextPortfolio = JSON.parse(JSON.stringify(portfolio));
      if (Object.prototype.hasOwnProperty.call(nextPortfolio, "available_cash")) nextPortfolio.available_cash = divideMoney(nextPortfolio.available_cash, current.fxRate);
      Object.keys(nextPortfolio.positions || {}).forEach(function (symbol) {
        var position = nextPortfolio.positions[symbol] || {};
        ["average_cost", "current_value"].forEach(function (field) { if (Object.prototype.hasOwnProperty.call(position, field)) position[field] = divideMoney(position[field], current.fxRate); });
      });
    }
    var migrated = normalize(Object.assign({}, current, { planningCurrency: "USD", planningMigrationVersion: USD_MIGRATION_VERSION, planningMigrationPending: false, migrationNoticeShown: false }));
    var previous = { currency: storage.getItem(KEY), deployment: storage.getItem(deploymentKey), portfolio: storage.getItem(portfolioKey) };
    try {
      storage.setItem(KEY, JSON.stringify(migrated));
      if (nextDeployment) storage.setItem(deploymentKey, JSON.stringify(nextDeployment));
      if (nextPortfolio) storage.setItem(portfolioKey, JSON.stringify(nextPortfolio));
    } catch (error) {
      [[KEY, previous.currency], [deploymentKey, previous.deployment], [portfolioKey, previous.portfolio]].forEach(function (entry) { if (entry[1] === null) storage.removeItem(entry[0]); else storage.setItem(entry[0], entry[1]); });
      return { complete: false, migrated: false, pending: true, reason: "本地设置写入失败", settings: current };
    }
    return { complete: true, migrated: true, settings: migrated, deployment: nextDeployment, portfolioRisk: nextPortfolio };
  }
  return Object.freeze({ KEY: KEY, DEFAULTS: DEFAULTS, USD_MIGRATION_VERSION: USD_MIGRATION_VERSION, normalize: normalize, load: load, save: save, rateIsValid: rateIsValid, convert: convert, feeRate: feeRate, estimateFxCost: estimateFxCost, annualUsdCost: annualUsdCost, format: format, migrateStoredPlanningCurrency: migrateStoredPlanningCurrency });
});
