(function () {
  "use strict";

  const status = document.getElementById("projectHealthStatus");
  const detail = document.getElementById("projectHealthDetails");
  const watchlist = document.getElementById("watchlistHealthStatus");
  const historyMetrics = document.getElementById("healthHistoryMetrics");
  const historyWindow = document.getElementById("healthHistoryWindow");
  const historyTrend = document.getElementById("healthHistoryTrend");
  if (!status || !detail) return;

  function formatValue(key, value) {
    if (value === null || value === undefined || value === "") return "无数据";
    if (/ratio|rate/.test(key)) return (Number(value) * 100).toFixed(1) + "%";
    if (/response_ms/.test(key)) return Math.round(Number(value)) + " 毫秒";
    return String(value);
  }

  function hasNumericValue(value) {
    return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
  }

  function renderHistory(history) {
    const entries = history && Array.isArray(history.entries) ? history.entries : [];
    if (historyWindow) historyWindow.textContent = "最近 " + String((history && history.retention_days) || 90) + " 天";
    if (!historyMetrics) return;
    historyMetrics.innerHTML = "";
    if (!entries.length) {
      historyMetrics.innerHTML = "<span class=\"health-history-empty\">暂无健康历史观察。</span>";
      if (historyTrend) historyTrend.textContent = "下一次健康检查将加入第一条趋势记录。";
      return;
    }
    const latest = entries[entries.length - 1];
    const previous = entries.length > 1 ? entries[entries.length - 2] : null;
    const metrics = [
      ["数据延迟", "data_delay_count"],
      ["工作流失败", "workflow_failure_rate"],
      ["盯盘降级", "watchlist_degradation_ratio"],
      ["Shadow 缺失", "shadow_missing_rate"],
      ["页面 JS 错误", "page_js_error_count"],
      ["数据源延迟", "data_source_response_ms"]
    ];
    metrics.forEach(function (item) {
      const card = document.createElement("div");
      const label = document.createElement("span");
      const value = document.createElement("strong");
      label.textContent = item[0];
      value.textContent = formatValue(item[1], latest[item[1]]);
      card.append(label, value);
      if (previous && hasNumericValue(latest[item[1]]) && hasNumericValue(previous[item[1]])) {
        const delta = document.createElement("small");
        const change = Number(latest[item[1]]) - Number(previous[item[1]]);
        delta.textContent = (change > 0 ? "+" : "") + formatValue(item[1], change) + "，较上次";
        card.appendChild(delta);
      }
      historyMetrics.appendChild(card);
    });
    if (historyTrend) {
      const dates = entries.slice(-3).map(function (entry) { return String(entry.recorded_at || "").slice(0, 10); }).filter(Boolean);
      historyTrend.textContent = entries.length + " 条观察记录；最新日期 " + (dates[dates.length - 1] || "未知") + "。近期记录：" + dates.join(" → ") + "。";
    }
  }

  function applyHealth(payload, history) {
    const value = ["healthy", "warning", "blocked"].includes(payload.status) ? payload.status : "warning";
    status.textContent = value === "healthy" ? "正常" : value === "blocked" ? "阻断" : "警告";
    status.dataset.status = value;
    const issueCount = Array.isArray(payload.issues) ? payload.issues.length : 0;
    const core = payload.core_satellite || {};
    const coreNote = core.preset_version ? " 核心/卫星 " + core.preset_version + "；SPY " + (core.spy_data_status || "未知") + "；QQQ " + (core.qqq_risk_signal_status || "未知") + "。" : "";
    detail.textContent = issueCount ? issueCount + " 个运行问题，请查看报告。" + coreNote : "数据和工作流正常，仅供人工决策。" + coreNote;
    if (watchlist) {
      const watchlistStatus = payload.watchlist && payload.watchlist.status;
      watchlist.textContent = watchlistStatus === "ready" ? "正常" : watchlistStatus === "degraded" ? "已降级" : "未知";
    }
    renderHistory(history);
    window.__SUINVESTMENT_HEALTH__ = payload;
    window.dispatchEvent(new CustomEvent("project-health:loaded", { detail: { report: payload, history: history } }));
  }

  Promise.all([
    fetch("results/health/project-health.json", { cache: "no-cache" }).then(function (response) { if (!response.ok) throw new Error("health report unavailable"); return response.json(); }),
    fetch("results/health/project-health-history.json", { cache: "no-cache" }).then(function (response) { if (!response.ok) return { entries: [] }; return response.json(); }).catch(function () { return { entries: [] }; })
  ])
    .then(function (payloads) { applyHealth(payloads[0], payloads[1]); })
    .catch(function () {
      status.textContent = "警告";
      status.dataset.status = "warning";
      detail.textContent = "健康报告不可用，请人工复核。";
      if (watchlist) watchlist.textContent = "未知";
      renderHistory({ entries: [] });
      window.dispatchEvent(new CustomEvent("project-health:loaded", { detail: { report: null, history: { entries: [] } } }));
    });

  window.addEventListener("watchlist:data-status", function (event) {
    if (!watchlist || !event.detail) return;
    const sources = event.detail.sources || {};
    const labels = Object.keys(sources).map(function (source) { return source + " " + sources[source]; });
    watchlist.textContent = labels.length ? labels.join(" / ") : "不可用";
  });
})();
