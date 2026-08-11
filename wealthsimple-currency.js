(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.WealthsimpleCurrency = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  var KEY = "su-investment-pro:wealthsimple-currency-v1";
  var DEFAULTS = { planningCurrency: "CAD", accountCurrency: "CAD", displayCurrency: "CAD", clientTier: "Core", usdAccountEnabled: false, fxRate: null, fxAsOf: null, fxFeeRate: 0.015, fxMaxAgeDays: 3, migrationNoticeShown: false };
  function finite(value) { return typeof value === "number" && Number.isFinite(value); }
  function read(storage) { try { var raw = storage && storage.getItem(KEY); return raw ? JSON.parse(raw) : {}; } catch (_) { return {}; } }
  function normalize(input) {
    var value = input && typeof input === "object" ? input : {};
    return Object.assign({}, DEFAULTS, value, {
      planningCurrency: ["CAD", "USD"].includes(value.planningCurrency) ? value.planningCurrency : "CAD",
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
  return Object.freeze({ KEY: KEY, DEFAULTS: DEFAULTS, normalize: normalize, load: load, save: save, rateIsValid: rateIsValid, convert: convert, feeRate: feeRate, estimateFxCost: estimateFxCost, annualUsdCost: annualUsdCost, format: format });
});
