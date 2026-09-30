"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const riskInput = require("../portfolio-risk-input.js");

test("missing cash stays missing and normalization is idempotent", () => {
  const first = riskInput.normalize({});
  assert.equal(first.available_cash, 0);
  assert.equal(first.available_cash_provided, false);
  assert.deepEqual(riskInput.normalize(first), first);
});

test("explicit zero cash remains explicitly provided", () => {
  const result = riskInput.normalize({ available_cash: 0, available_cash_provided: true });
  assert.equal(result.available_cash, 0);
  assert.equal(result.available_cash_provided, true);
});

test("explicit false wins over a serialized zero", () => {
  const result = riskInput.normalize({ available_cash: 0, available_cash_provided: false });
  assert.equal(result.available_cash, 0);
  assert.equal(result.available_cash_provided, false);
  assert.equal(riskInput.normalize(result).available_cash_provided, false);
});

test("a positive explicit cash amount is preserved", () => {
  const result = riskInput.normalize({ available_cash: 100, available_cash_provided: true });
  assert.equal(result.available_cash, 100);
  assert.equal(result.available_cash_provided, true);
});

const usListing = (exchange = "NASDAQ", instrument_kind = "stock") => ({ listing_currency: "USD", exchange, instrument_kind });

test("allocation context includes all US securities, even holdings outside the DCA list", () => {
  const result = riskInput.allocationContext({ complete: true, plannedSymbols: ["SPY"], positions: { SPY: { current_value: 200 }, NVDA: { current_value: 300 }, XOM: { current_value: 100 }, ASML: { current_value: 400 } }, listings: { SPY: usListing("NYSE Arca", "etf"), NVDA: usListing("XNAS"), XOM: usListing("XNYS"), ASML: usListing("NASDAQ", "adr") } });
  assert.equal(result.complete, true);
  assert.equal(result.securitiesValue, 1000);
  assert.deepEqual(result.allocationsPct, { SPY: 20, NVDA: 30, XOM: 10, ASML: 40 });
  assert.deepEqual(Object.keys(result.positions), ["SPY", "NVDA", "XOM", "ASML"]);
  assert.equal(result.denominator, "eligible_us_securities_excluding_cash");
  assert.deepEqual(result.reasonCodes, []);
});

test("allocation context excludes Canadian holdings, foreign listings, cash, and cash-equivalent securities", () => {
  const result = riskInput.allocationContext({ complete: true, positions: { SPY: { current_value: 200 }, SHOP: { current_value: 300 }, VOD: { current_value: 400 }, CASH: { current_value: 500 }, BIL: { current_value: 600 } }, listings: { SPY: usListing("ARCX", "etf"), SHOP: { listing_currency: "CAD", exchange: "TSX", instrument_kind: "stock" }, VOD: { listing_currency: "GBP", exchange: "LSE", instrument_kind: "stock" }, CASH: usListing("NASDAQ", "cash"), BIL: { ...usListing("NYSE Arca", "etf"), cash_equivalent: true } } });
  assert.equal(result.complete, true);
  assert.equal(result.securitiesValue, 200);
  assert.deepEqual(result.allocationsPct, { SPY: 100 });
  assert.deepEqual(result.excludedSymbols, ["SHOP", "VOD", "CASH", "BIL"]);
});

test("verified US shortcuts cannot reintroduce Canadian cash or cash equivalents to the denominator", () => {
  const result = riskInput.allocationContext({ complete: true, positions: { SPY: { current_value: 100 }, CASH: { current_value: 500 }, CAD: { current_value: 300 } }, listings: { SPY: { verifiedUS: true, listing_currency: "USD", instrument_kind: "etf" }, CASH: { ...usListing("NASDAQ", "etf"), verifiedUS: true, cash_equivalent: true }, CAD: { verifiedUS: true, listing_currency: "CAD", exchange: "TSX", instrument_kind: "stock" } } });
  assert.equal(result.complete, true);
  assert.equal(result.securitiesValue, 100);
  assert.deepEqual(result.allocationsPct, { SPY: 100 });
  assert.deepEqual(result.excludedSymbols, ["CASH", "CAD"]);
});

test("unidentified positions and missing valuation prevent a complete allocation context", () => {
  for (const listing of [undefined, {}, { listing_currency: "USD" }, { verifiedUS: true }, { exchange: "NASDAQ", instrument_kind: "stock" }, { listing_currency: "USD", instrument_kind: "stock" }, { listing_currency: "USD", exchange: "NASDAQ" }]) {
    const result = riskInput.allocationContext({ complete: true, positions: { UNKNOWN: { current_value: 200 } }, listings: listing === undefined ? {} : { UNKNOWN: listing } });
    assert.equal(result.complete, false, JSON.stringify(listing));
    assert.ok(result.reasonCodes.includes("HOLDING_IDENTITY_UNKNOWN:UNKNOWN"));
  }
  for (const current_value of [undefined, null, "", " ", NaN, Infinity, -1, false, []]) {
    const result = riskInput.allocationContext({ complete: true, positions: { SPY: { current_value } }, listings: { SPY: usListing("NYSE", "etf") } });
    assert.equal(result.complete, false, String(current_value));
    assert.ok(result.reasonCodes.includes("HOLDING_VALUE_UNKNOWN:SPY"));
  }
});

test("incomplete or unspecified holdings never become a complete allocation context", () => {
  const input = { positions: { SPY: { current_value: 200 } }, listings: { SPY: usListing("NYSE", "etf") } };
  for (const complete of [false, undefined]) {
    const result = riskInput.allocationContext({ ...input, complete });
    assert.equal(result.complete, false);
    assert.ok(result.reasonCodes.includes("HOLDINGS_INCOMPLETE"));
  }
});

test("available cash and unplanned holdings do not manufacture a lower SPY securities weight", () => {
  const input = { complete: true, positions: { SPY: { current_value: 250 }, XOM: { current_value: 750 } }, listings: { SPY: usListing("NYSE", "etf"), XOM: usListing("NYSE") } };
  const original = riskInput.allocationContext({ ...input, available_cash: 0 });
  assert.deepEqual(riskInput.allocationContext({ ...input, available_cash: 100000 }), original);
  assert.equal(original.allocationsPct.SPY, 25);
  assert.equal(original.securitiesValue, 1000);
});

test("zero security values remain valid without inventing a denominator", () => {
  const result = riskInput.allocationContext({ complete: true, positions: { SPY: { current_value: 0 } }, listings: { SPY: usListing("NYSE", "etf") } });
  assert.equal(result.complete, true);
  assert.equal(result.securitiesValue, 0);
  assert.deepEqual(result.allocationsPct, { SPY: 0 });
});
