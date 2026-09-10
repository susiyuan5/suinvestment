(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.WealthsimpleExecutionPolicy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  var DEFAULT_MINIMUM = 1.00;
  var SUPPORTED_CURRENCIES = ["CAD", "USD"];
  function finite(value) { var number = Number(value); return Number.isFinite(number) ? number : null; }
  function money(value) { var number = finite(value); return number === null ? 0 : Math.round(Math.max(0, number) * 100) / 100; }
  function precise(value) { var number = finite(value); return number === null ? 0 : Math.max(0, number); }
  function dateValid(value, now, maxAgeDays) { var at = Date.parse(value || ""), current = now || Date.now(), age = (current - at) / 86400000; return Number.isFinite(at) && age >= 0 && age <= (maxAgeDays || 1); }
  function currency(value, fallback) { var code = String(value || fallback || "").toUpperCase(); return SUPPORTED_CURRENCIES.indexOf(code) >= 0 ? code : ""; }
  function convert(amount, from, to, fxRate) {
    var value = finite(amount), rate = finite(fxRate);
    if (value === null || !from || !to) return null;
    if (from === to) return value;
    if (rate === null || rate <= 0) return null;
    if (from === "CAD" && to === "USD") return value / rate;
    if (from === "USD" && to === "CAD") return value * rate;
    return null;
  }
  function execute(input, options) {
    var value = input || {}, config = options || {};
    var planningAmount = money(value.planningAmount === undefined ? value.suggestedAmount : value.planningAmount);
    var planningCurrency = currency(value.planningCurrency, value.tradingCurrency);
    var accountCurrency = currency(value.accountCurrency), tradingCurrency = currency(value.tradingCurrency);
    var price = finite(value.price), minimum = finite(value.minimumFractionalAmount) === null ? DEFAULT_MINIMUM : Math.max(0, Number(value.minimumFractionalAmount));
    var availableAfterReserve = value.availableAfterReserve === undefined ? null : finite(value.availableAfterReserve);
    var result = { executable: false, executionStatus: "本周不可执行", planningAmount: planningAmount, planningCurrency: planningCurrency, tradingCurrency: tradingCurrency, accountCurrency: accountCurrency, executableNotionalTrading: 0, executableAmountPlanning: 0, accountDebit: 0, fxFeeAccount: 0, retainedBudgetPlanning: planningAmount, executableAmount: 0, retainedCash: planningAmount, requiredOrderType: "未知", requiresFractionalOrder: false, requiresCurrencyConversion: false, estimatedFxFee: 0, reasonCodes: [], warnings: [] };
    if (!planningAmount) { result.reasonCodes.push("ZERO_SUGGESTION"); return result; }
    if (price === null || price <= 0) { result.executionStatus = "数据过期"; result.reasonCodes.push("INVALID_PRICE"); return result; }
    if (!dateValid(value.quoteTimestamp, config.now, config.maxQuoteAgeDays || 1)) { result.executionStatus = "数据过期"; result.reasonCodes.push("STALE_QUOTE"); return result; }
    if (!planningCurrency || !accountCurrency || !tradingCurrency || !value.accountType) { result.reasonCodes.push("ACCOUNT_RULES_UNKNOWN"); return result; }
    var needsFx = planningCurrency !== accountCurrency || accountCurrency !== tradingCurrency || planningCurrency !== tradingCurrency;
    var fxRate = finite(value.fxRate);
    if (needsFx && (fxRate === null || fxRate <= 0 || !dateValid(value.fxAsOf, config.now, value.fxMaxAgeDays || 3))) { result.executionStatus = "数据过期"; result.reasonCodes.push("FX_RATE_UNAVAILABLE_OR_STALE"); return result; }
    result.requiresCurrencyConversion = accountCurrency !== tradingCurrency;
    var budgetAccount = convert(planningAmount, planningCurrency, accountCurrency, fxRate);
    if (budgetAccount === null) { result.reasonCodes.push("CURRENCY_CONVERSION_UNAVAILABLE"); return result; }
    var accountCap = availableAfterReserve === null ? budgetAccount : Math.min(budgetAccount, Math.max(0, availableAfterReserve));
    if (accountCap <= 0) { result.reasonCodes.push("INSUFFICIENT_ACCOUNT_FUNDS"); return result; }
    var feeRate = accountCurrency !== tradingCurrency ? Math.max(0, finite(value.fxFeeRate) === null ? 0.015 : Number(value.fxFeeRate)) : 0;
    var tradingCap = convert(accountCap / (1 + feeRate), accountCurrency, tradingCurrency, fxRate);
    if (tradingCap === null || tradingCap <= 0) { result.reasonCodes.push("CURRENCY_CONVERSION_UNAVAILABLE"); return result; }
    var otc = String(value.marketType || "").toUpperCase() === "OTC", registered = ["TFSA", "FHSA", "RRSP", "RESP"].indexOf(value.accountType) >= 0, executableTrading = 0;
    if (otc) {
      result.requiredOrderType = "LIMIT";
      if (registered) { result.reasonCodes.push("OTC_REGISTERED_ACCOUNT"); result.executionStatus = "账户不支持"; return result; }
      if (value.fractionalSupported === true || value.fractionalSupported === "unknown") result.warnings.push("OTC 不生成碎股执行建议");
      var otcShares = Math.floor(tradingCap / price);
      if (!otcShares) { result.reasonCodes.push("OTC_AMOUNT_BELOW_ONE_SHARE"); return result; }
      executableTrading = otcShares * price;
    } else {
      result.requiredOrderType = "MARKET";
      if (value.fractionalSupported === "unknown" || value.fractionalSupported === undefined || value.fractionalSupported === null) { result.executionStatus = "需要确认碎股支持"; result.reasonCodes.push("FRACTIONAL_SUPPORT_UNKNOWN"); result.warnings.push("需要在 Wealthsimple 确认碎股支持"); return result; }
      var wholeShares = Math.floor(tradingCap / price), wholeNotional = wholeShares * price, remainder = Math.max(0, tradingCap - wholeNotional);
      if (value.fractionalSupported === false) {
        executableTrading = wholeNotional;
        if (!wholeShares) { result.reasonCodes.push("NO_WHOLE_SHARE"); return result; }
        if (remainder > 0.005) result.warnings.push("不足一整股的金额保留为现金");
      } else {
        result.requiresFractionalOrder = remainder > 0.005 || wholeShares === 0;
        if (result.requiresFractionalOrder && tradingCap < minimum) { result.reasonCodes.push("BELOW_FRACTIONAL_MINIMUM"); return result; }
        executableTrading = tradingCap;
      }
    }
    var baseDebitAccount = convert(executableTrading, tradingCurrency, accountCurrency, fxRate);
    if (baseDebitAccount === null) { result.reasonCodes.push("CURRENCY_CONVERSION_UNAVAILABLE"); return result; }
    var feeAccount = precise(baseDebitAccount * feeRate), accountDebit = precise(baseDebitAccount + feeAccount), spentPlanning = convert(accountDebit, accountCurrency, planningCurrency, fxRate);
    if (spentPlanning === null) { result.reasonCodes.push("CURRENCY_CONVERSION_UNAVAILABLE"); return result; }
    if (availableAfterReserve !== null && accountDebit - availableAfterReserve > 0.005) { result.reasonCodes.push("INSUFFICIENT_ACCOUNT_FUNDS"); return result; }
    result.executable = true; result.executionStatus = "可以执行";
    result.executableNotionalTrading = money(executableTrading); result.accountDebit = money(accountDebit); result.fxFeeAccount = money(feeAccount); result.estimatedFxFee = money(convert(feeAccount, accountCurrency, planningCurrency, fxRate));
    result.executableAmountPlanning = money(spentPlanning); result.retainedBudgetPlanning = money(planningAmount - spentPlanning); result.executableAmount = result.executableAmountPlanning; result.retainedCash = result.retainedBudgetPlanning;
    if (availableAfterReserve !== null && availableAfterReserve + 0.005 < budgetAccount) result.warnings.push("账户可用资金低于计划预算，已按账户资金缩减");
    return result;
  }
  return Object.freeze({ execute: execute, convert: convert, DEFAULT_MINIMUM: DEFAULT_MINIMUM });
});
