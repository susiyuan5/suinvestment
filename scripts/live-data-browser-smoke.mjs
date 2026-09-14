import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.BASE_URL;
if (!base) throw Error("BASE_URL is required");
const browser = await chromium.launch();
try {
  for (const path of ["", "holdings.html", "stock-detail.html?ticker=NVDA", "research-sandbox.html"]) {
    const page = await browser.newPage();
    const errors = [];
    const versions = new Set();
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => {
      const match = request.url().match(/raw\.githubusercontent\.com\/susiyuan5\/suinvestment\/([a-f0-9]{40})\//);
      if (match) versions.add(match[1]);
    });
    await page.goto(new URL(path, base.replace(/\/$/, "") + "/").href, { waitUntil: "domcontentloaded" });
    const manifest = await page.evaluate(async () => (await LiveData.session().ready).manifest);
    const response = await page.evaluate(async () => {
      const session = await LiveData.session().ready;
      const result = await session.fetch("data/market-data.json");
      return { ok: result.ok, value: (await result.json()).generatedAt };
    });
    assert.ok(response.ok && response.value, path);
    assert.deepEqual([...versions], [manifest.dataCommit], "each entry point pins one data commit");
    assert.deepEqual(errors, [], path);
    await page.close();
  }
  const failed = await browser.newPage();
  await failed.route("**/live-data/live-data-manifest.json*", route => route.fulfill({ status: 503, body: "unavailable" }));
  const bundled = [];
  failed.on("request", request => { if (request.url().startsWith(base) && /\/data\/(market-data|backtest-prices)\.json/.test(request.url())) bundled.push(request.url()); });
  await failed.goto(base, { waitUntil: "domcontentloaded" });
  await failed.locator('#liveDataStatus[data-failed="true"]').waitFor();
  assert.equal(bundled.length, 0, "manifest failure must not use bundled snapshots");
  await failed.close();
  console.log("Live-data browser smoke passed: four entry points, fixed revisions, CORS and failed-manifest safety.");
} finally {
  await browser.close();
}
