(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MarketData = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function freshness(timestamp, options, nowMs, defaultMaxAgeHours) {
    const opts = options || {};
    if (opts.missing) return "missing";
    if (opts.stale) return "stale";
    if (!Number.isFinite(timestamp)) return "missing";
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    if (timestamp > now + 300000) return "stale";
    const maxAge = opts.maxAgeHours || defaultMaxAgeHours || 24;
    return (now - timestamp) / 3600000 > maxAge ? "stale" : "fresh";
  }

  function fieldMeta(source, timestamp, options, nowMs, defaultMaxAgeHours) {
    const ts = Number(timestamp);
    return {
      source: source || "Unavailable",
      timestamp: Number.isFinite(ts) ? ts : null,
      freshness: (options && options.freshness) || freshness(ts, options, nowMs, defaultMaxAgeHours),
      stale_reason: (options && options.staleReason) || ""
    };
  }

  return Object.freeze({ freshness, fieldMeta });
});
