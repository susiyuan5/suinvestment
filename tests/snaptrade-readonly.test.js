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
