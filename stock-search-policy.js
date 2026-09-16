(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.StockSearchPolicy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = "stock-search-v1";
  const MAX_RESULTS = 8;
  const RECENT_LIMIT = 5;
  const EXCHANGES = Object.freeze({
    NASDAQ: "NASDAQ", NASDAQGS: "NASDAQ", NASDAQGM: "NASDAQ", NASDAQCM: "NASDAQ", NMS: "NASDAQ", NGM: "NASDAQ", NCM: "NASDAQ",
    NYSE: "NYSE", NYQ: "NYSE", ASE: "NYSE American", AMEX: "NYSE American", NYSEAMERICAN: "NYSE American"
  });
  const NAMES = Object.freeze({
    AAPL: "Apple Inc.", MSFT: "Microsoft Corporation", NVDA: "NVIDIA Corporation",
    TSLA: "Tesla, Inc.", AMZN: "Amazon.com, Inc.", GOOGL: "Alphabet Inc.", GOOG: "Alphabet Inc.",
    META: "Meta Platforms, Inc.", NFLX: "Netflix, Inc.", AMD: "Advanced Micro Devices, Inc.",
    AVGO: "Broadcom Inc.", ORCL: "Oracle Corporation", CRM: "Salesforce, Inc.",
    COST: "Costco Wholesale Corporation", KO: "The Coca-Cola Company", ASML: "ASML Holding N.V.",
    JPM: "JPMorgan Chase & Co.", V: "Visa Inc.", MA: "Mastercard Incorporated", BRK_B: "Berkshire Hathaway Inc."
  });
  const ALIASES = Object.freeze({
    "苹果": "AAPL", "微软": "MSFT", "英伟达": "NVDA", "辉达": "NVDA", "特斯拉": "TSLA",
    "亚马逊": "AMZN", "谷歌": "GOOGL", "字母表": "GOOGL", "脸书": "META", "元宇宙": "META",
    "奈飞": "NFLX", "网飞": "NFLX", "超微": "AMD", "博通": "AVGO", "甲骨文": "ORCL",
    "赛富时": "CRM", "好市多": "COST", "可口可乐": "KO", "阿斯麦": "ASML",
    "摩根大通": "JPM", "维萨": "V", "万事达": "MA", "伯克希尔": "BRK.B"
  });

  function symbol(value) {
    const next = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
    return /^[A-Z][A-Z0-9.-]{0,14}$/.test(next) ? next : "";
  }
  function finite(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
  function normalizeExchange(value) {
    const raw = String(value || "").trim();
    return { raw, canonical: EXCHANGES[raw.toUpperCase().replace(/[\s_-]/g, "")] || "" };
  }
  function instrument(value) {
    const raw = String(value || "").trim().toUpperCase().replace(/[\s_-]/g, "");
    if (["EQUITY", "COMMONSTOCK", "ADREQUITY", "ADR"].includes(raw)) return "EQUITY";
    if (raw === "ETF") return "ETF";
    if (["MUTUALFUND", "FUND"].includes(raw)) return "MUTUALFUND";
    return raw;
  }
  function reason(code) {
    return ({
      unsupported_type: "仅支持美股普通股或 ADR", unsupported_currency: "仅支持 USD 证券",
      unsupported_exchange: "仅支持 Nasdaq、NYSE 或 NYSE American", missing_price: "未取得有效价格",
      stale_quote: "行情过期或不是可信的最近收盘价", invalid_symbol: "证券代码无效",
      network_error: "联网搜索失败，请检查网络后重试", rate_limited: "数据源请求过于频繁，请稍后重试",
      no_match: "没有找到匹配的美股个股", already_added: "已在定投清单中"
    })[code] || "等待验证";
  }
  function normalize(raw, source) {
    raw = raw || {};
    const ticker = symbol(raw.symbol || raw.displaySymbol);
    if (!ticker) return null;
    const exchange = normalizeExchange(raw.exchange || raw.exchDisp || raw.fullExchangeName);
    const type = instrument(raw.instrumentType || raw.quoteType || raw.type);
    const price = finite(raw.price ?? raw.regularMarketPrice);
    const timestampValue = raw.quoteTimestamp ?? raw.regularMarketTime;
    const hasTimestamp = timestampValue !== null && timestampValue !== undefined && String(timestampValue).trim() !== "";
    const timestamp = hasTimestamp && Number.isFinite(Number(timestampValue))
      ? new Date(Number(timestampValue) < 1e12 ? Number(timestampValue) * 1000 : Number(timestampValue)).toISOString()
      : (hasTimestamp && Number.isFinite(Date.parse(timestampValue)) ? new Date(timestampValue).toISOString() : null);
    const result = {
      symbol: ticker, name: String(raw.name || raw.longname || raw.shortname || raw.description || NAMES[ticker.replace(".", "_")] || ticker),
      exchange: exchange.raw, canonicalExchange: exchange.canonical, instrumentType: type,
      currency: String(raw.currency || "").toUpperCase(), price: price !== null && price > 0 ? price : null,
      quoteTimestamp: timestamp, source: source || raw.source || "Unknown",
      eligibility: "pending", reasonCode: "", reasonText: "选择后验证"
    };
    return preliminary(result);
  }
  function preliminary(result) {
    const next = { ...result };
    if (next.instrumentType && next.instrumentType !== "EQUITY") next.reasonCode = "unsupported_type";
    else if (next.currency && next.currency !== "USD") next.reasonCode = "unsupported_currency";
    else if (next.exchange && !next.canonicalExchange) next.reasonCode = "unsupported_exchange";
    if (next.reasonCode) { next.eligibility = "ineligible"; next.reasonText = reason(next.reasonCode); }
    return next;
  }
  function localResults(query) {
    const raw = String(query || "").trim(), upper = raw.toUpperCase(), symbols = [];
    Object.keys(ALIASES).forEach(alias => { if (raw.includes(alias) || alias.includes(raw)) symbols.push(ALIASES[alias]); });
    Object.keys(NAMES).forEach(key => {
      const ticker = key.replace("_", ".");
      if (ticker.includes(upper) || NAMES[key].toUpperCase().includes(upper)) symbols.push(ticker);
    });
    return Array.from(new Set(symbols)).map(ticker => normalize({ symbol: ticker, name: NAMES[ticker.replace(".", "_")] || ticker }, "本地别名"));
  }
  function score(item, query) {
    const q = String(query || "").trim().toUpperCase(), s = item.symbol.toUpperCase(), n = item.name.toUpperCase();
    if (s === q) return 0;
    if (s.startsWith(q)) return 1;
    if (n.startsWith(q)) return 2;
    if (n.includes(q)) return 3;
    return 4;
  }
  function mergeAndRank(arrays, query, limit) {
    const merged = new Map();
    (arrays || []).forEach(rows => (rows || []).forEach(raw => {
      const item = raw && raw.eligibility ? raw : normalize(raw, raw && raw.source);
      if (!item) return;
      const old = merged.get(item.symbol);
      merged.set(item.symbol, old ? preliminary({ ...old, ...Object.fromEntries(Object.entries(item).filter(([, value]) => value !== "" && value != null)) }) : item);
    }));
    return Array.from(merged.values()).sort((a, b) => score(a, query) - score(b, query) || a.symbol.localeCompare(b.symbol)).slice(0, limit || MAX_RESULTS);
  }
  function validate(result, quote, quoteStatus) {
    const next = normalize({ ...result, ...quote, symbol: result && result.symbol }, quote && quote.source || result && result.source);
    if (!next) return { ...(result || {}), eligibility: "ineligible", reasonCode: "invalid_symbol", reasonText: reason("invalid_symbol") };
    if (next.eligibility === "ineligible") return next;
    if (next.instrumentType !== "EQUITY") return { ...next, eligibility: "ineligible", reasonCode: "unsupported_type", reasonText: reason("unsupported_type") };
    if (next.currency !== "USD") return { ...next, eligibility: "ineligible", reasonCode: "unsupported_currency", reasonText: reason("unsupported_currency") };
    if (!next.canonicalExchange) return { ...next, eligibility: "ineligible", reasonCode: "unsupported_exchange", reasonText: reason("unsupported_exchange") };
    if (!(next.price > 0)) return { ...next, eligibility: "ineligible", reasonCode: "missing_price", reasonText: reason("missing_price") };
    if (!["validated", "market_closed_last_close"].includes(quoteStatus)) return { ...next, eligibility: "ineligible", reasonCode: "stale_quote", reasonText: reason("stale_quote") };
    return { ...next, eligibility: "eligible", reasonCode: "", reasonText: quoteStatus === "market_closed_last_close" ? "可加入 · 休市最近收盘价" : "可加入" };
  }
  function normalizeRecent(value) {
    if (!value || value.version !== VERSION || !Array.isArray(value.items)) return [];
    return value.items.map(item => {
      const normalized = normalize(item, "最近添加");
      return normalized && { symbol: normalized.symbol, name: normalized.name, exchange: normalized.exchange, addedAt: Number.isFinite(Date.parse(item.addedAt)) ? item.addedAt : null };
    }).filter(Boolean).slice(0, RECENT_LIMIT);
  }
  function addRecent(value, item, now) {
    const rows = normalizeRecent(value).filter(row => row.symbol !== item.symbol);
    rows.unshift({ symbol: item.symbol, name: item.name || item.symbol, exchange: item.exchange || "", addedAt: new Date(now == null ? Date.now() : now).toISOString() });
    return { version: VERSION, items: rows.slice(0, RECENT_LIMIT) };
  }
  return Object.freeze({ VERSION, MAX_RESULTS, ALIASES, NAMES, normalize, preliminary, localResults, mergeAndRank, validate, normalizeRecent, addRecent, reason });
});
