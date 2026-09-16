import assert from "node:assert/strict";
import create from "../live-data.js";

// Uses the same resolver as the browser. No checkout data or local decryption.
const source = create({ fetch, timeoutMs: 30000 });
const session = await source.session().ready;
for (const path of [
  "data/market-data.json",
  "data/backtest-prices.json",
  "data/us-equity-search-index.json",
  "results/health/project-health.json",
  "research/results/v3_1/idea-engine/latest-candidates.json",
  "data/private/wealthsimple-holdings.enc.json",
]) {
  const response = await session.fetch(path);
  assert.equal(response.ok, true, path);
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "*",
    "public browser CORS: " + path,
  );
  const value = await response.json();
  assert.equal(typeof value, "object", path);
  if (path.includes("private")) {
    assert.equal(value.schema_version, "wealthsimple-holdings-encrypted-v1");
    assert.ok(value.ciphertext_base64);
    assert.equal(value.holdings, undefined);
    assert.equal(value.accounts, undefined);
  }
  assert.ok(session.url(path).includes(session.manifest.dataCommit));
}
console.log(JSON.stringify({ passed: true, ...session.manifest }));
