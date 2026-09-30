const test = require("node:test");
const assert = require("node:assert/strict");

const model = require("../holdings-detail-model.js");

test("aggregates the same symbol across accounts without losing account or cost detail", () => {
  const rows = model.aggregateSnapshotHoldings({
    holdings: [
      { symbol: "AAPL", description: "Apple Inc.", included_in_stock_plan: true, units: 1, price: 120, cost_basis: 90, market_value: 120, account_name: "TFSA", exchange: "NASDAQ", position_currency: "USD", data_as_of: "2026-08-13T12:00:00Z" },
      { symbol: "AAPL", included_in_stock_plan: true, units: 2, price: 120, cost_basis: 105, market_value: 240, account_name: "Non-registered", exchange: "NASDAQ", position_currency: "USD", data_as_of: "2026-08-13T13:00:00Z" },
      { symbol: "USD", included_in_stock_plan: false, units: 50, market_value: 50 }
    ]
  });

  assert.deepEqual(Object.keys(rows), ["AAPL"]);
  assert.equal(rows.AAPL.shares, 3);
  assert.equal(rows.AAPL.currentValue, 360);
  assert.equal(rows.AAPL.costBasis, 300);
  assert.equal(rows.AAPL.averageCost, 100);
  assert.deepEqual(rows.AAPL.accounts, ["TFSA", "Non-registered"]);
  assert.equal(rows.AAPL.dataAsOf, "2026-08-13T12:00:00Z");
});

test("builds detailed planned and display-only rows with truthful allocation and PnL", () => {
  const snapshot = {
    generated_at: "2026-08-13T14:00:00Z",
    positions_as_of: "2026-08-13T13:00:00Z",
    accounts: [{ account_name: "TFSA", account_category: "registered", sync_status: "synced", balances: [{ currency: "USD", cash: 40 }], positions: [] }],
    holdings: [
      { symbol: "AAPL", description: "Apple Inc.", included_in_stock_plan: true, units: 2, price: 120, cost_basis: 100, market_value: 240, account_name: "TFSA", exchange: "NASDAQ", position_currency: "USD" },
      { symbol: "MSFT", description: "Microsoft Corporation", included_in_stock_plan: true, units: 1, price: 60, cost_basis: 50, market_value: 60, account_name: "TFSA", exchange: "NASDAQ", position_currency: "USD" }
    ]
  };
  const result = model.build({
    entries: [{ stock: { symbol: "AAPL", allocation: 0.15 }, signal: { latest_price: 120, data_freshness: "fresh" } }],
    portfolioRisk: {
      total_stock_value: 240,
      total_portfolio_value: 280,
      available_cash: 40,
      available_cash_provided: true,
      equity_exposure_percentage: 85.71,
      positions: { AAPL: { shares: 2, average_cost: 100, current_value: 240, current_allocation: 85.71, target_allocation: 15 } }
    },
    snapshot,
    status: "ready",
    sourceMode: "snaptrade_automatic",
    planningCurrency: "USD"
  });

  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].symbol, "AAPL");
  assert.equal(result.rows[0].pnl, 40);
  assert.equal(result.rows[0].pnlPercent, 20);
  assert.equal(result.rows[0].allocationState, "over");
  assert.equal(result.rows[1].symbol, "MSFT");
  assert.equal(result.rows[1].planned, false);
  assert.equal(result.rows[1].allocationState, "outside_plan");
  assert.equal(result.summary.unrealizedPnl, 40);
  assert.equal(result.summary.pnlComplete, true);
  assert.equal(result.summary.outsidePlanCount, 1);
  assert.equal(result.meta.accountLabel, "TFSA");
  assert.equal(result.meta.currencyLabel, "USD");
  assert.equal(result.meta.asOf, "2026-08-13T13:00:00Z");
});

test("does not invent PnL when average cost is unavailable", () => {
  const result = model.build({
    entries: [{ stock: { symbol: "SPY", allocation: 0.4 }, signal: { latest_price: 600, data_freshness: "fresh" } }],
    portfolioRisk: { total_stock_value: 600, total_portfolio_value: 600, available_cash_provided: false, positions: { SPY: { shares: 1, current_value: 600, current_allocation: 100, target_allocation: 40 } } },
    snapshot: null,
    status: "manual",
    sourceMode: "manual",
    planningCurrency: "USD"
  });
  assert.equal(result.rows[0].costBasis, null);
  assert.equal(result.rows[0].pnl, null);
  assert.equal(result.summary.pnlComplete, false);
});

test("holding weights include outside-plan positions, exclude cash and use normalized currency", () => {
  const result = model.build({
    entries: [{ stock: { symbol: "AAPL", allocation: .4 } }],
    portfolioRisk: { positions: { AAPL: { shares: 2, average_cost: 100, current_value: 240 } }, available_cash: 900 },
    actualPositions: { AAPL: { shares: 2, average_cost: 100, current_value: 240 }, SHOP: { shares: 1, average_cost: 80, current_value: 60 } },
    snapshot: { holdings: [{ symbol: "SHOP", included_in_stock_plan: true, units: 1, cost_basis: 108, market_value: 81, position_currency: "CAD" }] },
    status: "ready", planningCurrency: "USD"
  });
  assert.equal(result.rows[0].positionWeight, 80);
  assert.equal(result.rows[1].positionWeight, 20);
  assert.equal(result.rows[1].planned, false);
  assert.equal(result.rows[1].currency, "USD");
  assert.equal(result.rows[1].pnl, -20);
  assert.equal(result.rows[1].pnlPercent, -25);
});

test("holding weights stay unknown for unconverted mixed currencies and zero values", () => {
  const result = model.build({
    snapshot: { holdings: [
      { symbol: "AAPL", included_in_stock_plan: true, units: 1, market_value: 120, position_currency: "USD" },
      { symbol: "SHOP", included_in_stock_plan: true, units: 1, market_value: 81, position_currency: "CAD" }
    ] }, status: "ready"
  });
  assert.ok(result.rows.every(row => row.positionWeight === null));
  const zero = model.build({ actualPositions: { SPY: { shares: 1, average_cost: 10, current_value: 0 } }, planningCurrency: "USD" });
  assert.equal(zero.rows[0].positionWeight, null);
});

test("missing normalized cost never falls back to an unconverted snapshot cost", () => {
  const result = model.build({
    actualPositions: { SHOP: { shares: 1, average_cost: 0, current_value: 60 } },
    snapshot: { holdings: [{ symbol: "SHOP", included_in_stock_plan: true, units: 1, cost_basis: 108, price: 81, market_value: 81, position_currency: "CAD" }] },
    status: "ready", planningCurrency: "USD"
  });
  assert.equal(result.rows[0].currency, "USD");
  assert.equal(result.rows[0].currentValue, 60);
  assert.equal(result.rows[0].costBasis, null);
  assert.equal(result.rows[0].pnl, null);
  assert.equal(result.rows[0].latestPrice, null);
});
