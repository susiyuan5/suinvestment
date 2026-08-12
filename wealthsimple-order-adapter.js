(function (root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.WealthsimpleOrderAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";
  function number(value) { var parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
  function buildChecklist(plan, context) {
    var settings = context.settings, rules = context.rules, accounts = context.accounts || {}, rows = (plan && plan.items || []).filter(function (row) { return number(row.finalAmount) > 0; });
    if (!settings || !rules || !settings.planningCurrency || !root.WealthsimpleRules) return { safe: false, status: "核对信息不完整，请在 Wealthsimple 人工确认", rows: [], reason: "关键模块缺失" };
    var output = rows.map(function (row) {
      var account = accounts[row.accountId] || accounts.default || {}, security = (context.securities || {})[row.symbol] || { currency: "USD", otc: "unknown", fractional: "unknown" }, securityCurrency = security.currency || "USD";
      var conversion = root.WealthsimpleCurrency ? root.WealthsimpleCurrency.convert(number(row.finalAmount), settings.planningCurrency, securityCurrency, settings) : { ok: false, amount: null, reason: "汇率模块缺失" };
      var fx = root.WealthsimpleCurrency ? root.WealthsimpleCurrency.estimateFxCost(number(row.finalAmount), settings.planningCurrency, securityCurrency, settings) : { ok: false, cost: null, reason: "汇率模块缺失" };
      var available = number(account.available_to_trade), reserve = number(account.pending_order_reserve), afterReserve = Math.max(0, available - reserve);
      var validation = root.WealthsimpleRules.validateOrder({ accountType: account.account_type, accountCurrency: account.account_currency, availableAfterReserve: afterReserve, planningAmount: number(row.finalAmount), price: number(row.price), priceAsOf: row.priceAsOf, securityAmount: conversion.amount, security: security, fractional: row.fractional === true, orderType: row.orderType || "MARKET", session: row.session || "REGULAR" }, rules);
      var execution = root.WealthsimpleExecutionPolicy ? root.WealthsimpleExecutionPolicy.execute({ symbol: row.symbol, marketType: security.otc === true || row.symbol === "BYDDY" ? "OTC" : "listed", price: number(row.price), suggestedAmount: number(row.finalAmount), tradingCurrency: securityCurrency, accountCurrency: account.account_currency, accountType: account.account_type, fractionalSupported: security.fractional, minimumFractionalAmount: rules.fractional_order_rules.minimum_amount, quoteTimestamp: row.priceAsOf, fxRate: settings.fxRate, fxAsOf: settings.fxAsOf, fxFeeRate: settings.fxFeeRate, fxMaxAgeDays: settings.fxMaxAgeDays }) : { executable: false, executionStatus: "需要人工复核", executableAmount: 0, retainedCash: number(row.finalAmount), requiredOrderType: "未知", reasonCodes: ["EXECUTION_MODULE_MISSING"], warnings: [] };
      var canQuantity = validation.ok && conversion.ok && fx.ok && number(row.price) > 0, quantity = canQuantity ? root.WealthsimpleRules.estimateQuantity(conversion.amount, row.price, row.fractional === true, true) : null;
      return { accountId: row.accountId || account.id || "", accountType: account.account_type || "", accountCurrency: account.account_currency || "", symbol: row.symbol, securityCurrency: securityCurrency, planningAmount: number(row.finalAmount), fxFee: execution.estimatedFxFee === null ? fx.cost : execution.estimatedFxFee, tradableAmount: conversion.amount, price: number(row.price) || null, priceAsOf: row.priceAsOf || null, quantity: quantity, quantityType: row.fractional ? "零碎股" : "整股", orderType: execution.requiredOrderType, session: row.session || "REGULAR", limitPrice: row.limitPrice || null, reserve: reserve, status: execution.executionStatus, executionStatus: execution.executionStatus, executable: execution.executable, executableAmount: execution.executableAmount, retainedCash: execution.retainedCash, requiresFractionalOrder: execution.requiresFractionalOrder, requiresCurrencyConversion: execution.requiresCurrencyConversion, failures: validation.failures.concat(validation.warnings, execution.reasonCodes || [], execution.warnings || []), note: "本清单不会提交订单。" };
    });
    var good = output.length > 0 && output.every(function (row) { return row.status === "规则校验通过，仍需人工核对"; });
    return { safe: good, status: good ? "规则校验通过，仍需人工核对" : "核对信息不完整，请在 Wealthsimple 人工确认", rows: output, planningCurrency: settings.planningCurrency };
  }
  return Object.freeze({ buildChecklist: buildChecklist });
});
