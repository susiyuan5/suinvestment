(function (root) {
  "use strict";
  if (root.TakeProfitPanel) return;
  const view = document.getElementById("view-take-profit");
  if (!view) return;
  const KEY = "su-investment-pro:take-profit-positions-v1";
  const INDEX_PATH = "data/take-profit-v1/index.json";
  const byId = (id) => document.getElementById(id);
  const form = byId("takeProfitForm"), select = byId("takeProfitSymbol");
  const dateInput = byId("takeProfitDate"), costInput = byId("takeProfitCost");
  const save = byId("takeProfitSave"), refresh = byId("takeProfitRefresh");
  const cancelEdit = byId("takeProfitCancelEdit"), status = byId("takeProfitDataStatus");
  let started = false, observations = [], positions = [], index = null, expected = null;
  let editing = null, pendingRemove = null, attempt = 0, busy = false, storageWritable = true;
  let holdings = { available: false, reason: "正在读取当前持仓。", sourceLabel: "当前持仓", positions: [] };
  let holdingsFingerprint = "", refreshingHoldings = false;
  const symbolCache = new Map(), controllers = new Set(), results = new Map();

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
    const stamp = Date.parse(value + "T12:00:00Z");
    return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value;
  }
  function price(value) {
    return Number.isFinite(value) ? value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
  }
  function gain(value) {
    return Number.isFinite(value) ? (value > 0 ? "+" : "") + value.toFixed(2) + "%" : "—";
  }
  function setStatus(message, state = "ready") {
    status.textContent = message;
    status.dataset.state = state;
  }
  function updateControls() {
    refresh.disabled = busy;
    refresh.setAttribute("aria-busy", String(busy));
    refresh.textContent = busy ? "核对持仓与行情中…" : "更新持仓与行情";
    const position = positions.find((p) => p.symbol === select.value);
    select.disabled = !index || !holdings.available || !positions.length || editing !== null;
    byId("takeProfitSymbolHelp").textContent = editing !== null ? "正在编辑 " + editing + "；点击取消编辑后可选择其他持仓。" : !holdings.available ? holdings.reason : !positions.length ? holdings.reason || "当前没有股票持仓，请先在持仓页面解锁自动持仓或录入实际人工持仓。" : !index ? "正在加载行情清单，完成后可选择当前持仓。" : "与持仓页使用同一来源；选择股票后补充实际买入日期。";
    save.disabled = !index || !holdings.available || !positions.length || !storageWritable || Boolean(position && !index.symbols[position.symbol]);
    const reset = editing !== null || observations.some((p) => p.symbol === select.value);
    save.textContent = reset ? "保存并重置观察" : "保存观察";
    cancelEdit.hidden = editing === null;
    byId("takeProfitEntryTitle").textContent = editing ? "核对 " + editing + " 入场信息" : "补充持仓入场信息";
    const coverage = index && index.symbols[select.value];
    byId("takeProfitDateHelp").textContent = coverage ? "日线覆盖 " + coverage.first_date + "—" + coverage.last_date + "；入场前须有至少 14 根完整日线。填写实际买入日。" : "填写实际买入日；缺少日期无法重建持有后的峰值。";
    costInput.readOnly = Boolean(position && position.costFromHolding);
    if (costInput.readOnly) costInput.value = position.cost;
    byId("takeProfitCostHelp").textContent = !position ? "选择持仓股票后自动读取可用美元成本；缺少成本时请补充。" : costInput.readOnly ? "已读取当前持仓的美元每股平均成本；请在持仓来源中更正成本。" : "当前持仓没有可直接使用的美元成本，请按当前股数口径补充美元每股成本。";
  }
  function readPositions() {
    try {
      const raw = root.localStorage.getItem(KEY);
      if (raw === null) return [];
      const payload = JSON.parse(raw);
      if (payload.version !== 1 || !Array.isArray(payload.positions) || payload.positions.length > 100) {
        throw new Error("不兼容的观察记录");
      }
      const seen = new Set();
      return payload.positions.map((p) => {
        if (!p || typeof p.symbol !== "string" || !/^[A-Z0-9][A-Z0-9.^-]{0,15}$/.test(p.symbol) || seen.has(p.symbol)) {
          throw new Error("观察记录格式无效");
        }
        seen.add(p.symbol);
        // Do not invent missing entry information: evaluator blocks it, and the
        // edit form lets the owner supply the actual date/cost.
        const result = { symbol: p.symbol, date: typeof p.date === "string" ? p.date : "", cost: p.cost };
        if (Object.prototype.hasOwnProperty.call(p, "holdingBasis")) result.holdingBasis = p.holdingBasis;
        return result;
      });
    } catch (_) {
      storageWritable = false;
      byId("takeProfitFormStatus").textContent = "浏览器观察记录无法读取，已保留原记录；暂时无法保存。";
      return [];
    }
  }
  function writePositions(next) {
    try {
      root.localStorage.setItem(KEY, JSON.stringify({ version: 1, positions: next.map((p) => {
        const record = { symbol: p.symbol, date: p.date, cost: p.cost };
        if (Object.prototype.hasOwnProperty.call(p, "holdingBasis")) record.holdingBasis = p.holdingBasis;
        return record;
      }) }));
      observations = next;
      return true;
    } catch (_) {
      byId("takeProfitFormStatus").textContent = "本浏览器无法保存观察，请检查浏览器存储设置；原观察未改动。";
      return false;
    }
  }
  function currentHoldings() {
    try { return root.__SUINVESTMENT_HOLDINGS_API__?.current() || null; }
    catch (_) { return null; }
  }
  function syncHoldings() {
    const source = currentHoldings();
    holdings = root.TakeProfitHoldings ? root.TakeProfitHoldings.build({ holdings: source, observations,
      supportedSymbols: index ? Object.keys(index.symbols) : [], now: Date.now() }) :
      { available: false, reason: "持仓读取模块不可用，请刷新页面。", sourceLabel: "当前持仓", positions: [] };
    holdingsFingerprint = JSON.stringify({ source, available: holdings.available, reason: holdings.reason });
    positions = holdings.positions;
    byId("takeProfitHoldingsStatus").textContent = holdings.available ? holdings.sourceLabel + " · 当前持仓 " + positions.length + " 只" + (holdings.asOf ? " · 持仓时间 " + holdings.asOf : "") + (holdings.reason ? "；" + holdings.reason : "；买入日期需自行核对。") : holdings.reason;
    byId("takeProfitHoldingsStatus").dataset.state = holdings.available && !holdings.reason ? "ready" : "error";
    byId("takeProfitHoldingsSettings").textContent = source?.requestedSourceMode === "automatic" && source?.automaticStatus === "locked" ? "解锁持仓" : "持仓设置";
    if ((editing && !positions.some((p) => p.symbol === editing)) || (select.value && !positions.some((p) => p.symbol === select.value))) resetForm();
  }
  function fillEntry(symbol) {
    const position = positions.find((p) => p.symbol === symbol);
    dateInput.value = position && validDate(position.date) ? position.date : "";
    costInput.value = position && Number.isFinite(position.cost) ? position.cost : "";
    clearErrors();
    updateControls();
  }
  function abortPending() {
    for (const controller of controllers) controller.abort();
    controllers.clear();
  }
  async function json(path) {
    if (!root.LiveData || typeof root.LiveData.fetch !== "function") throw new Error("数据发布读取模块不可用");
    const controller = new AbortController();
    controllers.add(controller);
    let timer, onAbort;
    try {
      const canceled = new Promise((_, reject) => {
        onAbort = () => reject(new Error("读取已取消"));
        controller.signal.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(() => controller.abort(), 12000);
      });
      const fetcher = root.LiveData.fetch.bind(root.LiveData);
      return await Promise.race([
        fetcher(path, { cache: "no-cache", signal: controller.signal }).then(async (response) => {
          if (!response.ok) throw new Error("行情读取失败（HTTP " + response.status + "）");
          return response.json();
        }),
        canceled,
      ]);
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", onAbort);
      controllers.delete(controller);
    }
  }
  async function loadIndex() {
    if (index) return index;
    const payload = await json(INDEX_PATH);
    if (!payload || payload.schema_version !== "take-profit-browser-index-v1" || payload.currency !== "USD" || payload.research_only !== true || !validDate(payload.as_of) || !payload.symbols || typeof payload.symbols !== "object" || Array.isArray(payload.symbols)) throw new Error("股票行情清单格式不可用");
    const entries = Object.entries(payload.symbols);
    if (!entries.length || entries.length > 500 || entries.some(([symbol, meta]) =>
      !/^[A-Z0-9][A-Z0-9.^-]{0,15}$/.test(symbol) || !meta ||
      meta.path !== "data/take-profit-v1/symbols/" + symbol + ".json" ||
      !validDate(meta.first_date) || !validDate(meta.last_date) || meta.first_date > meta.last_date ||
      !Number.isInteger(meta.rows) || meta.rows < 1)) {
      throw new Error("股票行情清单格式不可用");
    }
    return payload;
  }
  async function expectedSession() {
    if (!root.MarketCalendar) return null;
    let timer;
    try {
      await Promise.race([
        root.MarketCalendar.ready,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("交易日历读取超时")), 12000); }),
      ]);
      const assessment = root.MarketCalendar.assess({ symbol: "SPY", trustedSource: false }, Date.now());
      const value = assessment && assessment.expectedClose && assessment.expectedClose.slice(0, 10);
      return assessment && assessment.known && validDate(value) ? value : null;
    } catch (_) { return null; }
    finally { clearTimeout(timer); }
  }
  function fillSymbols() {
    const selected = select.value;
    select.replaceChildren(node("option", "", "选择当前持仓"));
    select.firstChild.value = "";
    for (const position of positions) {
      const option = node("option", "", position.symbol + (index.symbols[position.symbol] ? "" : "（日线未覆盖）"));
      option.value = position.symbol;
      select.append(option);
    }
    if (positions.some((p) => p.symbol === selected)) select.value = selected;
    if (expected) dateInput.max = expected;
    else dateInput.removeAttribute("max");
    updateControls();
  }
  function loadSymbol(symbol) {
    if (symbolCache.has(symbol)) return symbolCache.get(symbol);
    const promise = json(index.symbols[symbol].path).then((payload) => {
      const meta = index.symbols[symbol];
      if (!payload || payload.schema_version !== "take-profit-browser-bars-v1" || payload.currency !== "USD" || payload.research_only !== true || payload.symbol !== symbol || payload.as_of !== index.as_of || !Array.isArray(payload.rows) || payload.rows.length !== meta.rows || payload.rows[0]?.date !== meta.first_date || payload.rows[payload.rows.length - 1]?.date !== meta.last_date) throw new Error("股票日线身份或版本不匹配");
      return payload.rows;
    }).catch((error) => { if (symbolCache.get(symbol) === promise) symbolCache.delete(symbol); throw error; });
    symbolCache.set(symbol, promise);
    return promise;
  }
  function unavailable(reason, lastDate = null) {
    return { status: "blocked", reason, lastDate, line: null, score: null, signal: false };
  }
  function button(text, action, symbol, className = "") {
    const item = node("button", className, text);
    item.type = "button";
    item.dataset.tpAction = action;
    item.dataset.symbol = symbol;
    return item;
  }
  function renderCards() {
    const container = byId("takeProfitRows");
    container.replaceChildren();
    byId("takeProfitCount").textContent = String(positions.length);
    if (!positions.length) {
      container.append(node("p", "take-profit-empty", holdings.reason || "当前没有可观察的股票或 ETF 持仓。请先在持仓页面核对实际持仓。"));
      return;
    }
    for (const position of positions) {
      const result = results.get(position.symbol);
      const state = result ? result.status : "loading";
      const card = node("article", "take-profit-card");
      card.dataset.symbol = position.symbol;
      card.dataset.state = state;
      const heading = node("div", "take-profit-card-heading"), identity = node("div");
      identity.append(node("h4", "", position.symbol));
      identity.append(node("p", "", (Number.isFinite(position.shares) ? "持有 " + position.shares + " 股" : "持有股数待补充") + " · 买入 " + (position.date || "日期待补充") + " · 成本 USD " + price(position.cost)));
      heading.append(identity, node("span", "take-profit-state", { inactive: "未激活", active: "跟踪中", triggered: "已触发 · 请核对", pending: "待补充", review: "持仓变化 · 待复核", blocked: "数据不可用", loading: "核对中" }[state] || "数据不可用"));
      card.append(heading);
      let reason = result ? result.reason : "正在读取这只股票的完整日线…";
      const firstSignal = result && (result.firstSignalDate || result.signalDate);
      if (state === "triggered") reason = "首次触发 " + firstSignal + "。提示已保留，请核对是否已执行；重新入场后重置观察。";
      else if (state === "inactive" && Number.isFinite(result.activationPrice)) reason = "峰值尚未达到激活门槛（USD " + price(result.activationPrice) + "），暂不生成止盈线。";
      else if (state === "active") reason = "收盘跌至止盈线或以下提示退出；当前浮盈不保证次日成交仍然盈利。";
      card.append(node("p", "take-profit-card-reason", reason || "无法生成止盈提示"));
      const metrics = node("dl", "take-profit-metrics");
      for (const [label, value] of [["最新收盘 · USD", price(result && result.currentPrice)], ["止盈线 · USD", price(result && result.line)], ["当前浮盈", gain(result && result.gainPct)], ["持有后峰值 · USD", price(result && result.peakPrice)]]) {
        const metric = node("div");
        metric.append(node("dt", "", label), node("dd", "", value));
        metrics.append(metric);
      }
      card.append(metrics);
      if (result && Number.isFinite(result.score) && (state === "active" || state === "triggered")) {
        const score = node("div", "take-profit-score"), id = "takeProfitScore-" + position.symbol;
        const label = node("label", "", "回落至止盈线的接近度");
        label.htmlFor = id;
        const meter = node("progress");
        meter.id = id;
        meter.max = 100;
        meter.value = result.score;
        meter.setAttribute("aria-valuetext", result.score.toFixed(0) + " / 100，距离提示，不是概率");
        score.append(label, node("span", "", result.score.toFixed(0) + " / 100"), meter);
        card.append(score);
      }
      const footer = node("div", "take-profit-card-footer");
      let freshness = "行情日期待核对";
      if (result && result.lastDate) freshness = "行情 " + result.lastDate + (result.lastDate === expected ? " · 最新完整日线" : " · 预期 " + (expected || "日期未知"));
      if (!expected) freshness += " · 交易日历不可用";
      footer.append(node("p", "take-profit-card-data", freshness));
      const actions = node("div", "take-profit-card-actions");
      if (pendingRemove === position.symbol) actions.append(node("span", "take-profit-confirm-text", "清除入场信息？持仓仍会显示。"), button("确认清除", "confirm-remove", position.symbol, "take-profit-remove-confirm"), button("取消", "cancel-remove", position.symbol));
      else {
        if (index && index.symbols[position.symbol]) actions.append(button(position.date ? "编辑 / 重置" : "补充买入日期", "edit", position.symbol));
        if (observations.some((p) => p.symbol === position.symbol)) actions.append(button("清除入场信息", "remove", position.symbol));
      }
      footer.append(actions);
      card.append(footer);
      container.append(card);
    }
  }
  async function evaluateWatches(token) {
    const queue = [...positions];
    let cursor = 0;
    async function worker() {
      while (cursor < queue.length && token === attempt) {
        const position = queue[cursor++];
        let result;
        try {
          if (position.blockedReason) {
            result = unavailable(position.blockedReason);
            if (position.needsReview) result.status = "review";
            else if (["date_missing", "date_invalid", "date_and_cost_missing", "usd_cost_missing", "quantity_missing"].includes(position.blockedReasonCode)) result.status = "pending";
          }
          else if (!index.symbols[position.symbol]) result = unavailable("当前已验证日线未覆盖这只持仓，暂时无法计算止盈。");
          else if (expected && index.as_of !== expected) result = unavailable("行情快照未覆盖最新完整交易日或含未来日期，暂停计算。", index.symbols[position.symbol].last_date);
          else {
            const rows = await loadSymbol(position.symbol);
            if (token !== attempt) return;
            if (!root.TakeProfitIndicator) result = unavailable("止盈计算模块未加载，请刷新页面重试。", rows[rows.length - 1]?.date);
            else result = root.TakeProfitIndicator.evaluatePosition({ rows, entryDate: position.date, entryPrice: position.cost, expectedSession: expected });
          }
        } catch (_) { result = unavailable("这只股票的日线读取失败，请更新行情重试。"); }
        if (token !== attempt) return;
        results.set(position.symbol, result);
        renderCards();
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  }
  async function activate(force = false) {
    if (view.hidden) return;
    const token = ++attempt;
    abortPending();
    // An aborted promise must not remain as a reusable symbol cache entry.
    if (busy || force) symbolCache.clear();
    busy = true;
    results.clear();
    syncHoldings();
    updateControls();
    renderCards();
    setStatus("正在核对日线快照与最新完整交易日…", "loading");
    try {
      if (force) {
        index = null;
        updateControls();
        if (root.LiveData) await root.LiveData.refresh();
        if (currentHoldings()?.requestedSourceMode === "automatic" && root.SnaptradeHoldingsView) {
          refreshingHoldings = true;
          try { await root.SnaptradeHoldingsView.refresh(); } finally { refreshingHoldings = false; }
        }
      }
      if (token !== attempt) return;
      const [nextIndex, session] = await Promise.all([loadIndex(), expectedSession()]);
      if (token !== attempt) return;
      index = nextIndex;
      expected = session;
      syncHoldings();
      fillSymbols();
      const fresh = expected && index.as_of === expected;
      let summary = "行情快照 " + index.as_of;
      if (!expected) summary += " · 交易日历不可用；当前不生成有效止盈提示。";
      else if (!fresh) summary += (index.as_of < expected ? " · 行情过期" : " · 含未完成或未来交易日") + "，最新完整日线应为 " + expected + "；未通过时效核对。";
      else summary += " · 最新完整日线已核对 · 仅加载入场信息已补齐的当前持仓";
      setStatus(summary, fresh ? "ready" : "error");
      await evaluateWatches(token);
    } catch (_) {
      if (token !== attempt) return;
      syncHoldings();
      if (index) fillSymbols();
      for (const position of positions) results.set(position.symbol, unavailable("股票行情清单读取失败，请更新行情重试。"));
      setStatus("股票行情清单读取失败；未生成止盈提示。请更新行情重试。", "error");
      renderCards();
    } finally {
      if (token === attempt) { busy = false; updateControls(); }
    }
  }
  function resetForm() {
    editing = null;
    form.reset();
    clearErrors();
    updateControls();
  }
  function fieldError(name, message) {
    const element = byId("takeProfit" + name + "Error"), input = byId("takeProfit" + name);
    element.textContent = message;
    element.hidden = !message;
    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }
  function clearErrors() { for (const field of ["Symbol", "Date", "Cost"]) fieldError(field, ""); }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    clearErrors();
    syncHoldings();
    const symbol = select.value, position = positions.find((p) => p.symbol === symbol);
    const date = dateInput.value, cost = position?.costFromHolding ? position.cost : Number(costInput.value);
    let firstError;
    if (!holdings.available || !position || !index || !index.symbols[symbol]) { fieldError("Symbol", "请选择日线已覆盖的当前持仓股票。"); firstError = select; }
    if (!validDate(date)) { fieldError("Date", "请填写实际买入日期。"); firstError ||= dateInput; }
    else if (expected && date > expected) { fieldError("Date", "买入日期晚于最新完整交易日，请待当日日线完成后再保存。"); firstError ||= dateInput; }
    if (!Number.isFinite(cost) || cost <= 0 || !costInput.value.trim()) { fieldError("Cost", "每股成本必须是大于 0 的美元金额。"); firstError ||= costInput; }
    if (firstError) { firstError.focus(); return; }
    const next = observations.filter((p) => p.symbol !== symbol).concat({ symbol, date, cost, holdingBasis: position.holdingBasis });
    if (!writePositions(next)) return;
    pendingRemove = null;
    resetForm();
    byId("takeProfitFormStatus").textContent = symbol + " 观察已保存，峰值与首次触发按本次入场重新计算。";
    activate();
  });
  select.addEventListener("change", () => { fillEntry(select.value); });
  cancelEdit.addEventListener("click", () => { resetForm(); byId("takeProfitFormStatus").textContent = "已取消编辑，保存的观察未改动。"; });
  refresh.addEventListener("click", () => activate(true));
  byId("takeProfitRows").addEventListener("click", (event) => {
    const item = event.target.closest("button[data-tp-action]");
    if (!item) return;
    const symbol = item.dataset.symbol, action = item.dataset.tpAction;
    const position = positions.find((p) => p.symbol === symbol);
    if (!position) return;
    if (action === "edit") {
      if (!index || !index.symbols[symbol]) { byId("takeProfitFormStatus").textContent = "当前日线未覆盖此持仓，暂时无法计算止盈。"; return; }
      editing = symbol;
      select.value = symbol;
      fillEntry(symbol);
      byId("takeProfitFormStatus").textContent = "修改入场信息后重新计算；保存前不会改变观察。";
      dateInput.focus();
      form.scrollIntoView({ block: "nearest" });
    } else if (action === "remove") { pendingRemove = symbol; renderCards(); }
    else if (action === "cancel-remove") { pendingRemove = null; renderCards(); }
    else if (action === "confirm-remove") {
      if (!writePositions(observations.filter((p) => p.symbol !== symbol))) return;
      pendingRemove = null;
      results.delete(symbol);
      if (editing === symbol) resetForm();
      activate();
      byId("takeProfitFormStatus").textContent = symbol + " 入场信息已清除；实际持仓仍保留在列表。";
    }
  });
  root.addEventListener("workspace:view-changed", (event) => {
    if (event.detail?.view !== "take-profit") {
      ++attempt;
      abortPending();
      if (busy) symbolCache.clear();
      busy = false;
      updateControls();
      return;
    }
    if (!started) { started = true; observations = readPositions(); }
    activate();
  });
  root.addEventListener("storage", (event) => {
    if (event.key !== KEY || !started) return;
    observations = readPositions();
    if (!view.hidden) activate();
  });
  async function checkFreshness() {
    if (!started || view.hidden || busy) return;
    const previous = holdingsFingerprint;
    syncHoldings();
    if (previous !== holdingsFingerprint) { activate(); return; }
    const token = attempt, session = await expectedSession();
    if (token !== attempt || view.hidden) return;
    if (session !== expected) activate();
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkFreshness(); });
  root.setInterval(checkFreshness, 60000);
  function holdingsChanged() {
    if (!started) return;
    const previous = holdingsFingerprint;
    syncHoldings();
    if (previous === holdingsFingerprint) return;
    results.clear();
    if (index) fillSymbols();
    updateControls();
    renderCards();
    if (!view.hidden && !refreshingHoldings) activate();
  }
  for (const event of ["wealthsimple:plan-updated", "snaptrade:holdings-updated", "snaptrade:holdings-mode", "snaptrade:holdings-forgotten"]) root.addEventListener(event, holdingsChanged);
  byId("takeProfitHoldingsSettings").addEventListener("click", () => {
    root.dispatchEvent(new CustomEvent("settings-center:open", { detail: { category: "accounts" } }));
    const source = currentHoldings();
    if (source?.requestedSourceMode === "automatic" && source?.automaticStatus === "locked") {
      // The settings center first focuses its category tab on the next task.
      root.setTimeout(() => {
        const keyInput = byId("snaptradeSnapshotKeyInput");
        if (keyInput && !byId("settingsModal").classList.contains("hidden")) {
          keyInput.focus(); keyInput.scrollIntoView({ block: "center" });
        }
      }, 0);
    }
  });
  root.TakeProfitPanel = Object.freeze({ storageKey: KEY, refresh: () => activate(true) });
  // The script can also load after navigation during testing or future bundling.
  if (root.WorkspaceNavigation?.current === "take-profit") {
    started = true;
    observations = readPositions();
    activate();
  }
})(window);
