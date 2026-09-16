(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory;
  else
    root.LiveData = factory({
      fetch: root.fetch.bind(root),
      document: root.document,
    });
})(typeof globalThis !== "undefined" ? globalThis : this, function (options) {
  "use strict";
  const origin = "https://raw.githubusercontent.com/susiyuan5/suinvestment/";
  const nativeFetch = options.fetch;
  const timeoutMs = options.timeoutMs || 12000;
  const patterns = [
    "results/",
    "research/results/",
    "data/research-universe/v2/",
    "data/idea-engine-v3/",
  ];
  const files = new Set([
    "data/market-data.json",
    "data/backtest-prices.json",
    "data/v2/backtest-adjusted-daily.json",
    "data/short-term-daily-bars-v1.json",
    "data/us-equity-search-index.json",
    "data/idea-engine-events-v1.json",
    "data/research-refresh-status.json",
    "data/research-prices-sector-balanced-80.json",
    "data/private/wealthsimple-holdings.enc.json",
  ]);
  [
    "data/backtest-daily-prices.json",
    "data/research-prices.json",
    "data/dip-warmup-daily.json",
  ].forEach((path) => files.add(path));
  let current;
  let active;
  let count = 0;
  function priceUpdateSummary(report) {
    if (
      !report ||
      !["published", "skipped"].includes(report.publishStatus) ||
      !report.generatedAt
    )
      return "行情检查报告不可用；行情时间以各面板为准";
    const result =
      report.publishStatus === "published"
        ? "行情已替换"
        : "行情未替换，保留此前快照（未通过来源或时效校验）";
    return "行情检查 " + report.generatedAt + " · " + result;
  }
  function pathOf(input) {
    const value = String(input).replace(/^\.\//, "").split(/[?#]/)[0];
    return !value.includes("..") &&
      (files.has(value) || patterns.some((p) => value.startsWith(p)))
      ? value
      : null;
  }
  async function request(url, init = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (init.signal) {
      if (init.signal.aborted) abort();
      else init.signal.addEventListener("abort", abort, { once: true });
    }
    const timer = setTimeout(abort, timeoutMs);
    try {
      const response = await nativeFetch(url, {
        ...init,
        signal: controller.signal,
      });
      // Buffer under the timeout too; parsing happens after the complete response.
      const bytes = await response.arrayBuffer();
      return new Response(bytes, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } finally {
      clearTimeout(timer);
      if (init.signal) init.signal.removeEventListener("abort", abort);
    }
  }
  function status(message, failed = false) {
    const doc = options.document;
    if (!doc || !doc.body) return;
    let node = doc.getElementById("liveDataStatus");
    if (!node) {
      node = doc.createElement("p");
      node.id = "liveDataStatus";
      node.setAttribute("role", "status");
      doc.body.prepend(node);
    }
    node.textContent = message;
    node.dataset.failed = String(failed);
  }
  function links(session) {
    const doc = options.document;
    if (!doc) return;
    doc.querySelectorAll("a[href]").forEach((node) => {
      const original = node.dataset.liveDataPath || node.getAttribute("href");
      if (pathOf(original)) {
        node.dataset.liveDataPath = original;
        node.href = session.url(original);
      }
    });
  }
  function newSession() {
    const manifestPromise = request(
      origin +
        "live-data/live-data-manifest.json?refresh=" +
        Date.now() +
        "-" +
        ++count,
      { cache: "no-store" },
    ).then(async (response) => {
      if (!response.ok)
        throw new Error("数据发布清单读取失败：HTTP " + response.status);
      const manifest = await response.json();
      if (
        manifest.formatVersion !== 1 ||
        !/^[a-f0-9]{40}$/.test(manifest.dataCommit) ||
        !/^[a-f0-9]{40}$/.test(manifest.codeCommit) ||
        !Number.isFinite(Date.parse(manifest.publishedAt))
      )
        throw new Error("数据发布清单格式不兼容");
      return Object.freeze(manifest);
    });
    let manifest;
    const session = {
      ready: manifestPromise.then((value) => {
        manifest = value;
        return session;
      }),
      get manifest() {
        return manifest;
      },
      url(path) {
        const clean = pathOf(path);
        return clean ? origin + manifest.dataCommit + "/" + clean : path;
      },
      async fetch(path, init) {
        if (!pathOf(path)) return nativeFetch(path, init);
        await session.ready;
        try {
          const response = await request(session.url(path), init);
          if (!response.ok)
            status(
              "部分数据读取失败：" +
                pathOf(path) +
                "（HTTP " +
                response.status +
                "），请检查数据质量。",
              true,
            );
          return response;
        } catch (error) {
          status(
            "数据读取失败：" +
              pathOf(path) +
              "；保留的显示可能是旧数据，请刷新重试。",
            true,
          );
          throw error;
        }
      },
    };
    session.ready
      .then(() => {
        if (current !== session) return;
        status(
          "数据版本 " +
            manifest.dataCommit.slice(0, 7) +
            " · 发布 " +
            manifest.publishedAt +
            " · 行情时间以各面板为准",
        );
        links(session);
        if (options.document) {
          request(
            session.url("results/data_freshness/market_price_freshness.json"),
            { cache: "no-cache" },
          )
            .then((response) => (response.ok ? response.json() : null))
            .catch(() => null)
            .then((report) => {
              if (
                current !== session ||
                options.document.getElementById("liveDataStatus")?.dataset
                  .failed === "true"
              )
                return;
              status(
                "数据清单 " +
                  manifest.dataCommit.slice(0, 7) +
                  " · " +
                  priceUpdateSummary(report),
              );
            });
        }
      })
      .catch((error) =>
        status(error.message + "；未使用页面附带的旧快照。", true),
      );
    return session;
  }
  function session() {
    if (!current) current = newSession();
    return current;
  }
  function refresh() {
    if (active) return active;
    current = newSession();
    active = current.ready.finally(() => {
      active = null;
    });
    return active;
  }
  if (options.document && typeof MutationObserver !== "undefined") {
    new MutationObserver(() => {
      if (current && current.manifest) links(current);
    }).observe(options.document.body, { childList: true, subtree: true });
  }
  return {
    priceUpdateSummary,
    session,
    refresh,
    pathOf,
    fetch: (path, init) => session().fetch(path, init),
  };
});
