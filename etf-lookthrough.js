(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.EtfLookthrough = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  function finite(value) { var number = Number(value); return Number.isFinite(number) ? number : null; }
  function fresh(data, now, maxAgeDays) { var asOf = Date.parse(data && data.asOf || data && data.as_of || ""), current = now || Date.now(); return Boolean(data && Number.isFinite(asOf) && asOf <= current && (current - asOf) / 86400000 <= (maxAgeDays || 30) && data.schemaVersion); }
  function calculate(direct, etfData, now, maxAgeDays, mode) {
    var directValues = direct || {}, data = etfData || {}, rows = Array.isArray(data.holdings) ? data.holdings : [], useLookthrough = mode !== "direct_only";
    var directExposure = {}, indirectExposure = {}, effectiveExposure = {};
    Object.keys(directValues).forEach(function (symbol) { directExposure[symbol] = finite(directValues[symbol].allocation) || finite(directValues[symbol]) || 0; });
    var ready = fresh(data, now, maxAgeDays);
    if (useLookthrough && !ready) return { status: "unknown", mode: "lookthrough", directExposure: directExposure, indirectExposure: {}, effectiveExposure: directExposure, note: "穿透数据待更新", asOf: data.asOf || data.as_of || null };
    Object.keys(directExposure).forEach(function (symbol) { effectiveExposure[symbol] = directExposure[symbol]; });
    if (useLookthrough) rows.forEach(function (row) { var etfAllocation = directExposure[row.etfTicker] || 0, weight = finite(row.weight); if (etfAllocation && weight !== null && weight >= 0) { indirectExposure[row.componentTicker] = (indirectExposure[row.componentTicker] || 0) + etfAllocation * weight; effectiveExposure[row.componentTicker] = (effectiveExposure[row.componentTicker] || 0) + etfAllocation * weight; } });
    return { status: useLookthrough ? "ready" : "direct_only", mode: useLookthrough ? "lookthrough" : "direct_only", directExposure: directExposure, indirectExposure: indirectExposure, effectiveExposure: effectiveExposure, note: useLookthrough ? "ETF 穿透口径已计入间接持仓" : "仅直接持仓口径，ETF 重叠未计入", asOf: data.asOf || data.as_of || null };
  }
  return Object.freeze({ calculate: calculate });
});
