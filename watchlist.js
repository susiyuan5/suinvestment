(function () {
  "use strict";

  const KEY = "su-investment-pro:watchlist";
  const NAMES = { AAPL: "Apple Inc.", MSFT: "Microsoft Corporation", NVDA: "NVIDIA Corporation", TSLA: "Tesla, Inc.", AMZN: "Amazon.com, Inc.", GOOGL: "Alphabet Inc.", META: "Meta Platforms, Inc.", AMD: "Advanced Micro Devices, Inc.", QQQ: "Invesco QQQ Trust", SPY: "SPDR S&P 500 ETF Trust" };
  const state = { symbols: loadSymbols(), active: "AAPL", period: "1y", quotes: {}, series: {}, timer: null };
  const $ = (id) => document.getElementById(id);
  const els = { cards: $("watchlistCards"), form: $("watchlistAddForm"), input: $("watchlistSymbolInput"), status: $("watchlistFormStatus"), symbol: $("watchlistActiveSymbol"), name: $("watchlistCompanyName"), meta: $("watchlistQuoteMeta"), price: $("watchlistPrice"), change: $("watchlistChange"), auto: $("watchlistAutoRefresh"), rate: $("watchlistRefreshRate"), refresh: $("watchlistRefreshBtn"), periods: $("watchlistPeriods"), loading: $("watchlistChartLoading"), priceCanvas: $("watchlistPriceChart"), macdCanvas: $("watchlistMacdChart"), caption: $("watchlistChartCaption") };
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
      return `<button class="watch-card ${symbol === state.active ? "active" : ""}" data-symbol="${esc(symbol)}" type="button"><span class="watch-card-remove" data-remove="${esc(symbol)}" title="Remove" aria-label="Remove ${esc(symbol)}">&times;</span><span class="watch-card-top"><strong>${esc(symbol)}</strong><span>USD</span></span><span class="watch-card-bottom"><strong>${fmt(quote.price)}</strong><span class="${tone}">${signed(quote.change)}</span></span></button>`;
    }).join("");
  }

  function renderQuote() {
    const quote = state.quotes[state.active] || {};
    els.symbol.textContent = state.active;
    els.name.textContent = NAMES[state.active] || "US listed security";
    els.price.textContent = fmt(quote.price);
    els.change.textContent = signed(quote.change);
    els.change.className = Number.isFinite(quote.change) ? (quote.change >= 0 ? "positive" : "negative") : "";
    els.meta.textContent = quote.time ? `Updated ${new Date(quote.time).toLocaleString()} / ${quote.source}` : "Loading market data...";
  }

  async function getChart(symbol, period) {
    const settings = { "1d": ["1d", "5m"], "5d": ["5d", "15m"], "3mo": ["3mo", "1d"], "1y": ["1y", "1d"], "5y": ["5y", "1wk"] }[period];
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${settings[0]}&interval=${settings[1]}&includePrePost=false`;
    const response = await fetch(url);
    if (!response.ok) throw new Error("Quote request failed");
    const json = await response.json();
    const result = json.chart && json.chart.result && json.chart.result[0];
    if (!result) throw new Error("No market data");
    const quote = result.indicators.quote[0];
    const close = result.indicators.adjclose ? result.indicators.adjclose[0].adjclose : quote.close;
    const rows = result.timestamp.map((time, index) => ({ time: time * 1000, open: quote.open[index], high: quote.high[index], low: quote.low[index], close: close[index] })).filter((row) => [row.open, row.high, row.low, row.close].every(Number.isFinite));
    return { rows, meta: result.meta };
  }

  async function getFallback(symbol) {
    const response = await fetch("data/backtest-prices.json?v=" + Date.now());
    const json = await response.json();
    const rows = (json.symbols && json.symbols[symbol] || []).map((row) => ({ time: Date.parse(row.date), open: row.close, high: row.close, low: row.close, close: row.close }));
    if (!rows.length) throw new Error("No local history for this ticker");
    return { rows, meta: { regularMarketPrice: rows.at(-1).close, previousClose: rows.at(-2)?.close } };
  }

  async function loadActive() {
    els.loading.classList.remove("hidden");
    try {
      let data;
      let source = "Yahoo Finance";
      try { data = await getChart(state.active, state.period); } catch (_) { data = await getFallback(state.active); source = "Local weekly history"; }
      state.series[state.active] = data.rows;
      const last = data.rows.at(-1);
      const previous = Number.isFinite(data.meta.chartPreviousClose) ? data.meta.chartPreviousClose : (Number.isFinite(data.meta.previousClose) ? data.meta.previousClose : data.rows.at(-2)?.close);
      const price = Number.isFinite(data.meta.regularMarketPrice) ? data.meta.regularMarketPrice : last.close;
      state.quotes[state.active] = { price, change: previous ? ((price - previous) / previous) * 100 : null, time: last.time, source };
      renderCards(); renderQuote(); draw();
      els.caption.textContent = `${state.active} / ${state.period.toUpperCase()} / ${data.rows.length} market intervals`;
    } catch (error) {
      els.meta.textContent = error.message;
      els.caption.textContent = "Market data unavailable. Try again or add a supported ticker.";
    } finally { els.loading.classList.add("hidden"); }
  }

  async function refreshAll() {
    els.refresh.disabled = true;
    await Promise.all(state.symbols.map(async (symbol) => {
      try {
        const data = await getChart(symbol, "5d"); const last = data.rows.at(-1); const previous = data.meta.chartPreviousClose || data.meta.previousClose || data.rows.at(-2)?.close; const price = data.meta.regularMarketPrice || last.close;
        state.quotes[symbol] = { price, change: previous ? ((price - previous) / previous) * 100 : null, time: last.time, source: "Yahoo Finance" };
      } catch (_) {
        try { const data = await getFallback(symbol); const last = data.rows.at(-1); const previous = data.rows.at(-2)?.close; state.quotes[symbol] = { price: last.close, change: previous ? ((last.close - previous) / previous) * 100 : null, time: last.time, source: "Local weekly history" }; } catch (_) {}
      }
    }));
    renderCards(); renderQuote(); els.refresh.disabled = false;
  }

  function ema(values, length) { const factor = 2 / (length + 1); const out = []; let value = values[0]; values.forEach((item, index) => { value = index ? item * factor + value * (1 - factor) : item; out.push(value); }); return out; }
  function setup(canvas) { const rect = canvas.getBoundingClientRect(); const dpr = Math.min(devicePixelRatio || 1, 2); canvas.width = Math.max(1, rect.width * dpr); canvas.height = Math.max(1, rect.height * dpr); const context = canvas.getContext("2d"); context.setTransform(dpr, 0, 0, dpr, 0, 0); return { context, width: rect.width, height: rect.height }; }
  function grid(context, width, height) { context.strokeStyle = "#26344a"; context.lineWidth = 1; for (let index = 1; index < 5; index += 1) { const y = index * height / 5; context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke(); } }
  function draw() { const rows = state.series[state.active] || []; if (rows.length < 2) return; drawPrice(rows); drawMacd(rows); }
  function drawPrice(rows) { const { context, width, height } = setup(els.priceCanvas); context.clearRect(0, 0, width, height); grid(context, width, height); const values = rows.flatMap((row) => [row.low, row.high]); const min = Math.min(...values); const max = Math.max(...values); const pad = (max - min) * 0.08 || 1; const low = min - pad; const high = max + pad; const x = (index) => 10 + index * (width - 55) / (rows.length - 1); const y = (value) => 8 + (high - value) * (height - 24) / (high - low); const candle = Math.max(1, Math.min(7, (width - 55) / rows.length * 0.65)); rows.forEach((row, index) => { const up = row.close >= row.open; context.strokeStyle = context.fillStyle = up ? "#3ed59b" : "#ff6f7f"; context.beginPath(); context.moveTo(x(index), y(row.high)); context.lineTo(x(index), y(row.low)); context.stroke(); context.fillRect(x(index) - candle / 2, Math.min(y(row.open), y(row.close)), candle, Math.max(1, Math.abs(y(row.open) - y(row.close)))); }); context.fillStyle = "#8391a5"; context.font = "11px system-ui"; for (let index = 1; index < 5; index += 1) { const value = high - (high - low) * index / 5; context.fillText(value.toFixed(2), width - 43, index * height / 5 + 4); } }
  function drawMacd(rows) { const { context, width, height } = setup(els.macdCanvas); context.clearRect(0, 0, width, height); grid(context, width, height); const closes = rows.map((row) => row.close); const fast = ema(closes, 12); const slow = ema(closes, 26); const macd = fast.map((value, index) => value - slow[index]); const signal = ema(macd, 9); const histogram = macd.map((value, index) => value - signal[index]); const abs = Math.max(...macd.concat(signal, histogram).map(Math.abs), 0.01); const x = (index) => index * (width - 6) / (rows.length - 1); const y = (value) => height / 2 - value * (height * 0.42) / abs; context.strokeStyle = "#617089"; context.beginPath(); context.moveTo(0, height / 2); context.lineTo(width, height / 2); context.stroke(); const barWidth = Math.max(1, (width - 6) / rows.length * 0.7); histogram.forEach((value, index) => { context.fillStyle = value >= 0 ? "rgba(62,213,155,.7)" : "rgba(255,111,127,.7)"; context.fillRect(x(index) - barWidth / 2, Math.min(y(value), height / 2), barWidth, Math.abs(y(value) - height / 2)); }); [[macd, "#f3b95f"], [signal, "#7b9cff"]].forEach(([values, color]) => { context.strokeStyle = color; context.lineWidth = 1.4; context.beginPath(); values.forEach((value, index) => index ? context.lineTo(x(index), y(value)) : context.moveTo(x(index), y(value))); context.stroke(); }); }

  els.cards.addEventListener("click", (event) => { const remove = event.target.closest("[data-remove]"); if (remove) { event.stopPropagation(); const symbol = remove.dataset.remove; if (state.symbols.length === 1) return; state.symbols = state.symbols.filter((item) => item !== symbol); if (state.active === symbol) state.active = state.symbols[0]; save(); renderCards(); loadActive(); return; } const card = event.target.closest("[data-symbol]"); if (card) { state.active = card.dataset.symbol; renderCards(); renderQuote(); loadActive(); } });
  els.form.addEventListener("submit", async (event) => { event.preventDefault(); const symbol = els.input.value.trim().toUpperCase().replace(/[^A-Z.\-]/g, ""); if (!symbol) { els.status.textContent = "Enter a US ticker."; return; } if (state.symbols.includes(symbol)) { els.status.textContent = "Already on your watchlist."; return; } if (state.symbols.length >= 8) { els.status.textContent = "Watchlist supports up to 8 tickers."; return; } state.symbols.push(symbol); state.active = symbol; save(); els.input.value = ""; els.status.textContent = "Added. Loading quote..."; renderCards(); await loadActive(); });
  els.periods.addEventListener("click", (event) => { const button = event.target.closest("[data-period]"); if (!button) return; state.period = button.dataset.period; els.periods.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button)); loadActive(); });
  els.refresh.addEventListener("click", () => { refreshAll(); loadActive(); });
  function schedule() { clearInterval(state.timer); if (els.auto.checked) state.timer = setInterval(() => { refreshAll(); loadActive(); }, Number(els.rate.value) * 1000); }
  els.auto.addEventListener("change", schedule); els.rate.addEventListener("change", schedule); window.addEventListener("resize", () => requestAnimationFrame(draw));
  renderCards(); renderQuote(); refreshAll().then(loadActive); schedule();
}());
