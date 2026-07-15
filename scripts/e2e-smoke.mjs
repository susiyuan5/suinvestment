import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = (process.env.BASE_URL || "").replace(/\/$/, "") + "/";
if (!process.env.BASE_URL) throw new Error("BASE_URL is required");

async function waitForDashboard(page) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator("#projectHealthStatus").waitFor({ state: "attached", timeout: 15000 });
  await page.waitForFunction(() => {
    const status = document.querySelector("#projectHealthStatus");
    return status && status.textContent && !/loading/i.test(status.textContent);
  }, null, { timeout: 15000 });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await waitForDashboard(page);
  assert.equal((await page.title()).length > 0, true, "homepage title should be present");
  assert.equal(await page.locator("#decisionSummary").isVisible(), true, "decision summary should be visible");
  assert.equal(await page.locator("#projectHealthStatus").textContent().then((value) => Boolean(value.trim())), true, "health report should render");

  const healthResponse = await context.request.get(new URL("results/health/project-health.json", baseUrl).toString());
  assert.equal(healthResponse.ok(), true, "health report should be readable after deployment");
  const healthPayload = await healthResponse.json();
  assert.ok(["healthy", "warning", "blocked"].includes(healthPayload.status), "health report should have a known status");

  const watchlist = page.locator("#watchlist");
  await watchlist.locator(":scope > summary").click();
  await page.locator("#watchlistCards .ws-card-select").first().waitFor({ state: "visible" });
  const symbols = await page.locator("#watchlistCards .ws-card-select").evaluateAll((buttons) => buttons.map((button) => button.dataset.symbol));
  assert.ok(symbols.length >= 2, "watchlist should expose at least two symbols");
  await page.locator("#watchlistCards .ws-card-select").nth(1).click();
  await page.waitForFunction((symbol) => document.querySelector("#watchlistActiveSymbol")?.textContent === symbol, symbols[1]);
  assert.ok((await page.locator("#watchlistChartSummary").textContent()).trim().length > 0, "canvas chart should have accessible alternative text");

  assert.deepEqual(consoleErrors, [], `core modules emitted console errors: ${consoleErrors.join(" | ")}`);
  assert.deepEqual(pageErrors, [], `homepage emitted page errors: ${pageErrors.join(" | ")}`);

  const failedPage = await context.newPage();
  await failedPage.route("**/data/market-data.json*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ generatedAt: new Date().toISOString(), symbols: {} })
  }));
  await failedPage.route("**/query1.finance.yahoo.com/**", (route) => route.abort());
  await failedPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await failedPage.waitForFunction(() => Array.isArray(window.__SUINVESTMENT_SIGNALS__) && window.__SUINVESTMENT_SIGNALS__.length > 0, null, { timeout: 15000 });
  const failedSignals = await failedPage.evaluate(() => window.__SUINVESTMENT_SIGNALS__.map((signal) => ({ action: signal.suggested_action, amount: signal.suggested_buy_amount })));
  assert.ok(failedSignals.every((signal) => signal.amount === 0 && !["BUY", "STRONG_BUY", "NORMAL_BUY"].includes(signal.action)), "failed data must not generate enhanced buy recommendations");
  await failedPage.close();

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobile = await mobileContext.newPage();
  await waitForDashboard(mobile);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "mobile page should not overflow horizontally");
  await mobile.locator("#watchlist > summary").click();
  await mobile.locator("#watchlistCards .ws-card-select").first().click();
  assert.ok((await mobile.locator("#watchlistChartSummary").textContent()).trim().length > 0, "mobile chart alternative should remain available");
  await mobile.close();
  await mobileContext.close();
  await page.close();
  await context.close();
  await browser.close();
  console.log("E2E smoke passed: desktop, mobile, health, watchlist, and failed-data safety paths.");
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
