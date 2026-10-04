const test = require("node:test");
const assert = require("node:assert/strict");
const { build } = require("../take-profit-holdings.js");

const now = Date.parse("2026-10-04T12:00:00Z");
const row = (symbol = "AAPL", fields = {}) => ({ symbol, shares: 2, averageCost: 100,
  currency: "USD", listingCurrency: "USD", exchange: "NASDAQ", instrumentKind: "stock", cashEquivalent: false, ...fields });
const auto = (rows = [row()], fields = {}) => ({ sourceMode: "snaptrade_automatic",
  requestedSourceMode: "automatic", status: "ready", asOf: "2026-10-02T20:00:00Z", rows, ...fields });
const run = (holdings = auto(), observations = [], supportedSymbols = ["AAPL", "SPY", "WMT"]) => build({ holdings, observations, supportedSymbols, now });
const save = (position, fields = {}) => ({ symbol: position.symbol, date: "2026-09-01", cost: position.cost,
  holdingBasis: position.holdingBasis, ...fields });

test("imports every actual held symbol including outside-plan positions without guessing dates", () => {
  const holdings = auto([row(), row("WMT"), row("ZZZZ")]);
  const source = JSON.stringify(holdings);
  const result = run(holdings, [{symbol:"SPY",date:"2026-09-01",cost:100}]);
  assert.deepEqual(result.positions.map(p => p.symbol), ["AAPL", "WMT", "ZZZZ"]);
  assert.equal(result.positions[0].date, null);
  assert.equal(result.positions[0].blockedReasonCode, "date_missing");
  assert.equal(result.positions[2].blockedReasonCode, "unsupported_symbol");
  assert.equal(JSON.stringify(holdings), source);
});
test("known USD holding cost takes precedence over an old manual cost", () => {
  const result = run(auto(), [{symbol:"AAPL",date:"2026-09-01",cost:10}]).positions[0];
  assert.equal(result.cost, 100);
  assert.equal(result.costFromHolding, true);
  assert.equal(result.needsReview, true);
});
test("explicitly confirmed date and basis permit evaluation", () => {
  const first = run().positions[0];
  const result = run(auto(), [save(first)]).positions[0];
  assert.equal(result.date, "2026-09-01");
  assert.equal(result.blockedReason, null);
  assert.equal(result.needsReview, false);
});
test("cost or quantity changes require review and preserving the date cannot reset silently", () => {
  const saved = save(run().positions[0]);
  for (const fields of [{shares:3},{averageCost:110}]) {
    const result = run(auto([row("AAPL",fields)]), [saved]).positions[0];
    assert.equal(result.needsReview, true);
    assert.equal(result.blockedReasonCode,"holding_changed");
    assert.equal(result.date, saved.date);
    assert.equal(run(auto([row("AAPL",fields)]), [save(result)]).positions[0].blockedReason, null);
  }
});
test("legacy observations remain usable only when their USD cost matches", () => {
  const legacy = {symbol:"AAPL",date:"2026-09-01",cost:100};
  assert.equal(run(auto(),[legacy]).positions[0].blockedReason,null);
  assert.equal(run(auto(),[{...legacy,cost:90}]).positions[0].needsReview,true);
});
test("cash, short, zero and unknown quantities never enter current long holdings", () => {
  const result = run(auto([row(),row("SPY",{shares:0}),row("WMT",{shares:-2}),row("CASH",{cashEquivalent:true}),row("MISSING",{shares:null})]));
  assert.deepEqual(result.positions.map(p=>p.symbol),["AAPL"]);
});
test("locked, stale and failed automatic source never falls back to saved observations", () => {
  for (const status of ["locked","checking","warning","error","idb_unavailable"]) {
    const result = run(auto(undefined,{status}),[{symbol:"AAPL",date:"2026-09-01",cost:100}]);
    assert.equal(result.available,false);
    assert.deepEqual(result.positions,[]);
  }
  assert.equal(run(auto(undefined,{sourceMode:"manual"})).available,false);
});
test("valid-looking ready snapshots are independently checked for age and future times", () => {
  for (const asOf of ["2026-09-30T12:00:00Z","2026-10-05T00:00:00Z",null,"2026-02-30T00:00:00Z","bad"]) {
    assert.equal(run(auto(undefined,{asOf})).available,false);
  }
  assert.equal(run(auto(undefined,{asOf:"2026-10-01T12:00:00Z"})).available,true);
});
test("current FX is never used to relabel a CAD entry cost", () => {
  const holding = auto([row("AAPL",{currency:"CAD",averageCost:140})]);
  const first = run(holding).positions[0];
  assert.equal(first.cost,null);
  assert.equal(first.costFromHolding,false);
  const confirmed = run(holding,[save(first,{cost:100})]).positions[0];
  assert.equal(confirmed.cost,100);
  assert.equal(confirmed.blockedReason,null);
});
test("foreign listings remain blocked even with a manually entered USD cost", () => {
  const holding = auto([row("AAPL",{listingCurrency:"CAD",exchange:"TSX"})]);
  const first = run(holding).positions[0];
  assert.equal(run(holding,[save(first,{cost:100})]).positions[0].blockedReasonCode,"unsupported_listing_currency");
});
test("every exchange in a cross-account aggregate must be verified US", () => {
  assert.equal(run(auto([row("AAPL",{exchange:"NASDAQ / NYSE"})])).positions[0].blockedReasonCode,"date_missing");
  assert.equal(run(auto([row("AAPL",{exchange:"NASDAQ / TSX"})])).positions[0].blockedReasonCode,"unsupported_exchange");
  assert.equal(run(auto([row("AAPL",{exchange:"NASDAQ / "})])).positions[0].blockedReasonCode,"unsupported_exchange");
});
test("missing listing identity and unsupported products block a ready source", () => {
  for (const fields of [{listingCurrency:null},{exchange:null},{instrumentKind:"option"}]) {
    const first=run(auto([row("AAPL",fields)])).positions[0];
    assert.notEqual(run(auto([row("AAPL",fields)]),[save(first,{cost:100})]).positions[0].blockedReason,null);
  }
});
test("manual holdings use planning currency and include only actual owned shares", () => {
  const manual = {sourceMode:"manual",requestedSourceMode:"manual",status:"ready",asOf:null,
    rows:[row("AAPL",{listingCurrency:null,exchange:"",currency:"CAD"})]};
  const first=run(manual).positions[0];
  assert.equal(first.cost,null);
  assert.equal(run(manual,[save(first,{cost:105})]).positions[0].blockedReason,null);
  const usd={...manual,rows:[row("AAPL",{listingCurrency:null,exchange:""})]};
  assert.equal(run(usd).positions[0].cost,100);
});
test("source switches invalidate an existing monitoring basis", () => {
  const saved=save(run().positions[0]);
  const manual={sourceMode:"manual",requestedSourceMode:"manual",status:"ready",rows:[row()]};
  assert.equal(run(manual,[saved]).positions[0].blockedReasonCode,"holding_changed");
});
test("malformed and duplicate holdings/observations cannot silently produce a valid basis", () => {
  assert.equal(run(null).available,false);
  assert.equal(run(auto(undefined,{rows:null})).available,false);
  assert.equal(run(auto([row(),row()])).positions[0].blockedReasonCode,"duplicate_holding");
  const saved=save(run().positions[0]);
  assert.equal(run(auto(),[saved,saved]).positions[0].needsReview,true);
  for (const averageCost of [null,"",false,Infinity,"USD 100"]) assert.equal(run(auto([row("AAPL",{averageCost})])).positions[0].cost,null);
});
test("sold holdings disappear while observations remain untouched", () => {
  const observations=[save(run().positions[0])], original=JSON.stringify(observations);
  assert.deepEqual(run(auto([]),observations).positions,[]);
  assert.equal(JSON.stringify(observations),original);
});
