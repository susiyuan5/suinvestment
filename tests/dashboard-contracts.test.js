"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const market = require("../market-data.js");
const signal = require("../signal-engine.js");
const portfolio = require("../portfolio-policy.js");
const backtest = require("../backtest-engine.js");

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "dashboard_contract_cases.json"), "utf8"));
const close = (left, right, tolerance = 1e-12) => assert.ok(Math.abs(left - right) <= tolerance, `${left} != ${right}`);

test("market data golden fixtures", function () {
  fixture.market_data.forEach(function (row) {
    assert.equal(market.freshness(row.timestamp, {}, row.now_ms, row.max_age_hours), row.expected);
  });
});

test("signal golden fixtures", function () {
  assert.deepEqual(signal.marketSignals(fixture.signal.closes), fixture.signal.expected_market_signals);
  assert.equal(signal.score(fixture.signal.score_input, fixture.signal.score_params), fixture.signal.expected_score);
});

test("portfolio golden fixtures", function () {
  const actual = portfolio.normalizePortfolio(fixture.portfolio.items, fixture.portfolio.defaults, false);
  assert.deepEqual(actual.map(({ symbol, name }) => ({ symbol, name })), fixture.portfolio.expected.map(({ symbol, name }) => ({ symbol, name })));
  actual.forEach((row, index) => close(row.allocation, fixture.portfolio.expected[index].allocation));
});

test("backtest metric golden fixtures", function () {
  const row = fixture.backtest;
  close(backtest.cagr(row.final_value, row.total_invested, row.weeks), row.expected.cagr);
  close(backtest.annualizedVolatility(row.returns), row.expected.annualized_volatility);
  close(backtest.downsideDeviation(row.downside_returns), row.expected.downside_deviation);
  close(backtest.returnVolatility(row.returns), row.expected.return_volatility);
  assert.equal(backtest.sharpe(0.2, 0.1), row.expected.sharpe);
  assert.equal(backtest.sortino(0.2, 0.1), row.expected.sortino);
  assert.equal(backtest.calmar(0.2, 10), row.expected.calmar);
  const testCase = row.dca_case;
  const aligned = [{ stock: { symbol: "TEST", allocation: 1 }, prices: testCase.prices.map((value, index) => ({ date: String(index), close: value })) }];
  const result = backtest.simulateStrategy(aligned, "dca", {
    weeklyAmount: testCase.weekly_amount, weeklyDeployment: testCase.weekly_amount, frictionCostRate: testCase.friction_rate,
    marketRegime: () => ({}), enhancedMultiplier: () => 1, smoothMultiplier: () => 1, oldMultiplier: () => 1,
    round2: (value) => Math.round((value + Number.EPSILON) * 100) / 100
  });
  Object.entries(testCase.expected).forEach(([key, value]) => close(result[key], value));
});
