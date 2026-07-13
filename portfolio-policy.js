(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PortfolioPolicy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

  function normalizeSymbol(value) {
    const symbol = String(value || "").trim().toUpperCase();
    return /^[A-Z0-9.-]{1,12}$/.test(symbol) ? symbol : "";
  }

  function normalizePortfolio(items, defaultStocks, allowCustom) {
    const supportedSymbols = new Set((defaultStocks || []).map((stock) => stock.symbol));
    const seen = new Set();
    return (Array.isArray(items) ? items : []).reduce(function (portfolio, item) {
      const symbol = normalizeSymbol(item && item.symbol);
      const allocation = Number(item && item.allocation);
      if (!symbol || (!supportedSymbols.has(symbol) && !allowCustom) || seen.has(symbol) || !Number.isFinite(allocation) || allocation < 0) return portfolio;
      seen.add(symbol);
      portfolio.push({ symbol, name: String(item.name || symbol).trim() || symbol, allocation: round2(allocation * 100) / 100 });
      return portfolio;
    }, []);
  }

  return Object.freeze({ normalizeSymbol, normalizePortfolio });
});
