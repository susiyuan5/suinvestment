const test = require("node:test");
const assert = require("node:assert/strict");
const center = require("../settings-center.js");

test("设置中心迁移旧版账户且保留金额与账户信息", () => {
  const migrated = center.normalizeAccounts({ TFSA: { account_type: "TFSA", account_currency: "USD", available_to_trade: 125.5, pending_order_reserve: 10 } });
  assert.equal(migrated.accounts.length, 1);
  assert.equal(migrated.accounts[0].available_to_trade, 125.5);
  assert.equal(migrated.accounts[0].account_currency, "USD");
  assert.equal(migrated.defaultId, "TFSA");
});

test("设置中心导出不包含 API 密钥", () => {
  const result = center.serializable({ apiKey: "secret", displayCurrency: "CAD", planningCurrency: "CAD", accountCurrency: "CAD", clientTier: "Core", deployment: {}, accounts: { accounts: [] }, allocation: {} });
  const exported = center.exportPayload(result);
  assert.equal(Object.prototype.hasOwnProperty.call(exported.settings, "apiKey"), false);
  assert.equal(JSON.stringify(exported).includes("secret"), false);
});
