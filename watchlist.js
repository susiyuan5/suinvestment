(function () {
  "use strict";

  const KEY = "su-investment-pro:watchlist";
  const NAMES = { AAPL: "Apple Inc.", MSFT: "Microsoft Corporation", NVDA: "NVIDIA Corporation", TSLA: "Tesla, Inc.", AMZN: "Amazon.com, Inc.", GOOGL: "Alphabet Inc.", META: "Meta Platforms, Inc.", AMD: "Advanced Micro Devices, Inc.", QQQ: "Invesco QQQ Trust", SPY: "SPDR S&P 500 ETF Trust" };
  const state = {
    symbols: loadSymbols(), active: "AAPL", period: "1y", quotes: {}, series: {}, timer: null,
    chartIndicators: null, activeRequestId: 0, activeController: null, refreshPromise: null,
    backtestPricesPromise: null
  };
  const $ = (id) => document.getElementById(id);
  const els = { ticker: $("watchlistTickerStrip"), cards: $("watchlistCards"), insight: $("watchlistInsight"), form: $("watchlistAddForm"), input: $("watchlistSymbolInput"), status: $("watchlistFormStatus"), symbol: $("watchlistActiveSymbol"), name: $("watchlistCompanyName"), meta: $("watchlistQuoteMeta"), price: $("watchlistPrice"), change: $("watchlistChange"), auto: $("watchlistAutoRefresh"), rate: $("watchlistRefreshRate"), refresh: $("watchlistRefreshBtn"), periods: $("watchlistPeriods"), loading: $("watchlistChartLoading"), plot: $("watchlistChartPlot"), tooltip: $("watchlistChartTooltip"), priceCanvas: $("watchlistPriceChart"), macdCanvas: $("watchlistMacdChart"), caption: $("watchlistChartCaption"), accessibleSummary: $("watchlistChartSummary") };
  if (!els.cards) return;

  function loadSymbols() { try { const value = JSON.parse(localStorage.getItem(KEY)); if (Array.isArray(value) && value.length) return value.slice(0, 8); } catch (_) {} return ["AAPL", "MSFT", "NVDA", "QQQ"]; }
  function save() { localStorage.setItem(KEY, JSON.stringify(state.symbols)); }
  function esc(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
  function fmt(value) { return Number.isFinite(value) ? value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "--"; }
  function signed(value) { return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%` : "--"; }

  function renderCards() {
    els.cards.innerHTML = state.symbols.map((symbol) => {
      const quote = state.quotes[symbol] || {};
      const tone = quote.change >= 0 ? "positive" : "negative";
      const index = state.symbols.indexOf(symbol);
      return `<article class="ws-card ${symbol === state.active ? "active" : ""}"><button class="ws-card-select" data-symbol="${esc(symbol)}" type="button" aria-pressed="${symbol === state.active}"><span class="ws-card-sym"><strong>${esc(symbol)}</strong><span class="ws-card-cur">USD</span></span><span><strong class="ws-card-pr">${fmt(quote.price)}</strong><span class="ws-card-ch ${tone === "positive" ? "pos" : "neg"}">${signed(quote.change)}</span></span></button><span class="ws-card-actions"><button data-move="up" data-target="${esc(symbol)}" type="button" ${index === 0 ? "disabled" : ""}>上移</button><button data-move="down" data-target="${esc(symbol)}" type="button" ${index === state.symbols.length - 1 ? "disabled" : ""}>下移</button><button class="ws-card-rm" data-remove="${esc(symbol)}" type="button">删除</button></span></article>`;
    }).join("");
  }

  
  function renderTicker() {
    els.ticker.innerHTML = state.symbols.map(function (symbol) {
      const quote = state.quotes[symbol] || {};
      const tone = (quote.change >= 0) ? "pos" : "neg";
      const price = Number.isFinite(quote.price) ? quote.price.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}) : "--";
      const change = Number.isFinite(quote.change) ? (quote.change >= 0 ? "+" : "") + quote.change.toFixed(2) + "%" : "--";
      return "<button type=\"button\" class=\"ws-ticker-item " + (symbol === state.active ? "active" : "") + "\" data-symbol=\"" + esc(symbol) + "\" aria-pressed=\"" + (symbol === state.active) + "\"><span class=\"ws-tick-sym\">" + esc(symbol) + "</span><span class=\"ws-tick-pr\">" + price + "</span><span class=\"ws-tick-ch " + tone + "\">" + change + "</span></button>";
    }).join("");
  }

  function renderInsight() {
    const active = state.active;
    const quote = state.quotes[active] || {};
    const indicators = state.chartIndicators || {};
    const rows = indicators.rows || [];
    const lastIdx = rows.length - 1;
    const haveIndicators = indicators.macd && indicators.macd.length > 0;
    const val = function (v) { return Number.isFinite(v) ? v.toFixed(4) : "--"; };

    var html = "";

    if (active && quote.price) {
      var tone = Number.isFinite(quote.change) ? (quote.change >= 0 ? "pos" : "neg") : "";
      html += "<div class=\"ws-insight-card\">";
      html += "<h4>摘要 / Summary</h4>";
      html += "<div class=\"ws-insight-row\"><span class=\"ws-ir-label\">代码</span><span class=\"ws-ir-value\">" + esc(active) + "</span></div>";
      html += "<div class=\"ws-insight-row\"><span class=\"ws-ir-label\">价格</span><span class=\"ws-ir-value\">" + fmt(quote.price) + " USD</span></div>";
      if (Number.isFinite(quote.change)) {
        html += "<div class=\"ws-insight-row\"><span class=\"ws-ir-label\">涨跌</span><span class=\"ws-ir-value " + tone + "\">" + (quote.change >= 0 ? "+" : "") + quote.change.toFixed(2) + "%</span></div>";
      }
      html += "</div>";
    }

    if (haveIndicators && indicators.macd[lastIdx] !== undefined) {
      html += "<div class=\"ws-insight-card\">";
      html += "<h4>MACD 指标</h4>";
      html += "<div class=\"ws-insight-row\"><span class=\"ws-ir-label\">MACD</span><span class=\"ws-ir-value\">" + val(indicators.macd[lastIdx]) + "</span></div>";
      html += "<div class=\"ws-insight-row\"><span class=\"ws-ir-label\">信号线</span><span class=\"ws-ir-value\">" + val(indicators.signal[lastIdx]) + "</span></div>";
      html += "<div class=\"ws-insight-row\"><span class=\"ws-ir-label\">柱状图</span><span class=\"ws-ir-value\">" + val(indicators.histogram[lastIdx]) + "</span></div>";
      var macdTone = indicators.macd[lastIdx] >= 0 ? "pos" : "neg";
      html += "<div class=\"ws-insight-row\"><span class=\"ws-ir-label\">状态</span><span class=\"ws-ir-value " + macdTone + "\">" + (indicators.macd[lastIdx] >= 0 ? "偏强 / Bullish" : "偏弱 / Bearish") + "</span></div>";
      html += "</div>";
    }

    if (haveIndicators && indicators.macd.length > 1) {
      var trend = indicators.macd[lastIdx] > indicators.macd[lastIdx - 1] ? "增强" : "减弱";
      var trendEn = indicators.macd[lastIdx] > indicators.macd[lastIdx - 1] ? "Strengthening" : "Weakening";
      html += "<div class=\"ws-insight-card\">";
      html += "<h4>动量 / Momentum</h4>";
      html += "<p>" + trend + " / " + trendEn + "</p>";
      html += "</div>";
    }

    if (!html) {
      html = "<p class=\"ws-insight-empty\">数据不足，暂不生成指标摘要。</p>";
    }

    els.insight.innerHTML = html;
  }
function renderQuote() {
    const quote = state.quotes[state.active] || {};
    els.symbol.textContent = state.active;
    els.name.textContent = NAMES[state.active] || "美国上市证券";
    els.price.textContent = fmt(quote.price);
    els.change.textContent = signed(quote.change);
    els.change.className = Number.isFinite(quote.change) ? (quote.change >= 0 ? "pos" : "neg") : "";
    els.meta.textContent = quote.time ? `更新于 ${new Date(quote.time).toLocaleString("zh-CN")} / ${quote.source}` : "正在加载行情…";
  }

  async function getChart(symbol, period, signal) {
    const settings = { "1d": ["1d", "5m"], "5d": ["5d", "15m"], "3mo": ["3mo", "1d"], "1y": ["1y", "1d"], "5y": ["5y", "1wk"] }[period];
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${settings[0]}&interval=${settings[1]}&includePrePost=false`;
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error("Quote request failed");
    const json = await response.json();
    const result = json.chart && json.chart.result && json.chart.result[0];
    if (!result) throw new Error("No market data");
    const quote = result.indicators.quote[0];
    const close = result.indicators.adjclose ? result.indicators.adjclose[0].adjclose : quote.close;
    const rows = result.timestamp.map((time, index) => ({ time: time * 1000, open: quote.open[index], high: quote.high[index], low: quote.low[index], close: close[index] })).filter((row) => [row.open, row.high, row.low, row.close].every(Number.isFinite));
    return { rows, meta: result.meta };
  }

  async function getBacktestPrices() {
    if (!state.backtestPricesPromise) {
      state.backtestPricesPromise = fetch("data/backtest-prices.json", { cache: "force-cache" })
        .then((response) => {
          if (!response.ok) throw new Error("本地历史数据不可用");
          return response.json();
        })
        .catch((error) => {
          state.backtestPricesPromise = null;
          throw error;
        });
    }
    return state.backtestPricesPromise;
  }

  async function getFallback(symbol, period) {
    const json = await getBacktestPrices();
    const allRows = (json.symbols && json.symbols[symbol] || []).map((row) => ({ time: Date.parse(row.date), open: row.close, high: row.close, low: row.close, close: row.close }));
    if (!allRows.length) throw new Error("没有该股票的本地历史数据");
    const fallbackPoints = { "1d": 2, "5d": 6, "3mo": 14, "1y": 53, "5y": allRows.length };
    const rows = allRows.slice(-Math.min(fallbackPoints[period] || 53, allRows.length));
    return { rows, meta: { regularMarketPrice: allRows.at(-1).close, previousClose: allRows.at(-2)?.close } };
  }

  function clearActiveView(message) {
    state.series[state.active] = [];
    state.chartIndicators = null;
    els.priceCanvas.getContext("2d").clearRect(0, 0, els.priceCanvas.width, els.priceCanvas.height);
    els.macdCanvas.getContext("2d").clearRect(0, 0, els.macdCanvas.width, els.macdCanvas.height);
    els.insight.innerHTML = "<p class=\"ws-insight-empty\">" + esc(message) + "</p>";
    if (els.accessibleSummary) els.accessibleSummary.textContent = message;
  }

  async function loadActive() {
    const symbol = state.active;
    const period = state.period;
    const requestId = ++state.activeRequestId;
    if (state.activeController) state.activeController.abort();
    const controller = new AbortController();
    state.activeController = controller;
    els.loading.classList.remove("hidden");
    try {
      let data;
      let source = "Yahoo Finance";
      try { data = await getChart(symbol, period, controller.signal); } catch (error) {
        if (error.name === "AbortError") return;
        data = await getFallback(symbol, period);
        source = "本地周线历史";
      }
      if (requestId !== state.activeRequestId || symbol !== state.active || period !== state.period) return;
      state.series[symbol] = data.rows;
      const last = data.rows.at(-1);
      const previous = Number.isFinite(data.meta.chartPreviousClose) ? data.meta.chartPreviousClose : (Number.isFinite(data.meta.previousClose) ? data.meta.previousClose : data.rows.at(-2)?.close);
      const price = Number.isFinite(data.meta.regularMarketPrice) ? data.meta.regularMarketPrice : last.close;
      state.quotes[symbol] = { price, change: previous ? ((price - previous) / previous) * 100 : null, time: last.time, source };
      renderCards(); renderTicker(); renderQuote(); draw(); renderInsight();
      els.caption.textContent = `${symbol} / ${period.toUpperCase()} / ${data.rows.length} 个数据点`;
      if (els.accessibleSummary) els.accessibleSummary.textContent = `${symbol} ${period.toUpperCase()} 图表，${data.rows.length} 个数据点，最新收盘价 ${fmt(last.close)}。`;
    } catch (error) {
      if (error.name === "AbortError") return;
      if (requestId !== state.activeRequestId) return;
      els.meta.textContent = error.message;
      els.caption.textContent = "行情暂不可用，请稍后重试或选择其他股票。";
      clearActiveView("行情暂不可用，请稍后重试。");
    } finally { els.loading.classList.add("hidden"); }
  }

  async function refreshAll() {
    if (state.refreshPromise) return state.refreshPromise;
    els.refresh.disabled = true;
    state.refreshPromise = Promise.all(state.symbols.map(async (symbol) => {
      try {
        const data = await getChart(symbol, "5d"); const last = data.rows.at(-1); const previous = data.meta.chartPreviousClose || data.meta.previousClose || data.rows.at(-2)?.close; const price = data.meta.regularMarketPrice || last.close;
        state.quotes[symbol] = { price, change: previous ? ((price - previous) / previous) * 100 : null, time: last.time, source: "Yahoo Finance" };
      } catch (_) {
        try { const data = await getFallback(symbol, "5d"); const last = data.rows.at(-1); const previous = data.rows.at(-2)?.close; state.quotes[symbol] = { price: last.close, change: previous ? ((last.close - previous) / previous) * 100 : null, time: last.time, source: "本地周线历史" }; } catch (_) {}
      }
    })).then(() => {
      renderCards(); renderTicker(); renderQuote(); renderInsight();
    }).finally(() => {
      els.refresh.disabled = false;
      state.refreshPromise = null;
    });
    return state.refreshPromise;
  }

  function ema(values, length) { const factor = 2 / (length + 1); const out = []; let value = values[0]; values.forEach((item, index) => { value = index ? item * factor + value * (1 - factor) : item; out.push(value); }); return out; }
  function setup(canvas) { const rect = canvas.getBoundingClientRect(); const dpr = Math.min(devicePixelRatio || 1, 2); canvas.width = Math.max(1, rect.width * dpr); canvas.height = Math.max(1, rect.height * dpr); const context = canvas.getContext("2d"); context.setTransform(dpr, 0, 0, dpr, 0, 0); return { context, width: rect.width, height: rect.height }; }
  function grid(context, plotLeft, plotRight, height) {
    context.save();
    context.strokeStyle = "rgba(79, 103, 132, .24)";
    context.lineWidth = 1;
    for (let index = 1; index < 5; index += 1) {
      const y = index * height / 5;
      context.beginPath();
      context.moveTo(plotLeft, y);
      context.lineTo(plotRight, y);
      context.stroke();
    }
    context.restore();
  }
  function draw() { const rows = state.series[state.active] || []; if (rows.length < 2) return; drawPrice(rows); drawMacd(rows); }
  function drawPrice(rows) {
    const { context, width, height } = setup(els.priceCanvas);
    context.clearRect(0, 0, width, height);
    const plotLeft = 10;
    const plotRight = Math.max(plotLeft + 1, width - 58);
    const plotTop = 12;
    const plotBottom = height - 8;
    const values = rows.map((row) => row.close);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = (max - min) * 0.12 || Math.max(Math.abs(max) * 0.01, 1);
    const low = min - pad;
    const high = max + pad;
    const x = (index) => plotLeft + index * (plotRight - plotLeft) / (rows.length - 1);
    const y = (value) => plotTop + (high - value) * (plotBottom - plotTop) / (high - low);

    grid(context, plotLeft, plotRight, height);

    context.beginPath();
    rows.forEach((row, index) => {
      index ? context.lineTo(x(index), y(row.close)) : context.moveTo(x(index), y(row.close));
    });
    context.lineTo(plotRight, plotBottom);
    context.lineTo(plotLeft, plotBottom);
    context.closePath();
    const fill = context.createLinearGradient(0, plotTop, 0, plotBottom);
    fill.addColorStop(0, "rgba(62, 213, 155, .30)");
    fill.addColorStop(.65, "rgba(62, 213, 155, .10)");
    fill.addColorStop(1, "rgba(62, 213, 155, .015)");
    context.fillStyle = fill;
    context.fill();

    context.beginPath();
    rows.forEach((row, index) => {
      index ? context.lineTo(x(index), y(row.close)) : context.moveTo(x(index), y(row.close));
    });
    context.strokeStyle = "#3ed59b";
    context.lineWidth = 2;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.stroke();

    context.fillStyle = "#8391a5";
    context.font = "11px system-ui";
    context.textAlign = "right";
    context.textBaseline = "middle";
    for (let index = 1; index < 5; index += 1) {
      const value = high - (high - low) * index / 5;
      context.fillText(value.toFixed(2), width - 7, index * height / 5);
    }
  }
    function drawMacd(rows) {
    const { context, width, height } = setup(els.macdCanvas);
    context.clearRect(0, 0, width, height);
    const closes = rows.map((row) => row.close);
    const fast = ema(closes, 12);
    const slow = ema(closes, 26);
    const macd = fast.map((value, index) => value - slow[index]);
    const signal = ema(macd, 9);
    const histogram = macd.map((value, index) => value - signal[index]);
    const maxAbs = Math.max(...histogram.map(Math.abs), 0.0001);
    const yMin = -maxAbs * 1.15;
    const yMax = maxAbs * 1.15;
    const plotLeft = 6;
    const plotRight = Math.max(plotLeft + 1, width - 56);
    const x = (index) => plotLeft + index * (plotRight - plotLeft) / (rows.length - 1);
    const mapY = (value) => 8 + (yMax - value) * (height - 16) / (yMax - yMin);
    const chartWidth = plotRight - plotLeft;
    const barWidth = Math.max(3, chartWidth / rows.length * 0.5);
    const zeroY = mapY(0);

    context.strokeStyle = "rgba(131,145,165,.28)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(plotLeft, zeroY);
    context.lineTo(plotRight, zeroY);
    context.stroke();

    // Draw histogram bars
    histogram.forEach(function (value, index) {
      context.fillStyle = value >= 0 ? "rgba(62,213,155,.78)" : "rgba(255,111,127,.78)";
      const barY = mapY(value);
      context.fillRect(x(index) - barWidth / 2, Math.min(barY, zeroY), barWidth, Math.max(1, Math.abs(barY - zeroY)));
    });
    state.chartIndicators = { rows, macd, signal, histogram };
  }

function showChartTooltip(event) {
    const indicators = state.chartIndicators;
    if (!indicators || !indicators.rows.length) return;
    const plotRect2 = els.plot.getBoundingClientRect();
    const plotRect = els.plot.getBoundingClientRect();
    const localX = Math.max(0, Math.min(plotRect2.width, event.clientX - plotRect2.left));
    const index = Math.max(0, Math.min(indicators.rows.length - 1, Math.round((localX - 10) / Math.max(1, plotRect2.width - 62) * (indicators.rows.length - 1))));
    const row = indicators.rows[index];
    const formatValue = (value) => Number.isFinite(value) ? value.toFixed(4) : "--";
    els.tooltip.innerHTML = `<strong>${new Date(row.time).toLocaleDateString("zh-CN")}</strong>价格：${fmt(row.close)}<br>MACD 柱状值：${formatValue(indicators.histogram[index])}`;
    els.tooltip.classList.add("visible");
    const left = Math.max(6, Math.min(plotRect.width - els.tooltip.offsetWidth - 6, event.clientX - plotRect.left + 12));
    const top = Math.max(6, Math.min(plotRect.height - els.tooltip.offsetHeight - 6, event.clientY - plotRect.top + 12));
    els.tooltip.style.left = `${left}px`;
    els.tooltip.style.top = `${top}px`;
  }

  function moveSymbol(symbol, direction) { const index = state.symbols.indexOf(symbol); const next = direction === "up" ? index - 1 : index + 1; if (index < 0 || next < 0 || next >= state.symbols.length) return; [state.symbols[index], state.symbols[next]] = [state.symbols[next], state.symbols[index]]; save(); renderCards(); }
  function selectSymbol(symbol) {
    if (!state.symbols.includes(symbol) || symbol === state.active) return;
    state.active = symbol;
    renderCards(); renderTicker(); renderQuote(); loadActive();
  }
  async function refreshDashboard() {
    await refreshAll();
    await loadActive();
  }
  els.cards.addEventListener("click", (event) => { const move = event.target.closest("[data-move]"); if (move) { moveSymbol(move.dataset.target, move.dataset.move); return; } const remove = event.target.closest("[data-remove]"); if (remove) { const symbol = remove.dataset.remove; if (state.symbols.length === 1) return; state.symbols = state.symbols.filter((item) => item !== symbol); if (state.active === symbol) state.active = state.symbols[0]; save(); renderCards(); renderTicker(); loadActive(); return; } const card = event.target.closest("[data-symbol]"); if (card) selectSymbol(card.dataset.symbol); });
  els.ticker.addEventListener("click", (event) => { const ticker = event.target.closest("[data-symbol]"); if (ticker) selectSymbol(ticker.dataset.symbol); });
  els.form.addEventListener("submit", async (event) => { event.preventDefault(); const symbol = els.input.value.trim().toUpperCase().replace(/[^A-Z.\-]/g, ""); if (!symbol) { els.status.textContent = "请输入美股代码。"; return; } if (state.symbols.includes(symbol)) { els.status.textContent = "该股票已在自选列表中。"; return; } if (state.symbols.length >= 8) { els.status.textContent = "最多可添加 8 只股票。"; return; } state.symbols.push(symbol); state.active = symbol; save(); els.input.value = ""; els.status.textContent = "已添加，正在加载行情…"; renderCards(); await loadActive(); });
  els.periods.addEventListener("click", (event) => { const button = event.target.closest("[data-period]"); if (!button) return; state.period = button.dataset.period; els.periods.querySelectorAll("button").forEach((item) => { const active = item === button; item.classList.toggle("active", active); item.setAttribute("aria-pressed", String(active)); }); loadActive(); });
  els.refresh.addEventListener("click", refreshDashboard);
  function schedule() { clearInterval(state.timer); if (els.auto.checked) state.timer = setInterval(refreshDashboard, Number(els.rate.value) * 1000); }
  els.auto.addEventListener("change", schedule); els.rate.addEventListener("change", schedule); window.addEventListener("resize", () => requestAnimationFrame(draw));
  els.plot.addEventListener("pointermove", showChartTooltip);
  els.plot.addEventListener("pointerdown", showChartTooltip);
  els.plot.addEventListener("pointerleave", () => els.tooltip.classList.remove("visible"));
  renderCards(); renderTicker(); renderQuote(); refreshDashboard(); schedule();
}());
