(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SettingsStorage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const API_KEY = "su-investment-pro:finnhub-key";
  const DISPLAY_CURRENCY_KEY = "su-investment-pro:display-currency";
  const DEFAULT_DISPLAY_CURRENCY = "CAD";
  const SUPPORTED_DISPLAY_CURRENCIES = Object.freeze(["CAD", "USD"]);

  function read(storage, key) {
    try { return storage && storage.getItem(key) || ""; } catch (_) { return ""; }
  }

  function remove(storage, key) {
    try { if (storage) storage.removeItem(key); } catch (_) {}
  }

  function write(storage, key, value) {
    try { if (storage) storage.setItem(key, value); return true; } catch (_) { return false; }
  }

  function loadApiKey(persistentStorage, sessionStorage) {
    const value = read(persistentStorage, API_KEY) || read(sessionStorage, API_KEY);
    if (value) write(persistentStorage, API_KEY, value);
    remove(sessionStorage, API_KEY);
    return value;
  }

  function saveApiKey(value, persistentStorage, sessionStorage) {
    const normalized = String(value || "").trim();
    remove(sessionStorage, API_KEY);
    if (!normalized) {
      remove(persistentStorage, API_KEY);
      return "";
    }
    if (!write(persistentStorage, API_KEY, normalized)) return "";
    return normalized;
  }

  function getApiKey(persistentStorage) {
    return read(persistentStorage, API_KEY);
  }

  function normalizeDisplayCurrency(value) {
    const normalized = String(value || "").trim().toUpperCase();
    return SUPPORTED_DISPLAY_CURRENCIES.includes(normalized) ? normalized : DEFAULT_DISPLAY_CURRENCY;
  }

  function loadDisplayCurrency(persistentStorage) {
    return normalizeDisplayCurrency(read(persistentStorage, DISPLAY_CURRENCY_KEY));
  }

  function saveDisplayCurrency(value, persistentStorage) {
    const normalized = normalizeDisplayCurrency(value);
    write(persistentStorage, DISPLAY_CURRENCY_KEY, normalized);
    return normalized;
  }

  return Object.freeze({
    API_KEY,
    DISPLAY_CURRENCY_KEY,
    DEFAULT_DISPLAY_CURRENCY,
    SUPPORTED_DISPLAY_CURRENCIES,
    loadApiKey,
    saveApiKey,
    getApiKey,
    normalizeDisplayCurrency,
    loadDisplayCurrency,
    saveDisplayCurrency
  });
});
