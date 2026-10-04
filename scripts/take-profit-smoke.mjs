import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = process.env.BASE_URL;
if (!base) throw new Error("BASE_URL is required");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const key = "su-investment-pro:take-profit-positions-v1";
const expected = "2026-10-02";
const dates = [];
for (let stamp = Date.parse(expected + "T12:00:00Z"); dates.length < 35; stamp -= 86400000) {
  const day = new Date(stamp);
  if (![0, 6].includes(day.getUTCDay())) dates.unshift(day.toISOString().slice(0, 10));
}
function rows(symbol) {
  return dates.map((date, index) => {
    let close = 100;
    if (symbol === "SPY" && index >= 20) close = 110;
    if (symbol === "AAPL" && index >= 21) close = [111, 120, 125, 112][Math.min(index - 21, 3)];
    return { date, open: close, high: close + 1, low: close - 1, close, adjusted_close: close };
  }).filter((_, index) => symbol !== "NVDA" || index < 34);
}
const symbols = ["AAPL", "MSFT", "SPY", "NVDA", "META", "TSLA"];
const index = { schema_version: "take-profit-browser-index-v1", research_only: true, currency: "USD", as_of: expected, symbol_count: symbols.length, symbols: {} };
const payloads = {};
for (const symbol of symbols) {
  const daily = rows(symbol);
  index.symbols[symbol] = { path: `data/take-profit-v1/symbols/${symbol}.json`, first_date: daily[0].date, last_date: daily.at(-1).date, rows: daily.length };
  payloads[symbol] = { schema_version: "take-profit-browser-bars-v1", research_only: true, currency: "USD", as_of: expected, symbol: symbol === "TSLA" ? "MSFT" : symbol, rows: daily };
}
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN" });
  await context.route(/https:\/\/(finnhub\.io|query1\.finance\.yahoo\.com|www\.bankofcanada\.ca)\//, (route) => route.abort());
  await context.route("https://raw.githubusercontent.com/susiyuan5/suinvestment/**", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").slice(4).join("/");
    if (name === "live-data-manifest.json") return route.fulfill({ json: { formatVersion: 1, dataCommit: "a".repeat(40), codeCommit: "b".repeat(40), publishedAt: "2026-10-04T12:00:00Z" } });
    if (name.includes("..")) return route.fulfill({ status: 404, body: "invalid path" });
    try { await route.fulfill({ body: await fs.readFile(path.join(root, name)), contentType: "application/json" }); }
    catch { await route.fulfill({ status: 404, body: "missing fixture" }); }
  });
  // Preserve the existing calendar interface while making expectedClose changeable
  // for clock/freshness tests. The production pure indicator is not mocked.
  await context.route("**/market-calendar.js*", async (route) => {
    const source = await fs.readFile(path.join(root, "market-calendar.js"), "utf8");
    await route.fulfill({ contentType: "text/javascript", body: source + `\nwindow.__TP_EXPECTED__=${JSON.stringify(expected)}; const originalAssess=MarketCalendar.assess; MarketCalendar.assess=(q,n)=>Object.assign({},originalAssess(q,n),{known:!window.__TP_CALENDAR_DOWN__,expectedClose:window.__TP_CALENDAR_DOWN__?null:window.__TP_EXPECTED__+'T20:00:00Z'});` });
  });
  const requests = [];
  let staleIndex = false;
  await context.route("**/data/take-profit-v1/**", async (route) => {
    const url = new URL(route.request().url());
    const name = url.pathname.slice(url.pathname.indexOf("data/take-profit-v1/"));
    requests.push(name);
    if (name === "data/take-profit-v1/index.json") return route.fulfill({ json: staleIndex ? { ...index, as_of: "2026-10-01" } : index });
    const symbol = path.basename(name, ".json");
    if (symbol === "META") return route.fulfill({ status: 503, body: "fixture unavailable" });
    if (!payloads[symbol]) return route.fulfill({ status: 404, body: "unknown symbol" });
    return route.fulfill({ json: payloads[symbol] });
  });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime("2026-10-04T12:00:00Z");
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#refreshBtn")?.getAttribute("aria-busy") === "false");
  assert.equal(requests.length, 0, "take-profit data must not load on weekly route");
  assert.equal(await page.locator("#view-take-profit").isVisible(), false);
  const financialSnapshot = () => page.evaluate(async (ownKey) => ({
    ledger: await DipLedger.transact(indexedDB, (value) => value),
    storage: Object.fromEntries(Object.entries(localStorage).filter(([name]) => name !== ownKey)),
  }), key);
  const before = await financialSnapshot();
  await page.locator('.workspace-nav a[href="#take-profit"]').click();
  await page.waitForFunction(() => document.querySelector("#takeProfitSave")?.disabled === false);
  assert.deepEqual(requests, ["data/take-profit-v1/index.json"], "index loads first, no unselected symbol history");
  assert.deepEqual(await page.locator("[data-workspace-view]:visible").evaluateAll((items) => items.map((item) => item.dataset.workspaceView)), ["take-profit"]);
  assert.equal(await page.locator('.workspace-nav a[href="#take-profit"]').getAttribute("aria-current"), "page");
  const watch = (symbol) => page.locator(`.take-profit-card[data-symbol="${symbol}"]`);
  const saved = () => page.evaluate((name) => JSON.parse(localStorage.getItem(name) || "null"), key);
  const savePosition = async (symbol, cost = "100", entryDate = dates[20]) => {
    await page.locator("#takeProfitSymbol").selectOption(symbol);
    await page.locator("#takeProfitDate").fill(entryDate);
    await page.locator("#takeProfitCost").fill(cost);
    await page.locator("#takeProfitSave").click();
    await watch(symbol).waitFor({ state: "visible" });
    await page.waitForFunction((symbol) => document.querySelector(`.take-profit-card[data-symbol="${symbol}"]`)?.dataset.state !== "loading", symbol);
  };
  await page.locator("#takeProfitSymbol").selectOption("AAPL");
  await page.locator("#takeProfitSave").click();
  assert.equal(await saved(), null, "missing actual date/cost cannot save a fabricated position");
  assert.equal(await page.locator("#takeProfitDate").getAttribute("aria-invalid"), "true");
  await page.locator("#takeProfitDate").fill(dates[20]);
  await page.locator("#takeProfitCost").fill("0");
  await page.locator("#takeProfitSave").click();
  assert.equal(await saved(), null, "zero cost cannot generate observation");
  await page.locator("#takeProfitDate").fill("2026-10-05");
  await page.locator("#takeProfitCost").fill("100");
  await page.locator("#takeProfitSave").click();
  assert.equal(await saved(), null, "future entry date is rejected");

  await savePosition("AAPL");
  assert.equal(await watch("AAPL").getAttribute("data-state"), "triggered");
  const firstTriggerText = await watch("AAPL").locator(".take-profit-card-reason").textContent();
  assert.match(firstTriggerText, /首次触发/);
  assert.equal(await watch("AAPL").locator("progress").count(), 1);
  assert.deepEqual((await saved()).positions, [{ symbol: "AAPL", date: dates[20], cost: 100 }], "only explicit position inputs are persisted");
  await savePosition("MSFT");
  assert.equal(await watch("MSFT").getAttribute("data-state"), "inactive");
  assert.equal(await watch("MSFT").locator("progress").count(), 0);
  await savePosition("SPY");
  assert.equal(await watch("SPY").getAttribute("data-state"), "active");
  await savePosition("NVDA");
  assert.equal(await watch("NVDA").getAttribute("data-state"), "blocked");
  assert.match(await watch("NVDA").textContent(), /最近完整交易日/);
  assert.equal(await watch("NVDA").locator("progress").count(), 0);
  await savePosition("TSLA");
  assert.equal(await watch("TSLA").getAttribute("data-state"), "blocked", "wrong payload symbol cannot generate a signal");
  await savePosition("META");
  assert.equal(await watch("META").getAttribute("data-state"), "blocked");

  await watch("MSFT").getByRole("button", { name: "编辑 / 重置" }).click();
  assert.equal(await page.locator("#takeProfitDate").inputValue(), dates[20]);
  await page.locator("#takeProfitCost").fill("95");
  await page.locator("#takeProfitSave").click();
  await page.waitForFunction((name) => JSON.parse(localStorage.getItem(name)).positions.find((p) => p.symbol === "MSFT").cost === 95, key);
  await watch("META").getByRole("button", { name: "移除", exact: true }).click();
  assert.equal((await saved()).positions.length, 6, "remove request waits for inline confirmation");
  await watch("META").getByRole("button", { name: "取消", exact: true }).click();
  assert.equal((await saved()).positions.length, 6);
  await watch("META").getByRole("button", { name: "移除", exact: true }).click();
  await watch("META").getByRole("button", { name: "确认移除" }).click();
  assert.equal((await saved()).positions.length, 5);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#takeProfitRefresh")?.getAttribute("aria-busy") === "false" && document.querySelectorAll(".take-profit-card").length === 5);
  assert.equal(await watch("AAPL").locator(".take-profit-card-reason").textContent(), firstTriggerText, "first trigger remains after reload and recovery");
  assert.equal((await saved()).positions.find((p) => p.symbol === "MSFT").cost, 95);
  assert.deepEqual(await financialSnapshot(), before, "monitor CRUD never changes any other saved financial inputs or dip ledger");
  for (let count = 0; count < 30; count++) {
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => !!document.activeElement.closest("[data-workspace-view][hidden]")), false);
  }
  await fs.mkdir(path.join(root, "output/playwright"), { recursive: true });
  for (const [name, width, zoom] of [["desktop", 1440, 1], ["mobile", 390, 1], ["zoom", 390, 2]]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((zoom) => { document.documentElement.style.zoom = zoom; }, zoom);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, name + " horizontal overflow");
    assert.equal(await page.locator(".workspace-nav a:visible").count(), 4);
    await page.screenshot({ path: path.join(root, `output/playwright/take-profit-${name}.png`), fullPage: true });
  }
  await page.evaluate(() => { document.documentElement.style.zoom = 1; window.__TP_EXPECTED__ = "2026-10-05"; document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForFunction(() => document.querySelector('.take-profit-card[data-symbol="SPY"]')?.dataset.state === "blocked");
  assert.match(await page.locator("#takeProfitDataStatus").textContent(), /行情过期/);
  assert.equal(await watch("SPY").locator("progress").count(), 0, "new market close invalidates cached old actionable state");
  await page.evaluate(() => { window.__TP_EXPECTED__ = "2026-10-02"; window.__TP_CALENDAR_DOWN__ = true; document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForFunction(() => document.querySelector("#takeProfitDataStatus").textContent.includes("交易日历不可用"));
  assert.equal(await watch("AAPL").getAttribute("data-state"), "blocked");
  await page.evaluate(() => { window.__TP_CALENDAR_DOWN__ = false; document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForFunction(() => document.querySelector('.take-profit-card[data-symbol="AAPL"]')?.dataset.state === "triggered");
  staleIndex = true;
  await page.locator("#takeProfitRefresh").click();
  await page.waitForFunction(() => document.querySelector("#takeProfitRefresh")?.getAttribute("aria-busy") === "false");
  assert.equal(await page.locator("#takeProfitDataStatus").getAttribute("data-state"), "error");
  assert.match(await page.locator("#takeProfitDataStatus").textContent(), /行情过期/);
  assert.equal(await watch("AAPL").getAttribute("data-state"), "blocked", "mixed file/index releases cannot expose a line");
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(root, "output/playwright/take-profit-smoke.json"), JSON.stringify({ passed: true, checks: ["route-lazy-load", "symbol-lazy-load", "manual-input-validation", "CRUD-persistence", "sticky-first-trigger", "active-inactive", "missing-stale-corrupt-identity", "calendar-unavailable", "new-close-revalidation", "cross-release-block", "ledger-invariance", "hidden-focus", "mobile-and-200-percent-zoom", "no-page-errors"] }, null, 2));
  console.log("Take-profit smoke passed: isolated storage, lazy data, CRUD, first trigger, freshness, identity, existing ledger, keyboard and responsive layouts.");
} finally { await browser.close(); }
