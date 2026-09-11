const test = require("node:test"),
  assert = require("node:assert/strict");
const S = require("../dip-strategy"),
  L = require("../dip-ledger");
const now = Date.parse("2026-09-08T14:00:00Z");
function input() {
  return {
    now,
    signals: Object.fromEntries(
      S.symbols.map((s) => [
        s,
        {
          valid: true,
          week: "2026-08-31",
          drawdown: 20,
          volatility: 2,
          stabilization: "strong",
          regime: "Neutral",
          trend: { status: "mixed" },
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
      usd: { currency: "USD", type: "NON_REGISTERED", cash: 1000, reserved: 0 },
    },
    securities: Object.fromEntries(
      S.symbols.map((s) => [
        s,
        { accountId: "usd", currency: "USD", fractional: true },
      ]),
    ),
    quotes: Object.fromEntries(
      S.symbols.map((s) => [s, { price: 50, asOf: "2026-09-08T13:00:00Z" }]),
    ),
    ledger: { balance: 100, weekLimit: 25, weekSpent: 0, bySymbol: {} },
  };
}
test("exact tier boundaries and stabilization gates", () => {
  for (const symbol of ["SPY", "NVDA"])
    for (const dd of [
      9.999, 10, 10.001, 14.999, 15, 15.001, 24.999, 25, 25.001, 34.999, 35,
      35.001,
    ])
      for (const stop of ["none", "preliminary", "strong"]) {
        const row = S.candidate(
          symbol,
          { valid: true, drawdown: dd, volatility: 2, stabilization: stop },
          0.4,
          0.2,
          "Neutral",
        );
        const expected =
          dd >= (symbol === "SPY" ? 10 : 15) &&
          stop !== "none" &&
          (dd < 25 || stop === "strong");
        assert.equal(
          row.reasons.length === 0,
          expected,
          `${symbol} ${dd} ${stop}`,
        );
      }
});
test("market and ticker risk gates, raw thresholds and overweight", () => {
  for (const [mutate, blocked] of [
    [(x) => (x.panic = true), 6],
    [(x) => (x.signals.QQQ.volatility = 6), 6],
    [(x) => (x.signals.NVDA.volatility = 6), 1],
    [(x) => (x.signals.QQQ.regime = "Bear"), 4],
    [(x) => (x.signals.SPY.valid = false), 6],
    [
      (x) => {
        x.signals.SPY.drawdown = 12;
        x.signals.SPY.trend.status = "strong_downtrend";
      },
      1,
    ],
  ]) {
    const x = input();
    mutate(x);
    assert.equal(S.plan(x).rows.filter((r) => !r.eligible).length, blocked);
  }
  assert.ok(
    S.candidate(
      "SPY",
      { valid: true, drawdown: 20, volatility: 2, stabilization: "strong" },
      0.4,
      0.42,
      "Neutral",
    ).reasons.includes("OVERWEIGHT"),
  );
  const x = input();
  x.signals.QQQ.volatility = 5.99999;
  assert.equal(S.plan(x).reasons.length, 0);
});
test("capped allocation, repeated confirmed spending and shallow limit", () => {
  const x = input(),
    p = S.plan(x);
  assert.equal(p.allocated, 25);
  assert.ok(
    p.rows.every(
      (r) => r.amountUSD <= (["SPY", "QQQ"].includes(r.symbol) ? 12.5 : 6.25),
    ),
  );
  x.ledger.weekSpent = 20;
  x.ledger.bySymbol = { SPY: 12.5, NVDA: 6.25, AAPL: 1.25 };
  const q = S.plan(x);
  assert.ok(q.allocated <= 5);
  assert.equal(q.rows.find((r) => r.symbol === "SPY").amountUSD, 0);
  const y = input();
  S.symbols.forEach((s) => {
    y.signals[s].drawdown = 0;
  });
  y.signals.SPY.drawdown = 12;
  assert.equal(S.plan(y).allocated, 6.25);
});
test("CAD fees, shared account cash, unknown cash, and whole shares", () => {
  const x = input();
  x.accounts.usd = {
    currency: "CAD",
    type: "NON_REGISTERED",
    cash: 30,
    reserved: 10,
  };
  x.fxRate = 1.35;
  x.fxAsOf = "2026-09-08T13:00:00Z";
  const p = S.plan(x);
  assert.ok(p.rows.reduce((a, r) => a + r.accountDebit, 0) <= 20 + 0.001);
  assert.ok(p.allocated <= 25);
  assert.ok(p.rows.filter((r) => r.amountUSD > 0).every((r) => r.fxFee > 0));
  x.accounts.usd.cash = null;
  assert.equal(S.plan(x).allocated, 0);
  const y = input();
  Object.values(y.securities).forEach((s) => (s.fractional = false));
  assert.equal(S.plan(y).allocated, 0);
  const z = input();
  z.securities.SPY.fractional = "unknown";
  assert.equal(S.plan(z).rows.find((r) => r.symbol === "SPY").amountUSD, 0);
});
test("post-buy weights are capped and rounding cannot overspend", () => {
  const x = input();
  x.values.SPY = 4199;
  x.values.KO -= 199;
  const p = S.plan(x),
    total =
      Object.values(x.values).reduce((a, b) => a + b, 0) +
      p.rows.reduce((a, r) => a + r.notional, 0);
  for (const r of p.rows)
    if (r.amountUSD)
      assert.ok(
        (x.values[r.symbol] + r.notional) / total <=
          x.targets[r.symbol] + 0.02 + 1e-9,
      );
  for (let n = 1; n < 150; n++) {
    const y = input();
    y.ledger.weekLimit = n / 100;
    const q = S.plan(y);
    assert.ok(q.allocated <= n / 100 + 0.0001);
  }
});
test("weekly history excludes current partial week, rejects gaps and is causal", () => {
  const rows = Array.from({ length: 53 }, (_, i) => ({
    date: new Date(Date.parse("2025-09-05") + i * 7 * 86400000)
      .toISOString()
      .slice(0, 10),
    adjusted_close: 100 + i,
  }));
  const a = S.signal(rows, now);
  assert.equal(a.valid, true);
  assert.equal(a.stabilization, "strong");
  assert.deepEqual(
    S.signal(
      [
        ...rows,
        { date: "2026-09-07", adjusted_close: 1 },
        { date: "2026-09-09", adjusted_close: 999 },
      ],
      now,
    ),
    a,
  );
  assert.equal(
    S.signal(
      rows.filter((_, i) => i !== 30),
      now,
    ).valid,
    false,
  );
  assert.equal(S.signal(rows.slice(0, -1), now).valid, false);
});
function trade(id = "one", amount = 5) {
  return {
    id,
    symbol: "SPY",
    quantity: amount / 50,
    price: 50,
    accountCurrency: "USD",
    accountDebit: amount,
    fxFee: 0,
    tradeAt: "2026-09-08T13:00:00Z",
    tier: "15-25",
  };
}
test("monthly backfill, unlimited carry and frozen cross-month week", () => {
  let b = L.ensure(L.blank(), "2026-01-01T14:00:00Z");
  assert.equal(L.summary(b, "2026-01-01").weekLimit, 25);
  b = L.ensure(b, "2026-09-08T14:00:00Z");
  assert.equal(L.summary(b, now).balance, 900);
  assert.equal(L.summary(b, now).weekLimit, 50);
  assert.deepEqual(L.ensure(b, now), b);
  let c = L.ensure(L.blank(), "2026-08-31T14:00:00Z");
  c = L.ensure(c, "2026-09-01T14:00:00Z");
  assert.equal(L.summary(c, "2026-09-01").balance, 200);
  assert.equal(L.summary(c, "2026-09-01").weekLimit, 25);
});
test("confirmation idempotence, reversal, anomalies and restore safety", () => {
  let b = L.ensure(L.blank(), now);
  b = L.buy(b, trade(), now);
  assert.equal(L.summary(b, now).balance, 95);
  assert.deepEqual(L.buy(b, trade(), now), b);
  const reversed = L.reverse(b, "one", now);
  assert.equal(L.summary(reversed, now).balance, 100);
  assert.deepEqual(L.reverse(reversed, "one", now), reversed);
  const bad = L.buy(b, trade("two", 30), now);
  assert.equal(L.summary(bad, now).blocked, true);
  assert.equal(bad.entries.at(-1).anomaly, true);
  assert.throws(() => L.restore(b, L.blank()));
  assert.throws(() => L.validate({ version: 2, entries: [] }));
});
test("NY calendar is stable across midnight and DST", () => {
  assert.equal(S.day("2026-09-01T02:00:00Z"), "2026-08-31");
  assert.equal(S.week("2026-03-09T03:00:00Z"), "2026-03-02");
});
module.exports = { input };
test("FX cents cannot exceed all-in USD caps; exact cash supports a smaller order", () => {
  for (const reserve of [100, 199.99, 200, 200.01, 400]) {
    const x = input();
    x.ledger.balance = reserve;
    x.ledger.weekLimit = Math.floor(Math.min(50, reserve * 0.25) * 100) / 100;
    x.accounts.usd = {
      currency: "CAD",
      type: "NON_REGISTERED",
      cash: 1000,
      reserved: 0,
    };
    x.fxRate = 1.35;
    x.fxAsOf = "2026-09-08T13:00:00Z";
    const result = S.plan(x);
    assert.ok(
      result.rows.reduce((sum, r) => sum + r.accountDebit / 1.35, 0) <=
        x.ledger.weekLimit + 1e-9,
    );
    for (const r of result.rows)
      assert.ok(r.accountDebit / 1.35 <= r.amountUSD + 1e-9);
  }
  const x = input();
  x.accounts.usd.cash = 3;
  const p = S.plan(x);
  assert.ok(p.allocated <= 3);
  assert.ok(p.allocated > 0);
});
test("cross-week reversal preserves frozen next-week allowance and import validates conservation", () => {
  let b = L.buy(L.ensure(L.blank(), now), trade(), now);
  b = L.ensure(b, "2026-09-15T14:00:00Z");
  assert.equal(L.summary(b, "2026-09-15").weekLimit, 23.75);
  b = L.reverse(b, "one", "2026-09-15T14:00:00Z");
  assert.equal(L.summary(b, "2026-09-15").weekLimit, 23.75);
  assert.equal(L.summary(b, "2026-09-15").balance, 100);
  assert.equal(L.summary(b, now).weekSpent, 0);
  const corrupt = structuredClone(b);
  corrupt.entries.find((e) => e.type === "week").limitUSD = 50;
  assert.throws(() => L.validate(corrupt), /WEEK_INVALID/);
  assert.throws(
    () =>
      L.buy(
        L.buy(L.ensure(L.blank(), now), trade(), now),
        trade("one", 6),
        now,
      ),
    /ID_CONFLICT/,
  );
  assert.throws(
    () =>
      L.buy(
        L.ensure(L.blank(), now),
        { ...trade(), tradeAt: "2026-09-09T14:00:00Z" },
        now,
      ),
    /TRADE_DATE_INVALID/,
  );
});
test("post-weight cap releases funds to another eligible symbol", () => {
  const x = input();
  x.values.AAPL = 1449.99;
  x.values.KO -= 199.99;
  const p = S.plan(x);
  assert.equal(p.allocated, 25);
  assert.ok(
    p.rows
      .find((r) => r.symbol === "AAPL")
      .reasons.includes("POST_BUY_WEIGHT_LIMIT"),
  );
  for (const s of S.symbols) x.securities[s].fractional = false;
  x.quotes.SPY.price = 5.123456;
  const r = S.plan(x).rows.find((r) => r.symbol === "SPY");
  assert.equal(Number.isInteger(r.quantity), true);
});
