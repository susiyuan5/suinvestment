const test = require("node:test");
const assert = require("node:assert/strict");
const currency = require("../wealthsimple-currency.js");
const rules = require("../wealthsimple-rules.js");
global.WealthsimpleCurrency = currency;
global.WealthsimpleRules = rules;
const adapter = require("../wealthsimple-order-adapter.js");
const reconciliation = require("../wealthsimple-reconciliation.js");
const orderPanel = require("../order-panel.js");

const ruleConfig = require("../data/wealthsimple-rules-v1.json");
const validSettings = currency.normalize({ planningCurrency: "CAD", accountCurrency: "CAD", displayCurrency: "CAD", fxRate: 1.35, fxAsOf: "2026-08-11T12:00:00Z" });

test("币种分离、有效期和预计费用安全失败", () => {
  assert.equal(currency.convert(100, "CAD", "CAD", validSettings, Date.parse("2026-08-12" )).amount, 100);
  assert.equal(currency.convert(100, "CAD", "USD", validSettings, Date.parse("2026-08-12")).ok, true);
  assert.equal(currency.convert(100, "CAD", "USD", validSettings, Date.parse("2026-08-20")).ok, false);
  assert.equal(currency.annualUsdCost(currency.normalize({ usdAccountEnabled: true, clientTier: "Core" })), 120);
});

test("规则阻止未知 OTC、缺少行情和不可用分数股", () => {
  const result = rules.validateOrder({ accountType: "TFSA", accountCurrency: "USD", availableAfterReserve: 100, planningAmount: 20, price: 10, priceAsOf: "2026-08-11", security: { otc: "unknown", fractional: "unknown" }, fractional: true, orderType: "LIMIT", session: "REGULAR", securityAmount: 20 }, ruleConfig);
  assert.equal(result.ok, false);
  assert.ok(result.warnings.length > 0);
});

test("适配器在账户或汇率不完整时不计算数量", () => {
  const result = adapter.buildChecklist({ items: [{ symbol: "OTC_SECURITY", finalAmount: 50, price: 10, priceAsOf: "2026-08-11", fractional: true }] }, { settings: validSettings, rules: ruleConfig, accounts: {}, securities: { OTC_SECURITY: { currency: "USD", otc: "unknown", fractional: "unknown" } } });
  assert.equal(result.rows[0].quantity, null);
  assert.equal(result.safe, false);
});

test("对账拒绝重复订单，部分成交保留剩余信息，持仓需二次确认", () => {
  let ledger = reconciliation.createLedger();
  const first = reconciliation.add(ledger, { id: "1", orderId: "ws-1", symbol: "SPY", status: "PARTIAL", remainingShares: 2 });
  assert.equal(first.ok, true); ledger = first.ledger;
  assert.equal(reconciliation.add(ledger, { id: "2", orderId: "ws-1", symbol: "SPY" }).ok, false);
  assert.equal(reconciliation.applyToHoldings(ledger.entries[0], {}, "再次确认").ok, false);
  const filled = Object.assign({}, ledger.entries[0], { status: "FILLED", actualShares: 1, actualPrice: 100 });
  assert.equal(reconciliation.applyToHoldings(filled, {}, "再次确认").ok, true);
});

test("订单面板金额使用计划币种，不写死 CAD", () => {
  assert.equal(orderPanel.amountText(12.5, "USD"), "USD 12.50");
  assert.equal(orderPanel.parseOrderLine("SPY：最终人工计划 USD 12.5")?.amount, "12.50");
});
