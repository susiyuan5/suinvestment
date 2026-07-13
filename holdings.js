(function () {
  "use strict";

  const STORAGE = { portfolio: "su-investment-pro:portfolio", portfolioRisk: "su-investment-pro:portfolio-risk" };
  const DEFAULT_PORTFOLIO = [
    { symbol: "BYDDY", allocation: 0.30 }, { symbol: "MSFT", allocation: 0.22 }, { symbol: "NVDA", allocation: 0.18 },
    { symbol: "AAPL", allocation: 0.15 }, { symbol: "ASML", allocation: 0.10 }, { symbol: "KO", allocation: 0.05 }
  ];
  const elements = {
    rows: document.getElementById("holdingsRows"), empty: document.getElementById("emptyState"), totalStock: document.getElementById("totalStockValue"),
    cash: document.getElementById("availableCash"), totalPortfolio: document.getElementById("totalPortfolioValue"), totalPnl: document.getElementById("totalUnrealizedPnl"),
    count: document.getElementById("holdingCount"), snapshot: document.getElementById("snapshotStatus"), updated: document.getElementById("lastUpdated"), refresh: document.getElementById("refreshButton")
  };

  function number(value) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : 0; }
  function readJson(key, fallback) { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; } }
  function formatCurrency(value) { return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 2 }).format(value || 0); }
  function formatNumber(value) { return new Intl.NumberFormat("en-CA", { maximumFractionDigits: 4 }).format(value || 0); }
  function escapeHtml(value) { return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;"); }
  function savedPortfolio() { const source = readJson(STORAGE.portfolio, DEFAULT_PORTFOLIO); return Array.isArray(source) && source.length ? source : DEFAULT_PORTFOLIO; }
  function tone(value) { return value > 0 ? "positive" : value < 0 ? "negative" : "neutral"; }

  function quoteFor(symbol, snapshot) {
    const quote = snapshot && snapshot.symbols && snapshot.symbols[symbol];
    if (!quote) return { price: 0, label: "Missing / 缺失" };
    const label = quote.validationStatus === "validated" ? "Fresh / 新鲜" : quote.validationStatus === "market_closed_last_close" ? "Market closed / 市场关闭" : "Review / 复核";
    return { price: number(quote.latestClose || quote.price), label, date: quote.latestDate || "", source: quote.source || "" };
  }

  async function loadSnapshot() {
    const response = await fetch("data/market-data.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Snapshot unavailable");
    return response.json();
  }

  function render(snapshot) {
    const risk = readJson(STORAGE.portfolioRisk, {});
    const positions = risk && risk.positions && typeof risk.positions === "object" ? risk.positions : {};
    const cashProvided = risk && risk.available_cash_provided === true;
    const availableCash = cashProvided ? number(risk.available_cash) : 0;
    const rows = savedPortfolio().map(function (stock) {
      const input = positions[stock.symbol] || {};
      const shares = number(input.shares), averageCost = number(input.average_cost), manualValue = number(input.current_value), quote = quoteFor(stock.symbol, snapshot);
      const marketValue = manualValue || quote.price * shares, costBasis = shares * averageCost;
      return { symbol: stock.symbol, shares, averageCost, marketValue, costBasis, pnl: marketValue - costBasis, target: number(input.target_allocation) || (Number(stock.allocation) || 0) * 100, quote, notes: input.notes || "" };
    }).filter(function (position) { return position.shares > 0 || position.marketValue > 0 || position.costBasis > 0; });
    const stockValue = rows.reduce(function (sum, row) { return sum + row.marketValue; }, 0);
    const totalValue = stockValue + availableCash;
    const totalPnl = rows.reduce(function (sum, row) { return sum + row.pnl; }, 0);

    elements.rows.innerHTML = rows.map(function (row) {
      const allocation = totalValue > 0 ? row.marketValue / totalValue * 100 : 0;
      const priceMeta = [row.quote.date, row.quote.source].filter(Boolean).join(" | ");
      return "<tr><th scope=\"row\">" + escapeHtml(row.symbol) + "</th><td><strong>" + (row.quote.price ? formatCurrency(row.quote.price) : "--") + "</strong><small>" + escapeHtml(priceMeta || "No local quote") + "</small></td><td>" + formatNumber(row.shares) + "</td><td>" + formatCurrency(row.averageCost) + "</td><td>" + formatCurrency(row.costBasis) + "</td><td>" + formatCurrency(row.marketValue) + "</td><td class=\"" + tone(row.pnl) + "\">" + formatCurrency(row.pnl) + "</td><td>" + allocation.toFixed(2) + "%</td><td>" + row.target.toFixed(2) + "%</td><td><span class=\"status-pill\">" + escapeHtml(row.quote.label) + "</span></td><td>" + escapeHtml(row.notes || "--") + "</td></tr>";
    }).join("");
    elements.empty.hidden = rows.length > 0;
    elements.totalStock.textContent = formatCurrency(stockValue);
    elements.cash.textContent = cashProvided ? formatCurrency(availableCash) : "Not provided / 未提供";
    elements.totalPortfolio.textContent = formatCurrency(totalValue);
    elements.totalPnl.textContent = formatCurrency(totalPnl);
    elements.totalPnl.className = tone(totalPnl);
    elements.count.textContent = String(rows.length);
    elements.snapshot.textContent = snapshot && snapshot.generatedAt ? "Loaded / 已加载" : "Unavailable / 不可用";
    elements.updated.textContent = snapshot && snapshot.generatedAt ? "Snapshot: " + new Date(snapshot.generatedAt).toLocaleString() : "No local snapshot";
  }

  async function refresh() {
    elements.snapshot.textContent = "Loading / 加载中";
    try { render(await loadSnapshot()); } catch (_) { render(null); elements.snapshot.textContent = "Unavailable / 不可用"; }
  }

  elements.refresh.addEventListener("click", refresh);
  refresh();
}());
