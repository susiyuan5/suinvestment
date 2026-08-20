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

  return Object.freeze({ normalize });
});
