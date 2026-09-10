(function (root, factory) {
  "use strict";
  var executionPolicy = root.WealthsimpleExecutionPolicy || (typeof require === "function" ? require("./wealthsimple-execution-policy.js") : null);
  var api = factory(root, executionPolicy);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.WealthsimpleOrderAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, executionPolicy) {
  "use strict";
  function number(value) { var parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
  function buildChecklist(plan, context) {
    var settings = context.settings, rules = context.rules, accounts = context.accounts || {}, rows = (plan && plan.items || []).filter(function (row) { return number(row.finalAmount) > 0; });
    if (!settings || !rules || !settings.planningCurrency || !root.WealthsimpleRules || !executionPolicy) return { safe: false, status: "核对信息不完整，请在 Wealthsimple 人工确认", rows: [], reason: "关键模块缺失" };
    var output = rows.map(function (row) {
      var account = accounts[row.accountId] || accounts.default || {};
      var security = (context.securities || {})[row.symbol] || { currency: "USD", otc: "unknown", fractional: "unknown" };
      var securityCurrency = security.currency || "USD";
      var available = number(account.available_to_trade), reserve = number(account.pending_order_reserve), afterReserve = Math.max(0, available - reserve);
      var execution = executionPolicy.execute({ symbol: row.symbol, marketType: security.otc === true || row.symbol === "BYDDY" ? "OTC" : "listed", price: number(row.price), planningAmount: number(row.finalAmount), planningCurrency: settings.planningCurrency, availableAfterReserve: afterReserve, tradingCurrency: securityCurrency, accountCurrency: account.account_currency, accountType: account.account_type, fractionalSupported: security.fractional, minimumFractionalAmount: rules.fractional_order_rules.minimum_amount, quoteTimestamp: row.priceAsOf, fxRate: settings.fxRate, fxAsOf: settings.fxAsOf, fxFeeRate: settings.fxFeeRate, fxMaxAgeDays: settings.fxMaxAgeDays }, { now: context.now });
      var validation = root.WealthsimpleRules.validateOrder({ accountType: account.account_type, accountCurrency: account.account_currency, availableAfterReserve: afterReserve, requiredAccountAmount: execution.accountDebit, price: number(row.price), priceAsOf: row.priceAsOf, securityAmount: execution.executableNotionalTrading, security: security, fractional: row.fractional === true, orderType: row.orderType || execution.requiredOrderType, session: row.session || "REGULAR" }, rules);
      var quantity = validation.ok && execution.executable ? root.WealthsimpleRules.estimateQuantity(execution.executableNotionalTrading, row.price, row.fractional === true, true) : null;
      return { accountId: row.accountId || account.id || "", accountType: account.account_type || "", accountCurrency: account.account_currency || "", symbol: row.symbol, securityCurrency: securityCurrency, planningAmount: number(row.finalAmount), planningCurrency: settings.planningCurrency, tradableAmount: execution.executableNotionalTrading, executableNotionalTrading: execution.executableNotionalTrading, executableAmountPlanning: execution.executableAmountPlanning, accountDebit: execution.accountDebit, fxFee: execution.fxFeeAccount, fxFeeAccount: execution.fxFeeAccount, retainedBudgetPlanning: execution.retainedBudgetPlanning, price: number(row.price) || null, priceAsOf: row.priceAsOf || null, quantity: quantity, quantityType: row.fractional ? "零碎股" : "整股", orderType: execution.requiredOrderType, session: row.session || "REGULAR", limitPrice: row.limitPrice || null, reserve: reserve, status: validation.ok && execution.executable ? "规则校验通过，仍需人工核对" : execution.executionStatus, executionStatus: execution.executionStatus, executable: validation.ok && execution.executable, executableAmount: execution.executableAmountPlanning, retainedCash: execution.retainedBudgetPlanning, requiresFractionalOrder: execution.requiresFractionalOrder, requiresCurrencyConversion: execution.requiresCurrencyConversion, failures: validation.failures.concat(validation.warnings, execution.reasonCodes || [], execution.warnings || []), note: "本清单不会提交订单。" };
    });
    var good = output.length > 0 && output.every(function (row) { return row.status === "规则校验通过，仍需人工核对"; });
    return { safe: good, status: good ? "规则校验通过，仍需人工核对" : "核对信息不完整，请在 Wealthsimple 人工确认", rows: output, planningCurrency: settings.planningCurrency };
  }
  return Object.freeze({ buildChecklist: buildChecklist });
});
