(function () {
  "use strict";

  const template = document.getElementById("stockCardTemplate");
  const card = template && template.content && template.content.firstElementChild;
  if (!card) return;

  ensureSignalFields(card);

  function ensureSignalFields(root) {
    const stockValues = root.querySelector(".stock-values");
    if (stockValues) {
      const score = stockValues.querySelector(".weekly-change");
      if (score && score.previousElementSibling) {
        score.previousElementSibling.textContent = "signal_score";
      }

      if (!stockValues.querySelector(".signal-strength")) {
        stockValues.insertBefore(createMetric("signal_strength", "signal-strength"), stockValues.children[1] || null);
      }

      if (!stockValues.querySelector(".risk-level")) {
        stockValues.insertBefore(createMetric("risk_level", "risk-level"), stockValues.children[2] || null);
      }
    }

    if (!root.querySelector(".decision-context")) {
      const context = document.createElement("div");
      context.className = "decision-context";
      context.appendChild(createTextBlock("reason", "decision-reason"));
      context.appendChild(createTextBlock("warning", "decision-warning"));
      const priceRow = root.querySelector(".price-row");
      root.insertBefore(context, priceRow || null);
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
})();
