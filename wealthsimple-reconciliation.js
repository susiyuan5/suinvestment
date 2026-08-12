(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.WealthsimpleReconciliation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  var VERSION = "wealthsimple-reconciliation-v1";
  function now() { return new Date().toISOString(); }
  function normalize(entry) { var value = entry && typeof entry === "object" ? entry : {}; return Object.assign({ id: "", createdAt: now(), updatedAt: now(), tradeDateTime: "", accountId: "", symbol: "", side: "BUY", actualShares: null, actualPrice: null, currency: "", actualFxAmount: null, actualFee: null, orderId: "", note: "", status: "PLANNED", plannedAmount: null, remainingShares: null }, value, { version: VERSION }); }
  function createLedger(existing) { return { version: VERSION, createdAt: existing && existing.createdAt || now(), updatedAt: now(), entries: existing && Array.isArray(existing.entries) ? existing.entries.map(normalize) : [] }; }
  function add(ledger, entry) { var next = createLedger(ledger); var item = normalize(entry); if (!item.id) item.id = item.orderId || "manual-" + Date.now(); if (item.orderId && next.entries.some(function (row) { return row.orderId === item.orderId; })) return { ok: false, code: "duplicate_order_id", ledger: next }; if (next.entries.some(function (row) { return row.id === item.id; })) return { ok: false, code: "duplicate_id", ledger: next }; next.entries.push(item); next.updatedAt = now(); return { ok: true, ledger: next, entry: item }; }
  function importJson(ledger, payload) { var source = typeof payload === "string" ? JSON.parse(payload) : payload; var imported = Array.isArray(source) ? source : source && source.entries; if (!Array.isArray(imported)) throw new Error("成交记录 JSON 格式无效"); var next = createLedger(ledger); var skipped = 0; imported.forEach(function (entry) { var result = add(next, entry); if (result.ok) next = result.ledger; else skipped += 1; }); return { ledger: next, skipped: skipped }; }
  function applyToHoldings(entry, holdings, confirmation) { if (confirmation !== "再次确认") return { ok: false, reason: "需要再次确认" }; var actualShares = Number(entry.actualShares), actualPrice = Number(entry.actualPrice); if (!Number.isFinite(actualShares) || actualShares <= 0 || !Number.isFinite(actualPrice) || actualPrice <= 0 || entry.status !== "FILLED") return { ok: false, reason: "只有已成交且实际成交数据完整时才能应用" }; var next = Object.assign({}, holdings), current = Object.assign({ shares: 0, current_value: 0, average_cost: 0 }, next[entry.symbol] || {}), totalShares = Number(current.shares || 0) + actualShares; next[entry.symbol] = Object.assign({}, current, { shares: totalShares, current_value: Number(current.current_value || 0) + actualShares * actualPrice, average_cost: (Number(current.shares || 0) * Number(current.average_cost || 0) + actualShares * actualPrice) / totalShares }); return { ok: true, holdings: next }; }
  return Object.freeze({ VERSION: VERSION, createLedger: createLedger, normalize: normalize, add: add, importJson: importJson, applyToHoldings: applyToHoldings });
});
