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
  function render(message) {
    var status = id("snaptradeSyncStatus"); if (status) { status.textContent = message || (state.status === "ready" ? "正常 · 只读同步可用" : state.status === "locked" ? "已锁定 · 等待本机解密密钥" : state.status === "warning" ? "警告 · 数据已过期" : "阻断 · 同步数据不可用"); status.dataset.state = state.status; }
    var snapshot = state.snapshot; var accounts = id("snaptradeAccountCount"); var positions = id("snaptradePositionCount"); var asOf = id("snaptradeSyncAsOf"); var last = id("snaptradeSyncLastSuccess");
    if (accounts) accounts.textContent = snapshot ? String(snapshot.accounts.length) : "--";
    if (positions) positions.textContent = snapshot ? String(snapshot.holdings.length) : "--";
    if (asOf) asOf.textContent = snapshot ? String(snapshot.generated_at) : "--";
    if (last) last.textContent = snapshot ? String(snapshot.generated_at) : "--";
    var connection = id("snaptradeConnectionSummary"); if (connection) connection.textContent = snapshot ? "Personal / 只读 / Wealthsimple" : "未解密";
    var warning = id("snaptradeSyncWarning"); if (warning) warning.textContent = state.status === "ready" ? "自动持仓只更新实际持仓；目标比例、预算和交易权限不会被修改。" : "自动持仓不可用时，本周决策继续使用最后有效人工持仓并要求人工复核。";
  }
  async function refresh() {
    var result = await root.SnaptradeHoldingsStore.load(); state.status = result.status; state.snapshot = result.snapshot;
    if (state.status === "ready" && !isFresh(result.snapshot)) { state.status = "warning"; state.portfolioRisk = null; render("警告 · 持仓数据已过期，不并入本周决策"); return; }
    state.portfolioRisk = result.snapshot ? portfolioRisk(result.snapshot) : null; render(result.error ? "阻断 · 解密失败，未显示部分数据" : "");
    if (state.status === "ready" && (localStorage.getItem(modeKey) || "automatic") === "automatic") dispatch();
  }
  async function bind() {
    if (!root.SnaptradeHoldingsStore || !id("snaptradeImportKeyBtn")) return;
    id("snaptradeImportKeyBtn").addEventListener("click", async function () { var input = id("snaptradeSnapshotKeyInput"); try { var snapshot = await root.SnaptradeHoldingsStore.unlock(input.value.trim()); if (!isFresh(snapshot)) throw new Error("snapshot_stale"); state.status = "ready"; state.snapshot = snapshot; state.portfolioRisk = portfolioRisk(snapshot); input.value = ""; render("正常 · 本机解密成功"); dispatch(); } catch (_) { state.status = "error"; state.snapshot = null; state.portfolioRisk = null; render("阻断 · 密钥或快照无效，未显示任何持仓"); } });
    id("snaptradeForgetKeyBtn").addEventListener("click", async function () { await root.SnaptradeHoldingsStore.forgetKey(); state.status = "locked"; state.snapshot = null; state.portfolioRisk = null; render("已忘记本机解密密钥"); root.dispatchEvent(new CustomEvent("snaptrade:holdings-forgotten")); });
    var mode = id("snaptradeHoldingsSourceMode"); if (mode) { mode.value = localStorage.getItem(modeKey) || "automatic"; mode.addEventListener("change", function () { localStorage.setItem(modeKey, mode.value); root.dispatchEvent(new CustomEvent("snaptrade:holdings-mode", { detail: { mode: mode.value } })); if (mode.value === "automatic") dispatch(); }); }
    await refresh();
  }
  root.SnaptradeHoldingsView = Object.freeze({ bind: bind, refresh: refresh, portfolioRisk: portfolioRisk });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind); else bind();
})(typeof globalThis !== "undefined" ? globalThis : this);
