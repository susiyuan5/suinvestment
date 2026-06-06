(function () {
  "use strict";

  const CONFIG = {
    monthlyBudget: 400,
    normalPool: 300,
    crashFund: 100,
    weeklyDeployment: 69.23,
    cacheHours: 24,
    weeklySnapshotUrl: "data/market-data.json",
    requestTimeoutMs: 9000,
    qqqPanicThreshold: -10,
    panicMultiplier: 1.3,
    panicSymbols: new Set(["MSFT", "NVDA", "AAPL", "ASML"]),
    defaultStocks: [
      { symbol: "BYDDY", name: "BYD Company Limited", allocation: 0.3 },
      { symbol: "MSFT", name: "Microsoft Corporation", allocation: 0.22 },
      { symbol: "NVDA", name: "NVIDIA Corporation", allocation: 0.18 },
      { symbol: "AAPL", name: "Apple Inc.", allocation: 0.15 },
      { symbol: "ASML", name: "ASML Holding N.V.", allocation: 0.1 },
      { symbol: "KO", name: "The Coca-Cola Company", allocation: 0.05 }
    ]
  };

  const STORAGE_KEYS = {
    apiKey: "su-investment-pro:finnhub-key",
    cache: "su-investment-pro:market-cache",
    overrides: "su-investment-pro:manual-overrides",
    portfolio: "su-investment-pro:portfolio"
  };

  const state = {
    marketRows: new Map(),
    rows: new Map(),
    qqqSignal: null,
    panicActive: false,
    loading: false,
    pendingRefresh: false,
    weeklySnapshot: null,
    portfolio: normalizePortfolio(loadJson(STORAGE_KEYS.portfolio, CONFIG.defaultStocks), { allowCustom: true }),
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
  const stockSearchInput = document.getElementById("stockSearchInput");
  const stockAllocationInput = document.getElementById("stockAllocationInput");
  const stockSearchBtn = document.getElementById("stockSearchBtn");
  const stockSearchResultsEl = document.getElementById("stockSearchResults");
  const portfolioTotalEl = document.getElementById("portfolioTotal");
  let apiKeyRefreshTimer = 0;

  if (!state.portfolio.length) {
    state.portfolio = normalizePortfolio(CONFIG.defaultStocks, { allowCustom: true });
  }

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
  stockSearchBtn.addEventListener("click", searchStocks);
  stockSearchInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") searchStocks();
  });

  renderPortfolioTotal();
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

    state.weeklySnapshot = await fetchWeeklySnapshot();

    const symbols = Array.from(new Set(state.portfolio.map(function (stock) {
      return stock.symbol;
    }).concat("QQQ")));
    const results = await Promise.all(symbols.map(fetchSymbolSnapshot));

    results.forEach(function (result) {
      if (!result) return;
      if (result.symbol === "QQQ") {
        state.qqqSignal = getDecisionChange(result);
      } else {
        state.marketRows.set(result.symbol, result);
      }
    });

    state.panicActive = typeof state.qqqSignal === "number" && state.qqqSignal <= CONFIG.qqqPanicThreshold;
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

  async function searchStocks() {
    const query = stockSearchInput.value.trim();
    if (!query) {
      renderSearchMessage("Enter a ticker or company name.");
      return;
    }

    stockSearchBtn.disabled = true;
    stockSearchBtn.textContent = "Searching...";
    renderSearchMessage("Searching...");

    try {
      const results = await fetchStockSearchResults(query);
      renderSearchResults(results, query);
    } catch (error) {
      console.warn("Stock search failed", error);
      const fallbackSymbol = normalizeSymbol(query);
      if (fallbackSymbol) {
        renderSearchResults([{ symbol: fallbackSymbol, name: "Add exact ticker", exchange: "Manual" }], query);
      } else {
        renderSearchMessage("Search failed. Try a ticker like TSLA or V.");
      }
    } finally {
      stockSearchBtn.disabled = false;
      stockSearchBtn.textContent = "Search";
    }
  }

  async function fetchStockSearchResults(query) {
    const url = "https://query1.finance.yahoo.com/v1/finance/search?q=" + encodeURIComponent(query) + "&quotesCount=8&newsCount=0";
    const payload = await fetchJson(url);
    const quotes = Array.isArray(payload.quotes) ? payload.quotes : [];
    const seen = new Set();

    return quotes.reduce(function (items, quote) {
      const symbol = normalizeSymbol(quote.symbol);
      if (!symbol || seen.has(symbol)) return items;

      const quoteType = String(quote.quoteType || "").toUpperCase();
      if (quoteType && !["EQUITY", "ETF", "MUTUALFUND"].includes(quoteType)) return items;

      seen.add(symbol);
      items.push({
        symbol,
        name: quote.longname || quote.shortname || quote.name || symbol,
        exchange: quote.exchDisp || quote.exchange || quoteType || "Market"
      });
      return items;
    }, []);
  }

  function renderSearchResults(results, query) {
    stockSearchResultsEl.innerHTML = "";

    const exactSymbol = normalizeSymbol(query);
    if (exactSymbol && !results.some(function (item) { return item.symbol === exactSymbol; })) {
      results.unshift({ symbol: exactSymbol, name: "Add exact ticker", exchange: "Manual" });
    }

    if (!results.length) {
      renderSearchMessage("No matching stocks found.");
      return;
    }

    results.slice(0, 8).forEach(function (result) {
      const button = document.createElement("button");
      button.className = "search-result";
      button.type = "button";
      button.innerHTML = "<strong></strong><span></span><em></em>";
      button.querySelector("strong").textContent = result.symbol;
      button.querySelector("span").textContent = result.name;
      button.querySelector("em").textContent = result.exchange;
      button.addEventListener("click", function () {
        addStock(result);
      });
      stockSearchResultsEl.appendChild(button);
    });
  }

  function renderSearchMessage(message) {
    stockSearchResultsEl.innerHTML = "";
    const note = document.createElement("p");
    note.className = "search-message";
    note.textContent = message;
    stockSearchResultsEl.appendChild(note);
  }

  function addStock(result) {
    const symbol = normalizeSymbol(result.symbol);
    if (!symbol) return;

    const allocation = parseAllocation(stockAllocationInput.value);
    const existing = state.portfolio.find(function (stock) {
      return stock.symbol === symbol;
    });

    if (existing) {
      existing.name = result.name || existing.name || symbol;
      if (allocation > 0) existing.allocation = allocation;
      copyStatusEl.textContent = symbol + " updated.";
    } else {
      state.portfolio.push({
        symbol,
        name: result.name || symbol,
        allocation
      });
      copyStatusEl.textContent = symbol + " added. Set allocation if needed.";
    }

    state.portfolio = normalizePortfolio(state.portfolio, { allowCustom: true });
    savePortfolio();
    stockSearchInput.value = "";
    stockAllocationInput.value = "";
    stockSearchResultsEl.innerHTML = "";
    renderPortfolioTotal();
    renderSkeleton();
    refreshMarketData();
  }

  function removeStock(symbol) {
    if (state.portfolio.length <= 1) {
      copyStatusEl.textContent = "Keep at least one stock in the portfolio.";
      return;
    }

    state.portfolio = state.portfolio.filter(function (stock) {
      return stock.symbol !== symbol;
    });
    delete state.overrides[symbol];
    delete state.cache[symbol];
    state.marketRows.delete(symbol);
    state.rows.delete(symbol);
    savePortfolio();
    saveOverrides();
    saveJson(STORAGE_KEYS.cache, state.cache);
    renderPortfolioTotal();
    renderSkeleton();
    refreshMarketData();
    copyStatusEl.textContent = symbol + " removed.";
  }

  async function fetchSymbolSnapshot(symbol) {
    const apiKey = apiKeyInput.value.trim();
    const cached = getValidCache(symbol);
    const weeklyData = getWeeklySnapshot(symbol);
    const failures = [];

    if (apiKey) {
      try {
        const finnhub = await fetchFinnhubSnapshot(symbol, apiKey);
        const mergedFinnhub = mergeWeeklySnapshot(finnhub, weeklyData);
        saveCache(symbol, mergedFinnhub);
        return mergedFinnhub;
      } catch (error) {
        console.warn("Finnhub failed for", symbol, error);
        failures.push("Finnhub: " + describeError(error));
      }
    }

    try {
      const yahoo = await fetchYahooSnapshot(symbol);
      const mergedYahoo = mergeWeeklySnapshot(yahoo, weeklyData);
      saveCache(symbol, mergedYahoo);
      return mergedYahoo;
    } catch (error) {
      console.warn("Yahoo failed for", symbol, error);
      failures.push("Yahoo: " + describeError(error));
    }

    if (weeklyData) {
      return {
        symbol,
        price: weeklyData.price,
        latestClose: weeklyData.latestClose,
        previousClose: weeklyData.previousClose,
        weekAgoClose: weeklyData.weekAgoClose,
        dailyChange: weeklyData.dailyChange,
        weeklyChange: weeklyData.weeklyChange,
        decisionChange: weeklyData.decisionChange,
        source: "Weekly",
        note: "Scheduled close snapshot",
        fetchedAt: weeklyData.fetchedAt
      };
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

  async function fetchWeeklySnapshot() {
    try {
      return await fetchJson(CONFIG.weeklySnapshotUrl + "?v=" + Date.now());
    } catch (error) {
      console.warn("Weekly snapshot failed", error);
      return null;
    }
  }

  function getWeeklySnapshot(symbol) {
    const item = state.weeklySnapshot && state.weeklySnapshot.symbols && state.weeklySnapshot.symbols[symbol];
    if (!item || !isFiniteNumber(item.weeklyChange)) return null;
    return {
      price: isFiniteNumber(item.price) ? item.price : null,
      latestClose: isFiniteNumber(item.latestClose) ? item.latestClose : null,
      previousClose: isFiniteNumber(item.previousClose) ? item.previousClose : null,
      weekAgoClose: isFiniteNumber(item.weekAgoClose) ? item.weekAgoClose : null,
      dailyChange: isFiniteNumber(item.dailyChange) ? item.dailyChange : null,
      weeklyChange: item.weeklyChange,
      decisionChange: isFiniteNumber(item.decisionChange) ? item.decisionChange : calculateDecisionChange(item.weeklyChange, item.dailyChange),
      fetchedAt: state.weeklySnapshot.generatedAt ? Date.parse(state.weeklySnapshot.generatedAt) : Date.now()
    };
  }

  function mergeWeeklySnapshot(row, weeklyData) {
    if (!weeklyData) return row;
    if (isFiniteNumber(row.weeklyChange) && isFiniteNumber(row.dailyChange) && !isFiniteNumber(weeklyData.dailyChange)) {
      return {
        ...row,
        decisionChange: calculateDecisionChange(row.weeklyChange, row.dailyChange)
      };
    }
    const mergedDailyChange = calculateDecisionChange(row.dailyChange, weeklyData.dailyChange);
    const mergedWeeklyChange = isFiniteNumber(row.weeklyChange) ? row.weeklyChange : weeklyData.weeklyChange;
    return {
      ...row,
      latestClose: isFiniteNumber(row.latestClose) ? row.latestClose : weeklyData.latestClose,
      previousClose: isFiniteNumber(row.previousClose) ? row.previousClose : weeklyData.previousClose,
      weekAgoClose: isFiniteNumber(row.weekAgoClose) ? row.weekAgoClose : weeklyData.weekAgoClose,
      dailyChange: mergedDailyChange,
      weeklyChange: mergedWeeklyChange,
      decisionChange: calculateDecisionChange(mergedWeeklyChange, mergedDailyChange, weeklyData.decisionChange),
      note: row.note + "; scheduled snapshot"
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

    let comparison = null;
    const quoteDailyChange = isFiniteNumber(quote.pc) && quote.pc > 0 ? round2(((quote.c - quote.pc) / quote.pc) * 100) : null;
    let candleNote = "Live quote; daily candles unavailable";

    try {
      const candle = await fetchJson(candleUrl);
      if (candle.s !== "ok" || !Array.isArray(candle.c) || candle.c.length < 6) {
        throw new Error(candle.s === "no_data" ? "no daily candle data" : "insufficient daily candles");
      }

      const closes = candle.c.filter(isFiniteNumber);
      comparison = calculateMarketSignals(closes);
      candleNote = "Live quote and daily candles";
    } catch (error) {
      console.warn("Finnhub candles failed for", symbol, error);
    }

    return {
      symbol,
      price: quote.c,
      latestClose: comparison ? comparison.latestClose : null,
      previousClose: comparison ? comparison.previousClose : isFiniteNumber(quote.pc) ? quote.pc : null,
      weekAgoClose: comparison ? comparison.weekAgoClose : null,
      dailyChange: comparison ? comparison.dailyChange : quoteDailyChange,
      weeklyChange: comparison ? comparison.weeklyChange : null,
      decisionChange: comparison ? comparison.decisionChange : quoteDailyChange,
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

    const comparison = calculateMarketSignals(closes);
    const metaPrice = result.meta && result.meta.regularMarketPrice;

    return {
      symbol,
      price: isFiniteNumber(metaPrice) ? metaPrice : comparison.latestClose,
      latestClose: comparison.latestClose,
      previousClose: comparison.previousClose,
      weekAgoClose: comparison.weekAgoClose,
      dailyChange: comparison.dailyChange,
      weeklyChange: comparison.weeklyChange,
      decisionChange: comparison.decisionChange,
      source: "Yahoo",
      note: "Yahoo Finance fallback",
      fetchedAt: Date.now()
    };
  }

  function calculateMarketSignals(closes) {
    const latestClose = closes[closes.length - 1];
    const previousClose = closes[closes.length - 2];
    const lookback = Math.min(5, closes.length - 1);
    const weekAgoClose = closes[closes.length - 1 - lookback];
    const dailyChange = round2(((latestClose - previousClose) / previousClose) * 100);
    const weeklyChange = round2(((latestClose - weekAgoClose) / weekAgoClose) * 100);
    const decisionChange = calculateDecisionChange(weeklyChange, dailyChange);
    return { latestClose, previousClose, weekAgoClose, dailyChange, weeklyChange, decisionChange };
  }

  function calculateDecisionChange() {
    const values = Array.prototype.slice.call(arguments).filter(isFiniteNumber);
    if (!values.length) return null;
    return Math.min.apply(null, values);
  }

  function getDecisionChange(row) {
    if (!row) return null;
    if (isFiniteNumber(row.decisionChange)) return row.decisionChange;
    return calculateDecisionChange(row.weeklyChange, row.dailyChange);
  }

  function getMultiplier(weeklyChange) {
    if (!isFiniteNumber(weeklyChange)) return 1;
    if (weeklyChange <= -15) return 2;
    if (weeklyChange <= -8) return 1.5;
    if (weeklyChange >= 10) return 0.5;
    return 1;
  }

  function buildSignalObject(stock, row) {
    const decisionChange = getDecisionChange(row);
    const manualOverrideActive = isFiniteNumber(state.overrides[stock.symbol]);
    const panicSupported = state.panicActive && CONFIG.panicSymbols.has(stock.symbol);
    const normalMultiplier = getMultiplier(decisionChange);
    const panicMultiplier = panicSupported ? CONFIG.panicMultiplier : 1;
    const multiplier = normalMultiplier * panicMultiplier;
    const baseBuyAmount = round2(CONFIG.weeklyDeployment * stock.allocation);
    const suggestedBuyAmount = round2(baseBuyAmount * multiplier);
    const dataAgeHours = row && row.fetchedAt ? (Date.now() - row.fetchedAt) / (60 * 60 * 1000) : null;

    const signal = {
      symbol: stock.symbol,
      latest_price: row && isFiniteNumber(row.price) ? row.price : null,
      daily_change: row && isFiniteNumber(row.dailyChange) ? row.dailyChange : null,
      weekly_change: row && isFiniteNumber(row.weeklyChange) ? row.weeklyChange : null,
      decision_change: isFiniteNumber(decisionChange) ? decisionChange : null,
      multiplier,
      base_buy_amount: baseBuyAmount,
      suggested_buy_amount: suggestedBuyAmount,
      signal_score: 0,
      signal_strength: "Data Needed",
      suggested_action: "DO_NOT_BUY",
      risk_level: "High",
      reason: "",
      warning: "",
      data_source: row && row.source ? row.source : "Unavailable",
      data_freshness: getDataFreshness(row, dataAgeHours),
      data_age_hours: isFiniteNumber(dataAgeHours) ? round2(dataAgeHours) : null,
      manual_override_active: manualOverrideActive,
      panic_active: panicSupported,
      note: row && row.note ? row.note : ""
    };

    signal.signal_score = calculateSignalScore({
      decisionChange: signal.decision_change,
      weeklyChange: signal.weekly_change,
      dailyChange: signal.daily_change,
      multiplier: signal.multiplier,
      panicActive: signal.panic_active,
      dataSource: signal.data_source,
      dataAgeHours: signal.data_age_hours,
      manualOverrideActive: signal.manual_override_active
    });
    signal.risk_level = calculateRiskLevel(signal);
    signal.suggested_action = getSuggestedAction(signal);
    signal.signal_strength = getSignalStrength(signal);
    signal.suggested_buy_amount = calculateRiskAdjustedBuyAmount(signal);
    signal.reason = generateSignalReason(signal);
    signal.warning = generateSignalWarning(signal);
    return signal;
  }

  function calculateSignalScore(input) {
    if (!isFiniteNumber(input.decisionChange)) return 10;

    let score = 50;
    const move = input.decisionChange;

    if (move <= -15) score += 35;
    else if (move <= -8) score += 22;
    else if (move < 0) score += 8;

    if (isFiniteNumber(input.weeklyChange) && input.weeklyChange <= -20) score += 6;
    if (isFiniteNumber(input.dailyChange) && input.dailyChange <= -8) score += 5;

    if (move >= 15) score -= 35;
    else if (move >= 10) score -= 25;
    else if (move >= 5) score -= 10;

    if (isFiniteNumber(input.dataAgeHours)) {
      if (input.dataAgeHours > 24) score -= 20;
      else if (input.dataAgeHours > 6) score -= 8;
    } else {
      score -= 25;
    }

    if (/cache/i.test(input.dataSource)) score -= 15;
    if (/manual/i.test(input.dataSource) || input.manualOverrideActive) score -= 10;
    if (/unavailable/i.test(input.dataSource)) score -= 45;

    if (input.panicActive) score += 6;
    if (input.multiplier >= 2) score += 8;
    else if (input.multiplier > 1) score += 5;
    else if (input.multiplier < 1) score -= 10;

    return clamp(Math.round(score), 0, 100);
  }

  function getSuggestedAction(signal) {
    if (signal.data_source === "Unavailable" || signal.data_freshness === "missing" || signal.data_freshness === "stale") return "DO_NOT_BUY";
    if (!isFiniteNumber(signal.decision_change)) return "DO_NOT_BUY";
    if (signal.decision_change >= 15) return "CONSIDER_SELL";
    if (signal.risk_level === "Extreme") return "DO_NOT_BUY";
    if (signal.signal_score <= 20) return "DO_NOT_BUY";
    if (signal.signal_score <= 40) return "REDUCE_BUY";
    if (signal.signal_score <= 60) return "NORMAL_BUY";
    if (signal.signal_score <= 80) return "BUY";
    return "STRONG_BUY";
  }

  function getSignalStrength(signal) {
    if (signal.suggested_action === "STRONG_BUY") return "Strong";
    if (signal.suggested_action === "BUY") return "Positive";
    if (signal.suggested_action === "NORMAL_BUY") return "Neutral";
    if (signal.suggested_action === "REDUCE_BUY") return "Reduced";
    if (signal.suggested_action === "CONSIDER_SELL") return "Sell Watch";
    return "Avoid";
  }

  function calculateRiskAdjustedBuyAmount(signal) {
    const strategyAmount = signal.base_buy_amount * signal.multiplier;
    if (signal.risk_level === "Extreme") return 0;
    if (signal.suggested_action === "DO_NOT_BUY" || signal.suggested_action === "CONSIDER_SELL") return 0;

    let amount = strategyAmount;
    if (signal.suggested_action === "REDUCE_BUY") amount = Math.min(strategyAmount, signal.base_buy_amount * 0.5);
    if (signal.suggested_action === "NORMAL_BUY") amount = signal.base_buy_amount;
    if (signal.risk_level === "High") amount *= 0.5;
    return round2(amount);
  }

  function calculateRiskLevel(signal) {
    if (signal.data_source === "Unavailable" || signal.data_freshness === "missing" || !isFiniteNumber(signal.decision_change)) return "Extreme";
    if (signal.data_freshness === "stale") return "High";

    let risk = 0;
    if (/cache|manual/i.test(signal.data_source) || signal.manual_override_active) risk += 1;
    if (isFiniteNumber(signal.decision_change) && Math.abs(signal.decision_change) >= 15) risk += 2;
    else if (isFiniteNumber(signal.decision_change) && Math.abs(signal.decision_change) >= 8) risk += 1;
    if (signal.panic_active) risk += 1;
    if (signal.multiplier >= 2) risk += 2;
    else if (signal.multiplier > 1.5) risk += 1;

    if (risk >= 5) return "Extreme";
    if (risk >= 3) return "High";
    if (risk >= 1) return "Medium";
    return "Low";
  }

  function generateSignalReason(signal) {
    if (signal.data_source === "Unavailable" || signal.data_freshness === "missing" || !isFiniteNumber(signal.decision_change)) {
      return "Market data is unavailable, so buying is blocked until fresh data is available.";
    }
    if (signal.data_freshness === "stale") {
      return "Market data is stale, so buying is blocked until fresh live or scheduled data is available.";
    }

    const move = Math.abs(signal.decision_change).toFixed(1) + "%";
    if (signal.decision_change <= -8) {
      return "The stock dropped " + move + " based on the lower of 1D and 5D changes, so the dip-buy strategy increases the manual buy amount.";
    }
    if (signal.decision_change >= 10) {
      return "The stock rose " + move + ", so the system reduces the manual buy amount to avoid chasing price strength.";
    }
    return "Neutral signal; base buy amount is used for manual review.";
  }

  function generateSignalWarning(signal) {
    const warnings = [];
    if (signal.data_source === "Unavailable" || signal.data_freshness === "missing" || !isFiniteNumber(signal.decision_change)) warnings.push("Market data unavailable");
    if (signal.data_freshness === "stale") warnings.push("Data may be stale");
    if (/cache/i.test(signal.data_source)) warnings.push("Using cache data");
    if (signal.manual_override_active) warnings.push("Manual override active");
    if (signal.panic_active) warnings.push("Panic mode active");
    if (isFiniteNumber(signal.weekly_change) && signal.weekly_change <= -15) warnings.push("Sharp weekly drop");
    if (isFiniteNumber(signal.decision_change) && signal.decision_change >= 10) warnings.push("Strong recent rise");
    if (
      signal.suggested_action === "REDUCE_BUY" ||
      signal.suggested_action === "CONSIDER_SELL" ||
      signal.suggested_action === "DO_NOT_BUY" ||
      signal.suggested_buy_amount < round2(signal.base_buy_amount * signal.multiplier)
    ) {
      warnings.push("Suggested buy amount reduced by risk rule");
    }
    return warnings.length ? warnings.join("; ") : "None";
  }

  function getDataFreshness(row, dataAgeHours) {
    if (!row || row.source === "Unavailable") return "missing";
    if (isFiniteNumber(dataAgeHours) && dataAgeHours > CONFIG.cacheHours) return "stale";
    return "fresh";
  }

  function applyManualOverrides() {
    state.portfolio.forEach(function (stock) {
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
          dailyChange: null,
          decisionChange: override,
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
    state.portfolio.forEach(function (stock) {
      const card = template.content.firstElementChild.cloneNode(true);
      ensureSignalFields(card);
      card.dataset.symbol = stock.symbol;
      card.querySelector("h3").textContent = stock.symbol;
      card.querySelector(".allocation").textContent = formatPercent(stock.allocation * 100) + " allocation";

      const input = card.querySelector(".override-input");
      input.value = state.overrides[stock.symbol] === undefined ? "" : formatSignedInput(state.overrides[stock.symbol]);
      card.querySelector(".source-badge").textContent = "Loading";
      card.querySelector(".weekly-change").textContent = "Loading";
      card.querySelector(".signal-strength").textContent = "Loading";
      card.querySelector(".risk-level").textContent = "Loading";
      card.querySelector(".multiplier").textContent = "1x";
      card.querySelector(".buy-amount").textContent = "CAD " + round2(CONFIG.weeklyDeployment * stock.allocation).toFixed(2);
      card.querySelector(".price").textContent = "Price loading";
      card.querySelector(".decision-reason").textContent = "Waiting for market data.";
      card.querySelector(".decision-warning").textContent = "None";

      card.querySelector(".apply-override").addEventListener("click", function () {
        applyOverride(stock.symbol, input.value);
      });
      card.querySelector(".clear-override").addEventListener("click", function () {
        clearOverride(stock.symbol);
      });
      card.querySelector(".remove-stock").addEventListener("click", function () {
        removeStock(stock.symbol);
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
      card.querySelector(".weekly-change").textContent = "Loading";
      card.querySelector(".signal-strength").textContent = "Loading";
      card.querySelector(".risk-level").textContent = "Loading";
      card.querySelector(".decision-reason").textContent = "Refreshing market data.";
      card.querySelector(".decision-warning").textContent = "None";
    });
  }

  function render() {
    panicBanner.classList.toggle("hidden", !state.panicActive);

    const orderLines = ["MANUAL TRADE PLAN", ""];
    const entries = [];
    let rawTotal = 0;
    let roundedTotal = 0;
    let latestTimestamp = 0;

    state.portfolio.forEach(function (stock) {
      const row = state.rows.get(stock.symbol);
      const signal = buildSignalObject(stock, row);
      const rawAmount = signal.suggested_buy_amount;
      const amount = round2(rawAmount);

      signal.suggested_buy_amount = amount;
      entries.push({ stock, row, signal, rawAmount });
      rawTotal += rawAmount;
      roundedTotal = round2(roundedTotal + amount);
      latestTimestamp = Math.max(latestTimestamp, row && row.fetchedAt ? row.fetchedAt : 0);
    });

    const targetTotal = round2(rawTotal);
    const pennyDifference = round2(targetTotal - roundedTotal);
    if (pennyDifference !== 0 && entries.length) {
      entries[0].signal.suggested_buy_amount = round2(entries[0].signal.suggested_buy_amount + pennyDifference);
    }

    entries.forEach(function (entry) {
      const card = cardsEl.querySelector('[data-symbol="' + entry.stock.symbol + '"]');
      updateCard(card, entry.signal);
      orderLines.push(formatManualTradePlanEntry(entry.signal));
    });

    window.__SUINVESTMENT_SIGNALS__ = entries.map(function (entry) {
      return entry.signal;
    });

    orderLines.push("");
    orderLines.push("Total:");
    orderLines.push("CAD " + targetTotal.toFixed(2));
    orderLines.push("");
    orderLines.push("This is a manual decision-support plan only. It does not place trades automatically. Review all signals, prices, risks, and available cash before placing any order yourself.");
    orderTextEl.textContent = orderLines.join("\n");
    lastUpdatedEl.textContent = latestTimestamp ? "Updated " + formatDateTime(latestTimestamp) : "No live data yet";
    renderPortfolioTotal();
  }

  function updateCard(card, signal) {
    ensureSignalFields(card);
    const badge = card.querySelector(".source-badge");
    const weeklyEl = card.querySelector(".weekly-change");

    badge.textContent = signal.data_source;
    badge.className = "source-badge " + sourceClass(signal.data_source);

    weeklyEl.className = "weekly-change";
    if (isFiniteNumber(signal.signal_score)) {
      weeklyEl.textContent = String(signal.signal_score);
      weeklyEl.classList.add(signal.signal_score >= 61 ? "positive" : "negative");
    } else {
      weeklyEl.textContent = "--";
    }

    card.querySelector(".signal-strength").textContent = signal.signal_strength;
    card.querySelector(".risk-level").textContent = signal.risk_level;
    card.querySelector(".multiplier").textContent = formatMultiplier(signal.multiplier);
    card.querySelector(".buy-amount").textContent = "CAD " + signal.suggested_buy_amount.toFixed(2);
    card.querySelector(".price").textContent = isFiniteNumber(signal.latest_price) ? "Price " + formatPrice(signal.latest_price) : "Price unavailable";
    card.querySelector(".decision-reason").textContent = signal.reason;
    card.querySelector(".decision-warning").textContent = signal.warning;

    const panicText = signal.panic_active ? " + panic 1.3x" : "";
    const signalText = formatSignalNote(signal);
    card.querySelector(".note").textContent = [signal.note, signalText, panicText.trim()]
      .filter(Boolean)
      .join("; ");
  }

  function ensureSignalFields(card) {
    const stockValues = card.querySelector(".stock-values");
    if (stockValues) {
      const signalScore = stockValues.querySelector(".weekly-change");
      if (signalScore && signalScore.previousElementSibling) {
        signalScore.previousElementSibling.textContent = "signal_score";
      }

      if (!stockValues.querySelector(".signal-strength")) {
        stockValues.insertBefore(createMetric("signal_strength", "signal-strength"), stockValues.children[1] || null);
      }

      if (!stockValues.querySelector(".risk-level")) {
        stockValues.insertBefore(createMetric("risk_level", "risk-level"), stockValues.children[2] || null);
      }
    }

    if (!card.querySelector(".decision-context")) {
      const context = document.createElement("div");
      context.className = "decision-context";
      context.appendChild(createTextBlock("reason", "decision-reason"));
      context.appendChild(createTextBlock("warning", "decision-warning"));
      const priceRow = card.querySelector(".price-row");
      card.insertBefore(context, priceRow || null);
    }
  }

  function createMetric(label, className) {
    const wrapper = document.createElement("div");
    const labelEl = document.createElement("span");
    const valueEl = document.createElement("strong");
    labelEl.textContent = label;
    valueEl.className = className;
    valueEl.textContent = "Loading";
    wrapper.appendChild(labelEl);
    wrapper.appendChild(valueEl);
    return wrapper;
  }

  function createTextBlock(label, className) {
    const wrapper = document.createElement("div");
    const labelEl = document.createElement("span");
    const valueEl = document.createElement("p");
    labelEl.textContent = label;
    valueEl.className = className;
    valueEl.textContent = "Waiting for market data.";
    wrapper.appendChild(labelEl);
    wrapper.appendChild(valueEl);
    return wrapper;
  }

  function formatManualTradePlanEntry(signal) {
    return [
      signal.symbol + " - " + signal.suggested_action + " - CAD " + signal.suggested_buy_amount.toFixed(2) + " - Score " + signal.signal_score + " - Risk " + signal.risk_level,
      "Reason: " + signal.reason,
      "Warning: " + signal.warning + "."
    ].join("\n");
  }

  function formatSignalNote(signal) {
    const parts = [];
    if (isFiniteNumber(signal.daily_change)) parts.push("1d " + formatSigned(signal.daily_change) + "%");
    if (isFiniteNumber(signal.weekly_change)) parts.push("5d " + formatSigned(signal.weekly_change) + "%");
    return parts.length ? parts.join(" / ") : "";
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
    state.cache[symbol] = {
      ...snapshot,
      fetchedAt: Date.now()
    };
    saveJson(STORAGE_KEYS.cache, state.cache);
  }

  function getValidCache(symbol) {
    const cached = state.cache[symbol];
    if (!cached || !cached.fetchedAt) return null;

    const ageMs = Date.now() - cached.fetchedAt;
    if (ageMs > CONFIG.cacheHours * 60 * 60 * 1000) return null;
    return cached;
  }

  function normalizePortfolio(items, options) {
    const allowCustom = options && options.allowCustom;
    const defaultSymbols = new Set(CONFIG.defaultStocks.map(function (stock) { return stock.symbol; }));
    const seen = new Set();
    return (Array.isArray(items) ? items : []).reduce(function (portfolio, item) {
      const symbol = normalizeSymbol(item && item.symbol);
      const allocation = Number(item && item.allocation);
      const supported = defaultSymbols.has(symbol);
      if (!symbol || (!supported && !allowCustom) || seen.has(symbol) || !Number.isFinite(allocation) || allocation < 0) {
        return portfolio;
      }

      seen.add(symbol);
      portfolio.push({
        symbol,
        name: String(item.name || symbol).trim() || symbol,
        allocation: round2(allocation * 100) / 100
      });
      return portfolio;
    }, []);
  }

  function normalizeSymbol(value) {
    const symbol = String(value || "").trim().toUpperCase();
    if (!/^[A-Z0-9.-]{1,12}$/.test(symbol)) return "";
    return symbol;
  }

  function parseAllocation(value) {
    const number = Number(String(value).trim().replace("%", ""));
    if (!Number.isFinite(number) || number < 0) return 0;
    return round2(number) / 100;
  }

  function renderPortfolioTotal() {
    const total = state.portfolio.reduce(function (sum, stock) {
      return sum + stock.allocation;
    }, 0);
    portfolioTotalEl.textContent = "Total allocation " + formatPercent(total * 100);
    portfolioTotalEl.classList.toggle("warning", Math.abs(total - 1) > 0.001);
  }

  function savePortfolio() {
    saveJson(STORAGE_KEYS.portfolio, state.portfolio);
  }

  function saveOverrides() {
    saveJson(STORAGE_KEYS.overrides, state.overrides);
  }

  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
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

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
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
    const rounded = round2(value);
    return (Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(2)) + "%";
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
