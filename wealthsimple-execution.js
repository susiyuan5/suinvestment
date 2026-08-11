(function (root) {
  "use strict";
  var ACCOUNT_KEY = "su-investment-pro:wealthsimple-accounts-v1";
  var LEDGER_KEY = "su-investment-pro:wealthsimple-reconciliation-v1";
  var rulesPromise;
  function byId(id) { return document.getElementById(id); }
  function readJson(key, fallback) { try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; } }
  function saveJson(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {} }
  function n(value) { var x = Number(value); return Number.isFinite(x) ? x : 0; }
  function settings() { return root.WealthsimpleCurrency ? root.WealthsimpleCurrency.load(localStorage) : null; }
  function loadRules() {
    if (rulesPromise) return rulesPromise;
    rulesPromise = fetch("data/wealthsimple-rules-v1.json", { cache: "no-store" }).then(function (response) { if (!response.ok) throw new Error("规则文件不可用"); return response.json(); });
    return rulesPromise;
  }
  function planContext() { return root.__SUINVESTMENT_WEALTHSIMPLE_PLAN__ || { plan: null, signals: [] }; }
  function accounts() { return readJson(ACCOUNT_KEY, {}); }
  function renderAccounts() {
    var host = byId("wealthsimpleAccounts"); if (!host) return;
    var saved = accounts(); host.innerHTML = "";
    ["TFSA", "FHSA", "RRSP", "RESP", "NON_REGISTERED"].forEach(function (type) {
      var row = saved[type] || {};
      var wrapper = document.createElement("div"); wrapper.className = "wealthsimple-account-row";
      wrapper.innerHTML = "<label>账户类型<select data-ws-account-type=" + type + "><option>" + type + "</option></select></label><label>账户 ID<input data-ws-account-id value=\"" + (row.account_id || "") + "\"></label><label>账户币种<select data-ws-account-currency><option>CAD</option><option>USD</option></select></label><label>可交易金额<input data-ws-available type=number min=0 step=any value=\"" + (row.available_to_trade || "") + "\"></label><label>待处理预留<input data-ws-reserve type=number min=0 step=any value=\"" + (row.pending_order_reserve || "") + "\"></label>";
      wrapper.querySelector("[data-ws-account-currency]").value = row.account_currency || "CAD";
      host.appendChild(wrapper);
    });
  }
  function readAccounts() {
    var result = {};
    document.querySelectorAll(".wealthsimple-account-row").forEach(function (row) {
      var type = row.querySelector("[data-ws-account-type]").value;
      result[type] = { account_id: row.querySelector("[data-ws-account-id]").value.trim(), account_type: type, account_currency: row.querySelector("[data-ws-account-currency]").value, available_to_trade: n(row.querySelector("[data-ws-available]").value), pending_order_reserve: n(row.querySelector("[data-ws-reserve]").value) };
    });
    return result;
  }
  function renderChecklist(context, rules) {
    var status = byId("wealthsimpleChecklistStatus"), warning = byId("wealthsimpleChecklistWarning"), host = byId("wealthsimpleChecklistRows");
    if (!status || !warning || !host) return;
    host.innerHTML = "";
    if (!root.WealthsimpleOrderAdapter || !root.WealthsimpleCurrency || !rules || !context.plan) { status.textContent = "模块或计划不可用"; warning.textContent = "数据或计算未通过安全检查，请人工复核。"; return; }
    var current = settings();
    var signals = {}; (context.signals || []).forEach(function (item) { signals[item.symbol] = item; });
    var items = (context.plan.items || []).map(function (item) { var signal = signals[item.symbol] || {}; return Object.assign({}, item, { accountId: item.accountId || "", price: signal.price, priceAsOf: signal.fetchedAt ? new Date(signal.fetchedAt).toISOString() : null, fractional: item.symbol === "SPY" || item.fractional === true }); });
    var result = root.WealthsimpleOrderAdapter.buildChecklist({ items: items }, { settings: current, rules: rules, accounts: accounts(), securities: { BYDDY: { currency: "USD", otc: "unknown", fractional: "unknown" } } });
    status.textContent = result.safe ? "已生成，仍需人工核对" : "核对信息不完整";
    warning.textContent = result.safe ? "数量为估算值，不是订单；请在 Wealthsimple 人工确认价格、币种、账户和可交易金额。" : "汇率、行情、账户、证券资格或资金信息不完整，禁止生成可执行核对清单。";
    result.rows.forEach(function (item) {
      var row = document.createElement("article"); row.className = "wealthsimple-checklist-row";
      var quantity = item.quantity === null ? "暂不计算" : String(item.quantity) + "（" + item.quantityType + "）";
      row.innerHTML = "<strong>" + item.symbol + "</strong><span>账户：" + (item.accountType || "未确认") + "</span><span>计划：" + item.planningAmount.toFixed(2) + " " + result.planningCurrency + "</span><span>预计费用：" + (item.fxFee === null ? "不可用" : item.fxFee.toFixed(2)) + "</span><span>价格：" + (item.price === null ? "不可用" : item.price) + "</span><span>数量：" + quantity + "</span><span class=\"wealthsimple-row-status\">" + item.status + "</span><small>" + (item.failures || []).join("；") + "</small>";
      host.appendChild(row);
    });
  }
  function renderStress() {
    var host = byId("wealthsimpleStressRows"); if (!host || !root.PortfolioStressTest) return;
    var context = planContext(), positions = {};
    (context.signals || []).forEach(function (signal) { positions[signal.symbol] = { value: n(signal.current_value || signal.market_value), bucket: signal.symbol === "SPY" ? "core" : "satellite", sector: signal.sector || (signal.symbol === "NVDA" || signal.symbol === "AAPL" || signal.symbol === "ASML" ? "technology" : "other") }; });
    positions.cash = n(context.plan && context.plan.cashRetained);
    host.innerHTML = root.PortfolioStressTest.run(positions).map(function (item) { return "<div class=\"wealthsimple-checklist-row\"><strong>" + item.name + "</strong><span>估算损失：" + item.estimatedLoss.toFixed(2) + "</span><small>" + item.note + "</small></div>"; }).join("");
  }
  function saveCurrencySettings() {
    if (!root.WealthsimpleCurrency) return;
    var current = settings();
    var next = Object.assign({}, current, { planningCurrency: byId("planningCurrencySelect").value, accountCurrency: byId("accountCurrencySelect").value, clientTier: byId("wealthsimpleTierSelect").value, usdAccountEnabled: byId("accountCurrencySelect").value === "USD", fxRate: n(byId("wealthsimpleFxRate").value) || null, fxAsOf: byId("wealthsimpleFxAsOf").value ? new Date(byId("wealthsimpleFxAsOf").value).toISOString() : null, fxMaxAgeDays: n(byId("wealthsimpleFxMaxAge").value) || 3 });
    root.WealthsimpleCurrency.save(next, localStorage); byId("wealthsimpleCurrencyStatus").textContent = "币种设置已保存；金额仍以计划币种为准。"; renderCurrent();
  }
  function loadCurrencySettings() {
    if (!root.WealthsimpleCurrency) return;
    var current = settings(); byId("planningCurrencySelect").value = current.planningCurrency; byId("accountCurrencySelect").value = current.accountCurrency; byId("wealthsimpleTierSelect").value = current.clientTier; byId("wealthsimpleFxRate").value = current.fxRate || ""; byId("wealthsimpleFxAsOf").value = current.fxAsOf ? current.fxAsOf.slice(0, 16) : ""; byId("wealthsimpleFxMaxAge").value = current.fxMaxAgeDays;
  }
  function renderCurrent() { renderStress(); loadRules().then(function (rules) { renderChecklist(planContext(), rules); }).catch(function () { renderChecklist(planContext(), null); }); }
  function ledger() { return root.WealthsimpleReconciliation ? root.WealthsimpleReconciliation.createLedger(readJson(LEDGER_KEY, {})) : null; }
  function renderLedger() { var host = byId("wealthsimpleReconciliationRows"); if (!host || !root.WealthsimpleReconciliation) return; host.innerHTML = ""; ledger().entries.forEach(function (entry) { var row = document.createElement("div"); row.className = "wealthsimple-checklist-row"; row.textContent = entry.tradeDateTime + " · " + entry.symbol + " · " + entry.status + " · 实际股数 " + (entry.actualShares || "待填") + " · 订单 " + (entry.orderId || "无"); host.appendChild(row); }); }
  function bindReconciliation() {
    var form = byId("wealthsimpleTradeForm"); if (form && root.WealthsimpleReconciliation) form.addEventListener("submit", function (event) { event.preventDefault(); var result = root.WealthsimpleReconciliation.add(ledger(), { id: byId("wealthsimpleTradeOrderId").value || "manual-" + Date.now(), tradeDateTime: byId("wealthsimpleTradeDateTime").value, accountId: byId("wealthsimpleTradeAccountId").value, symbol: byId("wealthsimpleTradeSymbol").value.toUpperCase(), orderId: byId("wealthsimpleTradeOrderId").value, actualShares: n(byId("wealthsimpleActualShares").value), actualPrice: n(byId("wealthsimpleActualPrice").value), currency: byId("wealthsimpleTradeCurrency").value, status: byId("wealthsimpleTradeStatus").value, note: byId("wealthsimpleTradeNote").value }); var status = byId("wealthsimpleReconciliationStatus"); if (!result.ok) { status.textContent = "记录未保存：重复订单或记录编号。"; return; } saveJson(LEDGER_KEY, result.ledger); status.textContent = "成交记录已保存到本地，尚未更新持仓。"; renderLedger(); });
    var exportButton = byId("wealthsimpleExportBtn"); if (exportButton) exportButton.addEventListener("click", function () { var blob = new Blob([JSON.stringify(ledger(), null, 2)], { type: "application/json" }); var link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "wealthsimple-reconciliation.json"; link.click(); URL.revokeObjectURL(link.href); });
    var importer = byId("wealthsimpleImportInput"); if (importer) importer.addEventListener("change", function () { var file = importer.files && importer.files[0]; if (!file || !root.WealthsimpleReconciliation) return; var reader = new FileReader(); reader.onload = function () { try { var result = root.WealthsimpleReconciliation.importJson(ledger(), reader.result); saveJson(LEDGER_KEY, result.ledger); byId("wealthsimpleReconciliationStatus").textContent = "对账记录已导入，跳过重复记录 " + result.skipped + " 条。"; renderLedger(); } catch (_) { byId("wealthsimpleReconciliationStatus").textContent = "导入失败：JSON 格式无效。"; } }; reader.readAsText(file); });
    renderLedger();
  }
  function bind() {
    renderAccounts(); loadCurrencySettings(); renderCurrent(); bindReconciliation();
    var saveAccounts = byId("wealthsimpleSaveAccountsBtn"); if (saveAccounts) saveAccounts.addEventListener("click", function () { saveJson(ACCOUNT_KEY, readAccounts()); renderCurrent(); });
    var saveCurrency = byId("saveWealthsimpleCurrencyBtn"); if (saveCurrency) saveCurrency.addEventListener("click", saveCurrencySettings);
    root.addEventListener("wealthsimple:plan-updated", renderCurrent);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind); else bind();
})(typeof globalThis !== "undefined" ? globalThis : window);
