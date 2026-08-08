(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IdeaEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var gradeLabels = { A: "深入研究", B: "继续观察", C: "筛选信号", blocked: "阻断", rejected: "拒绝" };
  function safePayload(payload) {
    if (!payload || payload.research_only !== true || payload.schema_version !== "idea-engine-v1" || !Array.isArray(payload.candidates)) return null;
    return payload;
  }
  function label(status) { return gradeLabels[status] || "阻断"; }
  function text(value, fallback) { return value === undefined || value === null || value === "" ? (fallback || "暂无数据") : String(value); }
  function createCard(candidate, doc) {
    var card = doc.createElement("article");
    card.className = "idea-engine-card";
    var title = doc.createElement("div"); title.className = "idea-engine-card-title";
    var heading = doc.createElement("h3"); heading.textContent = candidate.ticker;
    var grade = doc.createElement("span"); grade.className = "idea-engine-grade"; grade.textContent = label(candidate.status);
    title.append(heading, grade); card.appendChild(title);
    var score = doc.createElement("p"); score.className = "idea-engine-score"; score.textContent = "综合分 " + text(candidate.composite_score, "0") + "；剔除单源最低 " + text(candidate.leave_one_out_floor, "0"); card.appendChild(score);
    var dimensions = doc.createElement("div"); dimensions.className = "idea-engine-dimensions";
    var values = candidate.dimensions || candidate.family_scores || {};
    Object.keys(values).slice(0, 6).forEach(function (key) { var row = doc.createElement("span"); row.textContent = key + "：" + text(values[key]); dimensions.appendChild(row); });
    card.appendChild(dimensions);
    var detail = doc.createElement("details"); var summary = doc.createElement("summary"); summary.textContent = "查看研究详情"; detail.appendChild(summary);
    var body = doc.createElement("div"); body.className = "idea-engine-detail";
    ["what_makes_investable", "what_kills_thesis", "verification_conditions", "conflicts"].forEach(function (key) { var line = doc.createElement("p"); line.textContent = (key === "what_makes_investable" ? "核心假设：" : key === "what_kills_thesis" ? "第一否决风险：" : key === "verification_conditions" ? "未来验证：" : "方法状态：") + text((candidate[key] || []).join("；"), "暂无"); body.appendChild(line); });
    var button = doc.createElement("button"); button.type = "button"; button.className = "secondary-button"; button.textContent = "手动加入盯盘"; button.addEventListener("click", function () { var input = doc.getElementById("watchlistSymbolInput"); if (input) { input.value = candidate.ticker; input.focus(); } }); body.appendChild(button);
    detail.appendChild(body); card.appendChild(detail); return card;
  }
  function render(payload, elements, doc) {
    var safe = safePayload(payload); elements.rows.innerHTML = "";
    if (!safe || safe.status === "blocked") { elements.status.textContent = "潜力股研究暂不可用，请人工复核；不影响本周定投。"; elements.maturity.textContent = "Shadow 状态：未成熟，不能进入实时决策。"; return; }
    elements.status.textContent = "当前仅生成研究候选，不产生买入金额。";
    elements.maturity.textContent = "Shadow 状态：" + (safe.manual_review_only ? "仅供人工复核" : "等待治理门禁");
    safe.candidates.forEach(function (candidate) { elements.rows.appendChild(createCard(candidate, doc)); });
  }
  function init(doc, fetcher) {
    var elements = { status: doc.getElementById("ideaEngineStatus"), maturity: doc.getElementById("ideaEngineMaturity"), rows: doc.getElementById("ideaEngineRows") };
    if (!elements.status || !elements.maturity || !elements.rows) return;
    fetcher("research/results/v2/idea-engine/latest-candidates.json", { cache: "no-cache" }).then(function (response) { if (!response.ok) throw new Error("idea engine unavailable"); return response.json(); }).then(function (payload) { render(payload, elements, doc); }).catch(function () { render(null, elements, doc); });
  }
  if (typeof document !== "undefined" && typeof fetch === "function") init(document, fetch);
  return { safePayload: safePayload, gradeLabel: label, render: render, init: init };
});
