(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./data/us-equity-calendar.json"));
  } else {
    root.MarketCalendar = factory(null);
    root.MarketCalendar.ready = root.MarketCalendar.load(root.fetch.bind(root));
  }
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function create(config) {
    "use strict";
    function valid(c) {
      return !!(
        c &&
        c.version === "us-equity-sessions-2026-2028-v1" &&
        c.timezone === "America/New_York" &&
        c.validFrom === "2026-01-01" &&
        c.validThrough === "2028-12-31" &&
        c.previousSession === "2025-12-31" &&
        c.open === "09:30" &&
        c.close === "16:00" &&
        c.officialCloseToleranceSeconds === 300 &&
        Array.isArray(c.holidays) &&
        c.holidays.length === 29 &&
        new Set(c.holidays).size === 29 &&
        c.holidays.every((d) => /^202[678]-\d{2}-\d{2}$/.test(d)) &&
        c.earlyCloses &&
        Object.keys(c.earlyCloses).length === 5 &&
        Object.values(c.earlyCloses).every((t) => t === "13:00") &&
        c.exchangeAliases &&
        c.symbolExchanges
      );
    }
    if (!valid(config)) config = null;
    function parts(ts) {
      return Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/New_York",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
        })
          .formatToParts(new Date(ts))
          .map((p) => [p.type, p.value]),
      );
    }
    function dayOf(ts) {
      const p = parts(ts);
      return `${p.year}-${p.month}-${p.day}`;
    }
    function at(day, time) {
      const noon = Date.parse(day + "T12:00:00Z"),
        p = parts(noon);
      const offset =
        Date.parse(
          `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`,
        ) - noon;
      return Date.parse(day + "T" + time + ":00Z") - offset;
    }
    function close(day) {
      if (
        !config ||
        (day < config.validFrom && day !== config.previousSession) ||
        day > config.validThrough
      )
        return NaN;
      const weekday = new Date(day + "T12:00:00Z").getUTCDay();
      if (weekday === 0 || weekday === 6 || config.holidays.includes(day))
        return NaN;
      return at(day, config.earlyCloses[day] || config.close);
    }
    function assess(quote, now = Date.now()) {
      const empty = (reason) => ({
        known: false,
        closed: false,
        eligible: false,
        missedSession: false,
        expectedClose: null,
        reason,
      });
      if (!config) return empty("calendar_unavailable");
      if (!Number.isFinite(now)) return empty("invalid_time");
      const exchange =
        quote.exchange ||
        config.symbolExchanges[String(quote.symbol || "").toUpperCase()];
      if (!config.exchangeAliases[String(exchange || "").toUpperCase()])
        return empty("unknown_exchange");
      const day = dayOf(now);
      if (day < config.validFrom || day > config.validThrough)
        return empty("calendar_out_of_range");
      const todayClose = close(day);
      const closed =
        !Number.isFinite(todayClose) ||
        now < at(day, config.open) ||
        now >= todayClose;
      let expected = null;
      for (let n = 0; n < 10; n++) {
        const prior = new Date(Date.parse(day + "T12:00:00Z") - n * 86400000)
          .toISOString()
          .slice(0, 10);
        const end = close(prior);
        if (Number.isFinite(end) && end <= now) {
          expected = end;
          break;
        }
      }
      if (expected === null) return empty("calendar_out_of_range");
      const ts =
        typeof quote.quoteTimestamp === "number"
          ? quote.quoteTimestamp
          : Date.parse(quote.quoteTimestamp);
      const official =
        Number.isFinite(ts) &&
        ts <= now &&
        ts >= expected &&
        ts <= expected + config.officialCloseToleranceSeconds * 1000;
      const eligible = closed && official && quote.trustedSource === true;
      const missedSession = Number.isFinite(ts) && dayOf(ts) < dayOf(expected);
      return {
        known: true,
        closed,
        eligible,
        missedSession,
        expectedClose: new Date(expected).toISOString().replace(".000Z", "Z"),
        reason: eligible
          ? "latest_official_close"
          : missedSession
            ? "missing_latest_session"
            : "no_closed_market_exemption",
      };
    }
    async function load(fetcher) {
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetcher("data/us-equity-calendar.json", {
          signal: controller.signal,
          cache: "no-cache",
        });
        const next = response.ok ? await response.json() : null;
        config = valid(next) ? next : null;
      } catch (_) {
        config = null;
      } finally {
        clearTimeout(timer);
      }
      return !!config;
    }
    return {
      assess,
      close,
      load,
      create,
      get available() {
        return !!config;
      },
    };
  },
);
