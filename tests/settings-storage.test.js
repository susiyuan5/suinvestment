const assert = require("node:assert/strict");
const test = require("node:test");
const storage = require("../settings-storage.js");

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

test("Finnhub key migrates from session storage and persists", function () {
  const persistent = memoryStorage();
  const session = memoryStorage({ [storage.API_KEY]: "session-key" });
  assert.equal(storage.loadApiKey(persistent, session), "session-key");
  assert.equal(storage.getApiKey(persistent), "session-key");
  assert.equal(session.getItem(storage.API_KEY), null);
});

test("clearing the Finnhub field forgets the persistent key", function () {
  const persistent = memoryStorage({ [storage.API_KEY]: "saved-key" });
  const session = memoryStorage();
  assert.equal(storage.saveApiKey("", persistent, session), "");
  assert.equal(storage.getApiKey(persistent), "");
});

test("display currency defaults to CAD and persists a supported selection", function () {
  const persistent = memoryStorage();
  assert.equal(storage.loadDisplayCurrency(persistent), "CAD");
  assert.equal(storage.saveDisplayCurrency("usd", persistent), "USD");
  assert.equal(storage.loadDisplayCurrency(persistent), "USD");
  assert.equal(persistent.getItem(storage.DISPLAY_CURRENCY_KEY), "USD");
});

test("unsupported display currency safely falls back to CAD", function () {
  const persistent = memoryStorage({ [storage.DISPLAY_CURRENCY_KEY]: "EUR" });
  assert.equal(storage.loadDisplayCurrency(persistent), "CAD");
  assert.equal(storage.saveDisplayCurrency("GBP", persistent), "CAD");
});
