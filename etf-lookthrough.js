(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.EtfLookthrough = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  function calculate(direct, etfData, now, maxAgeDays) { var data = etfData || {}, at = data.as_of && Date.parse(data.as_of), fresh = data.status === "ready" && Number.isFinite(at) && ((now || Date.now()) - at) / 86400000 <= (maxAgeDays || 30); var directTech = Object.keys(direct || {}).reduce(function (sum, symbol) { return sum + (direct[symbol] && direct[symbol].sector === "technology" ? Number(direct[symbol].allocation || 0) : 0); }, 0); if (!fresh) return { status: "unknown", directTechnologyPct: directTech, etfTechnologyPct: null, issuerExposure: {}, asOf: data.as_of || null, note: "ETF 穿透数据过期或缺失" }; var issuer = {}, etfTech = 0; Object.keys(data.holdings || {}).forEach(function (symbol) { var row = data.holdings[symbol] || {}; var allocation = Number(row.allocation || 0); if (row.sector === "technology") etfTech += allocation; issuer[symbol] = (issuer[symbol] || 0) + allocation; }); Object.keys(direct || {}).forEach(function (symbol) { issuer[symbol] = (issuer[symbol] || 0) + Number(direct[symbol].allocation || 0); }); return { status: "ready", directTechnologyPct: directTech, etfTechnologyPct: etfTech, issuerExposure: issuer, asOf: data.as_of, note: "仅用于风险提示，不自动卖出或再平衡" }; }
  return Object.freeze({ calculate: calculate });
});
