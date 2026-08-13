(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HoldingsDetailModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function positive(value) {
    var parsed = finite(value);
    return parsed !== null && parsed > 0 ? parsed : 0;
  }

  function unique(values) {
    return Array.from(new Set((values || []).filter(Boolean)));
  }

  function label(value) {
    if (typeof value === "string" || typeof value === "number") return String(value).trim();
    if (!value || typeof value !== "object") return "";
    return label(value.name || value.code || value.symbol || value.slug || value.type || "");
  }

  function earliestIso(values) {
    return (values || []).filter(function (value) { return Number.isFinite(Date.parse(value)); }).sort()[0] || null;
  }

  function aggregateSnapshotHoldings(snapshot) {
    var groups = {};
    (snapshot && Array.isArray(snapshot.holdings) ? snapshot.holdings : []).forEach(function (item) {
      if (!item || item.included_in_stock_plan !== true || !item.symbol) return;
      var symbol = String(item.symbol).trim().toUpperCase();
      if (!symbol) return;
      var row = groups[symbol] || {
        symbol: symbol,
        description: "",
        shares: 0,
        currentValue: 0,
        hasCurrentValue: false,
        costBasis: 0,
        hasCompleteCostBasis: true,
        latestPrice: null,
        accounts: [],
        exchanges: [],
        currencies: [],
        dataAsOfValues: []
      };
      var shares = positive(item.units);
      var averageCost = finite(item.cost_basis);
      var marketValue = finite(item.market_value);
      var price = finite(item.price);
      row.shares += shares;
      if (marketValue !== null) {
        row.currentValue += marketValue;
        row.hasCurrentValue = true;
      } else if (price !== null && shares > 0) {
        row.currentValue += price * shares;
        row.hasCurrentValue = true;
      }
      if (averageCost !== null && averageCost >= 0 && shares > 0) row.costBasis += averageCost * shares;
      else if (shares > 0) row.hasCompleteCostBasis = false;
      if (price !== null && price > 0) row.latestPrice = price;
      if (!row.description && item.description) row.description = label(item.description);
      row.accounts.push(label(item.account_name));
      row.exchanges.push(label(item.exchange));
      row.currencies.push(label(item.position_currency || item.listing_currency));
      row.dataAsOfValues.push(item.data_as_of);
      groups[symbol] = row;
    });

    Object.keys(groups).forEach(function (symbol) {
      var row = groups[symbol];
      row.accounts = unique(row.accounts);
      row.exchanges = unique(row.exchanges);
      row.currencies = unique(row.currencies);
      row.currency = row.currencies.length === 1 ? row.currencies[0] : row.currencies.length > 1 ? "MIXED" : null;
      row.exchange = row.exchanges.join(" / ");
      row.accountLabel = row.accounts.join(" / ");
      row.dataAsOf = earliestIso(row.dataAsOfValues);
      row.averageCost = row.hasCompleteCostBasis && row.shares > 0 ? row.costBasis / row.shares : null;
      if (!row.hasCompleteCostBasis) row.costBasis = null;
      if (!row.hasCurrentValue) row.currentValue = null;
    });
    return groups;
  }

  function buildAccountMeta(snapshot) {
    var accounts = snapshot && Array.isArray(snapshot.accounts) ? snapshot.accounts : [];
    var names = unique(accounts.map(function (account) { return label(account.account_name || account.raw_type || account.account_category); }));
    var types = unique(accounts.map(function (account) { return label(account.account_category || account.raw_type); }));
    var currencies = unique(accounts.flatMap(function (account) {
      return (account.balances || []).map(function (balance) { return label(balance.currency); })
        .concat((account.positions || []).map(function (position) { return label(position.position_currency || position.listing_currency); }));
    }));
    var syncStates = unique(accounts.map(function (account) { return label(account.sync_status); }));
    return {
      count: accounts.length,
      names: names,
      accountLabel: names.length ? names.join(" / ") : accounts.length ? String(accounts.length) + " 个账户" : "--",
      typeLabel: types.length ? types.join(" / ") : "--",
      currencyLabel: currencies.length ? currencies.join(" / ") : "--",
      syncLabel: syncStates.length ? syncStates.join(" / ") : "--"
    };
  }

  function allocationState(target, drift, planned) {
    if (!planned) return "outside_plan";
    if (drift === null) return "unknown";
    if (drift > 2) return "over";
    if (drift < -2) return "under";
    return "near";
  }

  function build(options) {
    var input = options || {};
    var entries = Array.isArray(input.entries) ? input.entries : [];
    var portfolioRisk = input.portfolioRisk || {};
    var positions = portfolioRisk.positions || {};
    var snapshotRows = input.status === "ready" ? aggregateSnapshotHoldings(input.snapshot) : {};
    var entryBySymbol = {};
    var plannedSymbols = [];
    entries.forEach(function (entry) {
      var symbol = String(entry && entry.stock && entry.stock.symbol || "").toUpperCase();
      if (!symbol) return;
      entryBySymbol[symbol] = entry;
      plannedSymbols.push(symbol);
    });
    var allSymbols = unique(plannedSymbols.concat(Object.keys(snapshotRows)));
    var rows = allSymbols.map(function (symbol) {
      var entry = entryBySymbol[symbol] || null;
      var position = positions[symbol] || {};
      var snapshotRow = snapshotRows[symbol] || {};
      var planned = Boolean(entry);
      var shares = positive(position.shares) || positive(snapshotRow.shares);
      var averageCost = positive(position.average_cost) || finite(snapshotRow.averageCost);
      var currentValue = positive(position.current_value) || finite(snapshotRow.currentValue) || 0;
      var latestPrice = finite(entry && entry.signal && entry.signal.latest_price) || finite(snapshotRow.latestPrice);
      var target = planned ? finite(position.target_allocation) : 0;
      if (planned && (target === null || target === 0)) target = positive(entry.stock.allocation) * 100;
      var currentAllocation = planned ? finite(position.current_allocation) : null;
      var drift = planned && currentAllocation !== null ? currentAllocation - target : null;
      var costBasis = shares > 0 && averageCost !== null && averageCost >= 0 ? shares * averageCost : finite(snapshotRow.costBasis);
      var pnl = costBasis !== null ? currentValue - costBasis : null;
      var pnlPercent = costBasis !== null && costBasis > 0 ? pnl / costBasis * 100 : null;
      return {
        symbol: symbol,
        description: snapshotRow.description || "",
        planned: planned,
        shares: shares,
        latestPrice: latestPrice,
        averageCost: averageCost,
        costBasis: costBasis,
        currentValue: currentValue,
        pnl: pnl,
        pnlPercent: pnlPercent,
        currentAllocation: currentAllocation,
        targetAllocation: target,
        allocationDrift: drift,
        allocationState: allocationState(target, drift, planned),
        quoteStatus: entry && entry.signal && entry.signal.data_freshness || "unknown",
        dataAsOf: snapshotRow.dataAsOf || input.snapshot && (input.snapshot.positions_as_of || input.snapshot.generated_at) || null,
        accountLabel: snapshotRow.accountLabel || "--",
        exchange: snapshotRow.exchange || "--",
        currency: snapshotRow.currency || input.planningCurrency || null
      };
    }).filter(function (row) {
      return row.shares > 0 || row.currentValue > 0 || row.costBasis > 0;
    });

    var pnlRows = rows.filter(function (row) { return row.planned && row.pnl !== null; });
    var plannedRows = rows.filter(function (row) { return row.planned; });
    var accountMeta = buildAccountMeta(input.snapshot);
    return {
      rows: rows,
      summary: {
        stockValue: finite(portfolioRisk.total_stock_value) || 0,
        totalValue: finite(portfolioRisk.total_portfolio_value) || 0,
        availableCash: finite(portfolioRisk.available_cash) || 0,
        cashProvided: portfolioRisk.available_cash_provided === true,
        unrealizedPnl: pnlRows.reduce(function (sum, row) { return sum + row.pnl; }, 0),
        pnlComplete: plannedRows.length > 0 && pnlRows.length === plannedRows.length,
        equityExposure: finite(portfolioRisk.equity_exposure_percentage),
        positionCount: rows.length,
        plannedPositionCount: plannedRows.length,
        outsidePlanCount: rows.length - plannedRows.length
      },
      meta: {
        sourceMode: input.sourceMode || "manual",
        status: input.status || "manual",
        asOf: input.snapshot && (input.snapshot.positions_as_of || input.snapshot.generated_at) || portfolioRisk.source_as_of || null,
        generatedAt: input.snapshot && input.snapshot.generated_at || null,
        accountCount: accountMeta.count,
        accountLabel: accountMeta.accountLabel,
        accountTypeLabel: accountMeta.typeLabel,
        currencyLabel: accountMeta.currencyLabel,
        syncLabel: accountMeta.syncLabel
      }
    };
  }

  return Object.freeze({ aggregateSnapshotHoldings: aggregateSnapshotHoldings, buildAccountMeta: buildAccountMeta, build: build });
});
