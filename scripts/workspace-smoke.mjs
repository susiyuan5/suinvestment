import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
const base = process.env.BASE_URL;
if (!base) throw Error("BASE_URL is required");
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.route(
    /https:\/\/(finnhub\.io|query1\.finance\.yahoo\.com|www\.bankofcanada\.ca)\//,
    (r) => r.abort(),
  );
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.locator(".dip-candidate").first().waitFor({ state: "attached" });
  const visible = () =>
    page
      .locator("[data-workspace-view]:visible")
      .evaluateAll((x) => x.map((e) => e.dataset.workspaceView));
  assert.deepEqual(await visible(), ["weekly"]);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async text => { window.copiedPlan = text; } } }));
  if (await page.locator("#copyBtn").isEnabled()) {
    await page.locator("#copyBtn").click();
    await page.waitForFunction(() => document.querySelector("#copyStatus").textContent.length > 0);
    assert.equal(await page.evaluate(() => window.copiedPlan), await page.locator("#orderText").textContent());
  } else {
    assert.match(await page.locator("#weeklyDecisionSafety").textContent(), /暂停|核对|检查/);
  }
  assert.equal(await page.locator("#copyStatus").isVisible(), true);
  const book = () =>
    page.evaluate(() => DipLedger.transact(indexedDB, (x) => x));
  const before = await book();
  const plan = await page.locator("#weeklyDecisionRows").textContent();
  const nav = (route) =>
    page.locator(`.workspace-nav a[href="#${route}"]`).click();
  await nav("dip");
  await page.locator('[data-open-section="dipRecordDetails"]').click();
  await page.locator("#dipTradeForm [name=quantity]").fill("0.123");
  await nav("holdings");
  await page.goBack();
  assert.deepEqual(await visible(), ["dip"]);
  assert.equal(
    await page.locator("#dipTradeForm [name=quantity]").inputValue(),
    "0.123",
  );
  await page.goForward();
  assert.deepEqual(await visible(), ["holdings"]);
  await page.reload();
  assert.deepEqual(await visible(), ["holdings"]);
  for (const [hash, view, details] of [
    ["signalsSection", "weekly", "weeklyCalculationDetails"],
    ["dipOpportunities", "dip"],
    ["inlineHoldingsSection", "holdings"],
    ["research-panel", "tools-research"],
    ["dataQualityPanel", "tools-data", "dataQualityPanel"],
  ]) {
    await page.evaluate((h) => {
      location.hash = h;
    }, hash);
    await page.waitForFunction((v) => WorkspaceNavigation.current === v, view);
    assert.deepEqual(await visible(), [view]);
    if (details)
      assert.equal(
        (await page.locator(`#${details}`).getAttribute("open")) !== null,
        true,
      );
  }
  await nav("weekly");
  assert.equal(await page.locator("#weeklyDecisionRows").textContent(), plan);
  assert.deepEqual(await book(), before);
  await page.locator("#moreTools > summary").click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#moreTools").getAttribute("open"), null);
  for (let i = 0; i < 35; i++) {
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(
        () => !!document.activeElement.closest("[data-workspace-view][hidden]"),
      ),
      false,
    );
  }
  await fs.mkdir("output/playwright", { recursive: true });
  for (const [name, width, zoom] of [
    ["desktop", 1440, 1],
    ["mobile", 390, 1],
    ["zoom", 390, 2],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((z) => (document.documentElement.style.zoom = z), zoom);
    for (const route of ["weekly", "holdings", "dip"]) {
      await nav(route);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
        `${name}/${route} overflow`,
      );
      assert.equal(await page.locator(".workspace-nav a:visible").count(), 3);
      await page.screenshot({
        path: `output/playwright/workspace-${name}-${route}.png`,
      });
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    "Workspace smoke passed: routes, legacy anchors, history, form preservation, financial invariance, keyboard, mobile and 200% zoom.",
  );
} finally {
  await browser.close();
}
