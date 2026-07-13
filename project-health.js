(function () {
  "use strict";
  const status = document.getElementById("projectHealthStatus");
  const detail = document.getElementById("projectHealthDetails");
  const watchlist = document.getElementById("watchlistHealthStatus");
  if (!status || !detail) return;
  fetch("results/health/project-health.json", { cache: "no-cache" })
    .then(function (response) { if (!response.ok) throw new Error("health report unavailable"); return response.json(); })
    .then(function (payload) {
      const value = ["healthy", "warning", "blocked"].includes(payload.status) ? payload.status : "warning";
      status.textContent = value.charAt(0).toUpperCase() + value.slice(1);
      status.dataset.status = value;
      const issueCount = Array.isArray(payload.issues) ? payload.issues.length : 0;
      detail.textContent = issueCount ? issueCount + " operational issue(s); see report." : "Operational data and workflows are healthy. Manual decision only.";
      if (watchlist) watchlist.textContent = payload.watchlist && payload.watchlist.status === "ready" ? "Fallback ready" : "Degraded";
    })
    .catch(function () {
      status.textContent = "Warning";
      status.dataset.status = "warning";
      detail.textContent = "Health report unavailable; use manual review.";
      if (watchlist) watchlist.textContent = "Unknown";
    });

  window.addEventListener("watchlist:data-status", function (event) {
    if (!watchlist || !event.detail) return;
    const sources = event.detail.sources || {};
    const labels = Object.keys(sources).map(function (source) { return source + " " + sources[source]; });
    watchlist.textContent = labels.length ? labels.join(" / ") : "Unavailable";
  });
})();
