(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(typeof globalThis !== "undefined" ? globalThis : root);
  else root.IdeaEngine = factory(root);
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  var gradeLabels = { A: "A级 · 深入研究", B: "B级 · 研究观察", C: "C级 · 筛选信号", blocked: "已阻断 · 暂停研究", rejected: "已拒绝 · 不纳入研究", A_RESEARCH: "A级 · 深入研究", B_WATCH: "B级 · 等待触发", C_SCREEN: "C级 · 初步信号", VALUATION_GATED: "估值受限", EXPOSURE_UNPROVEN: "暴露尚未证实", BLOCKED: "数据阻断", REJECTED: "已拒绝" };
  var dimensionLabels = { financial_quality: "财务质量", valuation: "估值", demand_catalyst: "需求与催化", expectations_confirmation: "预期确认", industry_cycle: "行业周期", risk_liquidity_health: "风险与流动性" };
  var missingLabels = { analyst_consensus: "一致预期", earnings_transcript: "电话会", news_catalyst: "事件证据" };
  var gateLabels = { free_source_scope_limited: "免费数据范围有限", no_consensus_estimates: "缺少一致预期", missing_dimension: "评分维度缺少数据", provider_failure_no_stale_score: "数据提供方失败", missing_evidence_fields: "关键证据字段缺失", valuation_unverified: "估值尚未验证", stale_core_data: "核心数据过期", exposure_unproven: "主题暴露尚未证实", insufficient_independent_evidence: "独立证据不足", model_not_calibrated: "模型尚未完成 Shadow 校准" };
  function safePayload(payload) {
    if (!payload || payload.research_only !== true || !Array.isArray(payload.candidates) || ["idea-engine-v1", "idea-engine-v3", "idea-engine-v3.1"].indexOf(payload.schema_version) < 0) return null;
    return Object.assign({ source_version: payload.schema_version === "idea-engine-v3.1" ? "v3_1" : payload.schema_version === "idea-engine-v3" ? "v3" : "v2" }, payload);
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
    if (["idea-engine-v3", "idea-engine-v3.1"].indexOf(candidate.schema_version) >= 0 && (candidate.status === "VALUATION_GATED" || candidate.status === "EXPOSURE_UNPROVEN")) return label(candidate.status) + "；不进入本周定投，不生成买入金额。";
    return missing.length || gates.length ? "免费数据缺少" + (missing.length ? missing.join("、") : "部分证据") + "，仅限研究观察。" : "";
  }
  function detailSections(candidate) {
    var quality = candidate.data_quality || {};
    var sections = [
      { key: "why_now", title: "为什么现在", values: list(candidate.why_now) },
      { key: "variant", title: "市场可能忽略什么", values: list(candidate.variant_wedge) },
      { key: "exposure", title: "主题暴露证据", values: list(candidate.exposure_proof) },
      { key: "expectations", title: "市场预期风险", values: list(candidate.expectations_risk) },
      { key: "reasons", title: "入选理由", values: list(candidate.what_makes_investable) },
      { key: "risks", title: "主要否决风险", values: list(candidate.what_kills_thesis) },
      { key: "workflow", title: "下一步研究动作", values: list(candidate.next_workflow) },
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
  function safeEvidenceLinks(candidate) { return list(candidate.evidence).map(function (item) { var url = item && (item.url || item.canonical_url); return item && typeof url === "string" && /^https:\/\//i.test(url) ? { source: text(item.source || item.source_name, "来源") + (item.stale ? "（已过期）" : ""), url: url } : null; }).filter(Boolean); }
  function normalizeTicker(value) {
    var ticker = String(value || "").trim().toUpperCase();
    return /^[A-Z0-9.-]{1,16}$/.test(ticker) ? ticker : "";
  }
  function detailHref(ticker) {
    var normalized = normalizeTicker(ticker);
    return normalized ? "stock-detail.html?ticker=" + encodeURIComponent(normalized) : "";
  }
  function addText(doc, parent, tag, value, className) { var node = doc.createElement(tag); if (className) node.className = className; node.textContent = value; parent.appendChild(node); return node; }
  function createCard(candidate, doc, shortTermPlans) {
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
    var robustScore = candidate.leave_one_source_out_floor !== undefined ? Math.min(Number(candidate.leave_one_dimension_out_floor || candidate.composite_score || 0), Number(candidate.leave_one_source_out_floor || candidate.composite_score || 0)) : candidate.leave_one_out_floor;
    addText(doc, scores, "strong", "综合分 " + formatScore(candidate.composite_score), "idea-engine-score-primary");
    var robust = addText(doc, scores, "strong", "稳健分 " + formatScore(robustScore), "idea-engine-score-secondary");
    robust.setAttribute("aria-label", "稳健分，移除任一维度或来源家族后得到的最低结果：" + formatScore(robustScore));
    card.appendChild(scores);
    addText(doc, card, "p", "稳健分为移除任一单项后得到的最低结果。", "idea-engine-score-help");
    addText(doc, card, "p", "不进入本周定投，不生成买入金额。", "idea-engine-research-limit");
    if (["idea-engine-v3", "idea-engine-v3.1"].indexOf(candidate.schema_version) >= 0) {
      addText(doc, card, "p", [text(candidate.company_name, ticker), text(candidate.sector, "行业暂无"), text(candidate.research_type, "研究类型暂无")].join(" · "), "idea-engine-metadata");
      if (candidate.schema_version === "idea-engine-v3.1") {
        addText(doc, card, "p", "数据完整度 " + formatScore(candidate.evidence_coverage_score) + "% · 证据独立度 " + formatScore(candidate.evidence_independence_score) + "% · 模型校准度 " + (candidate.model_calibration_score === null || candidate.model_calibration_score === undefined ? "尚未验证" : formatScore(candidate.model_calibration_score) + "%"), "idea-engine-evidence-summary");
        if (candidate.model_calibration_score === null || candidate.model_calibration_score === undefined) addText(doc, card, "p", "模型校准尚未完成，综合分不能解释为短线上涨概率。", "idea-engine-score-help");
      }
      else addText(doc, card, "p", "证据覆盖率 " + formatScore(candidate.evidence_coverage_score) + "% · 数据可信度 " + formatScore(candidate.confidence_score) + "%", "idea-engine-evidence-summary");
      if (candidate.portfolio_fit_status) addText(doc, card, "p", "组合关系：" + text(candidate.portfolio_fit_status, "待核对"), "idea-engine-portfolio-fit");
      if (list(candidate.why_now).length) addText(doc, card, "p", "为什么现在：" + list(candidate.why_now).join("；"), "idea-engine-why-now");
      if (candidate.first_rejection) addText(doc, card, "p", "第一否决风险：" + text(candidate.first_rejection), "idea-engine-first-rejection");
      if (candidate.next_workflow) addText(doc, card, "p", "下一步：" + text(candidate.next_workflow), "idea-engine-next-workflow");
    }
    var limit = limitation(candidate); if (limit) addText(doc, card, "p", limit, "idea-engine-data-limit");
    var dimensions = doc.createElement("div"); dimensions.className = "idea-engine-dimensions";
    var values = candidate.dimensions || candidate.family_scores || {};
    if (["idea-engine-v3", "idea-engine-v3.1"].indexOf(candidate.schema_version) < 0) { Object.keys(dimensionLabels).forEach(function (key) { if (!Object.prototype.hasOwnProperty.call(values, key) || !Number.isFinite(Number(values[key]))) return; var row = doc.createElement("div"); row.className = "idea-engine-dimension"; var labelNode = addText(doc, row, "span", dimensionLabels[key] + "：" + formatScore(values[key]), "idea-engine-dimension-label"); labelNode.setAttribute("aria-label", dimensionLabels[key] + "评分 " + formatScore(values[key])); var bar = doc.createElement("span"); bar.className = "idea-engine-dimension-bar"; var fill = doc.createElement("span"); fill.className = "idea-engine-dimension-fill"; fill.style.width = Math.max(0, Math.min(100, Number(values[key]))) + "%"; bar.appendChild(fill); row.appendChild(bar); dimensions.appendChild(row); }); card.appendChild(dimensions); }
    var detail = doc.createElement("details");
    var summary = doc.createElement("summary"); summary.textContent = "查看研究详情"; detail.appendChild(summary);
    var body = doc.createElement("div"); body.className = "idea-engine-detail";
    detailSections(candidate).forEach(function (section) { var block = doc.createElement("section"); block.className = "idea-engine-detail-section"; addText(doc, block, "h4", section.title); var paragraph = addText(doc, block, "p", section.values.join("；")); body.appendChild(block); });
    if (["idea-engine-v3", "idea-engine-v3.1"].indexOf(candidate.schema_version) >= 0 && candidate.score_contributions && Object.keys(candidate.score_contributions).length) { var contributionBlock = doc.createElement("section"); contributionBlock.className = "idea-engine-detail-section"; addText(doc, contributionBlock, "h4", "评分贡献分解"); addText(doc, contributionBlock, "p", Object.keys(candidate.score_contributions).map(function (key) { return (dimensionLabels[key] || key) + " " + formatScore(candidate.score_contributions[key]); }).join("；")); body.appendChild(contributionBlock); }
    var links = safeEvidenceLinks(candidate); if (links.length) { var sourceBlock = doc.createElement("section"); sourceBlock.className = "idea-engine-detail-section"; addText(doc, sourceBlock, "h4", "来源链接"); links.forEach(function (item) { var link = doc.createElement("a"); link.href = item.url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = item.source; sourceBlock.appendChild(link); }); body.appendChild(sourceBlock); }
    var actionStatus = addText(doc, body, "span", "", "idea-engine-action-status"); actionStatus.setAttribute("role", "status"); actionStatus.setAttribute("aria-live", "polite");
    var button = doc.createElement("button"); button.type = "button"; button.className = "secondary-button"; button.textContent = "手动加入盯盘"; button.addEventListener("click", function () { var api = root.SuinvestmentWatchlist; if (!api || typeof api.addSymbol !== "function") { button.textContent = "填入盯盘代码"; var input = doc.getElementById("watchlistSymbolInput"); if (input) { input.value = candidate.ticker; input.focus(); } actionStatus.textContent = "当前无法安全调用盯盘添加接口，请手动确认。"; return; } button.disabled = true; Promise.resolve(api.addSymbol(candidate.ticker)).then(function (result) { actionStatus.textContent = result && result.ok ? "已加入盯盘。" : (result && result.message ? result.message : "加入盯盘失败，请人工复核。"); }).catch(function () { actionStatus.textContent = "加入盯盘失败，请人工复核。"; }).finally(function () { button.disabled = false; }); }); body.appendChild(button);
    detail.appendChild(body); card.appendChild(detail);
    var shortTermPlan = shortTermPlans && shortTermPlans[String(candidate.ticker || "").toUpperCase()];
    if (shortTermPlan && root.ShortTermTradePlan && typeof root.ShortTermTradePlan.createCardSection === "function") card.appendChild(root.ShortTermTradePlan.createCardSection(shortTermPlan, doc));
    return card;
  }
  function sortCandidates(candidates, sort) {
    var rows = (candidates || []).slice();
    rows.sort(function (a, b) {
      if (sort === "independence") return Number(b.evidence_independence_score || 0) - Number(a.evidence_independence_score || 0);
      if (sort === "coverage") return Number(b.evidence_coverage_score || 0) - Number(a.evidence_coverage_score || 0);
      if (sort === "updated") return String(b.as_of || "").localeCompare(String(a.as_of || ""));
      if (sort === "robust") return Number(b.leave_one_source_out_floor || b.leave_one_out_floor || 0) - Number(a.leave_one_source_out_floor || a.leave_one_out_floor || 0);
      return Number(b.composite_score || 0) - Number(a.composite_score || 0);
    });
    return rows;
  }
  function filterCandidates(candidates, filters) {
    filters = filters || {};
    var industry = String(filters.industry || "").trim().toLowerCase();
    return (candidates || []).filter(function (candidate) {
      return (!filters.status || candidate.status === filters.status) && (!filters.type || candidate.research_type === filters.type) && (!filters.fit || candidate.portfolio_fit_status === filters.fit) && (!industry || String(candidate.industry || candidate.sector || "").toLowerCase().indexOf(industry) >= 0);
    });
  }
  function localPortfolioRelation(candidate) {
    var relation = Object.assign({}, candidate.portfolio_relation || {});
    try {
      var watchlist = JSON.parse(root.localStorage && root.localStorage.getItem("su-investment-pro:watchlist") || "[]");
      relation.watchlist = Array.isArray(watchlist) && watchlist.indexOf(String(candidate.ticker || "").toUpperCase()) >= 0;
      var risk = root.__SUINVESTMENT_PORTFOLIO_RISK__;
      relation.direct_position = Boolean(risk && risk.positions && risk.positions[String(candidate.ticker || "").toUpperCase()]);
      relation.computed_in_browser = true;
    } catch (_error) { relation.computed_in_browser = true; }
    return relation;
  }
  function render(payload, elements, doc, governance, shortTermPayload) {
    var safe = safePayload(payload); elements.rows.innerHTML = "";
    var mature = governance && governance.status === "mature" && governance.manual_review_eligible === true;
    if (!safe || safe.status === "blocked") {
      elements.status.textContent = "免费公开数据覆盖不足或校验未通过，保留最后有效结果；不影响本周定投。";
      elements.maturity.textContent = "Shadow 状态：尚未满足人工复核门槛，不会自动进入定投决策。";
      return;
    }
    var versionLabel = safe.source_version === "v3_1" ? "当前显示 Idea Engine v3.1 短线结果；" : safe.source_version === "v2" ? "当前显示历史 v2 结果；" : "当前显示 Idea Engine v3；";
    elements.status.textContent = versionLabel + (safe.active_provider === "free_public_data" ? "已使用 SEC EDGAR 与公开价格数据加载 " : "已加载 ") + safe.candidates.length + " 个研究候选；不生成买入金额。";
    elements.maturity.textContent = "Shadow 状态：" + (mature ? "1–4 周短线样本已成熟，仅可人工复核" : "1–4 周短线样本继续观察，12 周仅监测衰减；不会自动进入定投决策");
    var shortTermPlans = {};
    if (root.ShortTermTradePlan && typeof root.ShortTermTradePlan.safePayload === "function") { var safeShortTerm = root.ShortTermTradePlan.safePayload(shortTermPayload); (safeShortTerm ? safeShortTerm.plans : []).forEach(function (plan) { shortTermPlans[String(plan.ticker || "").toUpperCase()] = plan; }); }
    var controls = { status: doc.getElementById("ideaEngineStatusFilter"), industry: doc.getElementById("ideaEngineIndustryFilter"), type: doc.getElementById("ideaEngineTypeFilter"), fit: doc.getElementById("ideaEngineFitFilter"), sort: doc.getElementById("ideaEngineSort") };
    function draw() {
      elements.rows.innerHTML = "";
      var candidates = filterCandidates(safe.candidates, { status: controls.status && controls.status.value, industry: controls.industry && controls.industry.value, type: controls.type && controls.type.value, fit: controls.fit && controls.fit.value });
      candidates.forEach(function (candidate) { candidate.portfolio_relation = localPortfolioRelation(candidate); elements.rows.appendChild(createCard(candidate, doc, shortTermPlans)); });
      if (!candidates.length) addText(doc, elements.rows, "p", "没有符合当前筛选条件的候选。", "idea-engine-empty");
    }
    var rerender = function () { var sorted = sortCandidates(safe.candidates, controls.sort && controls.sort.value); safe.candidates = sorted; draw(); };
    Object.keys(controls).forEach(function (key) { if (controls[key]) controls[key].addEventListener(key === "industry" ? "input" : "change", rerender); });
    var clear = doc.getElementById("ideaEngineClearFilters"); if (clear) clear.addEventListener("click", function () { Object.keys(controls).forEach(function (key) { if (controls[key]) controls[key].value = ""; }); if (controls.sort) controls.sort.value = "priority"; rerender(); });
    rerender();
  }
  function init(doc, fetcher) {
    var elements = { status: doc.getElementById("ideaEngineStatus"), maturity: doc.getElementById("ideaEngineMaturity"), rows: doc.getElementById("ideaEngineRows") };
    if (!elements.status || !elements.maturity || !elements.rows) return;
    var panel = doc.getElementById("ideaEnginePanel");
    if (panel && root.location && root.location.hash === "#ideaEnginePanel") panel.open = true;
    function fetchJson(url) { return fetcher(url, { cache: "no-cache" }).then(function (response) { if (!response.ok) throw new Error("idea engine unavailable"); return response.json(); }); }
    fetchJson("research/results/v3_1/idea-engine/latest-candidates.json").catch(function () { return fetchJson("research/results/v3/idea-engine/latest-candidates.json"); }).catch(function () { return fetchJson("research/results/v2/idea-engine/latest-candidates.json").then(function (payload) { payload.source_version = "v2"; return payload; }); }).then(function (payload) { var resultRoot = payload.source_version === "v2" ? "research/results/v2" : payload.schema_version === "idea-engine-v3.1" ? "research/results/v3_1" : "research/results/v3"; return Promise.all([payload, fetchJson(resultRoot + "/idea-engine/shadow/governance-report.json").catch(function () { return null; }), fetchJson("research/results/v3_1/short-term-trade-plans/latest.json").catch(function () { return null; })]); }).then(function (values) { render(values[0], elements, doc, values[1], values[2]); }).catch(function () { render(null, elements, doc, null, null); });
  }
  if (typeof document !== "undefined" && typeof fetch === "function") init(document, fetch);
  return { safePayload: safePayload, gradeLabel: label, formatScore: formatScore, limitation: limitation, detailSections: detailSections, safeEvidenceLinks: safeEvidenceLinks, normalizeTicker: normalizeTicker, detailHref: detailHref, filterCandidates: filterCandidates, sortCandidates: sortCandidates, render: render, init: init };
});
