(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(typeof globalThis !== "undefined" ? globalThis : root);
  else root.StockDetail = factory(root);
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  var WATCHLIST_KEY = "su-investment-pro:watchlist";
  var categoryLabels = {
    core_technology: "核心科技",
    semiconductors: "半导体",
    consumer_retail: "消费与零售",
    defensive_healthcare: "防御与医疗",
    financial_payments: "金融与支付",
    industrial_diversified: "工业",
    international: "国际股票",
    energy_materials: "能源与材料",
    utilities_real_assets: "公用事业与实物资产"
  };
  var dimensionLabels = { financial_quality: "财务质量", valuation: "估值", demand_catalyst: "需求与催化", expectations_confirmation: "预期确认", industry_cycle: "行业周期", risk_liquidity_health: "风险与流动性" };

  function normalizeTicker(value) {
    var ticker = String(value || "").trim().toUpperCase();
    return /^[A-Z0-9.-]{1,16}$/.test(ticker) ? ticker : "";
  }
  function tickerFromSearch(search) {
    try { return normalizeTicker(new URLSearchParams(String(search || "")).get("ticker")); }
    catch (_error) { return ""; }
  }
  function finite(value) { var parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
  function parseYahooChart(payload) {
    var result = payload && payload.chart && Array.isArray(payload.chart.result) ? payload.chart.result[0] : null;
    if (!result || !result.meta) return null;
    var quote = result.indicators && Array.isArray(result.indicators.quote) ? result.indicators.quote[0] : {};
    var timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
    var closes = quote && Array.isArray(quote.close) ? quote.close : [];
    var points = [];
    timestamps.forEach(function (stamp, index) { var close = finite(closes[index]); if (finite(stamp) !== null && close !== null && close > 0) points.push({ time: Number(stamp) * 1000, close: close }); });
    var meta = result.meta;
    var current = finite(meta.regularMarketPrice);
    if (current === null && points.length) current = points[points.length - 1].close;
    var previous = finite(meta.chartPreviousClose);
    if (previous === null) previous = finite(meta.previousClose);
    if (previous === null && points.length > 1) previous = points[points.length - 2].close;
    return {
      ticker: normalizeTicker(meta.symbol),
      companyName: String(meta.longName || meta.shortName || meta.symbol || "").trim(),
      exchange: String(meta.fullExchangeName || meta.exchangeName || "").trim(),
      currency: String(meta.currency || "").trim().toUpperCase(),
      instrumentType: String(meta.instrumentType || "").trim().toUpperCase(),
      current: current,
      previous: previous,
      change: current !== null && previous ? current - previous : null,
      changePct: current !== null && previous ? (current / previous - 1) * 100 : null,
      quoteTime: finite(meta.regularMarketTime) !== null ? Number(meta.regularMarketTime) * 1000 : (points.length ? points[points.length - 1].time : null),
      points: points
    };
  }
  function candidateForTicker(payload, ticker) {
    if (!payload || payload.research_only !== true || !Array.isArray(payload.candidates)) return null;
    return payload.candidates.find(function (candidate) { return normalizeTicker(candidate.ticker) === normalizeTicker(ticker); }) || null;
  }
  function categoryForTicker(payload, ticker) {
    var metadata = payload && payload.symbol_metadata && payload.symbol_metadata[normalizeTicker(ticker)];
    return metadata && metadata.category ? metadata.category : "";
  }
  function addToWatchlist(storage, ticker) {
    var normalized = normalizeTicker(ticker);
    if (!storage || !normalized) return { ok: false, message: "股票代码无效。" };
    try {
      var parsed = JSON.parse(storage.getItem(WATCHLIST_KEY) || "[]");
      var symbols = Array.isArray(parsed) ? parsed.map(normalizeTicker).filter(Boolean) : [];
      if (symbols.indexOf(normalized) >= 0) return { ok: true, alreadyExists: true, message: "已在盯盘列表。" };
      symbols.push(normalized);
      storage.setItem(WATCHLIST_KEY, JSON.stringify(symbols));
      return { ok: true, alreadyExists: false, message: "已加入盯盘。" };
    } catch (_error) { return { ok: false, message: "本地盯盘数据不可用，请人工复核。" }; }
  }
  function formatPrice(value, currency) { return finite(value) === null ? "--" : (currency || "USD") + " " + Number(value).toFixed(2); }
  function formatDateTime(value) { return finite(value) === null ? "时间暂无" : new Date(Number(value)).toLocaleString("zh-CN", { hour12: false }); }
  function setText(doc, id, value) { var node = doc.getElementById(id); if (node) node.textContent = value; return node; }
  function appendFact(doc, parent, label, value) { var wrapper = doc.createElement("div"); var term = doc.createElement("dt"); var description = doc.createElement("dd"); term.textContent = label; description.textContent = value || "暂无"; wrapper.append(term, description); parent.appendChild(wrapper); }
  function renderList(doc, id, values, fallback) { var parent = doc.getElementById(id); parent.innerHTML = ""; var rows = Array.isArray(values) && values.length ? values : [fallback]; rows.forEach(function (value) { var item = doc.createElement("li"); item.textContent = value; parent.appendChild(item); }); }
  function renderChart(canvas, points) {
    if (!canvas || !Array.isArray(points) || points.length < 2) return false;
    var ratio = root.devicePixelRatio || 1; var width = Math.max(320, canvas.clientWidth || 900); var height = 280;
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    var ctx = canvas.getContext("2d"); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
    var closes = points.map(function (point) { return point.close; }); var min = Math.min.apply(Math, closes); var max = Math.max.apply(Math, closes); var span = max - min || 1; var padding = 18;
    ctx.beginPath(); points.forEach(function (point, index) { var x = padding + index / (points.length - 1) * (width - padding * 2); var y = padding + (max - point.close) / span * (height - padding * 2); if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.strokeStyle = closes[closes.length - 1] >= closes[0] ? "#69e6c2" : "#ff637d"; ctx.lineWidth = 2.5; ctx.stroke(); return true;
  }
  function safeEvidence(candidate) { return Array.isArray(candidate && candidate.evidence) ? candidate.evidence.filter(function (item) { return item && /^https:\/\//i.test(String(item.url || "")); }) : []; }
  function render(doc, ticker, quote, candidate, universe) {
    var engine = root.IdeaEngine || {};
    var companyName = quote && quote.companyName ? quote.companyName : ticker;
    doc.title = companyName + "（" + ticker + "）· 股票详情";
    setText(doc, "stockDetailTicker", ticker);
    setText(doc, "stockDetailCompanyName", companyName);
    setText(doc, "stockDetailListing", [quote && quote.exchange, quote && quote.currency, quote && quote.instrumentType === "ETF" ? "ETF" : "股票"].filter(Boolean).join(" · ") || "上市信息暂无");
    setText(doc, "stockDetailPrice", formatPrice(quote && quote.current, quote && quote.currency));
    var changeNode = setText(doc, "stockDetailChange", quote && quote.change !== null ? (quote.change >= 0 ? "+" : "") + quote.change.toFixed(2) + "（" + (quote.changePct >= 0 ? "+" : "") + quote.changePct.toFixed(2) + "%）" : "涨跌暂无");
    if (quote && quote.change !== null) changeNode.className = quote.change >= 0 ? "stock-detail-positive" : "stock-detail-negative";
    setText(doc, "stockDetailQuoteTime", "报价时间：" + formatDateTime(quote && quote.quoteTime));
    setText(doc, "stockDetailQuoteSource", quote ? "Yahoo Finance 最近报价" : "报价暂不可用");
    var chartDrawn = renderChart(doc.getElementById("stockDetailChart"), quote && quote.points);
    setText(doc, "stockDetailChartSummary", chartDrawn ? "走势区间：" + new Date(quote.points[0].time).toLocaleDateString("zh-CN") + " 至 " + new Date(quote.points[quote.points.length - 1].time).toLocaleDateString("zh-CN") + "；区间首价 " + formatPrice(quote.points[0].close, quote.currency) + "，末价 " + formatPrice(quote.points[quote.points.length - 1].close, quote.currency) + "。" : "价格走势暂不可用，请以券商订单页为准。");
    var facts = doc.getElementById("stockDetailCompanyFacts"); facts.innerHTML = "";
    var category = categoryForTicker(universe, ticker);
    appendFact(doc, facts, "公司全名", companyName);
    appendFact(doc, facts, "股票代码", ticker);
    appendFact(doc, facts, "交易所", quote && quote.exchange);
    appendFact(doc, facts, "报价币种", quote && quote.currency);
    appendFact(doc, facts, "证券类型", quote && quote.instrumentType === "ETF" ? "交易所交易基金" : "普通股 / ADR");
    appendFact(doc, facts, "研究分类", categoryLabels[category] || category || "暂无分类");
    if (candidate) {
      setText(doc, "stockDetailGrade", typeof engine.gradeLabel === "function" ? engine.gradeLabel(candidate.status) : candidate.status);
      setText(doc, "stockDetailScore", typeof engine.formatScore === "function" ? engine.formatScore(candidate.composite_score) : String(candidate.composite_score || "--"));
      setText(doc, "stockDetailRobustScore", typeof engine.formatScore === "function" ? engine.formatScore(candidate.leave_one_out_floor) : String(candidate.leave_one_out_floor || "--"));
      setText(doc, "stockDetailLimitations", typeof engine.limitation === "function" ? engine.limitation(candidate) : "仅限研究观察，不进入本周定投。");
      var dimensions = doc.getElementById("stockDetailDimensions"); dimensions.innerHTML = ""; var values = candidate.dimensions || candidate.family_scores || {};
      Object.keys(dimensionLabels).forEach(function (key) { var score = finite(values[key]); if (score === null) return; var row = doc.createElement("div"); row.className = "stock-detail-dimension"; var label = doc.createElement("span"); label.textContent = dimensionLabels[key]; var track = doc.createElement("span"); track.className = "stock-detail-dimension-track"; var fill = doc.createElement("span"); fill.className = "stock-detail-dimension-fill"; fill.style.width = Math.max(0, Math.min(100, score)) + "%"; track.appendChild(fill); var value = doc.createElement("strong"); value.textContent = score.toFixed(1); row.append(label, track, value); dimensions.appendChild(row); });
      renderList(doc, "stockDetailReasons", candidate.what_makes_investable, "暂无足够证据支持进一步判断。");
      renderList(doc, "stockDetailRisks", candidate.what_kills_thesis, "暂无明确风险证据，请人工复核。");
      var evidence = doc.getElementById("stockDetailEvidence"); evidence.innerHTML = ""; safeEvidence(candidate).forEach(function (item) { var link = doc.createElement("a"); link.href = item.url; link.target = "_blank"; link.rel = "noopener noreferrer"; var source = doc.createElement("strong"); source.textContent = item.source || "来源"; var date = doc.createElement("small"); date.textContent = "发布日期：" + (item.published_at ? new Date(item.published_at).toLocaleDateString("zh-CN") : "暂无"); link.append(source, date); evidence.appendChild(link); });
      if (!evidence.children.length) { var empty = doc.createElement("div"); empty.textContent = "暂无可验证来源。"; evidence.appendChild(empty); }
    } else {
      setText(doc, "stockDetailGrade", "未进入候选"); setText(doc, "stockDetailLimitations", "当前股票不在最新潜力股候选中，仅展示可获得的公司和价格资料。");
      renderList(doc, "stockDetailReasons", [], "当前没有潜力股研究依据。"); renderList(doc, "stockDetailRisks", [], "当前没有潜力股风险结论。");
    }
    doc.getElementById("stockDetailStatus").hidden = true; doc.getElementById("stockDetailContent").hidden = false;
  }
  function init(doc, fetcher) {
    var ticker = tickerFromSearch(root.location && root.location.search);
    if (!ticker) { setText(doc, "stockDetailStatus", "股票代码无效，请返回潜力股研究重新选择。"); return; }
    var quoteUrl = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(ticker) + "?range=1y&interval=1d&includePrePost=false";
    Promise.allSettled([
      fetcher(quoteUrl, { cache: "no-cache" }).then(function (response) { if (!response.ok) throw new Error("quote unavailable"); return response.json(); }).then(parseYahooChart),
      fetcher("research/results/v2/idea-engine/latest-candidates.json", { cache: "no-cache" }).then(function (response) { if (!response.ok) throw new Error("research unavailable"); return response.json(); }),
      fetcher("data/research-universe-sector-balanced-80.json", { cache: "no-cache" }).then(function (response) { return response.ok ? response.json() : null; }).catch(function () { return null; })
    ]).then(function (values) {
      var quote = values[0].status === "fulfilled" ? values[0].value : null;
      var research = values[1].status === "fulfilled" ? values[1].value : null;
      var universe = values[2].status === "fulfilled" ? values[2].value : null;
      if (!quote && !research) { setText(doc, "stockDetailStatus", "公司与研究资料暂不可用，请稍后重试；不影响本周定投。"); return; }
      render(doc, ticker, quote, candidateForTicker(research, ticker), universe);
      var addButton = doc.getElementById("stockDetailAddWatchlist"); addButton.addEventListener("click", function () { var result = addToWatchlist(root.localStorage, ticker); setText(doc, "stockDetailActionStatus", result.message); });
      if (quote && quote.points) root.addEventListener("resize", function () { renderChart(doc.getElementById("stockDetailChart"), quote.points); });
    });
  }
  if (typeof document !== "undefined" && typeof fetch === "function") init(document, fetch);
  return { normalizeTicker: normalizeTicker, tickerFromSearch: tickerFromSearch, parseYahooChart: parseYahooChart, candidateForTicker: candidateForTicker, categoryForTicker: categoryForTicker, addToWatchlist: addToWatchlist, renderChart: renderChart, init: init };
});
