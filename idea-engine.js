(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(typeof globalThis !== "undefined" ? globalThis : root);
  else root.IdeaEngine = factory(root);
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  var gradeLabels = { A: "A级 · 深入研究", B: "B级 · 研究观察", C: "C级 · 筛选信号", blocked: "已阻断 · 暂停研究", rejected: "已拒绝 · 不纳入研究" };
  var dimensionLabels = { financial_quality: "财务质量", valuation: "估值", demand_catalyst: "需求与催化", expectations_confirmation: "预期确认", industry_cycle: "行业周期", risk_liquidity_health: "风险与流动性" };
  var missingLabels = { analyst_consensus: "一致预期", earnings_transcript: "电话会", news_catalyst: "事件证据" };
  var gateLabels = { free_source_scope_limited: "免费数据范围有限", no_consensus_estimates: "缺少一致预期", missing_dimension: "评分维度缺少数据", provider_failure_no_stale_score: "数据提供方失败" };
  function safePayload(payload) {
    if (!payload || payload.research_only !== true || payload.schema_version !== "idea-engine-v1" || !Array.isArray(payload.candidates)) return null;
    return payload;
  }
  function label(status) { return gradeLabels[status] || "已阻断 · 暂停研究"; }
  function formatScore(value) { return Number.isFinite(Number(value)) ? Number(value).toFixed(1) : "暂无"; }
  function text(value, fallback) { return value === undefined || value === null || value === "" ? (fallback || "暂无数据") : String(value); }
  function list(value) { return Array.isArray(value) ? value.filter(function (item) { return item !== null && item !== undefined && String(item).trim(); }) : []; }
  function formatDate(value) { if (!value) return "暂无"; var parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString("zh-CN"); }
  function limitation(candidate) {
    var quality = candidate.data_quality || {};
    var missing = list(quality.missing_fields).map(function (key) { return missingLabels[key] || key; });
    var gates = list(quality.gates_failed).map(function (key) { return gateLabels[key] || key; });
    return missing.length || gates.length ? "免费数据缺少" + (missing.length ? missing.join("、") : "部分证据") + "，仅限研究观察。" : "";
  }
  function detailSections(candidate) {
    var quality = candidate.data_quality || {};
    var sections = [
      { key: "reasons", title: "入选理由", values: list(candidate.what_makes_investable) },
      { key: "risks", title: "主要否决风险", values: list(candidate.what_kills_thesis) },
      { key: "missing", title: "尚缺证据", values: list(quality.missing_fields).map(function (key) { return missingLabels[key] || key; }).concat(list(quality.gates_failed).map(function (key) { return "数据门禁：" + (gateLabels[key] || key); })) },
      { key: "sources", title: "数据来源与更新时间", values: [] }
    ];
    var dates = [];
    if (quality.latest_filing) dates.push("最新 SEC 申报：" + formatDate(quality.latest_filing));
    if (quality.latest_price) dates.push("价格数据日期：" + formatDate(quality.latest_price));
    if (candidate.as_of) dates.push("研究 as-of：" + formatDate(candidate.as_of));
    sections[3].values = dates;
    return sections.filter(function (section) { return section.values.length; });
  }
  function safeEvidenceLinks(candidate) { return list(candidate.evidence).filter(function (item) { return item && typeof item.url === "string" && /^https:\/\//i.test(item.url); }).map(function (item) { return { source: text(item.source, "来源"), url: item.url }; }); }
  function normalizeTicker(value) {
    var ticker = String(value || "").trim().toUpperCase();
    return /^[A-Z0-9.-]{1,16}$/.test(ticker) ? ticker : "";
  }
  function detailHref(ticker) {
    var normalized = normalizeTicker(ticker);
    return normalized ? "stock-detail.html?ticker=" + encodeURIComponent(normalized) : "";
  }
  function addText(doc, parent, tag, value, className) { var node = doc.createElement(tag); if (className) node.className = className; node.textContent = value; parent.appendChild(node); return node; }
  function createCard(candidate, doc) {
    var ticker = normalizeTicker(candidate.ticker);
    var card = doc.createElement("article");
    card.className = "idea-engine-card";
    card.dataset.ideaTicker = ticker;
    var title = doc.createElement("div"); title.className = "idea-engine-card-title";
    var heading = doc.createElement("h3");
    var titleLink = doc.createElement("a");
    titleLink.className = "idea-engine-title-link";
    titleLink.href = detailHref(ticker);
    titleLink.textContent = ticker || text(candidate.ticker, "未知股票");
    titleLink.setAttribute("aria-label", "查看 " + titleLink.textContent + " 公司与研究详情");
    heading.appendChild(titleLink);
    var grade = doc.createElement("span"); grade.className = "idea-engine-grade"; grade.textContent = label(candidate.status);
    title.append(heading, grade); card.appendChild(title);
    var scores = doc.createElement("div"); scores.className = "idea-engine-scores";
    addText(doc, scores, "strong", "综合分 " + formatScore(candidate.composite_score), "idea-engine-score-primary");
    var robust = addText(doc, scores, "strong", "稳健分 " + formatScore(candidate.leave_one_out_floor), "idea-engine-score-secondary");
    robust.setAttribute("aria-label", "稳健分，移除任一单项后得到的最低结果：" + formatScore(candidate.leave_one_out_floor));
    card.appendChild(scores);
    addText(doc, card, "p", "稳健分为移除任一单项后得到的最低结果。", "idea-engine-score-help");
    addText(doc, card, "p", "不进入本周定投，不生成买入金额。", "idea-engine-research-limit");
    var limit = limitation(candidate); if (limit) addText(doc, card, "p", limit, "idea-engine-data-limit");
    var dimensions = doc.createElement("div"); dimensions.className = "idea-engine-dimensions";
    var values = candidate.dimensions || candidate.family_scores || {};
    Object.keys(dimensionLabels).forEach(function (key) { if (!Object.prototype.hasOwnProperty.call(values, key) || !Number.isFinite(Number(values[key]))) return; var row = doc.createElement("div"); row.className = "idea-engine-dimension"; var labelNode = addText(doc, row, "span", dimensionLabels[key] + "：" + formatScore(values[key]), "idea-engine-dimension-label"); labelNode.setAttribute("aria-label", dimensionLabels[key] + "评分 " + formatScore(values[key])); var bar = doc.createElement("span"); bar.className = "idea-engine-dimension-bar"; var fill = doc.createElement("span"); fill.className = "idea-engine-dimension-fill"; fill.style.width = Math.max(0, Math.min(100, Number(values[key]))) + "%"; bar.appendChild(fill); row.appendChild(bar); dimensions.appendChild(row); });
    card.appendChild(dimensions);
    var detail = doc.createElement("details");
    var summary = doc.createElement("summary"); summary.textContent = "查看研究详情"; detail.appendChild(summary);
    var body = doc.createElement("div"); body.className = "idea-engine-detail";
    detailSections(candidate).forEach(function (section) { var block = doc.createElement("section"); block.className = "idea-engine-detail-section"; addText(doc, block, "h4", section.title); var paragraph = addText(doc, block, "p", section.values.join("；")); body.appendChild(block); });
    var links = safeEvidenceLinks(candidate); if (links.length) { var sourceBlock = doc.createElement("section"); sourceBlock.className = "idea-engine-detail-section"; addText(doc, sourceBlock, "h4", "来源链接"); links.forEach(function (item) { var link = doc.createElement("a"); link.href = item.url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = item.source; sourceBlock.appendChild(link); }); body.appendChild(sourceBlock); }
    var actionStatus = addText(doc, body, "span", "", "idea-engine-action-status"); actionStatus.setAttribute("role", "status"); actionStatus.setAttribute("aria-live", "polite");
    var button = doc.createElement("button"); button.type = "button"; button.className = "secondary-button"; button.textContent = "手动加入盯盘"; button.addEventListener("click", function () { var api = root.SuinvestmentWatchlist; if (!api || typeof api.addSymbol !== "function") { button.textContent = "填入盯盘代码"; var input = doc.getElementById("watchlistSymbolInput"); if (input) { input.value = candidate.ticker; input.focus(); } actionStatus.textContent = "当前无法安全调用盯盘添加接口，请手动确认。"; return; } button.disabled = true; Promise.resolve(api.addSymbol(candidate.ticker)).then(function (result) { actionStatus.textContent = result && result.ok ? "已加入盯盘。" : (result && result.message ? result.message : "加入盯盘失败，请人工复核。"); }).catch(function () { actionStatus.textContent = "加入盯盘失败，请人工复核。"; }).finally(function () { button.disabled = false; }); }); body.appendChild(button);
    detail.appendChild(body); card.appendChild(detail); return card;
  }
  function render(payload, elements, doc, governance) {
    var safe = safePayload(payload); elements.rows.innerHTML = "";
    var mature = governance && governance.status === "mature" && governance.manual_review_eligible === true;
    if (!safe || safe.status === "blocked") {
      elements.status.textContent = "免费公开数据覆盖不足或校验未通过，保留最后有效结果；不影响本周定投。";
      elements.maturity.textContent = "Shadow 状态：尚未满足人工复核门槛，不会自动进入定投决策。";
      return;
    }
    elements.status.textContent = (safe.active_provider === "free_public_data" ? "已使用 SEC EDGAR 与公开价格数据加载 " : "已加载 ") + safe.candidates.length + " 个研究候选；不生成买入金额。";
    elements.maturity.textContent = "Shadow 状态：" + (mature ? "已成熟，仅可人工复核" : "继续观察，不会自动进入定投决策");
    safe.candidates.forEach(function (candidate) { elements.rows.appendChild(createCard(candidate, doc)); });
  }
  function init(doc, fetcher) {
    var elements = { status: doc.getElementById("ideaEngineStatus"), maturity: doc.getElementById("ideaEngineMaturity"), rows: doc.getElementById("ideaEngineRows") };
    if (!elements.status || !elements.maturity || !elements.rows) return;
    var panel = doc.getElementById("ideaEnginePanel");
    if (panel && root.location && root.location.hash === "#ideaEnginePanel") panel.open = true;
    Promise.all([
      fetcher("research/results/v2/idea-engine/latest-candidates.json", { cache: "no-cache" }).then(function (response) { if (!response.ok) throw new Error("idea engine unavailable"); return response.json(); }),
      fetcher("research/results/v2/idea-engine/shadow/governance-report.json", { cache: "no-cache" }).then(function (response) { return response.ok ? response.json() : null; }).catch(function () { return null; })
    ]).then(function (values) { render(values[0], elements, doc, values[1]); }).catch(function () { render(null, elements, doc, null); });
  }
  if (typeof document !== "undefined" && typeof fetch === "function") init(document, fetch);
  return { safePayload: safePayload, gradeLabel: label, formatScore: formatScore, limitation: limitation, detailSections: detailSections, safeEvidenceLinks: safeEvidenceLinks, normalizeTicker: normalizeTicker, detailHref: detailHref, render: render, init: init };
});
