(function () {
  "use strict";

  const orderTextEl = document.getElementById("orderText");
  const orderRowsEl = document.getElementById("orderRows");

  if (!orderTextEl || !orderRowsEl) return;

  const observer = new MutationObserver(renderOrderRows);
  observer.observe(orderTextEl, { childList: true, characterData: true, subtree: true });
  renderOrderRows();

  function renderOrderRows() {
    const lines = orderTextEl.textContent.split("\n").map(function (line) {
      return line.trim();
    }).filter(Boolean);

    const stockLines = lines.filter(function (line) {
      return /^\S+\s+[-—]\s+CAD\s+/i.test(line);
    });
    const totalIndex = lines.findIndex(function (line) {
      return /^Total:?$/i.test(line);
    });
    const totalLine = totalIndex >= 0 ? lines[totalIndex + 1] : "";

    orderRowsEl.innerHTML = "";

    if (!stockLines.length) {
      const empty = document.createElement("div");
      empty.className = "order-row empty";
      empty.textContent = "Waiting for order amounts";
      orderRowsEl.appendChild(empty);
      return;
    }

    stockLines.forEach(function (line) {
      const match = line.match(/^(\S+)\s+[-—]\s+CAD\s+(.+)$/i);
      if (!match) return;

      const row = document.createElement("div");
      row.className = "order-row";

      const symbol = document.createElement("strong");
      symbol.textContent = match[1];

      const amount = document.createElement("span");
      amount.textContent = "CAD " + match[2];

      row.append(symbol, amount);
      orderRowsEl.appendChild(row);
    });

    if (totalLine) {
      const total = document.createElement("div");
      total.className = "order-row total";

      const label = document.createElement("strong");
      label.textContent = "Total";

      const amount = document.createElement("span");
      amount.textContent = totalLine;

      total.append(label, amount);
      orderRowsEl.appendChild(total);
    }
  }
})();
