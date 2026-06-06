(function () {
  "use strict";

  const cardsEl = document.getElementById("cards");
  if (!cardsEl) return;

  const observer = new MutationObserver(formatSignalDetails);
  observer.observe(cardsEl, { childList: true, characterData: true, subtree: true });
  formatSignalDetails();

  function formatSignalDetails() {
    cardsEl.querySelectorAll(".stock-card .note").forEach(function (noteEl) {
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
    });
  }

  function parseSignalText(text) {
    const daily = matchSignal(text, /1d\s+([+-]?\d+(?:\.\d+)?)%/i);
    const weekly = matchSignal(text, /5d\s+([+-]?\d+(?:\.\d+)?)%/i);
    const lowerText = text.toLowerCase();
    const warnings = [];

    if (lowerText.includes("panic")) warnings.push("Panic multiplier active");
    if (lowerText.includes("daily candles unavailable")) warnings.push("Daily candles unavailable");

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
    if (lowerText.includes("manual override")) return "Manual override";
    if (lowerText.includes("cache")) return "Cached snapshot";
    if (lowerText.includes("scheduled snapshot")) return "Finnhub + scheduled snapshot";
    if (lowerText.includes("yahoo")) return "Yahoo Finance fallback";
    if (lowerText.includes("finnhub")) return "Finnhub live quote";
    return "Market data";
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
})();
