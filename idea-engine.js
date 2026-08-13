(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(typeof globalThis !== "undefined" ? globalThis : root);
  else root.IdeaEngine = factory(root);
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  var gradeLabels = { A: "A级 · 深入研究", B: "B级 · 研究观察", C: "C级 · 筛选信号", blocked: "已阻断 · 暂停研究", rejected: "已拒绝 · 不纳入研究", A_RESEARCH: "A级 · 深入研究", B_WATCH: "B级 · 等待触发", C_SCREEN: "C级 · 初步信号", VALUATION_GATED: "估值受限", EXPOSURE_UNPROVEN: "暴露尚未证实", BLOCKED: "数据阻断", REJECTED: "已拒绝" };
  var dimensionLabels = { financial_quality: "财务质量", valuation: "估值", demand_catalyst: "需求与催化", expectations_confirmation: "预期确认", industry_cycle: "行业周期", risk_liquidity_health: "风险与流动性" };
  var missingLabels = { analyst_consensus: "一致预期", earnings_transcript: "电话会", news_catalyst: "事件证据" };
  var gateLabels = { free_source_scope_limited: "免费数据范围有限", no_consensus_estimates: "缺少一致预期", missing_dimension: "评分维度缺少数据", provider_failure_no_stale_score: "数据提供方失败", missing_evidence_fields: "关键证据字段缺失", valuation_unverified: "估值尚未验证", stale_core_data: "核心数据过期", exposure_unproven: "主题暴露尚未证实", insufficient_independent_evidence: "独立证据不足", model_not_calibrated: "模型尚未完成 Shadow 校准" };
  gradeLabels.A_RESEARCH = "\u0041\u7ea7 \u00b7 \u6df1\u5165\u7814\u7a76";
  gradeLabels.B_WATCH = "\u0042\u7ea7 \u00b7 \u7814\u7a76\u89c2\u5bdf";
  gradeLabels.C_SCREEN = "\u0043\u7ea7 \u00b7 \u521d\u6b65\u7b5b\u9009";
  gradeLabels.BLOCKED = "\u5df2\u963b\u65ad \u00b7 \u7814\u7a76\u4e0d\u53ef\u7528";
  gradeLabels.REJECTED = "\u5df2\u62d2\u7edd \u00b7 \u4e0d\u7eb3\u5165\u7814\u7a76";
  gateLabels.free_source_scope_limited = "免费数据限制：缺少一致预期、电话会或事件催化证据";
  gateLabels.no_consensus_estimates = "缺少一致预期";
  gateLabels.missing_evidence_fields = "关键证据字段缺失";
  gateLabels.model_not_calibrated = "模型尚未完成 Shadow 校准";
  var workflowLabels = { EARNINGS_REVIEW: "建议复核财报与电话会", VALUATION_REVIEW: "建议复核估值", CATALYST_TRACKER: "建议跟踪事件催化", THESIS_TRACKER: "建议继续跟踪假设", WATCHLIST_ONLY: "仅加入研究观察", REJECT: "停止后续研究" };
  var sectorLabels = { core_technology: "核心科技", semiconductors: "半导体", consumer_retail: "消费与零售", defensive_healthcare: "防御与医疗", financial_payments: "金融与支付", industrial_diversified: "工业与多元制造", international: "国际股票", energy_materials: "能源与材料", utilities_real_assets: "公用事业与实物资产", mixed: "综合行业" };
  var researchTypeLabels = { QUALITY_COMPOUNDER: "高质量增长", CYCLICAL_RECOVERY: "周期复苏", VALUATION_DISLOCATION: "估值错位", CATALYST: "事件催化", THEMATIC_BENEFICIARY: "主题受益", RELATIVE_VALUE: "同行相对价值", WATCH_ONLY: "仅观察" };
  function workflowLabel(value) { return workflowLabels[String(value || "")] || (value ? "建议人工复核研究材料" : ""); }
  function rejectionLabel(value) { var key = String(value || ""); return gateLabels[key] || (key ? "存在待复核的证据限制" : ""); }
  function sectorLabel(value) { return sectorLabels[String(value || "")] || text(value, "行业暂无"); }
  function researchTypeLabel(value) { return researchTypeLabels[String(value || "")] || text(value, "研究类型暂无"); }
  function portfolioRelationLabel(relation) { relation = relation || {}; if (relation.direct_position) return "已持有 · 已读取当前持仓"; if (relation.watchlist) return "已在盯盘列表"; return "未持有 · 未在盯盘列表"; }
  function evidenceLineages(candidate) { return Array.from(new Set(list(candidate.evidence).map(function (item) { return String(item && (item.lineage_group || item.source_family) || "").trim().toUpperCase(); }).filter(Boolean))); }
  function numericOr(value, fallback) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
  function coverageDetails(candidate) { var quality = candidate.data_quality || {}; var dimension = candidate.score_dimension_coverage || quality.score_dimension_coverage || {}; var critical = candidate.critical_evidence_coverage || quality.critical_evidence_coverage || {}; var independent = candidate.independent_evidence || quality.independent_evidence || {}; var lineages = evidenceLineages(candidate); var missing = list(critical.missing).length ? list(critical.missing) : list(quality.missing_fields).map(function (key) { return missingLabels[key] || key; }); if (!Object.keys(critical).length) { var hasCompany = lineages.some(function (value) { return value.indexOf("SEC") >= 0 || value.indexOf("ISSUER") >= 0 || value.indexOf("COMPANY") >= 0; }); var hasPrice = lineages.some(function (value) { return value.indexOf("PRICE") >= 0 || value.indexOf("MARKET") >= 0 || value.indexOf("PUBLIC") >= 0; }); critical = { covered: (hasCompany ? 1 : 0) + (hasPrice ? 1 : 0), required: 5, percent: ((hasCompany ? 1 : 0) + (hasPrice ? 1 : 0)) / 5 * 100 }; } var independentTarget = numericOr(independent.target, 3); var independentCount = numericOr(independent.count, lineages.length); var independentPercent = numericOr(independent.percent, numericOr(candidate.evidence_independence_score, independentTarget ? independentCount / independentTarget * 100 : 0)); return { dimension: numericOr(dimension.percent, numericOr(candidate.evidence_coverage_score, 0)).toFixed(1), dimensionCovered: numericOr(dimension.covered, Number(candidate.evidence_coverage_score) === 100 ? 6 : 0), dimensionRequired: numericOr(dimension.required, 6), critical: numericOr(critical.percent, 0).toFixed(1), criticalCovered: numericOr(critical.covered, 0), criticalRequired: numericOr(critical.required, 5), missing: missing, independent: independentPercent.toFixed(1), independentCount: independentCount, independentTarget: independentTarget }; }
  function researchLimitations(candidate) { var quality = candidate.data_quality || {}; var values = list(candidate.research_limitations).length ? list(candidate.research_limitations) : list(quality.gates_failed || candidate.gates_failed); return Array.from(new Set(values.map(function (key) { return gateLabels[key] || rejectionLabel(key); }))); }
  function thesisKillRisks(candidate) { var risks = list(candidate.thesis_kill_risks).length ? list(candidate.thesis_kill_risks) : list(candidate.what_kills_thesis); if (!risks.length && candidate.first_rejection && !gateLabels[candidate.first_rejection]) risks = [candidate.first_rejection]; return risks; }
  function shadowProgress(governance) { if (!governance) return "Shadow 校准进度：治理报告不可用"; var required = governance.reliability_requirements || {}; return "Shadow 校准进度：观察 " + Number(governance.observation_count || 0) + "/" + numericOr(required.observation_count, 52) + " 次 · 日历周 " + Number(governance.calendar_week_count || 0) + "/" + numericOr(required.calendar_week_count, 52) + " · 完整成熟结果 " + Number(governance.primary_complete_count || governance.complete_count || 0) + "/" + numericOr(required.primary_complete_count, 26); }
  function dataLimitation(candidate) { var coverage = coverageDetails(candidate); return coverage.missing.length ? "免费数据限制：尚缺 " + coverage.missing.join("、") + "；仅作研究观察。" : ""; }

  function safePayload(payload) {
    if (!payload || payload.research_only !== true || !Array.isArray(payload.candidates) || ["idea-engine-v1", "idea-engine-v3", "idea-engine-v3.1"].indexOf(payload.schema_version) < 0) return null;
    return Object.assign({ source_version: payload.schema_version === "idea-engine-v3.1" ? "v3_1" : payload.schema_version === "idea-engine-v3" ? "v3" : "v2" }, payload);
  }
  function safeHistoricalOos(payload) {
    if (!payload || payload.schema_version !== "historical-oos-price-timing-v1" || payload.research_only !== true || payload.no_trade !== true || payload.scope !== "price_timing_layer_only" || payload.composite_score_calibrated !== false || !payload.current_mappings) return null;
    return payload;
  }
  function percent(value) { return Number.isFinite(Number(value)) ? (Number(value) * 100).toFixed(1) + "%" : "暂无"; }
  function historicalOosDetails(ticker, payload) {
    var safe = safeHistoricalOos(payload);
    var mapping = safe && safe.current_mappings[normalizeTicker(ticker)];
    if (!mapping) return null;
    var statusLabels = {
      preliminary_reliable_edge: "达到初步历史门禁",
      positive_skew_unconfirmed: "存在正收益偏斜，但统计仍不可靠",
      no_historical_edge: "未形成历史优势"
    };
    return {
      ticker: normalizeTicker(ticker),
      status: mapping.evidence_status,
      statusLabel: statusLabels[mapping.evidence_status] || "历史证据不足",
      text: "历史 OOS（价格择时层）：当前第 " + Number(mapping.calibration_bin) + "/5 档；永久留出 " + Number(mapping.oos_samples || 0) + " 个样本、" + Number(mapping.oos_origin_dates || 0) + " 个独立周，成本后相对 QQQ 命中率 " + percent(mapping.oos_cost_adjusted_hit_rate) + "（95% 区间 " + percent(mapping.oos_hit_rate_ci_low) + "–" + percent(mapping.oos_hit_rate_ci_high) + "），平均相对收益 " + percent(mapping.mean_oos_net_relative_return) + "；" + (statusLabels[mapping.evidence_status] || "历史证据不足") + "。",
      boundary: "仅校验价格与成交量择时层；使用当前股票池回填，仍存在幸存者偏差；不校验综合分，也不替代实时 Shadow。"
    };
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
    sections[8].values = dates;
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
  function createCard(candidate, doc, shortTermPlans, historicalOos) {
    var ticker = normalizeTicker(candidate.ticker);
    var shortTermPlan = shortTermPlans && shortTermPlans[String(candidate.ticker || "").toUpperCase()];
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
    addText(doc, card, "p", "交易状态：" + (shortTermPlan && root.ShortTermTradePlan && typeof root.ShortTermTradePlan.statusLabel === "function" ? root.ShortTermTradePlan.statusLabel(shortTermPlan.status) : "尚未形成有效短线计划"), "idea-engine-trade-status");
    if (shortTermPlan && root.ShortTermTradePlan && typeof root.ShortTermTradePlan.planSummary === "function") addText(doc, card, "p", root.ShortTermTradePlan.planSummary(shortTermPlan), "idea-engine-trade-reason");
    if (["idea-engine-v3", "idea-engine-v3.1"].indexOf(candidate.schema_version) >= 0) {
      addText(doc, card, "p", [text(candidate.company_name, ticker), sectorLabel(candidate.sector), researchTypeLabel(candidate.research_type)].join(" · "), "idea-engine-metadata");
      if (candidate.schema_version === "idea-engine-v3.1") {
        var coverage = coverageDetails(candidate);
        addText(doc, card, "p", "评分维度覆盖 " + coverage.dimension + "%（" + coverage.dimensionCovered + "/" + coverage.dimensionRequired + "） · 关键证据覆盖 " + coverage.critical + "%（" + coverage.criticalCovered + "/" + coverage.criticalRequired + "） · 独立证据 " + coverage.independent + "%（" + coverage.independentCount + "/" + coverage.independentTarget + "） · 模型校准：" + (candidate.model_calibration_score === null || candidate.model_calibration_score === undefined ? "尚未验证（需达到 Shadow 治理门槛）" : formatScore(candidate.model_calibration_score) + "%"), "idea-engine-evidence-summary");
        if (candidate.model_calibration_score === null || candidate.model_calibration_score === undefined) addText(doc, card, "p", "综合分仍只是研究排序，不是上涨概率；完整模型继续由实时 Shadow 验证。", "idea-engine-score-help");
        var oos = historicalOosDetails(ticker, historicalOos);
        if (oos) {
          addText(doc, card, "p", oos.text, "idea-engine-oos-summary");
          addText(doc, card, "p", oos.boundary, "idea-engine-score-help");
        }
      }
      else addText(doc, card, "p", "证据覆盖率 " + formatScore(candidate.evidence_coverage_score) + "% · 数据可信度 " + formatScore(candidate.confidence_score) + "%", "idea-engine-evidence-summary");
      if (candidate.portfolio_fit_status) addText(doc, card, "p", "组合关系：" + text(candidate.portfolio_fit_status, "待核对"), "idea-engine-portfolio-fit");
      if (list(candidate.why_now).length) addText(doc, card, "p", "为什么现在：" + list(candidate.why_now).join("；"), "idea-engine-why-now");
      var limitations = researchLimitations(candidate); if (limitations.length) addText(doc, card, "p", "首要研究限制：" + limitations[0], "idea-engine-research-limitation");
      var killRisks = thesisKillRisks(candidate); if (killRisks.length) addText(doc, card, "p", "公司假设失效风险：" + killRisks[0], "idea-engine-first-rejection");
      if (candidate.next_workflow) addText(doc, card, "p", "下一步：" + workflowLabel(candidate.next_workflow), "idea-engine-next-workflow");
    }
    var limit = limitation(candidate); if (limit) addText(doc, card, "p", limit, "idea-engine-data-limit");
    var limitationNode = card.querySelector(".idea-engine-data-limit"); var safeLimitation = dataLimitation(candidate); if (limitationNode) limitationNode.textContent = safeLimitation; else if (safeLimitation) addText(doc, card, "p", safeLimitation, "idea-engine-data-limit");
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
  function render(payload, elements, doc, governance, shortTermPayload, historicalOos) {
    var safe = safePayload(payload); elements.rows.innerHTML = "";
    var mature = governance && governance.status === "mature" && governance.manual_review_eligible === true;
    var progress = shadowProgress(governance);
    if (!safe || safe.status === "blocked") {
      elements.status.textContent = "免费公开数据覆盖不足或校验未通过，保留最后有效结果；不影响本周定投。";
      elements.maturity.textContent = "Shadow 状态：尚未满足人工复核门槛，不会自动进入定投决策。";
      return;
    }
    elements.maturity.textContent = progress + (mature ? " · 已达到人工复核门槛" : " · 尚未达到可靠性门槛，仅供研究演练");
    var versionLabel = safe.source_version === "v3_1" ? "当前显示 Idea Engine v3.1 短线结果；" : safe.source_version === "v2" ? "当前显示历史 v2 结果；" : "当前显示 Idea Engine v3；";
    elements.status.textContent = versionLabel + (safe.active_provider === "free_public_data" ? "已使用 SEC EDGAR 与公开价格数据加载 " : "已加载 ") + safe.candidates.length + " 个研究候选；不生成买入金额。";
    elements.maturity.textContent = progress + (mature ? " · 已达到人工复核门槛" : " · 尚未达到可靠性门槛，仅供研究演练");
    var shortTermPlans = {};
    if (root.ShortTermTradePlan && typeof root.ShortTermTradePlan.safePayload === "function") { var safeShortTerm = root.ShortTermTradePlan.safePayload(shortTermPayload); (safeShortTerm ? safeShortTerm.plans : []).forEach(function (plan) { shortTermPlans[String(plan.ticker || "").toUpperCase()] = plan; }); }
    var controls = { status: doc.getElementById("ideaEngineStatusFilter"), industry: doc.getElementById("ideaEngineIndustryFilter"), type: doc.getElementById("ideaEngineTypeFilter"), fit: doc.getElementById("ideaEngineFitFilter"), sort: doc.getElementById("ideaEngineSort") };
    function draw() {
      elements.rows.innerHTML = "";
      var candidates = filterCandidates(safe.candidates, { status: controls.status && controls.status.value, industry: controls.industry && controls.industry.value, type: controls.type && controls.type.value, fit: controls.fit && controls.fit.value });
      candidates.forEach(function (candidate) { var displayCandidate = Object.assign({}, candidate); displayCandidate.portfolio_relation = localPortfolioRelation(candidate); displayCandidate.portfolio_fit_status = portfolioRelationLabel(displayCandidate.portfolio_relation); elements.rows.appendChild(createCard(displayCandidate, doc, shortTermPlans, historicalOos)); });
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
    fetchJson("research/results/v3_1/idea-engine/latest-candidates.json").catch(function () { return fetchJson("research/results/v3/idea-engine/latest-candidates.json"); }).catch(function () { return fetchJson("research/results/v2/idea-engine/latest-candidates.json").then(function (payload) { payload.source_version = "v2"; return payload; }); }).then(function (payload) { var resultRoot = payload.source_version === "v2" ? "research/results/v2" : payload.schema_version === "idea-engine-v3.1" ? "research/results/v3_1" : "research/results/v3"; return Promise.all([payload, fetchJson(resultRoot + "/idea-engine/shadow/governance-report.json").catch(function () { return null; }), fetchJson("research/results/v3_1/short-term-trade-plans-v1_1/latest.json").catch(function () { return fetchJson("research/results/v3_1/short-term-trade-plans/latest.json"); }).catch(function () { return null; }), fetchJson("research/results/v3_1/historical-oos-price-timing/latest.json").catch(function () { return null; })]); }).then(function (values) { render(values[0], elements, doc, values[1], values[2], values[3]); }).catch(function () { render(null, elements, doc, null, null, null); });
  }
  if (typeof document !== "undefined" && typeof fetch === "function") init(document, fetch);
  return { safePayload: safePayload, safeHistoricalOos: safeHistoricalOos, historicalOosDetails: historicalOosDetails, gradeLabel: label, researchGradeLabel: label, workflowLabel: workflowLabel, rejectionLabel: rejectionLabel, sectorLabel: sectorLabel, researchTypeLabel: researchTypeLabel, coverageDetails: coverageDetails, researchLimitations: researchLimitations, thesisKillRisks: thesisKillRisks, shadowProgress: shadowProgress, dataLimitation: dataLimitation, portfolioRelationLabel: portfolioRelationLabel, formatScore: formatScore, limitation: limitation, detailSections: detailSections, safeEvidenceLinks: safeEvidenceLinks, normalizeTicker: normalizeTicker, detailHref: detailHref, filterCandidates: filterCandidates, sortCandidates: sortCandidates, render: render, init: init };
});
