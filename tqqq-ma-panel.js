(function (root) {
  "use strict";
  if (root.TqqqMaPanel) return;
  const view = document.getElementById("view-tqqq");
  if (!view || !root.TqqqMaSignal) return;
  const Signal = root.TqqqMaSignal;
  const DATA_PATH = "data/tqqq-ma-daily-v1.json";
  const byId = (id) => document.getElementById(id);
  const status = byId("tqqqMaStatus");
  const refresh = byId("tqqqMaRefresh");
  const opt = Signal.DEFAULTS;
  let started = false;
  let busy = false;
  let prefilled = false;

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  const f2 = (value) => (Number.isFinite(value) ? value.toFixed(2) : "—");
  const f1 = (value) => (Number.isFinite(value) ? value.toFixed(1) : "—");
  const share = (value) => (Math.round(value * 10000) / 100).toString() + "%";
  const signed = (value) =>
    Number.isFinite(value) ? (value >= 0 ? "+" : "−") + Math.abs(value).toFixed(1) + "%" : "—";
  const ZONE_TEXT = { above: "在买入线上方", below: "在卖出线下方", between: "两线之间" };

  function setStatus(message, state = "ready") {
    status.textContent = message;
    status.dataset.state = state;
  }

  // One headline and one sentence; never an order.
  function verdict(result) {
    const current = result.current;
    if (result.freshness.stale)
      return ["stale", "数据已过期", "请先重新读取，或用下面的手动计算，暂不据此判断。"];
    if (current.state === "hold") {
      if (current.signalToday)
        return ["buy", "买入", "最新收盘触发买入信号，按规则在下一个交易日买入 TQQQ；是否操作由你自行决定。"];
      return [
        "hold",
        "不操作 · 继续持有",
        "SPY 离卖出线还有 " + f1(current.spy.toSellPct) + "%，QQQ 还有 " + f1(current.qqq.toSellPct) + "%。上次买入信号：" + current.since + "。",
      ];
    }
    if (current.signalToday)
      return ["sell", "卖出", "最新收盘触发卖出信号，按规则在下一个交易日清仓 TQQQ；是否操作由你自行决定。"];
    const parts = [
      current.spy.toBuyPct > 0 ? "SPY 还要涨 " + f1(current.spy.toBuyPct) + "%" : "SPY 已在买入线上方",
      current.qqq.toBuyPct > 0 ? "QQQ 还要涨 " + f1(current.qqq.toBuyPct) + "%" : "QQQ 已在买入线上方",
    ];
    return [
      "wait",
      "不操作 · 空仓等待",
      parts.join("，") + "。" + (current.since ? "上次卖出信号：" + current.since + "。" : "历史区间内尚无买入信号。"),
    ];
  }

  function ruler(symbol, side) {
    const low = -10;
    const high = 12;
    const pos = (x) => Math.max(0, Math.min(100, ((x - low) / (high - low)) * 100));
    const box = node("div", "tqqq-ma-ruler");
    const head = node("div", "tqqq-ma-ruler-head");
    const left = node("span");
    left.append(node("b", "", symbol), "收盘 " + f2(side.close) + "　均线 " + f2(side.ma200));
    head.append(left, node("span", "", ZONE_TEXT[side.zone]));
    const bar = node("div", "tqqq-ma-bar");
    const sell = node("div", "tqqq-ma-zone");
    sell.dataset.side = "sell";
    sell.style.width = pos(opt.sellPct) + "%";
    const buy = node("div", "tqqq-ma-zone");
    buy.dataset.side = "buy";
    buy.style.width = 100 - pos(opt.buyPct) + "%";
    bar.append(sell, buy);
    for (const [kind, x, label] of [
      ["sell", opt.sellPct, "卖出 −" + Math.abs(opt.sellPct) + "%"],
      ["mid", 0, "均线"],
      ["buy", opt.buyPct, "买入 +" + opt.buyPct + "%"],
    ]) {
      const tick = node("div", "tqqq-ma-tick");
      tick.dataset.side = kind;
      tick.style.left = pos(x) + "%";
      tick.append(node("span", "", label));
      bar.append(tick);
    }
    const mark = node("div", "tqqq-ma-mark", signed(side.pct));
    mark.dataset.symbol = symbol;
    mark.style.left = pos(side.pct) + "%";
    bar.append(mark);
    box.append(head, bar);
    return box;
  }

  function chart(history) {
    const NS = "http://www.w3.org/2000/svg";
    const W = 800, H = 300, L = 40, R = 46, T = 14, B = 26;
    const n = history.length;
    const spy = history.map((row) => row.spyPct);
    const qqq = history.map((row) => row.qqqPct);
    const all = spy.concat(qqq, [opt.buyPct, opt.sellPct]);
    const lo = Math.floor(Math.min(...all) - 1);
    const hi = Math.ceil(Math.max(...all) + 1);
    const x = (i) => L + ((W - L - R) * i) / (n - 1);
    const y = (v) => T + ((H - T - B) * (hi - v)) / (hi - lo);
    const make = (tag, attrs, text) => {
      const element = document.createElementNS(NS, tag);
      for (const key of Object.keys(attrs)) element.setAttribute(key, String(attrs[key]));
      if (text !== undefined) element.textContent = text;
      return element;
    };
    const svg = make("svg", {
      viewBox: "0 0 " + W + " " + H,
      class: "tqqq-ma-chart",
      role: "img",
      "aria-label":
        "SPY 和 QQQ 收盘价相对各自 200 日均线的偏离百分比，" + history[0].date + " 至 " + history[n - 1].date +
        "；最新 SPY " + signed(spy[n - 1]) + "，QQQ " + signed(qqq[n - 1]),
    });
    const step = hi - lo > 24 ? 10 : 5;
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      const grid = make("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "tqqq-ma-grid" });
      if (v === 0) grid.setAttribute("data-zero", "");
      svg.append(grid, make("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end" }, String(v)));
    }
    svg.append(
      make("line", { x1: L, x2: W - R, y1: y(opt.buyPct), y2: y(opt.buyPct), class: "tqqq-ma-line-buy" }),
      make("line", { x1: L, x2: W - R, y1: y(opt.sellPct), y2: y(opt.sellPct), class: "tqqq-ma-line-sell" }),
    );
    const months = new Map();
    history.forEach((row, i) => {
      const key = row.date.slice(0, 7);
      if (!months.has(key)) months.set(key, i);
    });
    [...months.entries()].forEach(([key, i], j) => {
      if (i < 8 || j % 2) return;
      svg.append(make("text", { x: x(i), y: H - 8, "text-anchor": "middle" }, key.slice(2).replace("-", "/")));
    });
    const points = (values) => values.map((v, i) => x(i).toFixed(1) + "," + y(v).toFixed(1)).join(" ");
    let ySpy = y(spy[n - 1]);
    let yQqq = y(qqq[n - 1]);
    if (Math.abs(ySpy - yQqq) < 13) {
      if (ySpy < yQqq) { ySpy -= 6; yQqq += 6; } else { ySpy += 6; yQqq -= 6; }
    }
    svg.append(
      make("polyline", { points: points(qqq), class: "tqqq-ma-line-qqq" }),
      make("polyline", { points: points(spy), class: "tqqq-ma-line-spy" }),
      make("text", { x: W - R + 7, y: ySpy + 4, class: "tqqq-ma-end-spy" }, f1(spy[n - 1])),
      make("text", { x: W - R + 7, y: yQqq + 4, class: "tqqq-ma-end-qqq" }, f1(qqq[n - 1])),
    );
    return svg;
  }

  function render(result) {
    const current = result.current;
    const [kind, headline, sentence] = verdict(result);
    const card = byId("tqqqMaVerdict");
    card.dataset.verdict = kind;
    byId("tqqqMaVerdictLabel").textContent = headline;
    byId("tqqqMaVerdictText").textContent = sentence;

    byId("tqqqMaRulers").replaceChildren(ruler("SPY", current.spy), ruler("QQQ", current.qqq));

    byId("tqqqMaLevels").replaceChildren(
      ...[["SPY", current.spy], ["QQQ", current.qqq]].map(([symbol, side]) => {
        const row = node("tr");
        row.append(node("th", "", symbol));
        row.firstChild.scope = "row";
        for (const value of [side.close, side.ma200, side.sellLine, side.buyLine]) row.append(node("td", "", f2(value)));
        return row;
      }),
    );
    byId("tqqqMaHeat").textContent =
      "QQQ 过热线（仅显示价位，不计入买卖状态）：减半仓 " + f2(current.heat.halfLine) + "（+" + opt.heatHalfPct + "%），清仓 " +
      f2(current.heat.exitLine) + "（+" + opt.heatExitPct + "%）。现在是 " + signed(current.qqq.pct) +
      (current.heat.state === "exit" ? "，已到清仓线。" : current.heat.state === "half" ? "，已到减仓线。" : "。");

    byId("tqqqMaChart").replaceChildren(chart(result.history));

    if (!prefilled) {
      prefilled = true;
      byId("tqqqMaSpyClose").value = current.spy.close;
      byId("tqqqMaSpyMa").value = f2(current.spy.ma200);
      byId("tqqqMaQqqClose").value = current.qqq.close;
      byId("tqqqMaQqqMa").value = f2(current.qqq.ma200);
      calc();
    }

    if (result.freshness.stale)
      setStatus(
        "数据截至 " + current.asof + " 收盘，已是 " + result.freshness.ageDays + " 天前，信号可能已经变了。请重新读取或用手动计算。",
        "error",
      );
    else setStatus("数据截至 " + current.asof + " 收盘 · 来源 Yahoo Finance（SPY、QQQ 日线，非实时）");
  }

  function calc() {
    const read = (id) => parseFloat(byId(id).value);
    const out = byId("tqqqMaCalcOut");
    const result = Signal.manual({
      spyClose: read("tqqqMaSpyClose"),
      spyMa: read("tqqqMaSpyMa"),
      qqqClose: read("tqqqMaQqqClose"),
      qqqMa: read("tqqqMaQqqMa"),
    });
    const zone = { above: "高于买入线", below: "低于卖出线", between: "两线之间" };
    if (!result.spy) {
      out.textContent = "填入 SPY 收盘和均线后显示结果。";
      return;
    }
    let text = "SPY " + signed(result.spy.pct) + "，" + zone[result.spy.zone] + "。";
    if (!result.qqq) {
      out.textContent = text + " 再填入 QQQ 的两个数后给出结论。";
      return;
    }
    text += " QQQ " + signed(result.qqq.pct) + "，" + zone[result.qqq.zone] + "。";
    out.textContent =
      text + " 结论：" +
      (result.verdict === "buy" ? "买入或继续持有。" : result.verdict === "sell" ? "卖出或继续空仓。" : "不操作，保持上一次信号后的状态。");
  }

  async function load() {
    if (busy) return;
    busy = true;
    refresh.disabled = true;
    refresh.setAttribute("aria-busy", "true");
    setStatus("正在读取 SPY、QQQ 日线数据…", "loading");
    try {
      if (!root.LiveData || typeof root.LiveData.fetch !== "function")
        throw new Error("数据发布读取模块不可用");
      const response = await root.LiveData.fetch(DATA_PATH, { cache: "no-cache" });
      if (!response.ok) throw new Error("SPY、QQQ 日线读取失败（HTTP " + response.status + "）。手动计算仍然可用。");
      render(Signal.fromSnapshot(await response.json(), new Date()));
      byId("tqqqMaContent").hidden = false;
      // On narrow screens the chart scrolls sideways; start at the latest data.
      const scroller = byId("tqqqMaChart");
      scroller.scrollLeft = scroller.scrollWidth;
    } catch (error) {
      setStatus((error && error.message) || "SPY、QQQ 日线读取失败。手动计算仍然可用。", "error");
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

  // Position cap: fixed guidance from the plan constants, shown with or without data.
  function renderPlan() {
    const plan = Signal.plan();
    const item = (label, value, note) => {
      const box = node("div", "tqqq-ma-plan-item");
      box.append(node("span", "", label), node("strong", "", value), node("small", "", note));
      return box;
    };
    byId("tqqqMaPlan").replaceChildren(
      item(
        "TQQQ 预算上限",
        "总资产的 " + share(plan.budgetCap),
        "总资产最多亏 " + share(plan.lossLimit) + " ÷ 回测最大回撤 " + share(plan.referenceDrawdown) + "，向下取整",
      ),
      item("规则持有时", "TQQQ 最多占总资产 " + share(plan.budgetCap), "预算全部为 TQQQ"),
      item("规则空仓时", "TQQQ 占总资产 0%", "预算全部为现金"),
    );
    byId("tqqqMaPlanNote").textContent =
      "上限按含 2000 年模拟历史的最大回撤反推；只按 2010 年以来的真实历史（回撤 " + share(plan.realDrawdown) + "）算约为总资产的 " +
      share(plan.realHistoryBudgetCap) + "。未来回撤可能更深，股票也可能同时下跌；这个上限与虚拟货币的上限各自独立计算。本页不读取你的账户，比例需自行核对。";
  }
  renderPlan();

  const form = byId("tqqqMaCalc");
  form.addEventListener("input", calc);
  form.addEventListener("submit", (event) => event.preventDefault());
  calc();
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
    if (event.detail && event.detail.view === "tqqq") start();
  });
  if (!view.hidden) start();
  root.TqqqMaPanel = { load };
})(window);
