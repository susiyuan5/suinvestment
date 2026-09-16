const test = require("node:test");
const assert = require("node:assert/strict");
const create = require("../live-data.js");
const sha = (n) => String(n).repeat(40);
const manifest = (n) => ({
  formatVersion: 1,
  dataCommit: sha(n),
  codeCommit: sha(9),
  publishedAt: "2026-09-13T12:00:00Z",
});
test("manifest publication and skipped quote refresh have distinct user messages", () => {
  const source = create({ fetch: async () => Response.json({}) });
  assert.match(source.priceUpdateSummary({ publishStatus: "skipped", generatedAt: "2026-09-14T12:00:00Z" }), /行情未替换/);
  assert.match(source.priceUpdateSummary({ publishStatus: "published", generatedAt: "2026-09-14T12:00:00Z" }), /行情已替换/);
  assert.match(source.priceUpdateSummary(null), /不可用/);
});
test("one session pins correlated files while next refresh can advance", async () => {
  let version = 1;
  const calls = [];
  const source = create({
    fetch: async (url) => {
      calls.push(url);
      return Response.json(
        url.includes("manifest") ? manifest(version) : { url },
      );
    },
  });
  const old = await source.session().ready;
  await old.fetch("data/market-data.json?v=1");
  version = 2;
  const next = await source.refresh();
  await old.fetch("data/backtest-prices.json");
  await next.fetch("data/backtest-prices.json");
  assert.ok(calls[3].includes(sha(1)));
  assert.ok(calls[4].includes(sha(2)));
  assert.notEqual(calls[0], calls[2], "manifest cache key rotates");
});
test("manifest failures and incompatible formats never fall back to bundled data", async () => {
  for (const response of [
    Response.json({}, { status: 503 }),
    Response.json({ ...manifest(1), formatVersion: 2 }),
    Response.json({ ...manifest(1), dataCommit: "main" }),
  ]) {
    const calls = [];
    const source = create({
      fetch: async (url) => {
        calls.push(url);
        return response;
      },
    });
    await assert.rejects(source.fetch("data/market-data.json"));
    assert.equal(calls.length, 1);
  }
});
test("static configuration and external APIs retain their original URLs", async () => {
  const urls = [];
  const source = create({
    fetch: async (url) => {
      urls.push(url);
      return Response.json(url.includes("manifest") ? manifest(1) : {});
    },
  });
  await source.fetch("data/core-satellite-v5.json");
  await source.fetch("data/etf-holdings.json");
  await source.fetch("https://query1.finance.yahoo.com/test");
  assert.ok(urls.includes("data/core-satellite-v5.json"));
  assert.equal(source.pathOf("data/private/key.json"), null);
  assert.equal(source.pathOf("results/../key"), null);
});

test("published stock search index is pinned to the live-data commit", async () => {
  const calls = [];
  const source = create({
    fetch: async (url) => {
      calls.push(String(url));
      return Response.json(String(url).includes("manifest") ? manifest(1) : { formatVersion: 1, symbols: [] });
    },
  });
  const session = await source.session().ready;
  await session.fetch("data/us-equity-search-index.json");
  assert.match(calls.at(-1), new RegExp(session.manifest.dataCommit + "/data/us-equity-search-index\\.json"));
});
test("data timeout rejects instead of leaving an executable stale snapshot", async () => {
  const source = create({
    timeoutMs: 10,
    fetch: async (url, init) => {
      if (url.includes("manifest")) return Response.json(manifest(1));
      return new Promise((resolve, reject) =>
        init.signal.addEventListener("abort", () =>
          reject(new Error("timeout")),
        ),
      );
    },
  });
  await assert.rejects(source.fetch("data/market-data.json"), /timeout/);
});
test("simultaneous refreshes share a manifest and encrypted content is fetched unchanged", async () => {
  let calls = 0;
  const envelope = { ciphertext_base64: "encrypted-only" };
  const source = create({
    fetch: async (url) => {
      calls++;
      return Response.json(url.includes("manifest") ? manifest(1) : envelope);
    },
  });
  const [a, b] = await Promise.all([source.refresh(), source.refresh()]);
  assert.equal(a, b);
  assert.equal(calls, 1);
  assert.deepEqual(
    await (await a.fetch("data/private/wealthsimple-holdings.enc.json")).json(),
    envelope,
  );
});
