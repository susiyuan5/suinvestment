const test = require("node:test");
const assert = require("node:assert/strict");
const calendar = require("../market-calendar");
const market = require("../market-data");
const fixtures = require("./fixtures/market-sessions.json");
for (const fixture of fixtures) {
  test("session freshness: " + fixture.name, () => {
    const now = Date.parse(fixture.now);
    const actual = calendar.assess(fixture.quote, now);
    for (const [key, value] of Object.entries(fixture.expected))
      assert.equal(actual[key], value, key);
    assert.equal(market.quoteStatus(fixture.quote, now), fixture.status);
  });
}
test("missing or incompatible calendar never permits a closed-market exemption", async () => {
  for (const value of [null, {}, { version: "future" }]) {
    const instance = calendar.create(value);
    assert.equal(
      instance.assess(fixtures[0].quote, Date.parse(fixtures[0].now)).eligible,
      false,
    );
    await instance.load(async () => {
      throw Error("offline");
    });
    assert.equal(instance.available, false);
  }
});
test("calendar cannot upgrade a rejected snapshot or a future quote", () => {
  const f = fixtures[0],
    now = Date.parse(f.now);
  assert.equal(market.quoteStatus({ ...f.quote, stale: true }, now), "stale");
  assert.equal(
    market.quoteStatus({ ...f.quote, validationStatus: "stale_fallback" }, now),
    "stale",
  );
  assert.equal(
    market.quoteStatus({ ...f.quote, quoteTimestamp: now + 360000 }, now),
    "stale",
  );
});
test("incomplete/holiday bars cannot be converted to a fabricated close", () => {
  assert.ok(
    Number.isNaN(
      market.dailyCloseTimestamp(
        "2026-09-14",
        NaN,
        "Yahoo",
        "SPY",
        Date.parse("2026-09-14T15:00:00Z"),
      ),
    ),
  );
  assert.ok(
    Number.isNaN(market.dailyCloseTimestamp("2026-06-19", NaN, "Yahoo", "SPY")),
  );
  const intraday = Date.parse("2026-09-11T13:30:00Z");
  assert.equal(
    market.dailyCloseTimestamp("2026-09-11", intraday, "Yahoo", "SPY"),
    intraday,
  );
  assert.equal(
    market.dailyCloseTimestamp(
      "2026-11-27",
      NaN,
      "Yahoo",
      "SPY",
      Date.parse("2026-11-29T15:00:00Z"),
    ),
    Date.parse("2026-11-27T18:00:00Z"),
  );
});
