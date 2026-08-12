(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.WealthsimpleRules = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  var ACCOUNT_TYPES = ["TFSA", "FHSA", "RRSP", "RESP", "NON_REGISTERED"];
  function finite(value) { return typeof value === "number" && Number.isFinite(value); }
  function validateOrder(input, rules) {
    var value = input || {}, failures = [], warnings = [], security = value.security || {};
    if (!ACCOUNT_TYPES.includes(value.accountType)) failures.push("账户类型未确认");
    if (!value.accountCurrency || !["CAD", "USD"].includes(value.accountCurrency)) failures.push("账户币种未确认");
    if (!finite(Number(value.availableAfterReserve)) || Number(value.availableAfterReserve) < Number(value.planningAmount || 0)) failures.push("可用资金不足或未填写");
    if (!finite(Number(value.price)) || Number(value.price) <= 0) failures.push("行情价格不可用");
    if (!value.priceAsOf) failures.push("行情时间不可用");
    var isOtc = security.otc === true;
    var otcUnknown = security.otc === "unknown" || security.otc === undefined || security.otc === null;
    if (otcUnknown) warnings.push("证券 OTC 资格未知，请在 Wealthsimple 中确认");
    if (isOtc) { if (value.accountType !== "NON_REGISTERED") failures.push("OTC 证券仅允许非注册账户核对"); if (value.orderType !== "LIMIT") failures.push("OTC 证券只允许限价单"); if (value.session !== "REGULAR") failures.push("OTC 证券禁止延长交易时段"); }
    if (value.session === "EXTENDED") { if (value.orderType !== "LIMIT") failures.push("延长交易时段只允许限价单"); if (value.fractional) failures.push("延长交易时段不允许零碎股"); if (isOtc) failures.push("OTC 证券禁止延长交易时段"); warnings.push("延长交易时段存在流动性和未成交风险"); }
    if (value.fractional) { if (value.orderType !== "MARKET") failures.push("零碎股只允许市价单"); if (Number(value.securityAmount || 0) < Number(rules.fractional_order_rules.minimum_amount)) failures.push("零碎股金额低于官方最低值"); }
    if (security.fractional === false && value.fractional) failures.push("该证券零碎股资格未通过");
    if (security.fractional === "unknown" || security.fractional === undefined) warnings.push("零碎股资格未知，请人工确认");
    return { ok: failures.length === 0 && warnings.every(function (warning) { return !/资格未知/.test(warning); }), failures: failures, warnings: warnings, status: failures.length || warnings.length ? "核对信息不完整，请在 Wealthsimple 人工确认" : "规则校验通过，仍需人工核对" };
  }
  function estimateQuantity(amount, price, fractional, valid) { if (!valid || !finite(Number(amount)) || !finite(Number(price)) || Number(price) <= 0) return null; var quantity = Number(amount) / Number(price); return fractional ? Math.floor(quantity * 10000) / 10000 : Math.floor(quantity); }
  return Object.freeze({ ACCOUNT_TYPES: ACCOUNT_TYPES, validateOrder: validateOrder, estimateQuantity: estimateQuantity });
});
