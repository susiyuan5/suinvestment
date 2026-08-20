(function (root) {
  "use strict";
  var modeKey = "su-investment-pro:holdings-source-mode";
  var state = { status: "locked", snapshot: null, portfolioRisk: null };
  function id(value) { return document.getElementById(value); }
  function number(value) { return Number.isFinite(Number(value)) ? Number(value) : null; }
  function isFresh(snapshot) {
    var value = snapshot && (snapshot.positions_as_of || snapshot.generated_at);
    var time = value ? Date.parse(value) : NaN;
    return Number.isFinite(time) && time <= Date.now() && Date.now() - time <= 3 * 24 * 60 * 60 * 1000;
  }
  function portfolioRisk(snapshot) {
    var holdings = (snapshot.holdings || []).filter(function (item) { return item.included_in_stock_plan && item.market_value !== null; });
    var cash = (snapshot.accounts || []).reduce(function (sum, account) { return sum + (account.balances || []).reduce(function (inner, balance) { return inner + (number(balance.cash) || 0); }, 0); }, 0);
    var positions = {};
    holdings.forEach(function (item) { if (!item.symbol) return; var row = positions[item.symbol] || { current_value: 0, shares: 0, average_cost: item.cost_basis, currency: item.position_currency }; row.current_value += number(item.market_value) || 0; row.shares += number(item.units) || 0; positions[item.symbol] = row; });
    var total = Object.keys(positions).reduce(function (sum, symbol) { return sum + positions[symbol].current_value; }, 0) + cash;
    Object.keys(positions).forEach(function (symbol) { positions[symbol].current_allocation = total > 0 ? positions[symbol].current_value / total * 100 : 0; });
    return { available_cash: cash, available_cash_provided: true, positions: positions, source: "snaptrade_automatic", source_as_of: snapshot.generated_at, total_portfolio_value: total };
  }
  function dispatch() { root.dispatchEvent(new CustomEvent("snaptrade:holdings-updated", { detail: { status: state.status, snapshot: state.snapshot, portfolioRisk: state.portfolioRisk, sourceMode: localStorage.getItem(modeKey) || "automatic" } })); }
  function persistenceLabel(value) { return value === "persistent" ? "已永久保存在此浏览器" : value === "saved_may_clear" ? "已保存，但浏览器仍可能清理网站数据" : value === "saved_indexeddb" ? "已保存在此浏览器（未提供持久化权限）" : value === "session_only" ? "仅本次会话可用，密钥未能永久保存" : "正在检查本机密钥"; }
  function render(message, persistence) {
    var status = id("snaptradeSyncStatus"); if (status) { status.textContent = message || (state.status === "checking" ? "正在检查本机密钥" : state.status === "ready" ? "正常 · 已自动解密 · 只读同步可用" : state.status === "locked" ? "本机没有保存密钥" : state.status === "idb_unavailable" ? "阻断 · IndexedDB 不可用" : state.status === "warning" ? "警告 · 加密快照已过期" : "阻断 · 密钥与快照不匹配"); status.dataset.state = state.status; }
    var snapshot = state.snapshot; var accounts = id("snaptradeAccountCount"); var positions = id("snaptradePositionCount"); var asOf = id("snaptradeSyncAsOf"); var last = id("snaptradeSyncLastSuccess");
    if (accounts) accounts.textContent = snapshot ? String(snapshot.accounts.length) : "--";
    if (positions) positions.textContent = snapshot ? String(snapshot.holdings.length) : "--";
    if (asOf) asOf.textContent = snapshot ? String(snapshot.generated_at) : "--";
    if (last) last.textContent = snapshot ? String(snapshot.generated_at) : "--";
    var connection = id("snaptradeConnectionSummary"); if (connection) connection.textContent = snapshot ? "Personal / 只读 / Wealthsimple" : "未解密";
    var warning = id("snaptradeSyncWarning"); if (warning) warning.textContent = persistence ? persistenceLabel(persistence) + "。" : state.status === "ready" ? "自动持仓只更新实际持仓；目标比例、预算和交易权限不会被修改。" : state.status === "idb_unavailable" ? "本机浏览器无法使用加密密钥库，本次不能声明永久保存。" : "自动持仓不可用时，本周决策继续使用最后有效人工持仓并要求人工复核。";
    var persistenceEl = id("snaptradePersistenceStatus"); if (persistenceEl) persistenceEl.textContent = persistenceLabel(persistence || (state.status === "checking" ? "checking" : ""));
    var autoUnlockEl = id("snaptradeAutoUnlockAt"); if (autoUnlockEl && state.status === "ready") autoUnlockEl.textContent = new Date().toLocaleString("zh-CN");
  }
  async function refresh() {
    state.status = "checking"; render();
    var result = await root.SnaptradeHoldingsStore.autoUnlockFromStoredKey(); state.status = result.status; state.snapshot = result.snapshot;
    if (state.status === "ready" && !isFresh(result.snapshot)) { state.status = "warning"; state.portfolioRisk = null; render("警告 · 持仓数据已过期，不并入本周决策"); dispatch(); return; }
    state.portfolioRisk = result.snapshot ? portfolioRisk(result.snapshot) : null; render(result.status === "locked" ? "本机没有保存密钥" : result.error ? "阻断 · " + (result.error.message || "同步数据不可用") : "", result.persistence);
    dispatch();
  }
  async function bind() {
    if (!root.SnaptradeHoldingsStore || !id("snaptradeImportKeyBtn")) return;
    id("snaptradeImportKeyBtn").addEventListener("click", async function () { var input = id("snaptradeSnapshotKeyInput"); try { var result = await root.SnaptradeHoldingsStore.unlock(input.value.trim()); if (!isFresh(result.snapshot)) throw new Error("加密快照已过期"); state.status = "ready"; state.snapshot = result.snapshot; state.portfolioRisk = portfolioRisk(result.snapshot); input.value = ""; render(result.persistence && result.persistence.status === "session_only" ? "本次会话可用，但密钥未能永久保存" : "正常 · 本机解密成功", result.persistence && result.persistence.status); dispatch(); } catch (error) { state.status = "error"; state.snapshot = null; state.portfolioRisk = null; render("阻断 · " + (error.message || "密钥或快照无效，未显示任何持仓")); dispatch(); } });
    id("snaptradeForgetKeyBtn").addEventListener("click", async function () { try { await root.SnaptradeHoldingsStore.forgetStoredKey(); state.status = "locked"; state.snapshot = null; state.portfolioRisk = null; render("已忘记本机解密密钥"); root.dispatchEvent(new CustomEvent("snaptrade:holdings-forgotten")); } catch (error) { render("阻断 · 本机密钥未能确认删除，请人工复核"); } });
    var mode = id("snaptradeHoldingsSourceMode"); if (mode) { mode.value = localStorage.getItem(modeKey) || "automatic"; mode.addEventListener("change", function () { localStorage.setItem(modeKey, mode.value); root.dispatchEvent(new CustomEvent("snaptrade:holdings-mode", { detail: { mode: mode.value } })); if (mode.value === "automatic") dispatch(); }); }
    await refresh();
  }
  root.SnaptradeHoldingsView = Object.freeze({ bind: bind, refresh: refresh, portfolioRisk: portfolioRisk });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind); else bind();
})(typeof globalThis !== "undefined" ? globalThis : this);
