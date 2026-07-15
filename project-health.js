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
    if (value === null || value === undefined || value === "") return "N/A";
    if (/ratio|rate/.test(key)) return (Number(value) * 100).toFixed(1) + "%";
    if (/response_ms/.test(key)) return Math.round(Number(value)) + " ms";
    return String(value);
  }

  function renderHistory(history) {
    const entries = history && Array.isArray(history.entries) ? history.entries : [];
    if (historyWindow) historyWindow.textContent = "Last " + String((history && history.retention_days) || 90) + " days";
    if (!historyMetrics) return;
    historyMetrics.innerHTML = "";
    if (!entries.length) {
      historyMetrics.innerHTML = "<span class=\"health-history-empty\">No historical health observations yet.</span>";
      if (historyTrend) historyTrend.textContent = "The next scheduled health run will add the first trend point.";
      return;
    }
    const latest = entries[entries.length - 1];
    const previous = entries.length > 1 ? entries[entries.length - 2] : null;
    const metrics = [
      ["Data delays", "data_delay_count"],
      ["Workflow failures", "workflow_failure_rate"],
      ["Watchlist degraded", "watchlist_degradation_ratio"],
      ["Shadow missing", "shadow_missing_rate"],
      ["Page JS errors", "page_js_error_count"],
      ["Source latency", "data_source_response_ms"]
    ];
    metrics.forEach(function (item) {
      const card = document.createElement("div");
      const label = document.createElement("span");
      const value = document.createElement("strong");
      label.textContent = item[0];
      value.textContent = formatValue(item[1], latest[item[1]]);
      card.append(label, value);
      if (previous && Number.isFinite(Number(latest[item[1]])) && Number.isFinite(Number(previous[item[1]]))) {
        const delta = document.createElement("small");
        const change = Number(latest[item[1]]) - Number(previous[item[1]]);
        delta.textContent = (change > 0 ? "+" : "") + formatValue(item[1], change) + " vs previous";
        card.appendChild(delta);
      }
      historyMetrics.appendChild(card);
    });
    if (historyTrend) {
      const dates = entries.slice(-3).map(function (entry) { return String(entry.recorded_at || "").slice(0, 10); }).filter(Boolean);
      historyTrend.textContent = entries.length + " observation(s); latest " + (dates[dates.length - 1] || "unknown") + ". Recent points: " + dates.join(" → ") + ".";
    }
  }

  function applyHealth(payload, history) {
    const value = ["healthy", "warning", "blocked"].includes(payload.status) ? payload.status : "warning";
    status.textContent = value.charAt(0).toUpperCase() + value.slice(1);
    status.dataset.status = value;
    const issueCount = Array.isArray(payload.issues) ? payload.issues.length : 0;
    detail.textContent = issueCount ? issueCount + " operational issue(s); see report." : "Operational data and workflows are healthy. Manual decision only.";
    if (watchlist) watchlist.textContent = payload.watchlist && payload.watchlist.status === "ready" ? "Fallback ready" : "Degraded";
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
      status.textContent = "Warning";
      status.dataset.status = "warning";
      detail.textContent = "Health report unavailable; use manual review.";
      if (watchlist) watchlist.textContent = "Unknown";
      renderHistory({ entries: [] });
      window.dispatchEvent(new CustomEvent("project-health:loaded", { detail: { report: null, history: { entries: [] } } }));
    });

  window.addEventListener("watchlist:data-status", function (event) {
    if (!watchlist || !event.detail) return;
    const sources = event.detail.sources || {};
    const labels = Object.keys(sources).map(function (source) { return source + " " + sources[source]; });
    watchlist.textContent = labels.length ? labels.join(" / ") : "Unavailable";
  });
})();
