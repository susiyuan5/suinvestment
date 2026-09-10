const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

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
