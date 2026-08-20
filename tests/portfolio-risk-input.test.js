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
