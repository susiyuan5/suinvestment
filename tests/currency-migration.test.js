const test = require("node:test");
const assert = require("node:assert/strict");
const currency = require("../wealthsimple-currency.js");

function storage(initial) {
  const values = new Map(Object.entries(initial || {}));
  return { getItem(key) { return values.has(key) ? values.get(key) : null; }, setItem(key, value) { values.set(key, String(value)); }, removeItem(key) { values.delete(key); } };
}

test("CAD planning data migrates to USD once without changing purchasing power", () => {
  const store = storage({
    [currency.KEY]: JSON.stringify({ planningCurrency: "CAD", accountCurrency: "CAD", displayCurrency: "CAD", fxRate: 1.35, fxAsOf: "2026-08-11T12:00:00Z", fxMaxAgeDays: 3 }),
    "su-investment-pro:deployment": JSON.stringify({ monthlyBudget: 400, normalPool: 300, crashFund: 100, weeklyDeployment: 69.23 }),
    "su-investment-pro:portfolio-risk": JSON.stringify({ available_cash: 135, positions: { AAPL: { shares: 1, average_cost: 81, current_value: 135 } } })
  });
  const first = currency.migrateStoredPlanningCurrency(store, Date.parse("2026-08-12T12:00:00Z"));
  assert.equal(first.migrated, true);
  assert.equal(JSON.parse(store.getItem("su-investment-pro:deployment")).monthlyBudget, 296.3);
  assert.equal(JSON.parse(store.getItem("su-investment-pro:portfolio-risk")).available_cash, 100);
  const saved = store.getItem("su-investment-pro:deployment");
  const second = currency.migrateStoredPlanningCurrency(store, Date.parse("2026-08-12T13:00:00Z"));
  assert.equal(second.migrated, false);
  assert.equal(store.getItem("su-investment-pro:deployment"), saved);
});

test("CAD planning migration waits for a valid rate", () => {
  const original = JSON.stringify({ monthlyBudget: 400, normalPool: 300, crashFund: 100 });
  const store = storage({ [currency.KEY]: JSON.stringify({ planningCurrency: "CAD", accountCurrency: "CAD" }), "su-investment-pro:deployment": original });
  const result = currency.migrateStoredPlanningCurrency(store, Date.parse("2026-08-12T12:00:00Z"));
  assert.equal(result.complete, false);
  assert.equal(result.pending, true);
  assert.equal(store.getItem("su-investment-pro:deployment"), original);
});
