(function () {
  "use strict";

  const orderTextEl = document.getElementById("orderText");
  const orderRowsEl = document.getElementById("orderRows");
  const LANGUAGE_KEY = "su-investment-pro:language";

  if (!orderTextEl || !orderRowsEl) return;

  const observer = new MutationObserver(renderOrderRows);
  observer.observe(orderTextEl, { childList: true, characterData: true, subtree: true });
  renderOrderRows();

  function renderOrderRows() {
    const lines = orderTextEl.textContent.split("\n").map(function (line) {
      return line.trim();
    }).filter(Boolean);

    const orders = lines.map(parseOrderLine).filter(Boolean);
    const totalIndex = lines.findIndex(function (line) {
      return /^(Total|合计):?$/i.test(line);
    });
    const totalLine = totalIndex >= 0 ? lines[totalIndex + 1] : "";

    orderRowsEl.innerHTML = "";

    if (!orders.length) {
      const empty = document.createElement("div");
      empty.className = "order-row empty";
      empty.textContent = "Waiting for order amounts";
      orderRowsEl.appendChild(empty);
      return;
    }

    orders.forEach(function (order) {
      const row = document.createElement("div");
      row.className = "order-row";

      const symbol = document.createElement("strong");
      symbol.textContent = order.symbol;

      const action = document.createElement("span");
      action.textContent = order.action;

      const amount = document.createElement("span");
      amount.textContent = "CAD " + order.amount;

      const score = document.createElement("span");
      score.textContent = label("score") + " " + order.score;

      const risk = document.createElement("span");
      risk.textContent = label("risk") + " " + order.risk;

      row.append(symbol, action, amount, score, risk);
      orderRowsEl.appendChild(row);
    });

    if (totalLine) {
      const total = document.createElement("div");
      total.className = "order-row total";

      const label = document.createElement("strong");
      label.textContent = labelText("total");

      const amount = document.createElement("span");
      amount.textContent = totalLine;

      total.append(label, amount);
      orderRowsEl.appendChild(total);
    }
  }

  function parseOrderLine(line) {
    if (/^(Reason|Warning|Total|原因|警告|合计):?/i.test(line)) return null;
    if (/manual decision[- ]support/i.test(line)) return null;
    if (/手动决策支持|自动交易|券商登录|真实订单/.test(line)) return null;

    const rich = line.match(/^(\S+)\s+-\s+(.+?)\s+-\s+CAD\s+([0-9]+(?:\.[0-9]{1,2})?)\s+-\s+(?:Score|分数)\s+(\d+)\s+-\s+(?:Risk|风险)\s+(.+)$/i);
    if (rich) {
      return {
        symbol: rich[1],
        action: rich[2].toUpperCase(),
        amount: Number(rich[3]).toFixed(2),
        score: rich[4],
        risk: rich[5]
      };
    }

    const legacy = line.match(/^(\S+)\s+-\s+CAD\s+([0-9]+(?:\.[0-9]{1,2})?)$/i);
    if (legacy) {
      return {
        symbol: legacy[1],
        action: "MANUAL",
        amount: Number(legacy[2]).toFixed(2),
        score: "--",
        risk: "--"
      };
    }

    return null;
  }

  function currentLanguage() {
    return localStorage.getItem(LANGUAGE_KEY) === "zh" ? "zh" : "en";
  }

  function label(name) {
    if (currentLanguage() === "zh") return name === "score" ? "分数" : "风险";
    return name === "score" ? "Score" : "Risk";
  }

  function labelText(name) {
    if (currentLanguage() === "zh") return name === "total" ? "合计" : name;
    return name === "total" ? "Total" : name;
  }
})();
