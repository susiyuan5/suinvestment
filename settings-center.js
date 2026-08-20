(function (root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SettingsCenter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var ACCOUNT_KEY = "su-investment-pro:wealthsimple-accounts-v1";
  var DEPLOYMENT_KEY = "su-investment-pro:deployment";
  var CORE_STATE_KEY = "su-investment-pro:core-satellite-state";
  var DEFAULT_DEPLOYMENT = { monthlyBudget: 400, normalPool: 300, crashFund: 100, weeklyDeployment: 69.23 };
  var activeCategory = "accounts";
  var opener = null;
  var draft = null;
  var baseline = null;
  var initialized = false;
  var fxTimer = 0;
  var fxController = null;
  var fxRequestId = 0;

  function id(value) { return typeof document !== "undefined" ? document.getElementById(value) : null; }
  function read(key, fallback) { try { var value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; } }
  function writeRaw(key, value) { try { localStorage.setItem(key, value); return true; } catch (_) { return false; } }
  function number(value) { var parsed = Number(String(value == null ? "" : value).replace(/,/g, "")); return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : null; }
  function escapeHtml(value) { return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]; }); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function currencySettings() { return root.WealthsimpleCurrency ? root.WealthsimpleCurrency.load(localStorage) : { planningCurrency: "CAD", accountCurrency: "CAD", displayCurrency: "CAD", clientTier: "Core", usdAccountEnabled: false, fxRate: null, fxAsOf: null, fxMaxAgeDays: 3 }; }

  function normalizeAccounts(value) {
    if (value && Array.isArray(value.accounts)) {
      var modern = value.accounts.map(function (item) {
        var idValue = String(item && (item.id || item.account_id) || "").trim();
        return Object.assign({ id: idValue, label: "", account_id: idValue, account_type: "TFSA", account_currency: "CAD", available_to_trade: 0, pending_order_reserve: 0, complete: false }, item, { id: idValue, account_id: String(item && item.account_id || idValue) });
      }).filter(function (item) { return Boolean(item.id); });
      return { version: "wealthsimple-accounts-v2", defaultId: modern.some(function (item) { return item.id === value.defaultId; }) ? value.defaultId : (modern[0] ? modern[0].id : ""), accounts: modern };
    }
    var legacy = Object.keys(value && typeof value === "object" ? value : {}).flatMap(function (key) {
      var item = value[key] || {};
      var meaningful = String(item.account_id || item.label || "").trim() || Number(item.available_to_trade) > 0 || Number(item.pending_order_reserve) > 0;
      if (!meaningful) return [];
      var idValue = String(item.account_id || key);
      return [{ id: idValue, label: item.label || key, account_id: idValue, account_type: item.account_type || key, account_currency: item.account_currency || "CAD", available_to_trade: Number(item.available_to_trade) || 0, pending_order_reserve: Number(item.pending_order_reserve) || 0, complete: Boolean(item.account_currency) }];
    });
    return { version: "wealthsimple-accounts-v2", defaultId: legacy[0] ? legacy[0].id : "", accounts: legacy };
  }

  function allocationDraft() {
    var result = {};
    if (typeof document !== "undefined") document.querySelectorAll("#coreSatelliteAllocationEditor [data-allocation-symbol]").forEach(function (input) { result[input.dataset.allocationSymbol] = Number(input.value) / 100; });
    return Object.keys(result).length ? result : (root.__SUINVESTMENT_SETTINGS_API__ && root.__SUINVESTMENT_SETTINGS_API__.currentAllocation ? root.__SUINVESTMENT_SETTINGS_API__.currentAllocation() : {});
  }

  function deploymentFromForm(fallback) {
    var previous = fallback || DEFAULT_DEPLOYMENT;
    return {
      monthlyBudget: id("monthlyBudgetInput") ? id("monthlyBudgetInput").value : previous.monthlyBudget,
      normalPool: id("normalPoolInput") ? id("normalPoolInput").value : previous.normalPool,
      crashFund: id("crashFundInput") ? id("crashFundInput").value : previous.crashFund,
      weeklyDeployment: id("weeklyDeploymentInput") ? id("weeklyDeploymentInput").value : previous.weeklyDeployment
    };
  }

  function snapshot() {
    var settings = currencySettings();
    return {
      displayCurrency: id("displayCurrencySelect") ? id("displayCurrencySelect").value : settings.displayCurrency,
      planningCurrency: id("planningCurrencySelect") ? id("planningCurrencySelect").value : settings.planningCurrency,
      accountCurrency: id("accountCurrencySelect") ? id("accountCurrencySelect").value : settings.accountCurrency,
      clientTier: id("wealthsimpleTierSelect") ? id("wealthsimpleTierSelect").value : settings.clientTier,
      fxRate: id("wealthsimpleFxRate") ? id("wealthsimpleFxRate").value : settings.fxRate,
      fxAsOf: id("wealthsimpleFxAsOf") ? id("wealthsimpleFxAsOf").value : settings.fxAsOf,
      fxMaxAgeDays: id("wealthsimpleFxMaxAge") ? id("wealthsimpleFxMaxAge").value : settings.fxMaxAgeDays,
      deployment: read(DEPLOYMENT_KEY, DEFAULT_DEPLOYMENT),
      apiKey: root.SettingsStorage ? root.SettingsStorage.getApiKey(localStorage) : "",
      deleteApiKey: false,
      accounts: normalizeAccounts(read(ACCOUNT_KEY, {})),
      allocation: allocationDraft(),
      allocationMode: read(CORE_STATE_KEY, {}).allocation_mode || "default"
    };
  }

  function currentValue() {
    var settings = currencySettings();
    return {
      displayCurrency: id("displayCurrencySelect").value,
      planningCurrency: id("planningCurrencySelect").value,
      accountCurrency: id("accountCurrencySelect").value,
      clientTier: id("wealthsimpleTierSelect").value,
      fxRate: id("wealthsimpleFxRate").value || settings.fxRate,
      fxAsOf: id("wealthsimpleFxAsOf").value || settings.fxAsOf,
      fxMaxAgeDays: id("wealthsimpleFxMaxAge").value,
      deployment: deploymentFromForm(draft && draft.deployment),
      apiKey: draft && draft.deleteApiKey ? "" : id("apiKey").value,
      deleteApiKey: draft && draft.deleteApiKey === true,
      accounts: draft.accounts,
      allocation: allocationDraft(),
      allocationMode: draft.allocationMode
    };
  }

  function setValue(element, value) { if (element) element.value = value == null ? "" : value; }
  function fillDraft() {
    setValue(id("displayCurrencySelect"), draft.displayCurrency);
    setValue(id("planningCurrencySelect"), draft.planningCurrency);
    setValue(id("accountCurrencySelect"), draft.accountCurrency);
    setValue(id("wealthsimpleTierSelect"), draft.clientTier);
    setValue(id("wealthsimpleFxRate"), draft.fxRate || "");
    setValue(id("wealthsimpleFxAsOf"), draft.fxAsOf || "");
    setValue(id("wealthsimpleFxMaxAge"), draft.fxMaxAgeDays || 3);
    setValue(id("apiKey"), draft.apiKey || "");
    Object.keys(draft.deployment).forEach(function (field) {
      var input = id(field === "monthlyBudget" ? "monthlyBudgetInput" : field === "normalPool" ? "normalPoolInput" : field === "crashFund" ? "crashFundInput" : "weeklyDeploymentInput");
      setValue(input, draft.deployment[field]);
    });
    if (draft.allocation && root.__SUINVESTMENT_SETTINGS_API__ && root.__SUINVESTMENT_SETTINGS_API__.setAllocationDraft) root.__SUINVESTMENT_SETTINGS_API__.setAllocationDraft(draft.allocation);
    renderAccounts();
    renderSummary();
  }

  function serializable(value) {
    return { displayCurrency: value.displayCurrency, planningCurrency: value.planningCurrency, accountCurrency: value.accountCurrency, clientTier: value.clientTier, fxRate: value.fxRate, fxAsOf: value.fxAsOf, fxMaxAgeDays: value.fxMaxAgeDays, deployment: value.deployment, apiKey: value.apiKey, accounts: value.accounts, allocation: value.allocation, allocationMode: value.allocationMode };
  }

  function dirtyComparable(value) {
    var result = serializable(value);
    delete result.fxRate;
    delete result.fxAsOf;
    return result;
  }

  function exportPayload(value) {
    var result = serializable(value);
    delete result.apiKey;
    return { schema_version: "settings-center-v2", exportedAt: new Date().toISOString(), settings: result };
  }

  function renderSummary() {
    if (!draft) return;
    var value = currentValue();
    var accounts = value.accounts.accounts;
    var defaultAccount = accounts.find(function (item) { return item.id === value.accounts.defaultId; }) || accounts[0];
    id("settingsCommonSummary").textContent = "本周使用 " + value.planningCurrency + " 预算；默认账户：" + (defaultAccount ? (defaultAccount.label || defaultAccount.account_type) + " · " + defaultAccount.account_currency : "未设置") + "；页面显示 " + value.displayCurrency + "。";
    var accountComplete = defaultAccount && defaultAccount.label && defaultAccount.account_currency;
    id("settingsModalStatus").textContent = accounts.length ? "当前设置完整性：" + (accountComplete ? "正常" : "需要补充账户信息") : "当前设置完整性：需要添加 Wealthsimple 本地账户";
    var weekly = number(value.deployment.weeklyDeployment);
    if (id("settingsDeploymentImpact")) id("settingsDeploymentImpact").textContent = "本周计划影响：" + (weekly == null ? "输入无效" : weekly.toFixed(2) + " " + value.planningCurrency) + "；保存前会统一校验。";
  }

  function accountCardMarkup(account, isDefault) {
    var available = number(account.available_to_trade) || 0;
    var reserve = number(account.pending_order_reserve) || 0;
    var remaining = Math.max(0, available - reserve);
    var currency = escapeHtml(account.account_currency || "CAD");
    var name = escapeHtml(account.label || account.account_type || "本地账户");
    var type = escapeHtml(account.account_type || "TFSA");
    return "<div class=\"settings-account-card-heading\"><div class=\"settings-account-identity\"><strong>" + name + " · " + currency + "</strong><span>" + type + " · 仅保存在当前浏览器</span></div>" + (isDefault ? "<span class=\"settings-default-badge\">默认账户</span>" : "<button type=\"button\" class=\"secondary-button\" data-account-default>设为默认</button>") + "</div>" +
      "<div class=\"settings-account-metrics\"><div><span>可交易金额</span><strong data-account-metric=\"available\">" + available.toFixed(2) + "</strong><small>" + currency + "</small></div><div><span>待成交预留</span><strong data-account-metric=\"reserve\">" + reserve.toFixed(2) + "</strong><small>" + currency + "</small></div><div><span>剩余可用</span><strong data-account-metric=\"remaining\">" + remaining.toFixed(2) + "</strong><small>" + currency + "</small></div></div>" +
      "<details class=\"settings-account-editor\"><summary>编辑账户</summary><div class=\"settings-account-fields\"><label>本地账户名称<input data-account-field=\"label\" value=\"" + escapeHtml(account.label || "") + "\"></label><label>账户类型<select data-account-field=\"account_type\"><option>TFSA</option><option>FHSA</option><option>RRSP</option><option>RESP</option><option value=\"NON_REGISTERED\">非注册账户</option></select></label><label>账户币种<select data-account-field=\"account_currency\"><option>CAD</option><option>USD</option></select></label><label>可交易金额<input data-account-field=\"available_to_trade\" type=\"number\" min=\"0\" step=\"any\"></label><label>待成交预留<input data-account-field=\"pending_order_reserve\" type=\"number\" min=\"0\" step=\"any\"></label></div><div class=\"settings-account-actions\"><button type=\"button\" class=\"danger-button\" data-account-delete>删除本地账户</button></div></details>";
  }

  function updateAccountMetrics(card, account) {
    var available = number(account.available_to_trade) || 0;
    var reserve = number(account.pending_order_reserve) || 0;
    card.querySelector("[data-account-metric='available']").textContent = available.toFixed(2);
    card.querySelector("[data-account-metric='reserve']").textContent = reserve.toFixed(2);
    card.querySelector("[data-account-metric='remaining']").textContent = Math.max(0, available - reserve).toFixed(2);
  }

  function renderAccounts() {
    var host = id("wealthsimpleSettingsAccountCards");
    if (!host || !draft) return;
    host.innerHTML = "";
    id("wealthsimpleAccountsEmpty").hidden = draft.accounts.accounts.length > 0;
    draft.accounts.accounts.forEach(function (account) {
      var card = document.createElement("article");
      card.className = "settings-account-card";
      card.dataset.accountId = account.id;
      card.innerHTML = accountCardMarkup(account, account.id === draft.accounts.defaultId);
      var typeField = card.querySelector("[data-account-field='account_type']");
      var currencyField = card.querySelector("[data-account-field='account_currency']");
      var availableField = card.querySelector("[data-account-field='available_to_trade']");
      var reserveField = card.querySelector("[data-account-field='pending_order_reserve']");
      typeField.value = account.account_type || "TFSA";
      currencyField.value = account.account_currency || "CAD";
      availableField.value = account.available_to_trade || "";
      reserveField.value = account.pending_order_reserve || "";
      card.querySelectorAll("[data-account-field]").forEach(function (field) {
        field.addEventListener("input", function () {
          account[field.dataset.accountField] = field.type === "number" ? (number(field.value) || 0) : field.value;
          account.complete = Boolean(account.label && account.account_type && account.account_currency);
          updateAccountMetrics(card, account);
          markDirty();
        });
      });
      var defaultButton = card.querySelector("[data-account-default]");
      if (defaultButton) defaultButton.addEventListener("click", function () {
        draft.accounts.defaultId = account.id;
        id("accountCurrencySelect").value = account.account_currency || "CAD";
        renderAccounts();
        markDirty();
      });
      card.querySelector("[data-account-delete]").addEventListener("click", function () {
        var plan = root.__SUINVESTMENT_WEALTHSIMPLE_PLAN__ && root.__SUINVESTMENT_WEALTHSIMPLE_PLAN__.plan;
        var referenced = plan && (plan.items || []).some(function (item) { return item.accountId === account.id; });
        if (referenced) { id("wealthsimpleAccountStatus").textContent = "本周计划正在引用此账户，不能直接删除。"; return; }
        if (account.id === draft.accounts.defaultId && draft.accounts.accounts.length > 1) { id("wealthsimpleAccountStatus").textContent = "请先设置其他默认账户，再删除当前账户。"; return; }
        if (!window.confirm("确认删除这个本地账户？不会影响 Wealthsimple 真实账户。")) return;
        draft.accounts.accounts = draft.accounts.accounts.filter(function (item) { return item.id !== account.id; });
        if (draft.accounts.defaultId === account.id) draft.accounts.defaultId = draft.accounts.accounts[0] ? draft.accounts.accounts[0].id : "";
        renderAccounts();
        markDirty();
      });
      host.appendChild(card);
    });
  }

  function markDirty() {
    if (!draft) return;
    var value = currentValue();
    draft.displayCurrency = value.displayCurrency;
    draft.planningCurrency = value.planningCurrency;
    draft.accountCurrency = value.accountCurrency;
    draft.clientTier = value.clientTier;
    draft.fxMaxAgeDays = value.fxMaxAgeDays;
    draft.deployment = value.deployment;
    draft.allocation = value.allocation;
    var dirty = JSON.stringify(dirtyComparable(value)) !== JSON.stringify(dirtyComparable(baseline));
    id("settingsDirtyState").textContent = dirty ? "有未保存的更改" : "没有未保存的更改";
    id("settingsDirtyState").dataset.dirty = String(dirty);
    renderSummary();
  }

  function addAccount() {
    var idValue = "account-" + Date.now();
    draft.accounts.accounts.push({ id: idValue, label: "新账户", account_id: idValue, account_type: "TFSA", account_currency: id("accountCurrencySelect").value || "CAD", available_to_trade: 0, pending_order_reserve: 0, complete: false });
    if (!draft.accounts.defaultId) draft.accounts.defaultId = idValue;
    renderAccounts();
    var created = document.querySelector("[data-account-id='" + idValue + "'] details");
    if (created) { created.open = true; var input = created.querySelector("input"); if (input) input.focus(); }
    markDirty();
  }

  function validate() {
    var value = currentValue();
    var errors = [];
    var deployment = {};
    Object.keys(DEFAULT_DEPLOYMENT).forEach(function (field) { deployment[field] = number(value.deployment[field]); if (deployment[field] == null) errors.push(field + " 必须是有限的非负数"); });
    if (deployment.monthlyBudget != null && deployment.normalPool != null && deployment.crashFund != null && Math.abs(deployment.monthlyBudget - deployment.normalPool - deployment.crashFund) > .01) errors.push("月度预算必须等于常规资金池加下跌备用金");
    if (deployment.weeklyDeployment != null && deployment.normalPool != null && deployment.weeklyDeployment > deployment.normalPool) errors.push("每周投入不能超过常规资金池");
    value.accounts.accounts.forEach(function (account) {
      if (!String(account.label || "").trim()) errors.push("每个本地账户都需要名称");
      if ((number(account.pending_order_reserve) || 0) > (number(account.available_to_trade) || 0)) errors.push((account.label || "账户") + " 的待成交预留不能超过可交易金额");
    });
    var fxRate = number(id("wealthsimpleFxRate").value);
    var fxNeeded = value.planningCurrency !== value.accountCurrency || value.displayCurrency !== value.planningCurrency;
    var nextSettings = Object.assign({}, currencySettings(), { fxRate: fxRate, fxAsOf: id("wealthsimpleFxAsOf").value || null, fxMaxAgeDays: number(id("wealthsimpleFxMaxAge").value) || 3 });
    if (fxNeeded && (!root.WealthsimpleCurrency || !root.WealthsimpleCurrency.rateIsValid(nextSettings))) errors.push("跨币种设置需要未过期的实时汇率");
    var allocation = allocationDraft();
    if (root.__SUINVESTMENT_SETTINGS_API__ && root.__SUINVESTMENT_SETTINGS_API__.validateAllocation && !root.__SUINVESTMENT_SETTINGS_API__.validateAllocation(allocation).valid) errors.push("组合比例不满足现有校验规则");
    return { errors: errors, value: value, deployment: deployment, allocation: allocation, fxRate: fxRate };
  }

  function save() {
    var result = validate();
    if (result.errors.length) {
      id("settingsModalStatus").textContent = "保存失败：" + result.errors[0];
      id("settingsDirtyState").textContent = result.errors.join("；");
      return false;
    }
    var current = currencySettings();
    var nextCurrency = Object.assign({}, current, { displayCurrency: result.value.displayCurrency, planningCurrency: result.value.planningCurrency, accountCurrency: result.value.accountCurrency, clientTier: result.value.clientTier, usdAccountEnabled: result.value.accountCurrency === "USD", fxRate: result.fxRate, fxAsOf: id("wealthsimpleFxAsOf").value || null, fxMaxAgeDays: number(id("wealthsimpleFxMaxAge").value) || 3 });
    var deploymentValue = result.deployment;
    var entries = {};
    entries[DEPLOYMENT_KEY] = JSON.stringify(deploymentValue);
    entries[ACCOUNT_KEY] = JSON.stringify(result.value.accounts);
    entries[root.SettingsStorage.DISPLAY_CURRENCY_KEY] = nextCurrency.displayCurrency;
    entries[root.WealthsimpleCurrency.KEY] = JSON.stringify(root.WealthsimpleCurrency.normalize(nextCurrency));
    var atomic = root.SettingsStorage && root.SettingsStorage.atomicWrite ? root.SettingsStorage.atomicWrite(entries, localStorage) : null;
    var ok = atomic ? atomic.ok : Object.keys(entries).every(function (key) { return writeRaw(key, entries[key]); });
    if (!ok) { id("settingsModalStatus").textContent = "保存失败，原有设置已保留。"; return false; }
    if (draft.deleteApiKey) root.SettingsStorage.saveApiKey("", localStorage, sessionStorage);
    else if (id("apiKey").value.trim()) root.SettingsStorage.saveApiKey(id("apiKey").value, localStorage, sessionStorage);
    var allocationChanged = JSON.stringify(result.allocation) !== JSON.stringify(baseline.allocation);
    if (allocationChanged && root.__SUINVESTMENT_SETTINGS_API__ && root.__SUINVESTMENT_SETTINGS_API__.applyAllocation) root.__SUINVESTMENT_SETTINGS_API__.applyAllocation(draft.allocationMode === "default" ? "default" : "manual", result.allocation);
    root.dispatchEvent(new CustomEvent("settings-center:saved", { detail: { currency: nextCurrency, deployment: deploymentValue } }));
    draft = snapshot();
    baseline = clone(serializable(draft));
    id("settingsDirtyState").textContent = "保存成功：所有设置已统一保存。";
    id("settingsDirtyState").dataset.dirty = "false";
    renderSummary();
    return true;
  }

  function fallbackFxSnapshot() {
    var cache = root.FxRateService && root.FxRateService.loadCache(localStorage);
    if (cache) return cache;
    var settings = currencySettings();
    return root.FxRateService && root.FxRateService.normalize({ rate: settings.fxRate, asOf: settings.fxAsOf, fetchedAt: settings.fxFetchedAt || settings.fxAsOf, source: settings.fxSource || "最后有效缓存", sourceKind: "settings-cache" });
  }

  function formatFxTime(value) {
    if (!value) return "--";
    try { return new Intl.DateTimeFormat("zh-CN", { timeZone: "America/Halifax", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value)) + "（哈利法克斯）"; } catch (_) { return value; }
  }

  function renderFx(snapshot, errorMessage) {
    var service = root.FxRateService;
    var normalized = service && service.normalize(snapshot);
    var status = service ? service.classify(normalized, Date.now(), number(id("wealthsimpleFxMaxAge").value) || 3) : { state: "error", label: "不可用", usable: false };
    id("settingsFxRate").textContent = normalized ? normalized.rate.toFixed(4) : "--";
    id("settingsFxInverse").textContent = normalized ? "1 USD = " + normalized.rate.toFixed(4) + " CAD · 1 CAD = " + normalized.inverseRate.toFixed(4) + " USD" : "1 CAD = -- USD";
    id("settingsFxSource").textContent = normalized ? normalized.source : "不可用";
    id("settingsFxUpdatedAt").textContent = normalized ? formatFxTime(normalized.asOf) : "--";
    id("settingsFxState").textContent = status.label;
    id("settingsFxState").dataset.state = status.state;
    if (errorMessage && normalized) id("settingsFxMessage").textContent = "实时源暂不可用，正在使用最后有效汇率：" + errorMessage + "。请在 Wealthsimple 下单前再次核对。";
    else if (errorMessage) id("settingsFxMessage").textContent = "实时汇率不可用，跨币种换算已停止：" + errorMessage + "。";
    else if (status.state === "live") id("settingsFxMessage").textContent = "汇率已更新，只用于换算展示与人工计划核对；Wealthsimple 最终成交汇率及费用以订单预览为准。";
    else if (!status.usable) id("settingsFxMessage").textContent = "汇率已过期，跨币种换算已停止；原始人工计划保持不变。";
    else id("settingsFxMessage").textContent = "正在使用最近有效汇率并明确标记时间；请在 Wealthsimple 下单前再次核对。";
  }

  function applyFx(snapshot) {
    var normalized = root.FxRateService.saveCache(snapshot, localStorage);
    if (!normalized) return;
    id("wealthsimpleFxRate").value = normalized.rate;
    id("wealthsimpleFxAsOf").value = normalized.asOf;
    var current = currencySettings();
    root.WealthsimpleCurrency.save(Object.assign({}, current, { fxRate: normalized.rate, fxAsOf: normalized.asOf, fxFetchedAt: normalized.fetchedAt, fxSource: normalized.source, fxSourceKind: normalized.sourceKind }), localStorage);
    if (draft) { draft.fxRate = normalized.rate; draft.fxAsOf = normalized.asOf; }
    root.dispatchEvent(new CustomEvent("fx-rate:updated", { detail: normalized }));
    renderFx(normalized, "");
  }

  async function refreshFx() {
    if (!root.FxRateService) { renderFx(null, "汇率模块缺失"); return; }
    if (fxController) fxController.abort();
    fxController = new AbortController();
    var controller = fxController;
    var timedOut = false;
    var timeoutId = setTimeout(function () { timedOut = true; controller.abort(); }, 8000);
    var requestId = ++fxRequestId;
    var button = id("refreshFxRateBtn");
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    id("settingsFxState").textContent = "正在获取";
    id("settingsFxState").dataset.state = "loading";
    try {
      var quote = await root.FxRateService.fetchLatest({ apiKey: root.SettingsStorage ? root.SettingsStorage.getApiKey(localStorage) : "", signal: controller.signal });
      if (requestId !== fxRequestId) return;
      applyFx(quote);
    } catch (error) {
      if (error && error.name === "AbortError" && !timedOut) return;
      if (requestId !== fxRequestId) return;
      renderFx(fallbackFxSnapshot(), timedOut ? "请求超时" : (error && error.message || "请求失败"));
    } finally {
      clearTimeout(timeoutId);
      if (requestId === fxRequestId) { button.disabled = false; button.removeAttribute("aria-busy"); }
    }
  }

  function startFx() {
    renderFx(fallbackFxSnapshot(), "");
    refreshFx();
    clearInterval(fxTimer);
    fxTimer = setInterval(function () { if (!id("settingsModal").classList.contains("hidden")) refreshFx(); }, 60000);
  }

  function stopFx() {
    clearInterval(fxTimer);
    fxTimer = 0;
    if (fxController) fxController.abort();
    fxController = null;
  }

  function open(event) {
    opener = document.activeElement;
    draft = snapshot();
    baseline = clone(serializable(draft));
    fillDraft();
    id("settingsDirtyState").textContent = "没有未保存的更改";
    id("settingsDirtyState").dataset.dirty = "false";
    id("settingsModal").classList.remove("hidden");
    document.body.style.overflow = "hidden";
    var app = document.querySelector(".app-shell");
    if (app) { app.inert = true; app.setAttribute("aria-hidden", "true"); }
    activeCategory = event && event.detail && event.detail.category || "accounts";
    selectCategory(activeCategory);
    startFx();
    setTimeout(function () { var tab = document.querySelector("[data-settings-tab='" + activeCategory + "']"); if (tab) tab.focus(); }, 0);
  }

  function close(force) {
    if (!force && id("settingsDirtyState").dataset.dirty === "true" && !window.confirm("有未保存的更改，确认放弃吗？")) return;
    stopFx();
    if (root.__SUINVESTMENT_SETTINGS_API__ && root.__SUINVESTMENT_SETTINGS_API__.discardAllocationDraft) root.__SUINVESTMENT_SETTINGS_API__.discardAllocationDraft();
    id("settingsModal").classList.add("hidden");
    document.body.style.overflow = "";
    var app = document.querySelector(".app-shell");
    if (app) { app.inert = false; app.removeAttribute("aria-hidden"); }
    if (opener && opener.focus) opener.focus();
  }

  function selectCategory(category) {
    activeCategory = category;
    document.querySelectorAll("[data-settings-tab]").forEach(function (tab) { var selected = tab.dataset.settingsTab === category; tab.setAttribute("aria-selected", String(selected)); tab.tabIndex = selected ? 0 : -1; });
    document.querySelectorAll("[data-settings-panel]").forEach(function (panel) { panel.hidden = panel.dataset.settingsPanel !== category; });
    var allocationEditor = id("coreSatelliteAllocationEditor");
    if (allocationEditor && category === "allocation") allocationEditor.open = true;
  }

  function keydown(event) {
    if (id("settingsModal").classList.contains("hidden")) return;
    if (event.key === "Escape") { event.preventDefault(); close(false); return; }
    if (["ArrowLeft", "ArrowRight"].includes(event.key) && document.activeElement && document.activeElement.matches("[data-settings-tab]")) {
      event.preventDefault();
      var tabs = Array.from(document.querySelectorAll("[data-settings-tab]"));
      var currentIndex = tabs.indexOf(document.activeElement);
      var nextIndex = (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      selectCategory(tabs[nextIndex].dataset.settingsTab);
      tabs[nextIndex].focus();
      return;
    }
    if (event.key !== "Tab") return;
    var focusable = Array.from(id("settingsModal").querySelectorAll("button:not([disabled]), input:not([disabled]):not([type='hidden']), select:not([disabled]), summary, [tabindex='0']")).filter(function (item) { return item.offsetParent !== null; });
    if (!focusable.length) return;
    var first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function bind() {
    if (initialized) return;
    initialized = true;
    var modal = id("settingsModal");
    if (!modal) return;
    root.addEventListener("settings-center:open", open);
    id("openSettingsBtn").addEventListener("click", function (event) { event.stopImmediatePropagation(); open(); });
    id("closeSettingsBtn").addEventListener("click", function () { close(false); });
    id("cancelSettingsBtn").addEventListener("click", function () { close(false); });
    id("saveSettingsChangesBtn").addEventListener("click", save);
    id("addWealthsimpleAccountBtn").addEventListener("click", addAccount);
    id("refreshFxRateBtn").addEventListener("click", refreshFx);
    id("deleteApiKeyBtn").addEventListener("click", function () { if (window.confirm("确认删除当前浏览器中的 Finnhub API 密钥？")) { draft.deleteApiKey = true; id("apiKey").value = ""; markDirty(); } });
    var exportButton = id("exportSettingsBtn");
    if (exportButton) exportButton.addEventListener("click", function () { var blob = new Blob([JSON.stringify(exportPayload(currentValue()), null, 2)], { type: "application/json" }); var link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "suinvestment-settings.json"; link.click(); URL.revokeObjectURL(link.href); });
    var resetAdvanced = id("resetAdvancedSettingsBtn");
    if (resetAdvanced) resetAdvanced.addEventListener("click", function () { id("wealthsimpleTierSelect").value = "Core"; id("wealthsimpleFxMaxAge").value = "3"; markDirty(); });
    document.querySelectorAll("[data-settings-tab]").forEach(function (tab) { tab.addEventListener("click", function () { selectCategory(tab.dataset.settingsTab); }); });
    modal.addEventListener("keydown", keydown);
    modal.addEventListener("input", function (event) { if (!event.target.closest(".settings-account-card")) markDirty(); });
    modal.addEventListener("change", function (event) { if (!event.target.closest(".settings-account-card")) markDirty(); });
    modal.addEventListener("click", function (event) { if (event.target === modal) close(false); });
    root.addEventListener("online", function () { if (!modal.classList.contains("hidden")) refreshFx(); });
    root.addEventListener("allocation-editor:changed", function (event) {
      if (!draft) return;
      draft.allocationMode = event.detail && event.detail.mode || "manual";
      draft.allocation = event.detail && event.detail.allocation || allocationDraft();
      markDirty();
    });
    var editor = id("coreSatelliteAllocationEditor"), mount = id("settingsAllocationMount");
    if (editor && mount) {
      mount.appendChild(editor);
      var actions = document.createElement("div");
      actions.className = "allocation-editor-actions settings-allocation-actions";
      actions.innerHTML = "<button type=\"button\" class=\"secondary-button\" id=\"settingsRestoreDefaultAllocationBtn\">恢复默认 40/60</button><button type=\"button\" class=\"secondary-button\" id=\"settingsUndoAllocationBtn\">撤销本次修改</button>";
      mount.appendChild(actions);
      actions.querySelector("#settingsRestoreDefaultAllocationBtn").addEventListener("click", function () {
        var presetDefinition = root.CoreSatellitePolicy && root.CoreSatellitePolicy.PRESET, preset = {};
        if (presetDefinition) { (root.CoreSatellitePolicy.rowsForPreset ? root.CoreSatellitePolicy.rowsForPreset(presetDefinition) : [presetDefinition.core].concat(presetDefinition.growth_etfs || [], presetDefinition.satellites || [])).forEach(function (item) { preset[item.symbol] = item.target_allocation; }); }
        draft.allocationMode = "default";
        draft.allocation = preset;
        if (root.__SUINVESTMENT_SETTINGS_API__ && root.__SUINVESTMENT_SETTINGS_API__.setAllocationDraft) root.__SUINVESTMENT_SETTINGS_API__.setAllocationDraft(preset);
        markDirty();
      });
      actions.querySelector("#settingsUndoAllocationBtn").addEventListener("click", function () {
        draft.allocation = clone(baseline.allocation);
        draft.allocationMode = baseline.allocationMode;
        if (root.__SUINVESTMENT_SETTINGS_API__ && root.__SUINVESTMENT_SETTINGS_API__.setAllocationDraft) root.__SUINVESTMENT_SETTINGS_API__.setAllocationDraft(draft.allocation);
        id("settingsModalStatus").textContent = "已撤销本次编辑区输入，保存前仍可继续修改。";
        markDirty();
      });
    }
  }

  if (typeof document !== "undefined") { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind); else bind(); }
  return Object.freeze({ normalizeAccounts: normalizeAccounts, serializable: serializable, exportPayload: exportPayload });
});
