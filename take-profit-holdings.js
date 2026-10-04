(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TakeProfitHoldings = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Consumes the app's read-only holdings API. No account unlock, FX conversion,
  // persistence, network calls or inferred acquisition dates belong here.
  const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
  const US_EXCHANGES = new Set([
    "XNAS", "XNYS", "XASE", "ARCX", "NMS", "NGM", "NCM", "NYQ", "ASE", "AMEX", "PCX",
    "NASDAQ", "NASDAQGS", "NASDAQGM", "NASDAQCM", "NYSE", "NYSEARCA", "NYSEAMERICAN",
  ]);
  const INVESTMENT_KINDS = new Set(["stock", "adr", "etf"]);
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

  function finite(value) {
    if (typeof value !== "number" && typeof value !== "string") return null;
    if (typeof value === "string" && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  function positive(value) { const parsed = finite(value); return parsed !== null && parsed > 0 ? parsed : null; }
  function symbol(value) {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toUpperCase();
    return /^[A-Z0-9][A-Z0-9.\-]*$/.test(normalized) ? normalized : null;
  }
  function currency(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    return value.trim().toUpperCase();
  }
  function isoDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return null;
    const parsed = new Date(value + "T00:00:00Z");
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
  }
  function timestamp(value) {
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string" || !value.trim()) return null;
    // Offset-bearing timestamps and ISO dates have a deterministic timezone.
    if (!isoDate(value) && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
    if (!isoDate(value.slice(0, 10))) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  function approximatelyEqual(left, right) {
    return left !== null && right !== null && Math.abs(left - right) <= Math.max(0.01, Math.abs(right) * 1e-6);
  }
  function supportedSet(input) {
    const values = Array.isArray(input) ? input : input instanceof Set ? Array.from(input) : [];
    return new Set(values.map(symbol).filter(Boolean));
  }
  function observationsBySymbol(input) {
    const result = new Map();
    for (const raw of Array.isArray(input) ? input : []) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const key = symbol(raw.symbol);
      if (!key) continue;
      if (result.has(key)) result.get(key).duplicate = true;
      else result.set(key, { raw, duplicate: false });
    }
    return result;
  }

  function unavailable(sourceLabel, asOf, reason) {
    return Object.freeze({ available: false, reason, sourceLabel, asOf: asOf || null, positions: Object.freeze([]) });
  }
  function sourceReason(status) {
    if (status === "locked") return "自动持仓已锁定，请先在持仓页面解锁。";
    if (status === "checking" || status === "loading") return "自动持仓正在读取，请稍后再查看止盈。";
    if (status === "stale" || status === "warning") return "自动持仓未通过时效核对，请先更新持仓。";
    if (status === "idb_unavailable") return "本地自动持仓存储不可用，请在持仓页面处理。";
    if (status === "error") return "自动持仓读取失败，请先在持仓页面更新。";
    return "自动持仓尚未就绪，请先解锁或更新持仓。";
  }

  function build(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) input = {};
    const holdings = input.holdings;
    if (!holdings || typeof holdings !== "object" || Array.isArray(holdings)) return unavailable("持仓来源未就绪", null, "当前持仓来源不可用，请先在持仓页面设置。" );
    const automatic = holdings.requestedSourceMode === "automatic";
    const manual = holdings.requestedSourceMode === "manual";
    const sourceLabel = automatic ? "自动持仓（只读）" : manual ? "手动持仓" : "持仓来源未就绪";
    const asOf = typeof holdings.asOf === "string" || typeof holdings.asOf === "number" ? holdings.asOf : null;
    if (automatic) {
      if (holdings.status !== "ready") return unavailable(sourceLabel, asOf, sourceReason(holdings.status));
      if (holdings.sourceMode !== "snaptrade_automatic") return unavailable(sourceLabel, asOf, "当前选择自动持仓，但自动来源尚未就绪；请先解锁或更新持仓。" );
      const now = timestamp(input.now === undefined ? Date.now() : input.now);
      const snapshotTime = timestamp(asOf);
      if (now === null || snapshotTime === null) return unavailable(sourceLabel, asOf, "自动持仓时间缺失或无效，请先更新持仓。" );
      if (snapshotTime > now) return unavailable(sourceLabel, asOf, "自动持仓时间晚于当前时间，暂停止盈计算。" );
      if (now - snapshotTime > MAX_AGE_MS) return unavailable(sourceLabel, asOf, "自动持仓已超过 3 天，请先更新持仓。" );
    } else if (manual) {
      if (holdings.sourceMode !== "manual" || holdings.status !== "ready") return unavailable(sourceLabel, asOf, "手动持仓尚未就绪，请先在持仓页面完成设置。" );
    } else return unavailable(sourceLabel, asOf, "当前持仓来源模式无效，请先在持仓页面设置。" );
    if (!Array.isArray(holdings.rows)) return unavailable(sourceLabel, asOf, "当前持仓明细缺失，请先更新持仓。" );

    const supported = supportedSet(input.supportedSymbols);
    const observations = observationsBySymbol(input.observations);
    const rows = new Map();
    for (const raw of holdings.rows) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.cashEquivalent === true) continue;
      const key = symbol(raw.symbol), shares = positive(raw.shares);
      // Missing quantity is never coerced into a current holding. Shorts and
      // cash are excluded even if an old observation remains in local storage.
      if (!key || shares === null) continue;
      if (rows.has(key)) rows.get(key).duplicate = true;
      else rows.set(key, { raw, shares, duplicate: false });
    }
    const positions = [];
    for (const key of Array.from(rows.keys()).sort()) {
      const { raw, shares, duplicate } = rows.get(key);
      const sourceCurrency = currency(raw.currency), listingCurrency = currency(raw.listingCurrency);
      const sourceAverageCost = positive(raw.averageCost);
      const kind = typeof raw.instrumentKind === "string" ? raw.instrumentKind.trim().toLowerCase() : "";
      const exchanges = typeof raw.exchange === "string" ? raw.exchange.split("/").map((value) => value.toUpperCase().replace(/[\s_-]/g, "")) : [];
      const observation = observations.get(key), saved = observation?.raw;
      const savedCost = saved ? positive(saved.cost) : null;
      const date = saved ? isoDate(saved.date) : null;
      const holdingBasis = JSON.stringify([holdings.sourceMode, key, shares, sourceCurrency, sourceAverageCost, listingCurrency]);
      const knownUSDCost = sourceCurrency === "USD" && sourceAverageCost !== null && (manual || listingCurrency === "USD") ? sourceAverageCost : null;
      const costFromHolding = knownUSDCost !== null;
      const cost = costFromHolding ? knownUSDCost : savedCost;
      let needsReview = false, blockedReason = null, blockedReasonCode = null;
      function block(code, reason) { if (blockedReason === null) { blockedReasonCode = code; blockedReason = reason; } }

      if (duplicate) block("duplicate_holding", "同一股票存在重复持仓记录，请先核对持仓来源。" );
      if (!supported.has(key)) block("unsupported_symbol", "当前已验证日线未覆盖这只持仓，暂时无法计算止盈。" );
      if (automatic) {
        if (listingCurrency !== "USD") block("unsupported_listing_currency", listingCurrency ? "该持仓不是美元上市标的，暂时无法计算美股止盈。" : "该持仓的上市币种未知，请先核对标的身份。" );
        if (!INVESTMENT_KINDS.has(kind)) block("unsupported_instrument", "该持仓的产品类型不受支持，请先核对标的身份。" );
        if (!exchanges.length || !exchanges.every((value) => US_EXCHANGES.has(value))) block("unsupported_exchange", "该持仓的美国交易所身份未确认，暂时无法计算止盈。" );
      } else if (!INVESTMENT_KINDS.has(kind)) block("unsupported_instrument", "该手动持仓的产品类型不受支持。" );

      if (saved) {
        if (own(saved, "holdingBasis")) needsReview = typeof saved.holdingBasis !== "string" || saved.holdingBasis !== holdingBasis;
        else needsReview = !approximatelyEqual(savedCost, knownUSDCost);
        if (observation.duplicate) needsReview = true;
      }
      if (needsReview) block("holding_changed", "持仓数量、成本或来源已变化，原观察需要复核；请核对并重新保存入场信息。" );
      if (date === null && cost === null) block("date_and_cost_missing", "入场日期和美元每股成本待补充，请核对后保存。" );
      else if (date === null) block(saved && saved.date ? "date_invalid" : "date_missing", saved && saved.date ? "入场日期无效，请补充实际交易日后保存。" : "入场日期待补充，请填写实际交易日后保存。" );
      else if (cost === null) block("usd_cost_missing", "美元每股成本待补充；当前持仓成本无法直接用于美元止盈，请人工填写。" );
      positions.push(Object.freeze({
        symbol: key, date, cost, shares, holdingBasis, costFromHolding, needsReview,
        blockedReason, blockedReasonCode, currency: sourceCurrency, costCurrency: "USD",
      }));
    }
    return Object.freeze({ available: true, reason: null, sourceLabel, asOf: asOf || null, positions: Object.freeze(positions) });
  }

  return Object.freeze({ build });
});
