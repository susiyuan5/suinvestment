import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.BASE_URL;
if (!baseUrl) throw Error("BASE_URL is required");
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "zh-CN",
  });
  await context.route(
    /https:\/\/(finnhub\.io|query1\.finance\.yahoo\.com|www\.bankofcanada\.ca)\//,
    (r) => r.abort(),
  );
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator("#dipRows article").first().waitFor();
  assert.equal(await page.locator("#dipRows article").count(), 6);
  const snapshot = (p) =>
    p.evaluate(async () => {
      const b = await DipLedger.transact(indexedDB, (x) => x);
      return { book: b, summary: DipLedger.summary(b, Date.now()) };
    });
  const initial = await snapshot(page);
  assert.equal(initial.summary.balance, 100);
  assert.equal(initial.summary.weekLimit, 25);
  await page.locator("#dipRecalculate").click();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#dipRows article").first().waitFor();
  assert.equal((await snapshot(page)).summary.balance, 100);
  await page.locator("#dipOpportunities > details > summary").click();
  const form = page.locator("#dipTradeForm");
  await form.locator("[name=quantity]").fill("0.02");
  await form.locator("[name=price]").fill("50");
  await form.locator("[name=debit]").fill("1");
  const localTime = await page.evaluate(() => {
    const d = new Date(Date.now() - 60000);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });
  await form.locator("[name=tradeAt]").fill(localTime);
  await form.locator("button").click();
  await page.waitForFunction(
    async () =>
      DipLedger.summary(
        await DipLedger.transact(indexedDB, (x) => x),
        Date.now(),
      ).balance === 99,
  );
  const second = await context.newPage();
  await second.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await second.locator("#dipRows article").first().waitFor();
  await second.locator("#dipOpportunities > details > summary").click();
  const duplicateForm = second.locator("#dipTradeForm");
  await duplicateForm.locator("[name=quantity]").fill("0.02");
  await duplicateForm.locator("[name=price]").fill("50");
  await duplicateForm.locator("[name=debit]").fill("1");
  await duplicateForm.locator("[name=tradeAt]").fill(localTime);
  await duplicateForm.locator("button").click();
  await second.waitForFunction(
    () => document.querySelector("#dipTradeForm [name=quantity]").value === "",
  );
  assert.equal((await snapshot(second)).summary.balance, 99);
  const trade = {
    id: "concurrent-one",
    symbol: "SPY",
    quantity: 0.02,
    price: 50,
    accountCurrency: "USD",
    accountDebit: 1,
    fxFee: 0,
    tradeAt: new Date(Date.now() - 1000).toISOString(),
    tier: "15-25",
  };
  const record = (p, t) =>
    p.evaluate(
      (t) =>
        DipLedger.transact(indexedDB, (b) => DipLedger.buy(b, t, Date.now())),
      t,
    );
  await Promise.all([
    record(page, trade),
    record(second, trade),
    record(second, { ...trade, id: "concurrent-two" }),
  ]);
  assert.equal((await snapshot(page)).summary.balance, 97);
  const before = (await snapshot(page)).book;
  const aborted = await page.evaluate(async () => {
    try {
      await DipLedger.transact(indexedDB, (b) => {
        b.entries = [];
        throw Error("TEST_ABORT");
      });
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(aborted, true);
  assert.deepEqual((await snapshot(page)).book, before);
  const unavailable = await page.evaluate(async () => {
    try {
      await DipLedger.transact(null, (x) => x);
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(unavailable, true);
  await page.locator("#dipRecalculate").click();
  await page.waitForFunction(
    () => document.querySelectorAll("#dipLedgerEntries button").length === 3,
  );
  await page.locator("#dipLedgerEntries button").first().click();
  await page.waitForFunction(
    async () =>
      DipLedger.summary(
        await DipLedger.transact(indexedDB, (x) => x),
        Date.now(),
      ).balance === 98,
  );
  const download = page.waitForEvent("download");
  await page.locator("#dipExport").click();
  const exported = await download;
  const backup = JSON.parse(await fs.readFile(await exported.path(), "utf8"));
  assert.equal(backup.version, 1);
  await page.locator("#dipImport").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":99,"entries":[]}'),
  });
  await page.waitForFunction(() =>
    document
      .querySelector("#dipStatus")
      .textContent.includes("账本文件版本不支持"),
  );
  assert.equal((await snapshot(page)).summary.balance, 98);
  await page.locator("#dipImport").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.locator("#dipRows article").first().waitFor();
  assert.equal((await snapshot(page)).summary.balance, 98);
  await fs.mkdir("output/playwright", { recursive: true });
  await page
    .locator("#dipOpportunities")
    .screenshot({ path: "output/playwright/dip-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator("#dipOpportunities")
    .screenshot({ path: "output/playwright/dip-mobile.png" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    "output/playwright/dip-smoke.json",
    JSON.stringify(
      {
        passed: true,
        baseUrl,
        checks: [
          "panel",
          "refresh",
          "actual-buy-form",
          "concurrent-idempotence",
          "transaction-abort",
          "storage-unavailable",
          "reversal",
          "export",
          "invalid-import",
          "restore",
          "mobile-width",
          "runtime-errors",
        ],
      },
      null,
      2,
    ),
  );
  console.log("Independent dip browser smoke passed");
} finally {
  await browser.close();
}
