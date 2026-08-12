(function (root) {
  "use strict";
  function amountText(value, currency) { return (currency || "CAD") + " " + Number(value || 0).toFixed(2); }
  function parseOrderLine(line) {
    var match = String(line || "").match(/^(\S+)\s*：\s*.*?最终人工计划\s+([A-Z]{3})\s+([0-9]+(?:\.[0-9]+)?)/);
    if (!match) return null;
    return { symbol: match[1], currency: match[2], amount: Number(match[3]).toFixed(2), action: "人工计划" };
  }
  function renderOrderRows() {
    var text = document.getElementById("orderText"), host = document.getElementById("orderRows");
    if (!text || !host) return;
    host.innerHTML = "";
    var plan = root.__SUINVESTMENT_WEALTHSIMPLE_PLAN__ && root.__SUINVESTMENT_WEALTHSIMPLE_PLAN__.plan;
    var rows = plan && Array.isArray(plan.items) ? plan.items.map(function (item) { return { symbol: item.symbol, currency: plan.planningCurrency || "CAD", amount: Number(item.finalAmount || 0).toFixed(2), action: "人工计划" }; }) : text.textContent.split("\n").map(parseOrderLine).filter(Boolean);
    if (!rows.length) { var empty = document.createElement("div"); empty.className = "order-row empty"; empty.textContent = "等待人工计划金额"; host.appendChild(empty); return; }
    rows.forEach(function (order) { var row = document.createElement("div"); row.className = "order-row"; var symbol = document.createElement("strong"); symbol.textContent = order.symbol; var action = document.createElement("span"); action.textContent = order.action; var amount = document.createElement("span"); amount.textContent = amountText(order.amount, order.currency); row.append(symbol, action, amount); host.appendChild(row); });
  }
  if (typeof module === "object" && module.exports) module.exports = { parseOrderLine: parseOrderLine, amountText: amountText };
  if (typeof document === "undefined") return;
  var text = document.getElementById("orderText");
  if (text && typeof MutationObserver !== "undefined") new MutationObserver(renderOrderRows).observe(text, { childList: true, characterData: true, subtree: true });
  root.addEventListener("wealthsimple:plan-updated", renderOrderRows);
  renderOrderRows();
})(typeof globalThis !== "undefined" ? globalThis : window);
