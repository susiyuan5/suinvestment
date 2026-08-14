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
    const requestedSymbol = decodeURIComponent(requestUrl.pathname.split("/").pop() || "TEST").toUpperCase();
    const timestamps = Array.from({ length: 20 }, (_, index) => now - (19 - index) * 86400);
    const closes = timestamps.map((_, index) => 90 + index * 0.5);
    const longName = requestedSymbol === "TSM" ? "Taiwan Semiconductor Manufacturing Company Limited" : `${requestedSymbol} Test Company`;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ chart: { result: [{ meta: { symbol: requestedSymbol, longName, fullExchangeName: "NASDAQ", currency: "USD", instrumentType: "EQUITY", chartPreviousClose: 99, regularMarketPrice: 100, regularMarketTime: now }, timestamp: timestamps, indicators: { quote: [{ open: closes.map((value) => value - 0.2), high: closes.map((value) => value + 0.4), low: closes.map((value) => value - 0.5), close: closes, volume: closes.map(() => 1000000) }], adjclose: [{ adjclose: closes }] } }] } }) });
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

  await page.evaluate(() => {
    localStorage.setItem("su-investment-pro:core-satellite-state", JSON.stringify({ preset_version: "core-satellite-v1", allocation_mode: "default", migration_completed: true }));
    localStorage.setItem("su-investment-pro:portfolio", JSON.stringify([
      { symbol: "SPY", allocation: 0.60 }, { symbol: "NVDA", allocation: 0.10 }, { symbol: "AAPL", allocation: 0.10 },
      { symbol: "ASML", allocation: 0.08 }, { symbol: "KO", allocation: 0.07 }, { symbol: "BYDDY", allocation: 0.05 }
    ]));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#adjustAllocationBtn").click();
  assert.equal(await page.locator("#settingsModal").isVisible(), true, "allocation entry should open settings center");
  assert.equal(await page.locator("#settings-allocation").isVisible(), true, "allocation entry should select allocation category");
  assert.equal(await page.locator("[data-allocation-symbol='SPY']").inputValue(), "40.00", "legacy default allocation should migrate to the v4 recommended preset");
  assert.equal(await page.locator("[data-allocation-symbol='NVDA']").inputValue(), "15.00", "v4 recommended allocation should use the 15 percent satellite cap");
  assert.equal(await page.locator("[data-allocation-symbol='BYDDY']").count(), 0, "retired symbol must not render in the formal allocation editor");
  assert.equal(await page.locator("[data-core-allocation-preset='40']").getAttribute("aria-pressed"), "true", "40/60 shortcut should reflect the active default");
  await page.screenshot({ path: "output/playwright/allocation-settings-desktop.png" });
  await page.locator("[data-core-allocation-preset='50']").click();
  assert.equal(await page.locator("[data-allocation-symbol='SPY']").inputValue(), "50.00", "quick split should update the core allocation");
  assert.equal(await page.locator("[data-allocation-symbol='NVDA']").inputValue(), "12.50", "quick split should redistribute the stock bucket evenly");
  await page.locator("[data-allocation-symbol='NVDA']").fill("9.50");
  assert.equal(await page.locator("[data-allocation-symbol='NVDA']").inputValue(), "9.50", "manual target editing should preserve the active input");
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.allocationSymbol), "NVDA", "manual target editing should not lose keyboard focus");
  page.once("dialog", (dialog) => dialog.accept());
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
    assert.match(await ideaCard.textContent(), /历史 OOS（价格择时层）/, "candidate card should expose the separate historical OOS evidence");
    assert.match(await ideaCard.textContent(), /不校验综合分/, "historical timing evidence must not be presented as composite-score calibration");
    assert.doesNotMatch(await ideaCard.textContent(), /剔除单源最低/);
    const ideaTicker = (await ideaCard.locator("h3").textContent()).trim();
    const ideaTitleLink = ideaCard.getByRole("link", { name: `查看 ${ideaTicker} 公司与研究详情` });
    const detailHref = await ideaTitleLink.getAttribute("href");
    assert.equal(detailHref, `stock-detail.html?ticker=${ideaTicker}`, "candidate name should link to its company detail page");
    const detailPage = await context.newPage();
    await detailPage.goto(new URL(detailHref, baseUrl).toString(), { waitUntil: "domcontentloaded" });
    await detailPage.locator("#stockDetailContent").waitFor({ state: "visible", timeout: 15000 });
    assert.equal((await detailPage.locator("#stockDetailTicker").textContent()).trim(), ideaTicker, "detail page should preserve the selected ticker");
    assert.notEqual((await detailPage.locator("#stockDetailCompanyName").textContent()).trim(), ideaTicker, "detail page should show the company full name when the quote source supplies it");
    assert.match(await detailPage.locator("#stockDetailPrice").textContent(), /USD \d+\.\d{2}/, "detail page should show the latest quote with currency");
    assert.match(await detailPage.locator("#stockDetailResearchTitle").textContent(), /综合判断/, "detail page should retain the research view");
    assert.ok((await detailPage.locator("#stockDetailChartSummary").textContent()).trim().length > 0, "detail chart should have an accessible text summary");
    await detailPage.screenshot({ path: "output/playwright/stock-detail-desktop.png", fullPage: true });
    await detailPage.close();
    const shortTermDetails = ideaCard.locator(".short-term-plan-details");
    if (await shortTermDetails.count()) {
      await shortTermDetails.locator(":scope > summary").click();
      assert.equal(await shortTermDetails.locator(".short-term-strategy-card").count(), 3, "each candidate should expose exactly three independent entry strategies");
      assert.equal(await shortTermDetails.locator(".short-term-strategy-choice input[type='radio']").count(), 3, "each strategy should expose a research-only selection control");
      assert.match(await shortTermDetails.textContent(), /OOS/, "each strategy view should disclose its historical OOS gate");
      await shortTermDetails.screenshot({ path: "output/playwright/short-term-three-strategies-desktop.png" });
    }
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
  const fallbackDetailPage = await failedContext.newPage();
  await fallbackDetailPage.goto(`${baseUrl}stock-detail.html?ticker=TSM`, { waitUntil: "domcontentloaded" });
  await fallbackDetailPage.locator("#stockDetailContent").waitFor({ state: "visible", timeout: 15000 });
  assert.match(await fallbackDetailPage.locator("#stockDetailQuoteSource").textContent(), /同源研究周线/,
    "stock detail should use the same-origin research trend when Yahoo is unavailable");
  assert.doesNotMatch(await fallbackDetailPage.locator("#stockDetailChartSummary").textContent(), /价格走势暂不可用/,
    "same-origin research history should keep the price trend usable");
  assert.match(await fallbackDetailPage.locator("#stockDetailQuoteTime").textContent(), /非实时/,
    "fallback trend must not be presented as a live quote");
  await fallbackDetailPage.close();
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
