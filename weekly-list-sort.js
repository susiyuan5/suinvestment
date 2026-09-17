(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.WeeklyListSort = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const VERSION = 1;
  const DEFAULT = Object.freeze({ version: VERSION, field: "suggested", direction: "desc" });
  const FIELDS = new Set(["suggested", "target", "current", "marketValue", "price", "symbol"]);
  function normalize(value) {
    return value && value.version === VERSION && FIELDS.has(value.field) && ["asc", "desc"].includes(value.direction)
      ? { version: VERSION, field: value.field, direction: value.direction }
      : { ...DEFAULT };
  }
  function rows(items, preference) {
    const pref = normalize(preference), direction = pref.direction === "asc" ? 1 : -1;
    return (items || []).slice().sort(function (a, b) {
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
  return Object.freeze({ VERSION, DEFAULT, normalize, rows });
});
