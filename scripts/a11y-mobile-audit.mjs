import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = (process.env.BASE_URL || "").replace(/\/$/, "") + "/";
if (!process.env.BASE_URL) throw new Error("BASE_URL is required");

async function auditPage(browser, name, viewport, zoom = 1) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#projectHealthStatus")?.textContent && !/loading/i.test(document.querySelector("#projectHealthStatus").textContent), null, { timeout: 15000 });
  if (zoom !== 1) await page.evaluate((value) => { document.documentElement.style.zoom = String(value); }, zoom);
  await page.screenshot({ path: `output/playwright/${name}.png`, fullPage: true });
  const semanticViolations = await page.evaluate(() => {
    const violations = [];
    if (!document.documentElement.lang) violations.push({ id: "html-lang", impact: "serious", help: "Document must declare a language" });
    document.querySelectorAll("button, input, select, textarea").forEach((element) => {
      const label = element.getAttribute("aria-label") || element.getAttribute("title") || element.labels?.[0]?.textContent || element.textContent;
      if (!label?.trim()) violations.push({ id: "control-name", impact: "serious", help: `Interactive control has no accessible name: ${element.outerHTML.slice(0, 100)}` });
    });
    document.querySelectorAll("canvas").forEach((canvas) => {
      if (!canvas.getAttribute("aria-label") && !canvas.getAttribute("aria-describedby")) violations.push({ id: "canvas-alternative", impact: "serious", help: "Canvas must have an accessible name or description" });
    });
    return violations;
  });
  const focusTargets = await page.evaluate(() => {
    const controls = Array.from(document.querySelectorAll("button, a[href], input, select, summary"));
    return controls.slice(0, 18).map((element) => ({ tag: element.tagName, id: element.id, text: (element.textContent || element.getAttribute("aria-label") || "").trim().slice(0, 50) }));
  });
  const visibleTargets = await page.evaluate(() => Array.from(document.querySelectorAll("button, input, select, textarea")).filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }).map((element) => {
    const rect = element.getBoundingClientRect();
    return { id: element.id, width: Math.round(rect.width), height: Math.round(rect.height) };
  }).filter((item) => item.width < 24 || item.height < 24));
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 4);
  await context.close();
  return { name, viewport, zoom, violations: semanticViolations, focusTargets, smallTargets: visibleTargets, horizontalOverflow };
}

async function main() {
  await fs.mkdir("output/playwright", { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [
    await auditPage(browser, "a11y-desktop", { width: 1440, height: 1000 }),
    await auditPage(browser, "a11y-mobile", { width: 390, height: 844 }),
    await auditPage(browser, "a11y-mobile-200-percent", { width: 390, height: 844 }, 2)
  ];

  const keyboardContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const keyboardPage = await keyboardContext.newPage();
  await keyboardPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await keyboardPage.locator("#watchlist > summary").focus();
  await keyboardPage.keyboard.press("Enter");
  await keyboardPage.locator("#watchlistCards .ws-card-select").first().waitFor({ state: "visible", timeout: 15000 });
  await keyboardPage.locator("#watchlistCards .ws-card-select").first().focus();
  await keyboardPage.keyboard.press("Enter");
  const keyboardState = await keyboardPage.evaluate(() => ({
    activeTag: document.activeElement?.tagName,
    activeSymbol: document.querySelector("#watchlistActiveSymbol")?.textContent,
    chartAlternative: document.querySelector("#watchlistChartSummary")?.textContent?.trim()
  }));
  assert.equal(keyboardState.activeTag, "BUTTON", "keyboard flow should keep focus on an actionable control");
  assert.ok(keyboardState.activeSymbol, "keyboard flow should select a watchlist symbol");
  assert.ok(keyboardState.chartAlternative, "canvas must have a text alternative");
  await keyboardContext.close();

  const critical = results.flatMap((result) => result.violations.filter((violation) => ["critical", "serious"].includes(violation.impact)).map((violation) => ({ page: result.name, id: violation.id, impact: violation.impact, help: violation.help })));
  const report = { generated_at: new Date().toISOString(), base_url: baseUrl, results, keyboard: keyboardState, critical_violations: critical };
  await fs.writeFile("output/playwright/a11y-mobile-audit.json", JSON.stringify(report, null, 2) + "\n");
  await browser.close();
  if (critical.length) throw new Error(`Accessibility audit found ${critical.length} serious/critical violation(s)`);
  if (results.some((result) => result.horizontalOverflow)) throw new Error("Accessibility audit found horizontal overflow");
  console.log("Accessibility/mobile audit passed: desktop, mobile, 200% zoom, keyboard, canvas alternative, and target-size evidence captured.");
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
