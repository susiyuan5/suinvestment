(function () {
  "use strict";

  const CONFIG = {
    monthlyBudget: 400,
    normalPool: 300,
    crashFund: 100,
    weeklyDeployment: 69.23,
    cacheHours: 24,
    requestTimeoutMs: 9000,
    qqqPanicThreshold: -10,
    panicMultiplier: 1.3,
    panicSymbols: new Set(["MSFT", "NVDA", "AAPL", "ASML"]),
    stocks: [
      { symbol: "BYDDY", allocation: 0.3 },
      { symbol: "MSFT", allocation: 0.22 },
      { symbol: "NVDA", allocation: 0.18 },
      { symbol: "AAPL", allocation: 0.15 },
      { symbol: "ASML", allocation: 0.1 },
      { symbol: "KO", allocation: 0.05 }
    ],
    marketSymbols: ["BYDDY", "MSFT", "NVDA", "AAPL", "ASML", "KO", "QQQ"]
  };

  const STORAGE_KEYS = {
    apiKey: "su-investment-pro:finnhub-key",
    cache: "su-investment-pro:market-cache",
    overrides: "su-investment-pro:manual-overrides"
  };

  const state = {
    marketRows: new Map(),
    rows: new Map(),
    qqqWeekly: null,
    panicActive: false,
    loading: false,
    pendingRefresh: false,
    cache: loadJson(STORAGE_KEYS.cache, {}),
    overrides: loadJson(STORAGE_KEYS.overrides, {})
  };

  const cardsEl = document.getElementById("cards");
  const orderTextEl = document.getElementById("orderText");
  const copyStatusEl = document.getElementById("copyStatus");
  const refreshBtn = document.getElementById("refreshBtn");
  const copyBtn = document.getElementById("copyBtn");
  const apiKeyInput = document.getElementById("apiKey");
  const openSettingsBtn = document.getElementById("openSettingsBtn");
  const closeSettingsBtn = document.getElementById("closeSettingsBtn");
  const settingsModal = document.getElementById("settingsModal");
  const lastUpdatedEl = document.getElementById("lastUpdated");
  const panicBanner = document.getElementById("panicBanner");
  const template = document.getElementById("stockCardTemplate");
  let apiKeyRefreshTimer = 0;

  apiKeyInput.value = localStorage.getItem(STORAGE_KEYS.apiKey) || "";

  apiKeyInput.addEventListener("input", function () {
    localStorage.setItem(STORAGE_KEYS.apiKey, apiKeyInput.value.trim());
    window.clearTimeout(apiKeyRefreshTimer);
    apiKeyRefreshTimer = window.setTimeout(refreshMarketData, 700);
  });

  apiKeyInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      window.clearTimeout(apiKeyRefreshTimer);
      refreshMarketData();
    }
  });

  openSettingsBtn.addEventListener("click", openSettings);
  closeSettingsBtn.addEventListener("click", closeSettings);
  settingsModal.addEventListener("click", function (event) {
    if (event.target === settingsModal) closeSettings();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !settingsModal.classList.contains("hidden")) {
      closeSettings();
    }
  });

  refreshBtn.addEventListener("click", refreshMarketData);
  copyBtn.addEventListener("click", copyOrderList);

  renderSkeleton();
  refreshMarketData();

  async function refreshMarketData() {
    if (state.loading) {
      state.pendingRefresh = true;
      return;
    }

    state.loading = true;
    state.pendingRefresh = false;
    refreshBtn.disabled = true;
    refreshBtn.textContent = "Refreshing...";
    lastUpdatedEl.textContent = "Refreshing market data...";
    copyStatusEl.textContent = "";
    markCardsLoading();

    const symbols = CONFIG.marketSymbols;
    const results = await Promise.all(symbols.map(fetchSymbolSnapshot));

    results.forEach(function (result) {
      if (!result) return;
      if (result.symbol === "QQQ") {
        state.qqqWeekly = result.weeklyChange;
      } else {
        state.marketRows.set(result.symbol, result);
      }
    });

    state.panicActive = typeof state.qqqWeekly === "number" && state.qqqWeekly <= CONFIG.qqqPanicThreshold;
    applyManualOverrides();
    render();

    state.loading = false;
    refreshBtn.disabled = false;
    refreshBtn.textContent = "Refresh Prices";

    if (state.pendingRefresh) {
      refreshMarketData();
    }
  }

  function openSettings() {
    settingsModal.classList.remove("hidden");
    apiKeyInput.focus();
  }

  function closeSettings() {
    settingsModal.classList.add("hidden");
    openSettingsBtn.focus();
  }

  async function fetchSymbolSnapshot(symbol) {
    const apiKey = apiKeyInput.value.trim();
    const cached = getValidCache(symbol);
    const failures = [];

    if (apiKey) {
      try {
        const finnhub = await fetchFinnhubSnapshot(symbol, apiKey);
        saveCache(symbol, finnhub);
        return finnhub;
      } catch (error) {
        console.warn("Finnhub failed for", symbol, error);
        failures.push("Finnhub: " + describeError(error));
      }
    }

    try {
      const yahoo = await fetchYahooSnapshot(symbol);
      saveCache(symbol, yahoo);
      return yahoo;
    } catch (error) {
      console.warn("Yahoo failed for", symbol, error);
      failures.push("Yahoo: " + describeError(error));
    }

    if (cached) {
      return {
        ...cached,
        source: "Cache",
        note: "API failed; using saved snapshot"
      };
    }

    const note = failures.length ? failures.join(" | ") : "Enter Finnhub key or use manual override";
    return {
      symbol,
      price: null,
      latestClose: null,
      weekAgoClose: null,
      weeklyChange: null,
      source: "Unavailable",
      note
    };
  }

  async function fetchFinnhubSnapshot(symbol, apiKey) {
    const now = Math.floor(Date.now() / 1000);
    const from = now - 45 * 24 * 60 * 60;
    const candleUrl = new URL("https://finnhub.io/api/v1/stock/candle");
    candleUrl.search = new URLSearchParams({
      symbol,
      resolution: "D",
      from: String(from),
      to: String(now),
      token: apiKey
    }).toString();

    const quoteUrl = new URL("https://finnhub.io/api/v1/quote");
    quoteUrl.search = new URLSearchParams({ symbol, token: apiKey }).toString();

    const quote = await fetchJson(quoteUrl);
    if (!isFiniteNumber(quote.c) || quote.c <= 0) {
      throw new Error("quote unavailable");
    }

    if (
    isFiniteNumber(price) &&
    isFiniteNumber(previousClose)
) {

    weekly =
        ((price - previousClose)
        / previousClose) * 100;

    note =
        "Daily proxy calculation";

} else {

    weekly = 0;

    note =
        "Fallback calculation";

}

    try {
      const candle = await fetchJson(candleUrl);
      if (candle.s !== "ok" || !Array.isArray(candle.c) || candle.c.length < 6) {
        throw new Error(candle.s === "no_data" ? "no daily candle data" : "insufficient daily candles");
      }

      const closes = candle.c.filter(isFiniteNumber);
      comparison = calculateWeeklyChange(closes);
      candleNote = "Live quote and daily candles";
    } catch (error) {
      console.warn("Finnhub candles failed for", symbol, error);
    }

    return {
      symbol,
      price: quote.c,
      latestClose: comparison ? comparison.latestClose : null,
      weekAgoClose: comparison ? comparison.weekAgoClose : null,
      weeklyChange: comparison ? comparison.weeklyChange : null,
      source: "Finnhub",
      note: candleNote,
      fetchedAt: Date.now()
    };
  }

  async function fetchYahooSnapshot(symbol) {
    const url = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) + "?range=14d&interval=1d";
    const payload = await fetchJson(url);
    const result = payload.chart && payload.chart.result && payload.chart.result[0];
    if (!result || !result.indicators || !result.indicators.quote) {
      throw new Error("Yahoo payload missing result");
    }

    const quote = result.indicators.quote[0] || {};
    const closes = (quote.close || []).filter(isFiniteNumber);
    if (closes.length < 6) throw new Error("Yahoo returned insufficient candles");

    const comparison = calculateWeeklyChange(closes);
    const metaPrice = result.meta && result.meta.regularMarketPrice;

    return {
      symbol,
      price: isFiniteNumber(metaPrice) ? metaPrice : comparison.latestClose,
      latestClose: comparison.latestClose,
      weekAgoClose: comparison.weekAgoClose,
      weeklyChange: comparison.weeklyChange,
      source: "Yahoo",
      note: "Yahoo Finance fallback",
      fetchedAt: Date.now()
    };
  }

  function calculateWeeklyChange(closes) {
    const latestClose = closes[closes.length - 1];
    const lookback = Math.min(7, Math.max(5, closes.length - 1));
    const weekAgoClose = closes[closes.length - 1 - lookback];
    const weeklyChange = round2(((latestClose - weekAgoClose) / weekAgoClose) * 100);
    return { latestClose, weekAgoClose, weeklyChange };
  }

  function getMultiplier(weeklyChange) {
    if (!isFiniteNumber(weeklyChange)) return 1;
    if (weeklyChange <= -15) return 2;
    if (weeklyChange <= -8) return 1.5;
    if (weeklyChange >= 10) return 0.5;
    return 1;
  }

  function applyManualOverrides() {
    CONFIG.stocks.forEach(function (stock) {
      const base = state.marketRows.get(stock.symbol) || {
        symbol: stock.symbol,
        price: null,
        weeklyChange: null,
        source: "Unavailable",
        note: "Use manual override"
      };

      const override = state.overrides[stock.symbol];
      if (isFiniteNumber(override)) {
        state.rows.set(stock.symbol, {
          ...base,
          weeklyChange: override,
          source: "Manual",
          note: "Manual override active"
        });
      } else {
        state.rows.set(stock.symbol, base);
      }
    });
  }

  function renderSkeleton() {
    cardsEl.innerHTML = "";
    CONFIG.stocks.forEach(function (stock) {
      const card = template.content.firstElementChild.cloneNode(true);
      card.dataset.symbol = stock.symbol;
      card.querySelector("h3").textContent = stock.symbol;
      card.querySelector(".allocation").textContent = formatPercent(stock.allocation * 100) + " allocation";

    const input = card.querySelector(".override-input");
    input.value = state.overrides[stock.symbol] === undefined ? "" : formatSignedInput(state.overrides[stock.symbol]);
    card.querySelector(".source-badge").textContent = "Loading";
    card.querySelector(".weekly-change").textContent = "Loading";
    card.querySelector(".multiplier").textContent = "1x";
    card.querySelector(".buy-amount").textContent = "CAD " + round2(CONFIG.weeklyDeployment * stock.allocation).toFixed(2);
    card.querySelector(".price").textContent = "Price loading";

      card.querySelector(".apply-override").addEventListener("click", function () {
        applyOverride(stock.symbol, input.value);
      });
      card.querySelector(".clear-override").addEventListener("click", function () {
        clearOverride(stock.symbol);
      });
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter") applyOverride(stock.symbol, input.value);
      });

      cardsEl.appendChild(card);
    });
  }

  function markCardsLoading() {
    cardsEl.querySelectorAll(".stock-card").forEach(function (card) {
      card.querySelector(".source-badge").textContent = "Loading";
      card.querySelector(".source-badge").className = "source-badge";
      card.querySelector(".note").textContent = "Fetching market data";
    });
  }

  function render() {
    panicBanner.classList.toggle("hidden", !state.panicActive);

    const orderLines = ["THIS WEEK ORDER", ""];
    const entries = [];
    let rawTotal = 0;
    let roundedTotal = 0;
    let latestTimestamp = 0;

    CONFIG.stocks.forEach(function (stock) {
      const row = state.rows.get(stock.symbol);
      const weekly = row ? row.weeklyChange : null;
      const normalMultiplier = getMultiplier(weekly);
      const panicMultiplier = state.panicActive && CONFIG.panicSymbols.has(stock.symbol) ? CONFIG.panicMultiplier : 1;
      const multiplier = normalMultiplier * panicMultiplier;
      const rawAmount = CONFIG.weeklyDeployment * stock.allocation * multiplier;
      const amount = round2(rawAmount);

      entries.push({ stock, row, weekly, multiplier, amount, rawAmount });
      rawTotal += rawAmount;
      roundedTotal = round2(roundedTotal + amount);
      latestTimestamp = Math.max(latestTimestamp, row && row.fetchedAt ? row.fetchedAt : 0);
    });

    const targetTotal = round2(rawTotal);
    const pennyDifference = round2(targetTotal - roundedTotal);
    if (pennyDifference !== 0 && entries.length) {
      entries[0].amount = round2(entries[0].amount + pennyDifference);
    }

    entries.forEach(function (entry) {
      const card = cardsEl.querySelector('[data-symbol="' + entry.stock.symbol + '"]');
      updateCard(card, entry.row, entry.stock, entry.weekly, entry.multiplier, entry.amount);
      orderLines.push(entry.stock.symbol + " — CAD " + entry.amount.toFixed(2));
    });

    orderLines.push("");
    orderLines.push("Total:");
    orderLines.push("CAD " + targetTotal.toFixed(2));
    orderTextEl.textContent = orderLines.join("\n");
    lastUpdatedEl.textContent = latestTimestamp ? "Updated " + formatDateTime(latestTimestamp) : "No live data yet";
  }

  function updateCard(card, row, stock, weekly, multiplier, amount) {
    const badge = card.querySelector(".source-badge");
    const weeklyEl = card.querySelector(".weekly-change");

    badge.textContent = row ? row.source : "Unavailable";
    badge.className = "source-badge " + sourceClass(row ? row.source : "Unavailable");

    weeklyEl.className = "weekly-change";

if (isFiniteNumber(weekly)) {

    weeklyEl.textContent =
        formatSigned(weekly) + "%";

    weeklyEl.classList.add(
        weekly < 0 ? "negative" : "positive"
    );

} else if (
    row &&
    isFiniteNumber(row.price) &&
    isFiniteNumber(row.previousClose)
) {

    const proxyWeekly =
        ((row.price - row.previousClose)
        / row.previousClose) * 100;

    weeklyEl.textContent =
        formatSigned(proxyWeekly) + "%";

    weeklyEl.classList.add(
        proxyWeekly < 0 ? "negative" : "positive"
    );

} else {

    weeklyEl.textContent = "0.00%";

}

    card.querySelector(".multiplier").textContent = formatMultiplier(multiplier);
    card.querySelector(".buy-amount").textContent = "CAD " + amount.toFixed(2);
    card.querySelector(".price").textContent = row && isFiniteNumber(row.price) ? "Price " + formatPrice(row.price) : "Price unavailable";

    const panicText = state.panicActive && CONFIG.panicSymbols.has(stock.symbol) ? " + panic 1.3x" : "";
    card.querySelector(".note").textContent = (row && row.note ? row.note : "") + panicText;
  }

  function applyOverride(symbol, rawValue) {
    const normalized = String(rawValue).trim().replace("%", "");
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(normalized)) {
      copyStatusEl.textContent = symbol + " override must be a number like -9.2, +12, or 10.5.";
      return;
    }

    state.overrides[symbol] = Number(normalized);
    saveOverrides();
    applyManualOverrides();
    render();
    copyStatusEl.textContent = symbol + " manual override applied.";
  }

  function clearOverride(symbol) {
    delete state.overrides[symbol];
    saveOverrides();

    const card = cardsEl.querySelector('[data-symbol="' + symbol + '"]');
    if (card) card.querySelector(".override-input").value = "";

    applyManualOverrides();
    render();
    copyStatusEl.textContent = symbol + " manual override cleared.";
  }

  async function copyOrderList() {
    copyStatusEl.textContent = "";
    try {
      await navigator.clipboard.writeText(orderTextEl.textContent);
      copyStatusEl.textContent = "Order list copied.";
    } catch (error) {
      copyStatusEl.textContent = "Select the order text and copy it manually.";
    }
  }

 function saveCache(symbol, snapshot) {

    const safeSnapshot = {

        ...snapshot,

        previousClose:
            snapshot.previousClose ??
            snapshot.pc ??
            null,

        weekly:
            snapshot.weekly ??
            (
                snapshot.price != null &&
                (
                    snapshot.previousClose != null ||
                    snapshot.pc != null
                )
            )
            ? (
                (
                    snapshot.price -
                    (snapshot.previousClose ?? snapshot.pc)
                )
                /
                (snapshot.previousClose ?? snapshot.pc)
            ) * 100
            : null
    };

    state.cache[symbol] = {

        ...safeSnapshot,

        fetchedAt: Date.now()

    };

    localStorage.setItem(
        STORAGE_KEYS.cache,
        JSON.stringify(state.cache)
    );

}
    state.cache[symbol] = {
      ...snapshot,
      fetchedAt: Date.now()
    };
    localStorage.setItem(STORAGE_KEYS.cache, JSON.stringify(state.cache));
  }

  function getValidCache(symbol) {
    const cached = state.cache[symbol];
    if (!cached || !cached.fetchedAt) return null;

    const ageMs = Date.now() - cached.fetchedAt;
    if (ageMs > CONFIG.cacheHours * 60 * 60 * 1000) return null;
    return cached;
  }

  function saveOverrides() {
    localStorage.setItem(STORAGE_KEYS.overrides, JSON.stringify(state.overrides));
  }

  function loadJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) || fallback;
    } catch (error) {
      return fallback;
    }
  }

  async function fetchJson(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(function () {
      controller.abort();
    }, CONFIG.requestTimeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        const body = await response.text();
        throw new Error("Request failed with status " + response.status + " " + body.slice(0, 120));
      }
      return response.json();
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw new Error("request timed out");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function describeError(error) {
    const message = error && error.message ? error.message : String(error);
    if (/Failed to fetch/i.test(message)) return "browser blocked request";
    if (/401|403/.test(message)) return "check API key permissions";
    return message;
  }

  function round2(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function formatSigned(value) {
    return (value > 0 ? "+" : "") + value.toFixed(2);
  }

  function formatSignedInput(value) {
    return value > 0 ? "+" + value : String(value);
  }

  function formatMultiplier(value) {
    return value.toFixed(2).replace(/\.00$/, "") + "x";
  }

  function formatPercent(value) {
    return value.toFixed(0) + "%";
  }

  function formatPrice(value) {
    return Number(value).toFixed(2);
  }

  function formatDateTime(timestamp) {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(timestamp));
  }

  function sourceClass(source) {
    return String(source || "").toLowerCase().replace(/[^a-z]/g, "") || "error";
  }
})();
