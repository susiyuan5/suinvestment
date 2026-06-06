(function () {
  "use strict";

  // This file only formats note display. Signal calculation is handled in app.js.
  const LANGUAGE_KEY = "su-investment-pro:language";
  const cardsEl = document.getElementById("cards");
  if (!cardsEl) return;

  let isFormatting = false;
  let formatTimer = 0;
  const observer = new MutationObserver(scheduleFormat);
  observeCards();
  formatSignalDetails();

  function observeCards() {
    observer.observe(cardsEl, { childList: true, characterData: true, subtree: true });
  }

  function scheduleFormat() {
    if (isFormatting) return;
    window.clearTimeout(formatTimer);
    formatTimer = window.setTimeout(formatSignalDetails, 50);
  }

  function formatSignalDetails() {
    if (isFormatting) return;
    isFormatting = true;
    observer.disconnect();
    try {
      cardsEl.querySelectorAll(".stock-card .note").forEach(formatNote);
    } finally {
      isFormatting = false;
      observeCards();
    }
  }

  function formatNote(noteEl) {
    const rawText = noteEl.textContent.trim();
    if (!rawText || noteEl.dataset.signalFormatted === rawText) return;

    const detail = parseSignalText(rawText);
    if (!detail) return;

    noteEl.dataset.signalFormatted = rawText;
    noteEl.textContent = "";

    const source = document.createElement("span");
    source.className = "signal-source";
    source.textContent = detail.source;
    noteEl.appendChild(source);

    if (detail.daily !== null || detail.weekly !== null) {
      const breakdown = document.createElement("span");
      breakdown.className = "signal-breakdown";
      if (detail.daily !== null) breakdown.appendChild(createPill("1D", detail.daily));
      if (detail.weekly !== null) breakdown.appendChild(createPill("5D", detail.weekly));
      noteEl.appendChild(breakdown);
    }

    if (detail.warning) {
      const warning = document.createElement("span");
      warning.className = "signal-warning";
      warning.textContent = detail.warning;
      noteEl.appendChild(warning);
    }
  }

  function parseSignalText(text) {
    const daily = matchSignal(text, /1d\s+([+-]?\d+(?:\.\d+)?)%/i);
    const weekly = matchSignal(text, /5d\s+([+-]?\d+(?:\.\d+)?)%/i);
    const lowerText = text.toLowerCase();
    const warnings = [];

    if (lowerText.includes("panic") || text.includes("恐慌")) warnings.push(textFor("panicMultiplier"));
    if (lowerText.includes("daily candles unavailable")) warnings.push(textFor("dailyCandlesUnavailable"));

    if (daily === null && weekly === null && !warnings.length) return null;

    return {
      daily,
      weekly,
      source: sourceLabel(text),
      warning: warnings.join("; ")
    };
  }

  function sourceLabel(text) {
    const lowerText = text.toLowerCase();
    if (lowerText.includes("manual override") || text.includes("手动覆盖")) return textFor("manualOverride");
    if (lowerText.includes("cache")) return textFor("cachedSnapshot");
    if (lowerText.includes("scheduled snapshot")) return textFor("scheduledSnapshot");
    if (lowerText.includes("yahoo")) return textFor("yahooFallback");
    if (lowerText.includes("finnhub")) return textFor("finnhubQuote");
    return textFor("marketData");
  }

  function matchSignal(text, pattern) {
    const match = text.match(pattern);
    return match ? Number(match[1]) : null;
  }

  function createPill(label, value) {
    const pill = document.createElement("span");
    pill.className = "signal-pill " + (value < 0 ? "negative" : "positive");
    pill.textContent = label + " " + formatSigned(value) + "%";
    return pill;
  }

  function formatSigned(value) {
    return (value > 0 ? "+" : "") + value.toFixed(2);
  }

  function language() {
    return localStorage.getItem(LANGUAGE_KEY) === "zh" ? "zh" : "en";
  }

  function textFor(key) {
    const dictionary = {
      en: {
        panicMultiplier: "Panic multiplier active",
        dailyCandlesUnavailable: "Daily candles unavailable",
        manualOverride: "Manual override",
        cachedSnapshot: "Cached snapshot",
        scheduledSnapshot: "Market data + scheduled snapshot",
        yahooFallback: "Yahoo Finance fallback",
        finnhubQuote: "Finnhub live quote",
        marketData: "Market data"
      },
      zh: {
        panicMultiplier: "恐慌倍数已启用",
        dailyCandlesUnavailable: "日线数据不可用",
        manualOverride: "手动覆盖",
        cachedSnapshot: "缓存快照",
        scheduledSnapshot: "市场数据 + 计划快照",
        yahooFallback: "Yahoo Finance 备用",
        finnhubQuote: "Finnhub 实时报价",
        marketData: "市场数据"
      }
    };
    return dictionary[language()][key] || dictionary.en[key] || key;
  }
})();
