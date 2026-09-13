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

  function dailyCloseTimestamp(latestDate, regularMarketTime, source) {
    const parsedDate = typeof latestDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(latestDate) ? latestDate : "";
    if (!parsedDate) return Number.isFinite(Number(regularMarketTime)) ? Number(regularMarketTime) : NaN;
    const regular = Number(regularMarketTime);
    if (Number.isFinite(regular)) {
      const dateInNewYork = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(regular));
      if (dateInNewYork === parsedDate) return regular;
    }
    if (!/yahoo/i.test(String(source || ""))) return Number.isFinite(regular) ? regular : Date.parse(parsedDate + "T16:00:00Z");
    const probe = new Date(parsedDate + "T12:00:00Z");
    const zone = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "longOffset" }).formatToParts(probe).find((part) => part.type === "timeZoneName");
    const match = zone && zone.value.match(/GMT([+-])(\d{2}):?(\d{2})?/);
    const offsetMinutes = match ? (match[1] === "+" ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3] || 0)) : -300;
    return Date.parse(parsedDate + "T16:00:00Z") - offsetMinutes * 60000;
  }

  function isWeekendClose(timestamp, nowMs = Date.now()) {
    if (!Number.isFinite(timestamp) || timestamp > nowMs) return false;
    const parts = value => Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(value)).map(p => [p.type, p.value]));
    const now = parts(nowMs), quote = parts(timestamp);
    const day = Date.UTC(+now.year, +now.month - 1, +now.day);
    const weekday = new Date(day).getUTCDay();
    if (weekday !== 0 && weekday !== 6) return false;
    const friday = day - (weekday === 6 ? 1 : 2) * 86400000;
    return Date.UTC(+quote.year, +quote.month - 1, +quote.day) === friday && +quote.hour >= 16;
  }

  return Object.freeze({ freshness, fieldMeta, dailyCloseTimestamp, isWeekendClose });
});
