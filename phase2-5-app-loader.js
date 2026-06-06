(function () {
  "use strict";

  const APP_URL = "app.js?v=phase2-signal-engine-2";

  fetch(APP_URL)
    .then(function (response) {
      if (!response.ok) throw new Error("Unable to load app.js: " + response.status);
      return response.text();
    })
    .then(function (source) {
      const patched = patchAppSource(source);
      (0, eval)(patched + "\n//# sourceURL=app.phase2-5.js");
    })
    .catch(function (error) {
      console.error("Phase 2.5 loader failed", error);
      const script = document.createElement("script");
      script.src = APP_URL;
      document.body.appendChild(script);
    });

  function patchAppSource(source) {
    let code = source;

    code = code.replace(
      '    signal.suggested_action = getSuggestedAction(signal);\n    signal.signal_strength = getSignalStrength(signal);\n    signal.risk_level = calculateRiskLevel(signal);',
      '    signal.risk_level = calculateRiskLevel(signal);\n    signal.suggested_action = getSuggestedAction(signal);\n    signal.signal_strength = getSignalStrength(signal);'
    );

    code = code.replace(
      /  function getSuggestedAction\(signal\) \{[\s\S]*?\n  \}\n\n  function getSignalStrength/,
      '  function getSuggestedAction(signal) {\n    if (signal.data_source === "Unavailable" || signal.data_freshness === "missing" || signal.data_freshness === "stale") return "DO_NOT_BUY";\n    if (!isFiniteNumber(signal.decision_change)) return "DO_NOT_BUY";\n    if (signal.decision_change >= 15) return "CONSIDER_SELL";\n    if (signal.risk_level === "Extreme") return "DO_NOT_BUY";\n    if (signal.signal_score <= 20) return "DO_NOT_BUY";\n    if (signal.signal_score <= 40) return "REDUCE_BUY";\n    if (signal.signal_score <= 60) return "NORMAL_BUY";\n    if (signal.signal_score <= 80) return "BUY";\n    return "STRONG_BUY";\n  }\n\n  function getSignalStrength'
    );

    code = code.replace(
      /  function calculateRiskAdjustedBuyAmount\(signal\) \{[\s\S]*?\n  \}\n\n  function calculateRiskLevel/,
      '  function calculateRiskAdjustedBuyAmount(signal) {\n    const strategyAmount = signal.base_buy_amount * signal.multiplier;\n    if (signal.risk_level === "Extreme") return 0;\n    if (signal.suggested_action === "DO_NOT_BUY" || signal.suggested_action === "CONSIDER_SELL") return 0;\n\n    let amount = strategyAmount;\n    if (signal.suggested_action === "REDUCE_BUY") amount = Math.min(strategyAmount, signal.base_buy_amount * 0.5);\n    if (signal.suggested_action === "NORMAL_BUY") amount = signal.base_buy_amount;\n    if (signal.risk_level === "High") amount *= 0.5;\n    return round2(amount);\n  }\n\n  function calculateRiskLevel'
    );

    code = code.replace(
      /  function calculateRiskLevel\(signal\) \{[\s\S]*?\n  \}\n\n  function generateSignalReason/,
      '  function calculateRiskLevel(signal) {\n    if (signal.data_source === "Unavailable" || signal.data_freshness === "missing" || !isFiniteNumber(signal.decision_change)) return "Extreme";\n    if (signal.data_freshness === "stale") return "High";\n\n    let risk = 0;\n    if (/cache|manual/i.test(signal.data_source) || signal.manual_override_active) risk += 1;\n    if (isFiniteNumber(signal.decision_change) && Math.abs(signal.decision_change) >= 15) risk += 2;\n    else if (isFiniteNumber(signal.decision_change) && Math.abs(signal.decision_change) >= 8) risk += 1;\n    if (signal.panic_active) risk += 1;\n    if (signal.multiplier >= 2) risk += 2;\n    else if (signal.multiplier > 1.5) risk += 1;\n\n    if (risk >= 5) return "Extreme";\n    if (risk >= 3) return "High";\n    if (risk >= 1) return "Medium";\n    return "Low";\n  }\n\n  function generateSignalReason'
    );

    code = code.replace(
      /  function generateSignalReason\(signal\) \{[\s\S]*?\n  \}\n\n  function generateSignalWarning/,
      '  function generateSignalReason(signal) {\n    if (signal.data_source === "Unavailable" || signal.data_freshness === "missing" || !isFiniteNumber(signal.decision_change)) {\n      return "Market data is unavailable, so buying is blocked until fresh data is available.";\n    }\n    if (signal.data_freshness === "stale") {\n      return "Market data is stale, so buying is blocked until fresh live or scheduled data is available.";\n    }\n\n    const move = Math.abs(signal.decision_change).toFixed(1) + "%";\n    if (signal.decision_change <= -8) {\n      return "The stock dropped " + move + " based on the lower of 1D and 5D changes, so the dip-buy strategy increases the manual buy amount.";\n    }\n    if (signal.decision_change >= 10) {\n      return "The stock rose " + move + ", so the system reduces the manual buy amount to avoid chasing price strength.";\n    }\n    return "Neutral signal; base buy amount is used for manual review.";\n  }\n\n  function generateSignalWarning'
    );

    code = code.replace(
      '    if (signal.data_source === "Unavailable" || !isFiniteNumber(signal.decision_change)) warnings.push("Market data unavailable");',
      '    if (signal.data_source === "Unavailable" || signal.data_freshness === "missing" || !isFiniteNumber(signal.decision_change)) warnings.push("Market data unavailable");'
    );

    code = code.replace(
      '    orderLines.push("");\n    orderLines.push("Total:");',
      '    window.__SUINVESTMENT_SIGNALS__ = entries.map(function (entry) {\n      return entry.signal;\n    });\n\n    orderLines.push("");\n    orderLines.push("Total:");'
    );

    code = code.replace(
      '    orderLines.push("CAD " + targetTotal.toFixed(2));\n    orderTextEl.textContent = orderLines.join("\\n");',
      '    orderLines.push("CAD " + targetTotal.toFixed(2));\n    orderLines.push("");\n    orderLines.push("This is a manual decision-support plan only. It does not place trades automatically. Review all signals, prices, risks, and available cash before placing any order yourself.");\n    orderTextEl.textContent = orderLines.join("\\n");'
    );

    return code;
  }
})();
