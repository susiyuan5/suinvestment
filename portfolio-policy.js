(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PortfolioPolicy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

  function normalizeSymbol(value) {
    const symbol = String(value || "").trim().toUpperCase();
    return /^[A-Z0-9.-]{1,12}$/.test(symbol) ? symbol : "";
  }

  function normalizePortfolio(items, defaultStocks, allowCustom) {
    const supportedSymbols = new Set((defaultStocks || []).map((stock) => stock.symbol));
    const seen = new Set();
    return (Array.isArray(items) ? items : []).reduce(function (portfolio, item) {
      const symbol = normalizeSymbol(item && item.symbol);
      const allocation = Number(item && item.allocation);
      if (!symbol || (!supportedSymbols.has(symbol) && !allowCustom) || seen.has(symbol) || !Number.isFinite(allocation) || allocation < 0) return portfolio;
      seen.add(symbol);
      portfolio.push({ symbol, name: String(item.name || symbol).trim() || symbol, allocation: round2(allocation * 100) / 100 });
      return portfolio;
    }, []);
  }

  function allocateDcaL2Plan(items, options) {
    const opts = options || {};
    const rows = (Array.isArray(items) ? items : []).map(function (item) {
      const decision = { ...(item && item.decision || {}) };
      ["baseAmount", "extraAmount", "crashFundAmount"].forEach(function (field) {
        decision[field] = Number.isFinite(Number(decision[field])) && Number(decision[field]) >= 0 ? round2(Number(decision[field])) : 0;
      });
      decision.reasonCodes = Array.isArray(decision.reasonCodes) ? decision.reasonCodes.slice() : [];
      const allocation = Number(item && item.currentAllocationPct);
      if (Number.isFinite(allocation) && allocation >= Number(opts.veryHighPct == null ? 35 : opts.veryHighPct)) {
        decision.baseAmount = decision.extraAmount = decision.crashFundAmount = 0;
        decision.reasonCodes.push("CONCENTRATION_VERY_HIGH_BLOCKED");
        decision.manualReview = true;
      } else if (Number.isFinite(allocation) && allocation >= Number(opts.highPct == null ? 25 : opts.highPct)) {
        decision.extraAmount = decision.crashFundAmount = 0;
        decision.reasonCodes.push("EXTRA_BLOCKED_CONCENTRATION");
      }
      return { ...item, decision };
    });
    const money = function (value) { return round2(Math.max(0, Number(value) || 0)); };
    const normalRemaining = money(Number(opts.normalPool) - Number(opts.normalPoolUsed || 0));
    const crashRemaining = money(Number(opts.crashFund) - Number(opts.crashFundUsed || 0));
    const scale = function (field, available, reason) {
      const total = money(rows.reduce(function (sum, row) { return sum + row.decision[field]; }, 0));
      if (total <= available) return;
      const ratio = total > 0 ? available / total : 0;
      rows.forEach(function (row) {
        row.decision[field] = money(row.decision[field] * ratio);
        row.decision.reasonCodes.push(reason);
      });
    };
    scale("crashFundAmount", crashRemaining, "CRASH_FUND_BUDGET_APPLIED");
    scale("baseAmount", normalRemaining, "NORMAL_POOL_BASE_BUDGET_APPLIED");
    const baseTotal = money(rows.reduce(function (sum, row) { return sum + row.decision.baseAmount; }, 0));
    scale("extraAmount", money(normalRemaining - baseTotal), "NORMAL_POOL_EXTRA_BUDGET_APPLIED");
    let total = money(rows.reduce(function (sum, row) { return sum + row.decision.baseAmount + row.decision.extraAmount + row.decision.crashFundAmount; }, 0));
    const cashCap = Number.isFinite(Number(opts.portfolioCashCap)) ? money(opts.portfolioCashCap) : null;
    if (cashCap !== null && total > cashCap) {
      let reduction = total - cashCap;
      ["crashFundAmount", "extraAmount", "baseAmount"].forEach(function (field) {
        if (reduction <= 0) return;
        const component = money(rows.reduce(function (sum, row) { return sum + row.decision[field]; }, 0));
        if (component <= 0) return;
        const cut = Math.min(component, reduction);
        const ratio = (component - cut) / component;
        rows.forEach(function (row) {
          row.decision[field] = money(row.decision[field] * ratio);
          row.decision.reasonCodes.push("PORTFOLIO_CASH_CAP_APPLIED");
        });
        reduction = money(reduction - cut);
      });
      total = money(rows.reduce(function (sum, row) { return sum + row.decision.baseAmount + row.decision.extraAmount + row.decision.crashFundAmount; }, 0));
    }
    rows.forEach(function (row) {
      row.decision.finalAmount = money(row.decision.baseAmount + row.decision.extraAmount + row.decision.crashFundAmount);
      row.decision.reasonCodes = Array.from(new Set(row.decision.reasonCodes));
      row.decision.reasonCodes.sort();
      row.finalAmount = row.decision.finalAmount;
    });
    const plannedNormal = money(rows.reduce(function (sum, row) { return sum + row.decision.baseAmount + row.decision.extraAmount; }, 0));
    const plannedCrash = money(rows.reduce(function (sum, row) { return sum + row.decision.crashFundAmount; }, 0));
    return {
      items: rows,
      normalPool: money(opts.normalPool),
      normalPoolUsed: money(opts.normalPoolUsed),
      normalPoolRemaining: normalRemaining,
      crashFund: money(opts.crashFund),
      crashFundUsed: money(opts.crashFundUsed),
      crashFundRemaining: crashRemaining,
      plannedNormal,
      plannedCrash,
      totalPlanned: total,
      monthlyBudgetRemaining: money(normalRemaining + crashRemaining),
      unallocatedCash: money(normalRemaining + crashRemaining - total),
      portfolioCashCap: cashCap
    };
  }

  function normalizeDcaL2Ledger(value, currentMonth) {
    const raw = value && typeof value === "object" ? value : {};
    const month = typeof currentMonth === "string" && currentMonth ? currentMonth : new Date().toISOString().slice(0, 7);
    const rawEntries = Array.isArray(raw.entries) ? raw.entries : [];
    return {
      version: "dca-l2-v2",
      month: typeof raw.month === "string" ? raw.month : month,
      initial: Number.isFinite(Number(raw.initial)) ? Number(raw.initial) : 0,
      entries: rawEntries.filter(function (item) { return item && Number.isFinite(Number(item.amount)) && Number(item.amount) > 0; }).map(function (item, index) {
        return {
          id: String(item.id || ("migrated-" + index + "-" + Number(item.amount))),
          month: typeof item.month === "string" ? item.month : (typeof raw.month === "string" ? raw.month : month),
          type: ["base", "extra", "crash"].includes(item.type) ? item.type : "crash",
          symbol: String(item.symbol || "").trim().toUpperCase(),
          amount: round2(Number(item.amount)),
          date: typeof item.date === "string" ? item.date : month + "-01",
          note: String(item.note || ""),
          reversible: item.reversible !== false
        };
      }),
      defensiveLatched: raw.defensiveLatched === true,
      recoveryConfirmations: Number.isFinite(Number(raw.recoveryConfirmations)) ? Number(raw.recoveryConfirmations) : 0,
      lastRecoveryWeek: typeof raw.lastRecoveryWeek === "string" ? raw.lastRecoveryWeek : ""
    };
  }

  function dcaL2LedgerUsed(ledger, type) {
    const month = ledger && ledger.month;
    return round2((ledger && Array.isArray(ledger.entries) ? ledger.entries : []).filter(function (item) { return (!item.month || item.month === month) && item.type === type; }).reduce(function (sum, item) { return sum + Number(item.amount || 0); }, 0));
  }

  return Object.freeze({ normalizeSymbol, normalizePortfolio, allocateDcaL2Plan, normalizeDcaL2Ledger, dcaL2LedgerUsed });
});
