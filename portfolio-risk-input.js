(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PortfolioRiskInput = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function normalizeSymbol(value) {
    return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
  }

  function normalize(value) {
    const input = value && typeof value === "object" ? value : {};
    const positions = input.positions && typeof input.positions === "object" ? input.positions : {};
    const hasCashValue = Object.prototype.hasOwnProperty.call(input, "available_cash") && String(input.available_cash).trim() !== "" && Number.isFinite(Number(input.available_cash));
    // An explicit false is authoritative. This makes normalization idempotent
    // and keeps missing cash distinct from a deliberately entered zero.
    const cashProvided = input.available_cash_provided === false ? false : hasCashValue;
    return {
      available_cash: hasCashValue ? number(input.available_cash) : 0,
      available_cash_provided: cashProvided,
      positions: Object.keys(positions).reduce(function (result, symbol) {
        const normalized = normalizeSymbol(symbol);
        if (!normalized) return result;
        const position = positions[symbol] && typeof positions[symbol] === "object" ? positions[symbol] : {};
        result[normalized] = {
          shares: number(position.shares),
          average_cost: number(position.average_cost),
          current_value: number(position.current_value),
          target_allocation: number(position.target_allocation),
          notes: String(position.notes || "")
        };
        return result;
      }, {})
    };
  }

  // Allocation weights describe securities, not the cash-funded legacy risk
  // denominator. Inputs are already converted to USD by the holdings adapter.
  function allocationContext(options) {
    const input = options || {}, positions = input.positions || {}, listings = input.listings || {};
    const eligible = {}, excludedSymbols = [], errors = [];
    if (input.complete !== true) errors.push("HOLDINGS_INCOMPLETE");
    Object.keys(positions).forEach(function (symbol) {
      const listing = listings[symbol];
      if (!listing) { errors.push("HOLDING_IDENTITY_UNKNOWN:" + symbol); return; }
      const currency = String(listing.listing_currency || "").trim().toUpperCase();
      const exchange = String(listing.exchange || "").toUpperCase().replace(/[\s_-]/g, "");
      const kind = String(listing.instrument_kind || "").trim().toLowerCase();
      if (!currency || (!exchange && listing.verifiedUS !== true) || !kind) {
        errors.push("HOLDING_IDENTITY_UNKNOWN:" + symbol); return;
      }
      const usExchange = /^(XNAS|XNYS|XASE|ARCX|NMS|NGM|NCM|NYQ|ASE|AMEX|PCX)$/.test(exchange)
        || exchange.includes("NASDAQ") || exchange.startsWith("NYSE");
      const isEligible = currency === "USD" && (usExchange || listing.verifiedUS === true)
        && ["stock", "adr", "etf"].includes(kind) && listing.cash_equivalent !== true;
      if (!isEligible) { excludedSymbols.push(symbol); return; }
      const raw = positions[symbol] && positions[symbol].current_value;
      if (raw == null || !["number", "string"].includes(typeof raw) || String(raw).trim() === "" || !Number.isFinite(Number(raw)) || Number(raw) < 0) {
        errors.push("HOLDING_VALUE_UNKNOWN:" + symbol); return;
      }
      eligible[symbol] = { current_value: Number(raw) };
    });
    const securitiesValue = Object.values(eligible).reduce((sum, row) => sum + row.current_value, 0);
    const allocationsPct = Object.fromEntries(Object.entries(eligible).map(([symbol, row]) =>
      [symbol, securitiesValue > 0 ? row.current_value / securitiesValue * 100 : 0]));
    return { complete: errors.length === 0, positions: eligible, securitiesValue, allocationsPct,
      excludedSymbols, reasonCodes: errors, denominator: "eligible_us_securities_excluding_cash" };
  }

  return Object.freeze({ normalize, allocationContext });
});
