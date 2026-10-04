const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const scripts = fs.readdirSync(path.join(root, "scripts")).filter((name) => name.startsWith("snaptrade") || name === "sync-snaptrade-holdings.mjs" || name === "encrypted-holdings-snapshot.mjs");

test("SnapTrade integration is Personal and read-only", () => {
  const source = scripts.map((name) => fs.readFileSync(path.join(root, "scripts", name), "utf8")).join("\n");
  assert.match(source, /SnaptradeAuth\.personalApiKey/);
  assert.match(source, /WEALTHSIMPLETRADE/);
  assert.match(source, /connectionType: "read"/);
  for (const forbidden of ["registerSnapTradeUser", ".trading", "placeOrder", "cancelOrder", "replaceOrder", "trade-if-available", "connectionType: \"trade\""]) assert.doesNotMatch(source, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("browser surface does not receive SnapTrade secrets", () => {
  const browser = ["snaptrade-holdings-store.js", "snaptrade-holdings-view.js"].map((name) => fs.readFileSync(path.join(root, name), "utf8")).join("\n");
  assert.doesNotMatch(browser, /SNAPTRADE_CONSUMER_KEY|SNAPTRADE_CLIENT_ID|consumerKey|userSecret/);
  assert.match(browser, /IndexedDB/);
  assert.match(browser, /AES-GCM/);
});

test("browser key lifecycle validates before persistence and never falls back to plaintext", () => {
  const store = fs.readFileSync(path.join(root, "snaptrade-holdings-store.js"), "utf8");
  assert.match(store, /validateBase64Key/);
  assert.match(store, /importNonExtractableKey/);
  assert.match(store, /decryptAndValidateEnvelope/);
  assert.match(store, /persistValidatedKey/);
  assert.match(store, /verifyPersistedKey/);
  assert.match(store, /extractable.*false/);
  assert.match(store, /requestPersistentStorage/);
  assert.match(store, /session_only/);
  assert.doesNotMatch(store, /localStorage\.setItem\([^)]*(?:key|密钥)/i);
  assert.doesNotMatch(store, /sessionStorage\.setItem\([^)]*(?:key|密钥)/i);
  assert.doesNotMatch(store, /catch\s*\(\s*_\s*\)\s*\{\s*\}/);
  assert.doesNotMatch(store, /base64.*indexeddb|indexeddb.*base64/i);
});

test("published encrypted envelope contains no plaintext holdings fields", () => {
  const envelope = JSON.parse(fs.readFileSync(path.join(root, "data/private/wealthsimple-holdings.enc.json"), "utf8"));
  assert.equal(envelope.schema_version, "wealthsimple-holdings-encrypted-v1");
  assert.equal(envelope.algorithm, "AES-256-GCM");
  for (const field of ["accounts", "holdings", "positions", "balances", "consumer_key", "user_secret"]) assert.equal(Object.hasOwn(envelope, field), false);
  const ciphertext = Buffer.from(envelope.ciphertext_base64, "base64");
  assert.equal(crypto.createHash("sha256").update(ciphertext).digest("hex"), envelope.ciphertext_hash);
});

test("normalizer separates cash equivalents and hashes account identifiers", async () => {
  const { normalizePosition, stableAccountId } = await import("../scripts/snaptrade-normalizer.mjs");
  const cash = normalizePosition({ cash_equivalent: true, instrument: { kind: "cash", symbol: "USD" }, units: "12.34" });
  const stock = normalizePosition({ instrument: { kind: "stock", symbol: "AAPL" }, units: "1.25", price: "100.00" });
  assert.equal(cash.included_in_stock_plan, false);
  assert.equal(stock.included_in_stock_plan, true);
  assert.equal(stock.units_raw, "1.25");
  assert.equal(stableAccountId({ id: "account-number-123" }).includes("account-number-123"), false);
});

test("normalizer reads the real nested SnapTrade position schema", async () => {
  const { normalizePosition } = await import("../scripts/snaptrade-normalizer.mjs");
  const result = normalizePosition({ symbol: { symbol: { symbol: "AAPL", raw_symbol: "AAPL", description: "Apple", currency: { code: "USD" }, exchange: { code: "NASDAQ" }, type: { code: "cs" } } }, units: 2, price: 100, average_purchase_price: 80, currency: { code: "USD" } });
  assert.equal(result.symbol, "AAPL");
  assert.equal(result.position_currency, "USD");
  assert.equal(result.listing_currency, "USD");
  assert.equal(result.cost_basis, 80);
  assert.equal(result.market_value, 200);
  assert.equal(result.included_in_stock_plan, true);
});

test("portfolio risk converts CAD cash before USD aggregation", async () => {
  const { portfolioRiskFromSnapshot } = await import("../scripts/snaptrade-normalizer.mjs");
  const snapshot = { generated_at: "2026-08-12T12:00:00Z", holdings: [{ symbol: "AAPL", included_in_stock_plan: true, units: 1, price: 100, cost_basis: 80, market_value: 100, position_currency: "USD" }], accounts: [{ balances: [{ currency: "CAD", cash: 100 }] }] };
  const result = portfolioRiskFromSnapshot(snapshot, { fxRate: 1.35, fxAsOf: "2026-08-11T12:00:00Z", now: Date.parse("2026-08-12T12:00:00Z") });
  assert.equal(result.complete, true);
  assert.ok(Math.abs(result.total_portfolio_value - 174.074074) < .00001);
  assert.ok(Math.abs(result.available_cash - 74.074074) < .00001);
});

test("portfolio risk blocks mixed currencies when FX is unavailable", async () => {
  const { portfolioRiskFromSnapshot } = await import("../scripts/snaptrade-normalizer.mjs");
  const result = portfolioRiskFromSnapshot({ holdings: [], accounts: [{ balances: [{ currency: "CAD", cash: 100 }] }] }, {});
  assert.equal(result.complete, false);
  assert.equal(result.available_cash_provided, false);
});

test("AES-256-GCM snapshot round trip authenticates the outer schema", async () => {
  const { encryptSnapshot, decryptSnapshot } = await import("../scripts/encrypted-holdings-snapshot.mjs");
  const key = crypto.randomBytes(32).toString("base64");
  const payload = { schema_version: "wealthsimple-holdings-v1", accounts: [], holdings: [], generated_at: new Date().toISOString() };
  const envelope = encryptSnapshot(payload, key);
  assert.deepEqual(decryptSnapshot(envelope, key), payload);
  const tampered = { ...envelope, algorithm: "AES-256-GCM" };
  tampered.ciphertext_base64 = Buffer.from(Buffer.from(envelope.ciphertext_base64, "base64").map((value, index) => index === 0 ? value ^ 1 : value)).toString("base64");
  assert.throws(() => decryptSnapshot(tampered, key));
});

const SOURCE_NOW = "2026-10-04T12:00:00Z";
function sourceFixture({ asOf = "2026-10-04T11:00:00Z", dailyAsOf = "2026-09-01T00:00:00Z", generatedAt = SOURCE_NOW,
  positionMetadata = true, detailedHoldings, secondAccount, disabled = false, unavailable = false } = {}) {
  const connection = { id: "synthetic-readonly-connection", brokerage: { slug: "WEALTHSIMPLETRADE" }, type: "read", disabled };
  const account = { id: "synthetic-account", brokerage_authorization: connection.id,
    sync_status: { holdings: { last_successful_sync: dailyAsOf, holdings_unavailable: unavailable } } };
  const response = { results: [{ instrument: { kind: "stock", symbol: "SYNTH", currency: "USD", exchange: "XNAS" }, units: "1", price: "100", cost_basis: "80", currency: "USD" }] };
  if (positionMetadata) response.data_freshness = { as_of: asOf };
  const accountDetails = new Map();
  if (detailedHoldings !== undefined) accountDetails.set(account.id, { sync_status: { holdings: detailedHoldings } });
  const accounts = [account], positions = new Map([[account.id, response]]);
  if (secondAccount) {
    accounts.push({ ...account, id: "synthetic-second-account", sync_status: { holdings: { last_successful_sync: null } } });
    positions.set("synthetic-second-account", secondAccount);
  }
  return { connections: [connection], accounts, accountDetails, positions, generatedAt };
}

test("positions response brokerage freshness overrides stale daily account metadata without rewriting it", async () => {
  const { normalizeSnapshot, assertSnapshotSourceFreshness } = await import("../scripts/snaptrade-normalizer.mjs");
  const snapshot = normalizeSnapshot(sourceFixture());
  assert.equal(snapshot.positions_as_of, "2026-10-04T11:00:00Z");
  assert.equal(snapshot.accounts[0].positions_as_of, snapshot.positions_as_of);
  assert.equal(snapshot.accounts[0].holdings_as_of, "2026-09-01T00:00:00Z");
  assert.equal(snapshot.accounts[0].positions_timestamp_source, "positions_response");
  assert.equal(assertSnapshotSourceFreshness(snapshot), snapshot);
});

test("absent endpoint metadata uses authoritative account details then legacy account list sync", async () => {
  const { normalizeSnapshot, assertSnapshotSourceFreshness } = await import("../scripts/snaptrade-normalizer.mjs");
  const details = normalizeSnapshot(sourceFixture({ positionMetadata: false, detailedHoldings: { last_successful_sync: "2026-10-04T10:00:00Z" } }));
  assert.equal(details.positions_as_of, "2026-10-04T10:00:00Z");
  assert.equal(details.accounts[0].positions_timestamp_source, "account_details_holdings_sync");
  assert.doesNotThrow(() => assertSnapshotSourceFreshness(details));
  const legacy = normalizeSnapshot(sourceFixture({ positionMetadata: false, dailyAsOf: "2026-10-03T10:00:00Z" }));
  assert.equal(legacy.positions_as_of, "2026-10-03T10:00:00Z");
  assert.equal(legacy.accounts[0].positions_timestamp_source, "account_list_holdings_sync");
  assert.doesNotThrow(() => assertSnapshotSourceFreshness(legacy));
});

test("present invalid endpoint metadata never falls back to a newer account timestamp or local clock", async () => {
  const { normalizeSnapshot } = await import("../scripts/snaptrade-normalizer.mjs");
  for (const asOf of [null, "", "bad", "2026-02-30T11:00:00Z", "2026-10-04T25:00:00Z", "2026-10-04T11:00:00", false]) {
    assert.throws(() => normalizeSnapshot(sourceFixture({ asOf, dailyAsOf: SOURCE_NOW, detailedHoldings: { last_successful_sync: SOURCE_NOW } })), /来源时间/);
  }
  const nullMetadata = sourceFixture();
  nullMetadata.positions.get("synthetic-account").data_freshness = null;
  assert.throws(() => normalizeSnapshot(nullMetadata), /来源时间/);
});

test("fresh account list metadata cannot mask a present unknown details source timestamp", async () => {
  const { normalizeSnapshot, assertSnapshotSourceFreshness } = await import("../scripts/snaptrade-normalizer.mjs");
  const snapshot = normalizeSnapshot(sourceFixture({ positionMetadata: false, dailyAsOf: SOURCE_NOW, detailedHoldings: {} }));
  assert.equal(snapshot.positions_as_of, null);
  assert.equal(snapshot.status, "warning");
  assert.throws(() => assertSnapshotSourceFreshness(snapshot), /来源/);
});

test("a genuinely newer brokerage response is published even when holdings do not change", async () => {
  const { normalizeSnapshot, assertSnapshotSourceFreshness } = await import("../scripts/snaptrade-normalizer.mjs");
  const comparable = (snapshot) => { const copy = structuredClone(snapshot); delete copy.generated_at; return JSON.stringify(copy); };
  const old = normalizeSnapshot(sourceFixture({ asOf: "2026-10-03T11:00:00Z", generatedAt: "2026-10-03T12:00:00Z" }));
  const newer = normalizeSnapshot(sourceFixture());
  assert.deepEqual(old.holdings, newer.holdings);
  assert.notEqual(comparable(old), comparable(newer), "generator unchanged-content shortcut must see genuine brokerage freshness");
  assert.doesNotThrow(() => assertSnapshotSourceFreshness(newer));
  const onlyLocalClockChanged = normalizeSnapshot(sourceFixture({ asOf: "2026-10-03T11:00:00Z" }));
  assert.equal(comparable(old), comparable(onlyLocalClockChanged), "local generation alone must not manufacture source freshness");
});

test("stale source age stays traceable and is rejected even after a successful new local fetch", async () => {
  const { normalizeSnapshot, assertSnapshotSourceFreshness } = await import("../scripts/snaptrade-normalizer.mjs");
  for (const positionMetadata of [true, false]) {
    const snapshot = normalizeSnapshot(sourceFixture({ asOf: "2026-09-30T12:00:00Z", dailyAsOf: "2026-09-30T12:00:00Z", positionMetadata }));
    assert.equal(snapshot.generated_at, SOURCE_NOW);
    assert.equal(snapshot.positions_as_of, "2026-09-30T12:00:00Z");
    assert.throws(() => assertSnapshotSourceFreshness(snapshot), /超过 3 天/);
  }
});

test("publication freshness admits the inclusive 72-hour boundary and rejects one millisecond older", async () => {
  const { normalizeSnapshot, assertSnapshotSourceFreshness } = await import("../scripts/snaptrade-normalizer.mjs");
  assert.doesNotThrow(() => assertSnapshotSourceFreshness(normalizeSnapshot(sourceFixture({ asOf: "2026-10-01T12:00:00Z" }))));
  assert.throws(() => assertSnapshotSourceFreshness(normalizeSnapshot(sourceFixture({ asOf: "2026-10-01T11:59:59.999Z" }))), /超过 3 天/);
});

test("snapshot age represents the oldest source across every account using actual timestamp ordering", async () => {
  const { normalizeSnapshot, assertSnapshotSourceFreshness } = await import("../scripts/snaptrade-normalizer.mjs");
  const offset = normalizeSnapshot(sourceFixture({ generatedAt: "2026-10-04T14:00:00Z", asOf: "2026-10-04T10:00:00-03:00",
    secondAccount: { results: [], data_freshness: { as_of: "2026-10-04T12:30:00Z" } } }));
  assert.equal(offset.positions_as_of, "2026-10-04T12:30:00Z", "10:00 -03:00 is actually newer than 12:30Z");
  assert.doesNotThrow(() => assertSnapshotSourceFreshness(offset));
  const staleAccount = normalizeSnapshot(sourceFixture({ secondAccount: { results: [], data_freshness: { as_of: "2026-09-30T12:00:00Z" } } }));
  assert.equal(staleAccount.positions_as_of, "2026-09-30T12:00:00Z");
  assert.throws(() => assertSnapshotSourceFreshness(staleAccount), /超过 3 天/);
});

test("one unknown account cannot borrow another account's valid timestamp or local generation time", async () => {
  const { normalizeSnapshot, assertSnapshotSourceFreshness } = await import("../scripts/snaptrade-normalizer.mjs");
  const snapshot = normalizeSnapshot(sourceFixture({ secondAccount: { results: [] } }));
  assert.equal(snapshot.accounts[0].positions_as_of, "2026-10-04T11:00:00Z");
  assert.equal(snapshot.accounts[1].positions_as_of, null);
  assert.equal(snapshot.positions_as_of, null);
  assert.equal(snapshot.status, "warning");
  assert.match(snapshot.warnings.join(" "), /缺失持仓来源时间/);
  assert.throws(() => assertSnapshotSourceFreshness(snapshot), /来源/);
});

test("future source times are rejected per account even when another source time is old and valid", async () => {
  const { normalizeSnapshot, assertSnapshotSourceFreshness } = await import("../scripts/snaptrade-normalizer.mjs");
  assert.throws(() => normalizeSnapshot(sourceFixture({ asOf: "2026-10-04T12:00:00.001Z" })), /未来来源数据/);
  assert.throws(() => normalizeSnapshot(sourceFixture({ secondAccount: { results: [], data_freshness: { as_of: "2026-10-04T13:00:00Z" } } })), /未来来源数据/);
  const valid = normalizeSnapshot(sourceFixture());
  const forged = { ...valid, accounts: valid.accounts.map((account) => ({ ...account, positions_as_of: "2026-10-04T13:00:00Z" })) };
  assert.throws(() => assertSnapshotSourceFreshness(forged), /未来来源数据/);
});

test("publication guard rejects forged aggregate ages, invalid local reference and unavailable source accounts", async () => {
  const { normalizeSnapshot, assertSnapshotSourceFreshness } = await import("../scripts/snaptrade-normalizer.mjs");
  const valid = normalizeSnapshot(sourceFixture());
  assert.throws(() => assertSnapshotSourceFreshness({ ...valid, positions_as_of: SOURCE_NOW }), /最旧的数据/);
  assert.throws(() => assertSnapshotSourceFreshness({ ...valid, generated_at: "bad" }), /来源时间/);
  assert.throws(() => assertSnapshotSourceFreshness({ ...valid, positions_as_of: null }), /来源时间/);
  assert.throws(() => assertSnapshotSourceFreshness({ ...valid, accounts: valid.accounts.map((account) => ({ ...account, positions_as_of: null })) }), /来源时间/);
  assert.throws(() => assertSnapshotSourceFreshness({ ...valid, accounts: valid.accounts.map((account) => ({ ...account, sync_status: "unavailable" })) }), /来源不可用/);
  const unavailable = normalizeSnapshot(sourceFixture({ unavailable: true }));
  assert.equal(unavailable.status, "warning");
  assert.throws(() => assertSnapshotSourceFreshness(unavailable), /来源/);
  const disabled = normalizeSnapshot(sourceFixture({ disabled: true }));
  assert.equal(disabled.status, "blocked");
  assert.throws(() => assertSnapshotSourceFreshness(disabled), /来源/);
});

test("fresh endpoint metadata cannot turn malformed position results into a valid empty snapshot", async () => {
  const { normalizeSnapshot, assertSnapshotSourceFreshness } = await import("../scripts/snaptrade-normalizer.mjs");
  for (const response of [{data_freshness:{as_of:SOURCE_NOW}}, {results:null,data_freshness:{as_of:SOURCE_NOW}},
    {results:{},data_freshness:{as_of:SOURCE_NOW}}, null, "bad response"]) {
    const input=sourceFixture();
    input.positions.set("synthetic-account",response);
    assert.throws(()=>normalizeSnapshot(input),/持仓响应明细无效/);
  }
  const empty=sourceFixture();
  empty.positions.get("synthetic-account").results=[];
  const emptySnapshot=normalizeSnapshot(empty);
  assert.deepEqual(emptySnapshot.holdings,[]);
  assert.doesNotThrow(()=>assertSnapshotSourceFreshness(emptySnapshot));
  const legacy=sourceFixture({dailyAsOf:"2026-10-04T11:00:00Z"});
  legacy.positions.set("synthetic-account",[]);
  assert.doesNotThrow(()=>assertSnapshotSourceFreshness(normalizeSnapshot(legacy)));
});

test("browser refresh warns on missing/stale/future brokerage source age despite a new generated_at", async () => {
  const source = fs.readFileSync(path.join(root, "snaptrade-holdings-view.js"), "utf8");
  const now = Date.parse(SOURCE_NOW);
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  for (const [positionsAsOf, expected] of [[undefined, "warning"], [null, "warning"], ["2026-09-30T12:00:00Z", "warning"], ["2026-10-04T12:00:00.001Z", "warning"], ["2026-10-04T11:00:00Z", "ready"], ["2026-10-01T12:00:00Z", "ready"]]) {
    const snapshot = { schema_version: "wealthsimple-holdings-v1", generated_at: SOURCE_NOW, accounts: [{ balances: [] }], holdings: [] };
    if (positionsAsOf !== undefined) snapshot.positions_as_of = positionsAsOf;
    const events = [], elements = new Map();
    const context = vm.createContext({
      Date: FixedDate,
      document: { readyState: "loading", addEventListener() {}, getElementById(id) {
        if (!elements.has(id)) elements.set(id, { textContent: "", dataset: {} });
        return elements.get(id);
      } },
      localStorage: { getItem: () => "automatic" },
      CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
      dispatchEvent: (event) => events.push(event),
      SnaptradeHoldingsStore: { autoUnlockFromStoredKey: async () => ({ status: "ready", snapshot }) },
    });
    vm.runInContext(source, context);
    await context.SnaptradeHoldingsView.refresh();
    const update = events.find((event) => event.type === "snaptrade:holdings-updated");
    assert.equal(update.detail.status, expected);
    assert.equal(elements.get("snaptradeSyncStatus").dataset.state, expected);
    assert.equal(elements.get("snaptradeSyncAsOf").textContent, positionsAsOf || "未知", "data as-of must display brokerage time rather than local generation time");
    if (expected === "warning") assert.equal(update.detail.portfolioRisk, null);
    else assert.equal(update.detail.portfolioRisk.complete, true);
  }
});
