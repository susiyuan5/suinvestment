(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MarketData = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const calendar =
    typeof module === "object" && module.exports
      ? require("./market-calendar")
      : globalThis.MarketCalendar;

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
      freshness:
        (options && options.freshness) ||
        freshness(ts, options, nowMs, defaultMaxAgeHours),
      stale_reason: (options && options.staleReason) || "",
    };
  }

  function dailyCloseTimestamp(
    latestDate,
    regularMarketTime,
    source,
    symbol,
    nowMs = Date.now(),
  ) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(latestDate || "")) return NaN;
    const regular = Number(regularMarketTime);
    if (Number.isFinite(regular) && regular > 0) {
      const date = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(regular));
      const expected = calendar && calendar.close(latestDate);
      if (date === latestDate && Number.isFinite(expected) && regular >= expected && regular <= expected + 300000) return regular;
      if (date === latestDate) return regular;
    }
    const end = calendar && calendar.close(latestDate);
    if (
      !/yahoo|stooq/i.test(String(source || "")) ||
      !Number.isFinite(end) ||
      end > nowMs
    )
      return NaN;
    return calendar.assess({ symbol, quoteTimestamp: end }, nowMs).known
      ? end
      : NaN;
  }

  function quoteStatus(item, nowMs = Date.now()) {
    const ts =
      typeof item.quoteTimestamp === "number"
        ? item.quoteTimestamp
        : Date.parse(item.quoteTimestamp);
    if (!Number.isFinite(ts) || ts > nowMs + 300000) return "stale";
    if (
      item.stale === true ||
      (item.validationStatus &&
        !["validated", "market_closed_last_close"].includes(
          item.validationStatus,
        ))
    )
      return "stale";
    const session = calendar && calendar.assess(item, nowMs);
    if (session && session.missedSession) return "stale";
    if (session && session.eligible) return "market_closed_last_close";
    if (item.validationStatus === "market_closed_last_close") return "stale";
    return (nowMs - ts) / 3600000 > 24 ? "stale" : "validated";
  }

  return Object.freeze({
    freshness,
    fieldMeta,
    dailyCloseTimestamp,
    quoteStatus,
  });
});
