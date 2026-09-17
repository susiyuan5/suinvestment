(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.WeeklyListSort = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const VERSION = 2;
  const DEFAULT = Object.freeze({ version: VERSION, field: "suggested", direction: "desc", order: [] });
  const FIELDS = new Set(["suggested", "target", "current", "marketValue", "price", "symbol", "manual"]);
  function cleanOrder(value) {
    return Array.from(new Set((Array.isArray(value) ? value : []).map(function (symbol) { return String(symbol || "").trim().toUpperCase(); }).filter(function (symbol) { return /^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol); })));
  }
  function normalize(value) {
    return value && (value.version === VERSION || value.version === 1) && FIELDS.has(value.field) && ["asc", "desc"].includes(value.direction)
      ? { version: VERSION, field: value.field, direction: value.direction, order: cleanOrder(value.order) }
      : { version: VERSION, field: DEFAULT.field, direction: DEFAULT.direction, order: [] };
  }
  function rows(items, preference) {
    const pref = normalize(preference), direction = pref.direction === "asc" ? 1 : -1;
    return (items || []).slice().sort(function (a, b) {
      if (pref.field === "manual") {
        const ai = pref.order.indexOf(String(a.symbol)), bi = pref.order.indexOf(String(b.symbol));
        if (ai >= 0 || bi >= 0) return ai < 0 ? 1 : bi < 0 ? -1 : ai - bi;
        return String(a.symbol).localeCompare(String(b.symbol));
      }
      if (pref.field === "symbol") {
        const compared = String(a.symbol).localeCompare(String(b.symbol));
        return compared * direction;
      }
      const av = Number(a[pref.field]), bv = Number(b[pref.field]);
      const aKnown = Number.isFinite(av), bKnown = Number.isFinite(bv);
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      if (aKnown && av !== bv) return (av - bv) * direction;
      return String(a.symbol).localeCompare(String(b.symbol));
    });
  }
  function move(order, symbol, delta, universe) {
    const available = cleanOrder(universe), current = cleanOrder(order).filter(function (item) { return available.includes(item); });
    available.forEach(function (item) { if (!current.includes(item)) current.push(item); });
    const index = current.indexOf(String(symbol || "").toUpperCase()), next = Math.max(0, Math.min(current.length - 1, index + Number(delta || 0)));
    if (index < 0 || index === next) return current;
    const item = current.splice(index, 1)[0]; current.splice(next, 0, item); return current;
  }
  return Object.freeze({ VERSION, DEFAULT, normalize, rows, move });
});
