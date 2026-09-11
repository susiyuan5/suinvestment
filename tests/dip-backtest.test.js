const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const S = require("../dip-strategy"),
  L = require("../dip-ledger"),
  B = require("../scripts/independent-dip-backtest");
function fixture() {
  const rows = [];
  for (
    let t = Date.parse("2024-01-01");
    t <= Date.parse("2025-04-30");
    t += 86400000
  ) {
    const d = new Date(t);
    if ([0, 6].includes(d.getUTCDay())) continue;
    rows.push({
      date: d.toISOString().slice(0, 10),
      close: 100,
      adjusted_close: 100,
      adjusted_open: 100,
    });
  }
  return {
    symbols: Object.fromEntries(
      S.symbols.map((s) => [s, structuredClone(rows)]),
    ),
  };
}
test("browser and Node use identical dip signals and plans", () => {
  const browser = vm.createContext({});
  for (const file of [
    "market-analysis.js",
    "wealthsimple-execution-policy.js",
    "dip-strategy.js",
    "dip-ledger.js",
  ])
    vm.runInContext(fs.readFileSync(file, "utf8"), browser);
  const rows = fixture().symbols.SPY;
  const options = {
    now: Date.parse("2025-04-01T14:00:00Z"),
    signals: Object.fromEntries(
      S.symbols.map((s) => [
        s,
        {
          valid: true,
          week: "2025-03-24",
          drawdown: 20,
          volatility: 2,
          stabilization: "strong",
          regime: "Neutral",
        },
      ]),
    ),
    targets: {
      SPY: 0.4,
      QQQ: 0.1,
      NVDA: 0.125,
      AAPL: 0.125,
      ASML: 0.125,
      KO: 0.125,
    },
    values: {
      SPY: 4000,
      QQQ: 1000,
      NVDA: 1250,
      AAPL: 1250,
      ASML: 1250,
      KO: 1250,
    },
    accounts: {
      a: { currency: "USD", type: "NON_REGISTERED", cash: 100, reserved: 0 },
    },
    securities: Object.fromEntries(
      S.symbols.map((s) => [
        s,
        { currency: "USD", accountId: "a", fractional: true },
      ]),
    ),
    quotes: Object.fromEntries(
      S.symbols.map((s) => [s, { price: 100, asOf: "2025-04-01T13:00:00Z" }]),
    ),
    ledger: { balance: 100, weekLimit: 25, weekSpent: 0, bySymbol: {} },
  };
  const normalize = (x) => JSON.parse(JSON.stringify(x));
  assert.ok(S.plan(options).allocated > 0);
  assert.deepEqual(
    normalize(browser.DipStrategy.plan(options)),
    normalize(S.plan(options)),
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(browser.DipStrategy.signal(rows, "2025-04-01"))),
    S.signal(rows, "2025-04-01"),
  );
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        browser.DipLedger.ensure(
          browser.DipLedger.blank(),
          "2025-04-01T14:00:00Z",
        ),
      ),
    ),
    L.ensure(L.blank(), "2025-04-01T14:00:00Z"),
  );
});
test("replay is causal and extra cash cannot fund old strategy", () => {
  const data = fixture(),
    a = B.run(data, { start: "2025-01-01", end: "2025-03-31" });
  for (const s of S.symbols)
    for (const r of data.symbols[s])
      if (r.date > "2025-02-28") {
        r.adjusted_close = 1;
        r.adjusted_open = 999;
        r.close = 1;
      }
  const b = B.run(data, { start: "2025-01-01", end: "2025-03-31" });
  for (const name of Object.keys(a.strategies)) {
    const before = (s) =>
      s.strategies[name].decisions.filter((r) => r.date <= "2025-02-28");
    assert.deepEqual(before(a), before(b));
    const trades = (s) =>
      s.strategies[name].trades
        .filter((r) => r.date <= "2025-02-28")
        .map(({ recoveryDate, ...rest }) => rest);
    assert.deepEqual(trades(a), trades(b));
  }
  assert.deepEqual(
    a.strategies.current_400.trades,
    a.strategies.current_400_cash_100.trades,
  );
  assert.equal(a.summaries.current_400_cash_100.externalDeposits, 1500);
  assert.equal(a.summaries.current_400.externalDeposits, 1200);
  assert.equal(a.summaries.current_400_cash_100.idleReserve, 300);
});
test("Monday holiday includes the previous Friday complete week; missing history pauses", () => {
  const rows = fixture().symbols.SPY.filter((r) => r.date <= "2025-03-28");
  assert.equal(S.signal(rows, "2025-04-01").valid, true);
  assert.equal(S.signal(rows.slice(-30), "2025-04-01").valid, false);
});
