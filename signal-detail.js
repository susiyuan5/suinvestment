(function () {
  "use strict";

  const cardsEl = document.getElementById("cards");
  if (!cardsEl) return;

  let isApplying = false;
  let applyTimer = 0;
  const observer = new MutationObserver(scheduleDashboardDetails);
  observeCards();
  applyDashboardDetails();

  function observeCards() {
    observer.observe(cardsEl, { childList: true, characterData: true, subtree: true });
  }

  function scheduleDashboardDetails() {
    if (isApplying) return;
    window.clearTimeout(applyTimer);
    applyTimer = window.setTimeout(applyDashboardDetails, 50);
  }

  function applyDashboardDetails() {
    if (isApplying) return;
    isApplying = true;
    observer.disconnect();
    try {
      renameDashboard();
      formatSignalDetails();
      updateDecisionCards();
      renameManualTradePlan();
    } finally {
      isApplying = false;
      observeCards();
    }
  }

  function renameDashboard() {
    document.title = "Quant Decision Dashboard";
    const heading = document.querySelector(".hero h1");
    if (heading) heading.textContent = "Quant Decision Dashboard";
  }

  function renameManualTradePlan() {
    const orderTitle = document.getElementById("order-title");
    if (orderTitle) orderTitle.textContent = "Manual Trade Plan";

    const orderText = document.getElementById("orderText");
    if (orderText && /^THIS WEEK ORDER/.test(orderText.textContent)) {
      orderText.textContent = orderText.textContent.replace(/^THIS WEEK ORDER/, "MANUAL TRADE PLAN");
    }
  }

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

  function updateDecisionCards() {
    cardsEl.querySelectorAll(".stock-card").forEach(function (card) {
      ensureDecisionFields(card);

      const signalEl = card.querySelector(".weekly-change");
      const rawSignalText = signalEl ? signalEl.textContent.trim() : "";
      const parsedSignal = matchSignal(rawSignalText, /^([+-]?\d+(?:\.\d+)?)%$/);
      if (/loading|manual needed/i.test(rawSignalText)) delete card.dataset.phase1Signal;
      if (parsedSignal !== null) card.dataset.phase1Signal = String(parsedSignal);
      const signal = parsedSignal !== null
        ? parsedSignal
        : card.dataset.phase1Signal === undefined ? null : Number(card.dataset.phase1Signal);
      const noteText = card.querySelector(".note") ? card.querySelector(".note").textContent.trim() : "";
      const detail = parseSignalText(noteText);
      const manual = /manual/i.test(noteText);
      const warnings = getWarnings(noteText);
      const score = signal === null ? null : clamp(Math.round(50 - signal * 3), 0, 100);

      if (signalEl && signal !== null) {
        signalEl.textContent = String(score);
      } else if (signalEl && /manual needed|loading/i.test(rawSignalText)) {
        signalEl.textContent = rawSignalText;
      }

      setText(card, ".signal-strength", getSignalStrength(signal, manual, rawSignalText));
      setText(card, ".risk-level", getRiskLevel(signal, noteText, manual));
      setText(card, ".decision-reason", getReason(signal, detail, manual));
      setText(card, ".decision-warning", warnings.length ? warnings.join("; ") : "None");
    });
  }

  function ensureDecisionFields(card) {
    const stockValues = card.querySelector(".stock-values");
    if (!stockValues) return;

    const signalLabel = stockValues.querySelector(".weekly-change") && stockValues.querySelector(".weekly-change").previousElementSibling;
    if (signalLabel) signalLabel.textContent = "signal_score";

    if (!stockValues.querySelector(".signal-strength")) {
      stockValues.insertBefore(createMetric("signal_strength", "signal-strength"), stockValues.children[1] || null);
    }

    if (!stockValues.querySelector(".risk-level")) {
      stockValues.insertBefore(createMetric("risk_level", "risk-level"), stockValues.children[2] || null);
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

  function getSignalStrength(signal, manual, rawSignalText) {
    if (manual) return "Manual";
    if (/loading/i.test(rawSignalText)) return "Loading";
    if (signal === null) return "Data Needed";
    if (signal <= -15) return "Strong Buy";
    if (signal <= -8) return "Buy";
    if (signal < 0) return "Watch Buy";
    if (signal >= 10) return "Reduce";
    return "Neutral";
  }

  function getRiskLevel(signal, noteText, manual) {
    if (manual) return "Manual";
    if (/unavailable|failed|saved snapshot/i.test(noteText)) return "Medium";
    if (signal === null) return "High";
    if (signal <= -15) return "High";
    if (signal <= -8 || signal >= 10) return "Medium";
    return "Low";
  }

  function getReason(signal, detail, manual) {
    if (manual) return "Manual override is active for this ticker.";
    if (signal === null) return "No usable signal yet; use manual review before trading.";

    const source = detail && detail.daily !== null && detail.weekly !== null ? "lower of 1D and 5D moves" : "available market signal";
    const signalText = formatSigned(signal) + "%";
    if (signal <= -15) return "Sharp drop from " + source + " (" + signalText + "); strong buy setup for manual review.";
    if (signal <= -8) return "Pullback from " + source + " (" + signalText + "); buy setup for manual review.";
    if (signal >= 10) return "Strong recent rise (" + signalText + "); reduce manual buy size.";
    return "Neutral signal (" + signalText + "); use base manual trade amount.";
  }

  function getWarnings(noteText) {
    const warnings = [];
    if (/daily candles unavailable/i.test(noteText)) warnings.push("Daily candles unavailable");
    if (/unavailable/i.test(noteText)) warnings.push("Market data unavailable");
    if (/failed|saved snapshot|cache/i.test(noteText)) warnings.push("Using fallback data");
    if (/scheduled snapshot/i.test(noteText)) warnings.push("Includes scheduled snapshot");
    if (/panic/i.test(noteText)) warnings.push("Panic multiplier active");
    return warnings;
  }

  function setText(root, selector, value) {
    const element = root.querySelector(selector);
    if (element) element.textContent = value;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
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
