(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.WealthsimpleExecutionPolicy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  var DEFAULT_MINIMUM = 1.00;
  function finite(value) { var number = Number(value); return Number.isFinite(number) ? number : null; }
  function money(value) { var number = finite(value); return number === null ? 0 : Math.round(Math.max(0, number) * 100) / 100; }
  function dateValid(value, now, maxAgeDays) { var at = Date.parse(value || ""), current = now || Date.now(), age = (current - at) / 86400000; return Number.isFinite(at) && age >= 0 && age <= (maxAgeDays || 1); }
  function execute(input, options) {
    var value = input || {}, config = options || {}, amount = money(value.suggestedAmount), price = finite(value.price), minimum = finite(value.minimumFractionalAmount) === null ? DEFAULT_MINIMUM : Math.max(0, Number(value.minimumFractionalAmount));
    var result = { executable: false, executionStatus: "本周不可执行", executableAmount: 0, retainedCash: amount, requiredOrderType: "未知", requiresFractionalOrder: false, requiresCurrencyConversion: false, estimatedFxFee: null, reasonCodes: [], warnings: [] };
    if (!amount) { result.executionStatus = "本周不可执行"; result.reasonCodes.push("ZERO_SUGGESTION"); return result; }
    if (price === null || price <= 0) { result.executionStatus = "数据过期"; result.reasonCodes.push("INVALID_PRICE"); return result; }
    if (!dateValid(value.quoteTimestamp, config.now, config.maxQuoteAgeDays || 1)) { result.executionStatus = "数据过期"; result.reasonCodes.push("STALE_QUOTE"); return result; }
    var otc = String(value.marketType || "").toUpperCase() === "OTC";
    var registered = ["TFSA", "FHSA", "RRSP", "RESP"].indexOf(value.accountType) >= 0;
    if (!value.accountCurrency || !value.tradingCurrency || !value.accountType) { result.reasonCodes.push("ACCOUNT_RULES_UNKNOWN"); return result; }
    if (value.accountCurrency !== value.tradingCurrency) {
      result.requiresCurrencyConversion = true;
      var fxRate = finite(value.fxRate), fxFresh = dateValid(value.fxAsOf, config.now, value.fxMaxAgeDays || 3);
      if (fxRate === null || !fxFresh) { result.executionStatus = "数据过期"; result.reasonCodes.push("FX_RATE_UNAVAILABLE_OR_STALE"); return result; }
      result.estimatedFxFee = money(amount * Math.max(0, finite(value.fxFeeRate) === null ? 0.015 : Number(value.fxFeeRate)));
    }
    if (otc) {
      result.requiredOrderType = "LIMIT";
      if (registered) { result.reasonCodes.push("OTC_REGISTERED_ACCOUNT"); result.executionStatus = "账户不支持"; return result; }
      if (value.fractionalSupported === true || value.fractionalSupported === "unknown") result.warnings.push("OTC 不生成碎股执行建议");
      if (amount < price) { result.reasonCodes.push("OTC_AMOUNT_BELOW_ONE_SHARE"); return result; }
      result.executable = true; result.executableAmount = amount; result.retainedCash = 0; result.executionStatus = "可以执行"; return result;
    }
    if (value.fractionalSupported === "unknown" || value.fractionalSupported === undefined || value.fractionalSupported === null) { result.executionStatus = "需要确认碎股支持"; result.requiredOrderType = "MARKET"; result.reasonCodes.push("FRACTIONAL_SUPPORT_UNKNOWN"); result.warnings.push("需要在 Wealthsimple 确认碎股支持"); return result; }
    var wholeShares = Math.floor(amount / price), remainder = money(amount - wholeShares * price);
    if (value.fractionalSupported === false) {
      result.requiredOrderType = "MARKET";
      result.executableAmount = money(wholeShares * price); result.retainedCash = money(amount - result.executableAmount);
      if (!wholeShares) { result.reasonCodes.push("NO_WHOLE_SHARE"); return result; }
      result.executable = true; result.executionStatus = "可以执行"; if (remainder) result.warnings.push("不足一整股的金额保留为现金"); return result;
    }
    result.requiresFractionalOrder = remainder > 0 || wholeShares === 0;
    result.requiredOrderType = result.requiresFractionalOrder ? "MARKET" : "MARKET";
    if (result.requiresFractionalOrder && amount < minimum) { result.reasonCodes.push("BELOW_FRACTIONAL_MINIMUM"); return result; }
    result.executable = true; result.executableAmount = amount; result.retainedCash = 0; result.executionStatus = "可以执行"; return result;
  }
  return Object.freeze({ execute: execute, DEFAULT_MINIMUM: DEFAULT_MINIMUM });
});
