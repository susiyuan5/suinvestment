(function (root) {
  "use strict";
  if (root.BtcTrendPanel) return;
  const view = document.getElementById("view-crypto");
  if (!view || !root.BtcTrendSignal) return;
  const DATA_PATH = "data/btc-weekly-v1.json";
  const CHART_WEEKS = 104;
  const byId = (id) => document.getElementById(id);
  const status = byId("btcTrendStatus");
  const refresh = byId("btcTrendRefresh");
  let started = false;
  let busy = false;

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function usd(value) {
    return Number.isFinite(value)
      ? "$" + value.toLocaleString("en-US", { maximumFractionDigits: 0 })
      : "—";
  }
  function pct(value) {
    return Number.isFinite(value)
      ? (value > 0 ? "+" : "") + value.toFixed(1) + "%"
      : "—";
  }
  function setStatus(message, state = "ready") {
    status.textContent = message;
    status.dataset.state = state;
  }
  function metric(label, value, note) {
    const item = node("div", "btc-trend-metric");
    item.append(node("span", "", label), node("strong", "", value));
    if (note) item.append(node("small", "", note));
    return item;
  }

  function renderChart(rows) {
    const svgNS = "http://www.w3.org/2000/svg";
    const slice = rows.slice(-CHART_WEEKS);
    const width = 640;
    const height = 220;
    const pad = 8;
    const values = slice.flatMap((row) => [row.close, row.ma]);
    const min = Math.log(Math.min(...values));
    const max = Math.log(Math.max(...values));
    const x = (i) => pad + (i * (width - 2 * pad)) / Math.max(1, slice.length - 1);
    const y = (v) =>
      height - pad - ((Math.log(v) - min) * (height - 2 * pad)) / Math.max(1e-9, max - min);
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("class", "btc-trend-chart");
    svg.setAttribute("role", "img");
    const first = slice[0];
    const last = slice[slice.length - 1];
    svg.setAttribute(
      "aria-label",
      "最近 " + slice.length + " 周 BTC 收盘与 20 周均线，" + first.weekEnd + " 至 " + last.weekEnd + "，对数坐标",
    );
    // Shade weeks held by the rule.
    slice.forEach((row, i) => {
      if (row.position !== 1) return;
      const rect = document.createElementNS(svgNS, "rect");
      const step = (width - 2 * pad) / Math.max(1, slice.length - 1);
      rect.setAttribute("x", String(x(i) - step / 2));
      rect.setAttribute("y", "0");
      rect.setAttribute("width", String(step));
      rect.setAttribute("height", String(height));
      rect.setAttribute("class", "btc-trend-held");
      svg.append(rect);
    });
    for (const [key, cls] of [["ma", "btc-trend-line-ma"], ["close", "btc-trend-line-close"]]) {
      const line = document.createElementNS(svgNS, "polyline");
      line.setAttribute(
        "points",
        slice.map((row, i) => x(i).toFixed(1) + "," + y(row[key]).toFixed(1)).join(" "),
      );
      line.setAttribute("class", cls);
      svg.append(line);
    }
    const figure = node("figure", "btc-trend-figure");
    const legend = node("figcaption", "btc-trend-legend");
    legend.append(
      node("span", "btc-trend-key-close", "周收盘"),
      node("span", "btc-trend-key-ma", "20 周均线"),
      node("span", "btc-trend-key-held", "规则持有区间"),
      node("span", "", first.weekEnd + " — " + last.weekEnd + " · 对数坐标"),
    );
    figure.append(svg, legend);
    return figure;
  }

  function render(result) {
    const current = result.current;
    const holding = current.state === "holding";
    const since = current.lastTransition ? current.lastTransition.weekEnd : null;
    const card = byId("btcTrendState");
    card.dataset.state = current.state;
    byId("btcTrendStateLabel").textContent = holding ? "持有" : "空仓";
    byId("btcTrendStateSince").textContent = since
      ? (holding ? "自 " + since + " 周收盘起记为持有" : "自 " + since + " 周收盘起记为空仓")
      : "历史区间内尚无切换";

    const metrics = byId("btcTrendMetrics");
    metrics.replaceChildren(
      metric("最新完整周收盘", usd(current.close), "截至 " + current.weekEnd + "（UTC 周日）"),
      metric("20 周均线", usd(current.ma), "距均线 " + pct(current.distancePct)),
      metric(
        current.aboveStreak ? "连续站上" : "连续跌破",
        (current.aboveStreak || current.belowStreak) + " 周",
        "按完整周收盘计数",
      ),
    );

    const next = result.nextStep;
    const nextText = byId("btcTrendNext");
    if (next.kind === "exit-watch") {
      nextText.textContent =
        "下一个完整周收盘若低于 " + usd(next.price) + "（届时也会低于更新后的 20 周均线），规则将转为空仓。";
    } else if (next.weeksNeeded > 1) {
      nextText.textContent =
        "需要连续 " + next.weeksNeeded + " 个完整周收盘高于 20 周均线才转为持有；下一周的门槛约为 " + usd(next.price) + "。";
    } else {
      nextText.textContent =
        "下一个完整周收盘若高于 " + usd(next.price) + "，将满足连续 2 周站上，规则转为持有。";
    }

    const partial = byId("btcTrendPartial");
    partial.textContent = result.partial
      ? "本周（至 " + result.partial.week_end + "）进行中，最近日线 " + result.partial.date + " 收盘 " + usd(result.partial.close) + "；未收盘的周不参与判断。"
      : "当前没有进行中的周数据。";

    byId("btcTrendChartWrap").replaceChildren(renderChart(result.rows));

    const list = byId("btcTrendHistory");
    const items = result.transitions.slice(-8).reverse();
    list.replaceChildren(
      ...items.map((row) => {
        const item = node("li", "btc-trend-event");
        item.dataset.event = row.event;
        item.append(
          node("span", "", row.weekEnd),
          node("strong", "", row.event === "enter" ? "转为持有" : "转为空仓"),
          node("span", "", "收盘 " + usd(row.close) + " · 均线 " + usd(row.ma)),
        );
        return item;
      }),
    );

    const age = result.freshness.ageDays;
    if (result.freshness.stale)
      setStatus(
        "BTC 周线数据已过期（最新完整周 " + current.weekEnd + "，已过 " + age + " 天），请勿据此判断。",
        "error",
      );
    else
      setStatus(
        "数据 " + (result.generatedAt || "时间未知") + " 生成 · 最新完整周 " + current.weekEnd + " · 来源 Yahoo Finance（UTC 周线）",
      );
  }

  async function load() {
    if (busy) return;
    busy = true;
    refresh.disabled = true;
    refresh.setAttribute("aria-busy", "true");
    setStatus("正在读取 BTC 周线数据…", "loading");
    try {
      if (!root.LiveData || typeof root.LiveData.fetch !== "function")
        throw new Error("数据发布读取模块不可用");
      const response = await root.LiveData.fetch(DATA_PATH, { cache: "no-cache" });
      if (!response.ok) throw new Error("BTC 周线读取失败（HTTP " + response.status + "）");
      const snapshot = await response.json();
      render(root.BtcTrendSignal.fromSnapshot(snapshot, new Date()));
      byId("btcTrendContent").hidden = false;
    } catch (error) {
      setStatus((error && error.message) || "BTC 周线读取失败", "error");
    } finally {
      busy = false;
      refresh.disabled = false;
      refresh.setAttribute("aria-busy", "false");
    }
  }

  function start() {
    if (started) return;
    started = true;
    load();
  }

  refresh.addEventListener("click", async () => {
    if (root.LiveData && typeof root.LiveData.refresh === "function") {
      try {
        await root.LiveData.refresh();
      } catch (error) {
        // status already reported by LiveData; still try to read
      }
    }
    started = true;
    load();
  });
  root.addEventListener("workspace:view-changed", (event) => {
    if (event.detail && event.detail.view === "crypto") start();
  });
  if (!view.hidden) start();
  root.BtcTrendPanel = { load };
})(window);
