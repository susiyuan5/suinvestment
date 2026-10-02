(function (root, factory) {
  "use strict";
  const policy = typeof module === "object" && module.exports ? require("./core-satellite-policy.js") : root.CoreSatellitePolicy;
  const api = factory(policy);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AllocationDraft = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (policy) {
  "use strict";

  const RECOMMENDED = Object.freeze({ SPY: .20, QQQ: .10, NVDA: .11, AAPL: .09, ASML: .09, PEP: .09, KO: .09, WMT: .08, QNT: .05, CBRS: .05, JOBY: .05 });
  const SPECULATIVE_SYMBOLS = Object.freeze(["QNT", "CBRS", "JOBY"]);
  const validSymbol = symbol => /^[A-Z][A-Z0-9.-]{0,14}$/.test(String(symbol || ""));
  const failed = message => ({ valid: false, errors: [message] });

  function createDraft(current, candidates) {
    const baseline = Object.assign({}, current || {}), known = new Map();
    Object.keys(RECOMMENDED).forEach(symbol => known.set(symbol, { symbol, name: symbol }));
    Object.keys(baseline).filter(validSymbol).forEach(symbol => known.set(symbol, { symbol, name: symbol }));
    (candidates || []).forEach(row => {
      const symbol = String(typeof row === "string" ? row : row && row.symbol || "").trim().toUpperCase();
      if (validSymbol(symbol)) known.set(symbol, { symbol, name: String(row && row.name || symbol) });
    });
    return { baseline, allocations: Object.assign({}, RECOMMENDED), candidates: Array.from(known.values()) };
  }

  function edit(allocations, symbol, percent) {
    if (!Object.hasOwn(allocations, symbol)) return failed("此标的不在草稿中，请先添加。");
    return policy.rebalanceAllocations(allocations, symbol, percent);
  }

  function normalize(allocations) {
    if (!Object.hasOwn(allocations, "SPY")) return failed("请保留 SPY，再调整其每周基础投入比例。");
    if (Object.keys(allocations).some(symbol => !validSymbol(symbol) || allocations[symbol] == null || allocations[symbol] === "" || !Number.isFinite(Number(allocations[symbol])) || Number(allocations[symbol]) < 0 || Number(allocations[symbol]) > 1)) return failed("请先将各项每周基础投入比例填写为 0% 至 100% 的有效数字。");
    return policy.rebalanceAllocations(allocations, "SPY", Number(allocations.SPY) * 100);
  }

  function remove(allocations, symbol) {
    if (symbol === "SPY") return failed("SPY 是策略锚点，请保留并直接调整比例（可设置为 0%）。");
    if (!Object.hasOwn(allocations, symbol)) return failed("此标的不在草稿中。");
    const next = Object.assign({}, allocations);
    delete next[symbol];
    return normalize(next);
  }

  function add(allocations, candidates, symbol, percent) {
    if (!(candidates || []).some(row => (typeof row === "string" ? row : row.symbol) === symbol)) return failed("只能从已有标的或已持仓候选中添加。");
    if (Object.hasOwn(allocations, symbol)) return failed(symbol + " 已在草稿中，请直接修改比例。");
    if (!(Number(percent) > 0)) return failed("新增标的比例必须大于 0%。");
    return policy.rebalanceAllocations(allocations, symbol, percent);
  }

  function metrics(allocations) {
    const result = policy.validateAllocations(allocations);
    const speculativePct = SPECULATIVE_SYMBOLS.reduce((sum, symbol) => sum + Math.round((Number(allocations[symbol]) || 0) * 10000), 0) / 100;
    return Object.assign({}, result, { speculativePct, speculativeAboveSuggestion: speculativePct > 15.005 });
  }

  // This panel owns only an unsaved draft. The caller validates quotes and persists onApply.
  function createUI(options) {
    const opts = options || {}, doc = opts.document || (typeof document !== "undefined" ? document : null);
    if (!doc || typeof opts.getSnapshot !== "function" || typeof opts.onApply !== "function") throw Error("AllocationDraft.createUI requires a document, getSnapshot, and onApply");
    const byId = id => doc.getElementById(id), panel = byId("allocationSuggestionDraft"), opener = byId("openAllocationDraftBtn"), rows = byId("allocationSuggestionRows"), status = byId("allocationSuggestionStatus"), candidate = byId("allocationSuggestionCandidate"), addPercent = byId("allocationSuggestionAddPercent"), applyButton = byId("applyAllocationSuggestionBtn");
    if (!panel || !opener || !rows || !status || !candidate || !addPercent || !applyButton) throw Error("Allocation suggestion panel markup is missing");
    let session = null, pending = false, inputInvalid = false;
    const percent = ratio => (Number(ratio || 0) * 100).toFixed(2) + "%";

    function showStatus(message, invalid) {
      status.textContent = message || "";
      status.classList.toggle("is-error", Boolean(invalid));
    }

    function setPending(value) {
      pending = value;
      panel.setAttribute("aria-busy", String(value));
      renderSummary();
    }

    function renderSummary() {
      if (!session) return;
      const result = metrics(session.allocations);
      byId("allocationSuggestionTotal").textContent = result.metrics.allocated.toFixed(2) + "%";
      byId("allocationSuggestionSpy").textContent = percent(session.allocations.SPY);
      byId("allocationSuggestionSpeculative").textContent = result.speculativePct.toFixed(2) + "%";
      byId("allocationSuggestionWarning").textContent = result.speculativeAboveSuggestion ? "QNT、CBRS、JOBY 每周基础投入合计超过建议的 15%；这是配置提示，不是强制比例上限。" : "QNT、CBRS、JOBY 每周基础投入建议合计 15%；可手动调整。";
      panel.querySelectorAll("input, select, button").forEach(control => {
        control.disabled = pending || control.dataset.anchor === "true";
      });
      applyButton.disabled = pending || inputInvalid || !result.valid;
      byId("addAllocationSuggestionBtn").disabled = pending || !candidate.value;
      if (!result.valid && !inputInvalid) showStatus(result.errors.join("；"), true);
    }

    function renderCandidates() {
      candidate.replaceChildren();
      const placeholder = doc.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "选择已有标的或已持仓股票";
      candidate.appendChild(placeholder);
      session.candidates.filter(row => !Object.hasOwn(session.allocations, row.symbol)).forEach(row => {
        const option = doc.createElement("option");
        option.value = row.symbol;
        option.textContent = row.name && row.name !== row.symbol ? row.symbol + " · " + row.name : row.symbol;
        candidate.appendChild(option);
      });
    }

    function syncInputs(activeInput) {
      rows.querySelectorAll("[data-draft-symbol]").forEach(input => {
        if (input !== activeInput) input.value = (session.allocations[input.dataset.draftSymbol] * 100).toFixed(2);
        input.closest("tr").querySelector("[data-draft-preview]").textContent = percent(session.allocations[input.dataset.draftSymbol]);
      });
    }

    function accept(result, message) {
      if (!result.valid) { showStatus(result.errors.join("；"), true); return false; }
      session.allocations = result.allocations;
      inputInvalid = false;
      showStatus(message || "草稿已更新；尚未应用到定投清单。", false);
      return true;
    }

    function renderRows() {
      rows.replaceChildren();
      const symbols = Array.from(new Set(Object.keys(session.allocations).concat(Object.keys(session.baseline))));
      symbols.forEach(symbol => {
        const tr = doc.createElement("tr"), labelCell = doc.createElement("th"), currentCell = doc.createElement("td"), nextCell = doc.createElement("td"), actionCell = doc.createElement("td"), comparison = doc.createElement("span");
        labelCell.scope = "row";
        labelCell.textContent = symbol;
        currentCell.textContent = Object.hasOwn(session.baseline, symbol) ? percent(session.baseline[symbol]) : "未纳入";
        comparison.dataset.draftPreview = "";
        comparison.className = "visually-hidden";
        comparison.textContent = Object.hasOwn(session.allocations, symbol) ? percent(session.allocations[symbol]) : "移出清单";
        nextCell.appendChild(comparison);
        if (Object.hasOwn(session.allocations, symbol)) {
          const input = doc.createElement("input"), removeButton = doc.createElement("button");
          input.type = "number"; input.min = "0"; input.max = "100"; input.step = ".01"; input.inputMode = "decimal";
          input.value = (session.allocations[symbol] * 100).toFixed(2);
          input.dataset.draftSymbol = symbol;
          input.setAttribute("aria-label", symbol + " 草稿每周基础投入比例（百分比）");
          input.addEventListener("input", function () {
            const result = edit(session.allocations, symbol, input.value);
            inputInvalid = !result.valid;
            input.setAttribute("aria-invalid", String(inputInvalid));
            if (accept(result)) {
              rows.querySelectorAll("input").forEach(other => other.setAttribute("aria-invalid", "false"));
              syncInputs(input);
            }
            renderSummary();
          });
          nextCell.appendChild(input);
          removeButton.className = "secondary-button";
          removeButton.type = "button";
          removeButton.textContent = symbol === "SPY" ? "策略锚点" : "移除";
          removeButton.dataset.anchor = String(symbol === "SPY");
          removeButton.setAttribute("aria-label", symbol === "SPY" ? "SPY 策略锚点，保留并可调整至 0%" : "从草稿移除 " + symbol);
          removeButton.addEventListener("click", function () {
            if (accept(remove(session.allocations, symbol), symbol + " 已移出草稿，SPY 比例保持不变；其余标的已自动调节。")) renderAll();
          });
          actionCell.appendChild(removeButton);
        } else {
          nextCell.appendChild(doc.createTextNode("移出清单"));
          actionCell.textContent = "已有持仓继续保留";
        }
        [labelCell, currentCell, nextCell, actionCell].forEach(cell => tr.appendChild(cell));
        rows.appendChild(tr);
      });
    }

    function renderAll() { renderRows(); renderCandidates(); renderSummary(); }

    function open() {
      if (pending) return;
      try {
        const snapshot = opts.getSnapshot() || {};
        session = createDraft(snapshot.allocations, snapshot.candidates);
        inputInvalid = false;
        panel.hidden = false;
        opener.setAttribute("aria-expanded", "true");
        showStatus("每周基础投入建议仅为草稿；编辑和取消均不会修改已保存比例。", false);
        renderAll();
        byId("allocationSuggestionTitle").focus({ preventScroll: true });
        panel.scrollIntoView({ block: "nearest", behavior: "auto" });
      } catch (error) { showStatus(error.message || "无法读取当前比例。", true); }
    }

    function close() {
      if (pending) return;
      panel.hidden = true;
      opener.setAttribute("aria-expanded", "false");
      session = null;
      opener.focus({ preventScroll: true });
    }

    async function apply() {
      if (!session || pending || inputInvalid || !metrics(session.allocations).valid) return;
      const allocations = Object.assign({}, session.allocations), baselineAllocations = Object.assign({}, session.baseline);
      showStatus("正在检查行情并保存每周基础投入比例…", false);
      setPending(true);
      let result;
      try { result = await opts.onApply(allocations, { baselineAllocations, source: "optimization-draft" }); }
      catch (error) { result = { ok: false, error: error.message }; }
      setPending(false);
      if (result && result.ok === true) close();
      else showStatus(result && result.error || "保存未完成，草稿已保留；已保存配置未改动。", true);
    }

    opener.addEventListener("click", open);
    byId("cancelAllocationSuggestionBtn").addEventListener("click", close);
    applyButton.addEventListener("click", apply);
    byId("normalizeAllocationSuggestionBtn").addEventListener("click", function () {
      if (accept(normalize(session.allocations), "已保留 SPY 每周基础投入比例，其余标的合计调节至 100.00%。")) { syncInputs(); renderSummary(); }
    });
    candidate.addEventListener("change", function () {
      addPercent.value = ((RECOMMENDED[candidate.value] || .01) * 100).toFixed(2);
      renderSummary();
    });
    byId("addAllocationSuggestionBtn").addEventListener("click", function () {
      const symbol = candidate.value;
      if (accept(add(session.allocations, session.candidates, symbol, addPercent.value), symbol + " 已加入草稿；应用前将检查行情。")) renderAll();
    });
    return Object.freeze({ open, close, refresh: function () { if (session) renderSummary(); }, isOpen: function () { return !panel.hidden; } });
  }

  return Object.freeze({ RECOMMENDED, SPECULATIVE_SYMBOLS, createDraft, edit, normalize, remove, add, metrics, createUI });
});
