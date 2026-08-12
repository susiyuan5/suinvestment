(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FxRateService = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var CACHE_KEY = "su-investment-pro:fx-rate-cache-v1";
  var MIN_USD_CAD = 0.5;
  var MAX_USD_CAD = 2.5;
  var LIVE_MAX_AGE_MS = 15 * 60 * 1000;

  function finite(value) { return typeof value === "number" && Number.isFinite(value); }
  function plausibleRate(value) { return finite(value) && value >= MIN_USD_CAD && value <= MAX_USD_CAD; }
  function validTime(value) { var parsed = Date.parse(value); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }

  function normalize(input) {
    var value = input && typeof input === "object" ? input : {};
    var rate = Number(value.rate);
    var asOf = validTime(value.asOf);
    if (!plausibleRate(rate) || !asOf) return null;
    return {
      schemaVersion: "fx-rate-cache-v1",
      pair: "USD/CAD",
      rate: rate,
      inverseRate: 1 / rate,
      asOf: asOf,
      fetchedAt: validTime(value.fetchedAt) || asOf,
      source: String(value.source || "未知来源"),
      sourceKind: String(value.sourceKind || "unknown")
    };
  }

  function parseFinnhub(payload, fetchedAt) {
    var rate = Number(payload && payload.quote && payload.quote.CAD);
    if (String(payload && payload.base || "").toUpperCase() !== "USD" || !plausibleRate(rate)) return null;
    return normalize({ rate: rate, asOf: fetchedAt, fetchedAt: fetchedAt, source: "Finnhub", sourceKind: "finnhub" });
  }

  function parseYahoo(payload, fetchedAt) {
    var result = payload && payload.chart && Array.isArray(payload.chart.result) && payload.chart.result[0];
    var meta = result && result.meta || {};
    var rate = Number(meta.regularMarketPrice);
    if (!plausibleRate(rate)) return null;
    var timestamps = result && Array.isArray(result.timestamp) ? result.timestamp.filter(function (item) { return Number.isFinite(Number(item)); }) : [];
    var seconds = Number(meta.regularMarketTime) || Number(timestamps[timestamps.length - 1]);
    var asOf = seconds > 0 ? new Date(seconds * 1000).toISOString() : fetchedAt;
    return normalize({ rate: rate, asOf: asOf, fetchedAt: fetchedAt, source: "Yahoo Finance", sourceKind: "yahoo" });
  }

  function parseBankOfCanada(payload, fetchedAt) {
    var observations = payload && Array.isArray(payload.observations) ? payload.observations : [];
    var latest = observations[observations.length - 1] || {};
    var rate = Number(latest && latest.FXUSDCAD && latest.FXUSDCAD.v);
    var date = typeof latest.d === "string" ? latest.d : "";
    var asOf = date ? validTime(date + "T21:00:00Z") : null;
    if (!plausibleRate(rate) || !asOf) return null;
    return normalize({ rate: rate, asOf: asOf, fetchedAt: fetchedAt, source: "加拿大央行（日均）", sourceKind: "bank-of-canada" });
  }

  function classify(snapshot, now, maxAgeDays) {
    var normalized = normalize(snapshot);
    if (!normalized) return { state: "error", label: "不可用", usable: false, ageMs: null };
    var current = Number(now == null ? Date.now() : now);
    var timestamp = Date.parse(normalized.asOf);
    var ageMs = current - timestamp;
    var limitMs = Math.max(0, Number(maxAgeDays == null ? 3 : maxAgeDays)) * 86400000;
    if (!Number.isFinite(ageMs) || ageMs < -300000) return { state: "error", label: "时间异常", usable: false, ageMs: ageMs };
    if (ageMs <= LIVE_MAX_AGE_MS) return { state: "live", label: "实时", usable: true, ageMs: Math.max(0, ageMs) };
    if (ageMs <= 60 * 60 * 1000) return { state: "cached", label: "最近有效", usable: true, ageMs: ageMs };
    if (ageMs <= limitMs) return { state: "stale", label: "缓存数据", usable: true, ageMs: ageMs };
    return { state: "expired", label: "已过期", usable: false, ageMs: ageMs };
  }

  function loadCache(storage) {
    try { return normalize(JSON.parse(storage && storage.getItem(CACHE_KEY) || "null")); } catch (_) { return null; }
  }

  function saveCache(snapshot, storage) {
    var normalized = normalize(snapshot);
    if (!normalized) return null;
    try { if (storage) storage.setItem(CACHE_KEY, JSON.stringify(normalized)); } catch (_) {}
    return normalized;
  }

  async function requestJson(fetchImpl, url, options) {
    var response = await fetchImpl(url, options || {});
    if (!response || !response.ok) throw new Error("HTTP " + (response && response.status || "unknown"));
    return response.json();
  }

  async function fetchLatest(options) {
    var config = options || {};
    var fetchImpl = config.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    if (!fetchImpl) throw new Error("浏览器不支持行情请求");
    var fetchedAt = new Date(config.now == null ? Date.now() : config.now).toISOString();
    var failures = [];

    if (config.apiKey) {
      try {
        var finnhubUrl = "https://finnhub.io/api/v1/forex/rates?base=USD&token=" + encodeURIComponent(config.apiKey);
        var finnhubPayload = await requestJson(fetchImpl, finnhubUrl, { cache: "no-store", signal: config.signal });
        var finnhub = parseFinnhub(finnhubPayload, fetchedAt);
        if (finnhub) return Object.assign({}, finnhub, { attemptedSources: ["Finnhub"] });
        failures.push("Finnhub 返回无效汇率");
      } catch (error) {
        if (error && error.name === "AbortError") throw error;
        failures.push("Finnhub：" + (error && error.message || "请求失败"));
      }
    }

    try {
      var bankOfCanadaUrl = "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1";
      var bankOfCanadaPayload = await requestJson(fetchImpl, bankOfCanadaUrl, { cache: "no-store", signal: config.signal });
      var bankOfCanada = parseBankOfCanada(bankOfCanadaPayload, fetchedAt);
      if (bankOfCanada) return Object.assign({}, bankOfCanada, { attemptedSources: config.apiKey ? ["Finnhub", "加拿大央行"] : ["加拿大央行"] });
      failures.push("加拿大央行返回无效汇率");
    } catch (error) {
      if (error && error.name === "AbortError") throw error;
      failures.push("加拿大央行：" + (error && error.message || "请求失败"));
    }

    try {
      var yahooUrl = "https://query1.finance.yahoo.com/v8/finance/chart/CAD=X?interval=1m&range=1d";
      var yahooPayload = await requestJson(fetchImpl, yahooUrl, { cache: "no-store", signal: config.signal });
      var yahoo = parseYahoo(yahooPayload, fetchedAt);
      if (yahoo) return Object.assign({}, yahoo, { attemptedSources: config.apiKey ? ["Finnhub", "加拿大央行", "Yahoo Finance"] : ["加拿大央行", "Yahoo Finance"] });
      failures.push("Yahoo Finance 返回无效汇率");
    } catch (error) {
      if (error && error.name === "AbortError") throw error;
      failures.push("Yahoo Finance：" + (error && error.message || "请求失败"));
    }

    throw new Error(failures.join("；") || "实时汇率不可用");
  }

  return Object.freeze({
    CACHE_KEY: CACHE_KEY,
    LIVE_MAX_AGE_MS: LIVE_MAX_AGE_MS,
    normalize: normalize,
    plausibleRate: plausibleRate,
    parseFinnhub: parseFinnhub,
    parseBankOfCanada: parseBankOfCanada,
    parseYahoo: parseYahoo,
    classify: classify,
    loadCache: loadCache,
    saveCache: saveCache,
    fetchLatest: fetchLatest
  });
});
