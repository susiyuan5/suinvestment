import assert from "node:assert/strict";
import fs from "node:fs/promises";
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
  const startedAt = Date.now();
  await fs.mkdir("output/playwright", { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN" });
  await context.route("https://finnhub.io/api/v1/**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const payload = requestUrl.pathname.endsWith("/forex/rates")
      ? { base: "USD", quote: { CAD: 1.36 } }
      : requestUrl.pathname.endsWith("/quote")
      ? { c: 100, pc: 99 }
      : { s: "ok", c: [90, 92, 94, 96, 98, 100] };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  await context.route("https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ observations: [{ d: new Date(Date.now() - 86400000).toISOString().slice(0, 10), FXUSDCAD: { v: "1.3600" } }] })
    });
  });
  await context.route("https://query1.finance.yahoo.com/**", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname.includes("/v1/finance/search")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ quotes: [] }) });
      return;
    }
    if (requestUrl.pathname.includes("/v8/finance/chart/CAD=X")) {
      const now = Math.floor(Date.now() / 1000);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 1.36, regularMarketTime: now }, timestamp: [now], indicators: { quote: [{ close: [1.36] }] } }] } }) });
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const timestamps = Array.from({ length: 20 }, (_, index) => now - (19 - index) * 86400);
    const closes = timestamps.map((_, index) => 90 + index * 0.5);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ chart: { result: [{ meta: { chartPreviousClose: 99, regularMarketPrice: 100 }, timestamp: timestamps, indicators: { quote: [{ open: closes.map((value) => value - 0.2), high: closes.map((value) => value + 0.4), low: closes.map((value) => value - 0.5), close: closes, volume: closes.map(() => 1000000) }], adjclose: [{ adjclose: closes }] } }] } }) });
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await waitForDashboard(page);
  assert.equal((await page.title()).length > 0, true, "homepage title should be present");
  assert.equal(await page.locator("#decisionSummary").isVisible(), true, "decision summary should be visible");
  assert.equal((await page.locator("#decision-summary-title").textContent()).trim(), "本周资金与定投决策", "weekly funding and DCA must use one merged heading");
  assert.equal((await page.locator("#holdings-title").textContent()).trim(), "个股信号与持仓", "stock signals must not recreate a second weekly decision heading");
  assert.equal(await page.getByText("本周定投决策", { exact: true }).count(), 0, "legacy standalone weekly decision heading must be absent");
  assert.equal(await page.getByText("本周资金计划", { exact: true }).count(), 0, "legacy standalone weekly funding heading must be absent");
  assert.equal(await page.locator("#projectHealthStatus").textContent().then((value) => Boolean(value.trim())), true, "health report should render");

  const healthResponse = await context.request.get(new URL("results/health/project-health.json", baseUrl).toString());
  assert.equal(healthResponse.ok(), true, "health report should be readable after deployment");
  const healthPayload = await healthResponse.json();
  assert.ok(["healthy", "warning", "blocked"].includes(healthPayload.status), "health report should have a known status");

  await page.evaluate(() => {
    localStorage.setItem("su-investment-pro:wealthsimple-accounts-v1", JSON.stringify({
      version: "wealthsimple-accounts-v2",
      defaultId: "qa-tfsa",
      accounts: [
        { id: "qa-tfsa", account_id: "qa-tfsa", label: "长期投资", account_type: "TFSA", account_currency: "USD", available_to_trade: 1234.56, pending_order_reserve: 123.45, complete: true },
        { id: "qa-nonreg", account_id: "qa-nonreg", label: "非注册", account_type: "NON_REGISTERED", account_currency: "CAD", available_to_trade: 2345.67, pending_order_reserve: 210, complete: true }
      ]
    }));
  });
  await page.locator("#openSettingsBtn").click();
  assert.equal(await page.locator("#settingsModal").isVisible(), true, "settings center should open");
  assert.equal(await page.locator("[data-settings-tab]").count(), 6, "settings center should expose six categories");
  assert.ok((await page.locator("#settingsModal .modal-card").boundingBox()).width >= 1000, "desktop settings center should use wide layout");
  assert.equal(await page.locator("#settings-accounts").isVisible(), true, "account category should be reachable");
  await page.waitForFunction(() => document.querySelector("#settingsFxRate")?.textContent !== "--", null, { timeout: 10000 });
  assert.equal((await page.locator("#settingsFxSource").textContent()).trim(), "加拿大央行（日均）", "FX should use the reliable public official source when Finnhub is not configured");
  assert.equal((await page.locator("#settingsFxRate").textContent()).trim(), "1.3600", "USD/CAD rate direction must be explicit");
  assert.equal(await page.locator("#wealthsimpleSettingsAccountCards .settings-account-card").count(), 2, "only configured local accounts should render as cards");
  await page.screenshot({ path: "output/playwright/settings-center-desktop.png" });
  await page.locator("[data-settings-tab='data']").click();
  await page.locator("#apiKey").fill("browser-persistence-test-key");
  await page.locator("#saveSettingsChangesBtn").click();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#openSettingsBtn").click();
  await page.locator("[data-settings-tab='data']").click();
  assert.equal(await page.locator("#apiKey").inputValue(), "browser-persistence-test-key", "Finnhub key should persist across reloads");
  await page.locator("#apiKey").fill("");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#deleteApiKeyBtn").click();
  await page.locator("#saveSettingsChangesBtn").click();
  assert.equal(await page.evaluate(() => localStorage.getItem("su-investment-pro:finnhub-key")), null, "clearing the Finnhub key should remove persistent storage");
  await page.locator("#closeSettingsBtn").click();

  await page.locator("#adjustAllocationBtn").click();
  assert.equal(await page.locator("#settingsModal").isVisible(), true, "allocation entry should open settings center");
  assert.equal(await page.locator("#settings-allocation").isVisible(), true, "allocation entry should select allocation category");
  await page.locator("#cancelSettingsBtn").click();

  const watchlist = page.locator("#watchlist");
  await watchlist.locator(":scope > summary").click();
  await page.locator("#watchlistCards .ws-card-select").first().waitFor({ state: "visible" });
  const symbols = await page.locator("#watchlistCards .ws-card-select").evaluateAll((buttons) => buttons.map((button) => button.dataset.symbol));
  assert.ok(symbols.length >= 2, "watchlist should expose at least two symbols");
  await page.locator("#watchlistCards .ws-card-select").nth(1).click();
  await page.waitForFunction((symbol) => document.querySelector("#watchlistActiveSymbol")?.textContent === symbol, symbols[1]);
  assert.ok((await page.locator("#watchlistChartSummary").textContent()).trim().length > 0, "canvas chart should have accessible alternative text");

  const decisionBeforeIdea = await page.locator("#decisionSummary").textContent();
  const ideaPanel = page.locator("#ideaEnginePanel");
  await ideaPanel.locator(":scope > summary").click();
  const ideaCard = ideaPanel.locator(".idea-engine-card").first();
  if (await ideaCard.count()) {
    assert.match(await ideaCard.textContent(), /综合分 \d+\.\d/);
    assert.match(await ideaCard.textContent(), /稳健分 \d+\.\d/);
    assert.doesNotMatch(await ideaCard.textContent(), /剔除单源最低/);
    await ideaCard.locator("details").first().locator(":scope > summary").click();
    const sourceLink = ideaCard.locator("a[target='_blank']").first();
    if (await sourceLink.count()) assert.equal(await sourceLink.getAttribute("rel"), "noopener noreferrer");
    const addButton = ideaCard.getByRole("button", { name: "手动加入盯盘" });
    await addButton.click();
    const ideaActionStatus = ideaCard.getByRole("status");
    await ideaActionStatus.waitFor({ state: "attached" });
    await page.waitForFunction((element) => element.textContent.trim().length > 0, await ideaActionStatus.elementHandle());
    assert.match(await ideaActionStatus.textContent(), /已加入盯盘/, "idea card should report a successful Watchlist add");
    const addedSymbol = await ideaCard.locator("h3").textContent();
    const storedSymbols = await page.evaluate(() => JSON.parse(localStorage.getItem("su-investment-pro:watchlist") || "[]"));
    assert.equal(storedSymbols.filter((symbol) => symbol === addedSymbol.trim()).length, 1, "idea card should add exactly one watchlist entry");
    await addButton.click();
    await page.waitForFunction((element) => element.textContent.includes("已在盯盘列表"), await ideaActionStatus.elementHandle());
    assert.equal(await page.locator("#decisionSummary").textContent(), decisionBeforeIdea, "idea card interaction must not change weekly decision output");
  }

  const runtimeEvidence = {
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    elapsed_ms: Date.now() - startedAt,
    project_health_status: await page.locator("#projectHealthStatus").textContent(),
    watchlist_source_status: await page.locator("#watchlistHealthStatus").textContent(),
    page_js_error_count: pageErrors.length,
    console_error_count: consoleErrors.length,
    page_errors: pageErrors,
    console_errors: consoleErrors
  };
  await fs.writeFile("output/playwright/e2e-smoke.json", JSON.stringify(runtimeEvidence, null, 2) + "\n");

  assert.deepEqual(consoleErrors, [], `core modules emitted console errors: ${consoleErrors.join(" | ")}`);
  assert.deepEqual(pageErrors, [], `homepage emitted page errors: ${pageErrors.join(" | ")}`);

  const failedContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN" });
  const failedPage = await failedContext.newPage();
  await failedPage.route("**/data/market-data.json*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ generatedAt: new Date().toISOString(), symbols: {} })
  }));
  await failedPage.route("**/query1.finance.yahoo.com/**", (route) => route.abort());
  await failedPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await failedPage.waitForFunction(() => {
    const refresh = document.querySelector("#refreshBtn");
    return refresh?.getAttribute("aria-busy") === "false"
      && Array.isArray(window.__SUINVESTMENT_SIGNALS__)
      && window.__SUINVESTMENT_SIGNALS__.length > 0;
  }, null, { timeout: 15000 });
  const failedSignals = await failedPage.evaluate(() => window.__SUINVESTMENT_SIGNALS__.map((signal) => ({ action: signal.suggested_action, amount: signal.suggested_buy_amount })));
  assert.ok(
    failedSignals.every((signal) => signal.amount === 0 && !["BUY", "STRONG_BUY", "NORMAL_BUY"].includes(signal.action)),
    `failed data must not generate enhanced buy recommendations: ${JSON.stringify(failedSignals)}`
  );
  await failedPage.close();
  await failedContext.close();

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-CN" });
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
  // A failed assertion can leave Chromium handles open and make CI wait for
  // the job timeout. Exit immediately after reporting the actionable error;
  // the runner owns and cleans up the child browser process.
  process.exit(1);
});
