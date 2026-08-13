(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DashboardUiPolicy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function finite(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function sortHoldingsByDeviation(rows) {
    return (rows || []).slice().sort(function (a, b) {
      var left = Math.abs(finite(a && a.allocationDrift) || 0);
      var right = Math.abs(finite(b && b.allocationDrift) || 0);
      if (right !== left) return right - left;
      return String(a && a.symbol || "").localeCompare(String(b && b.symbol || ""));
    });
  }

  function decisionStatus(amount, action) {
    var value = finite(amount) || 0;
    var normalized = String(action || "").toUpperCase();
    if (value <= 0 || normalized === "HOLD" || normalized === "DO_NOT_BUY") return "暂停或保留现金";
    if (normalized === "REDUCE_BUY") return "低于基准投入";
    return "可供人工核对";
  }

  function emptyHoldingsState(source, status, hasCash) {
    if (source === "automatic" && status === "ready") return hasCash ? "已同步 Wealthsimple，当前没有股票或 ETF 持仓；已检测到现金" : "已同步 Wealthsimple，当前没有股票或 ETF 持仓";
    if (status === "locked") return "加密快照尚未在本机解锁";
    if (source === "automatic" && ["warning", "error"].indexOf(status) >= 0) return "自动同步失败，已回退到人工持仓";
    return "当前没有已录入持仓";
  }

  return Object.freeze({ sortHoldingsByDeviation: sortHoldingsByDeviation, decisionStatus: decisionStatus, emptyHoldingsState: emptyHoldingsState });
});
