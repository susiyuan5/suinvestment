import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
const base = process.env.BASE_URL;
if (!base) throw Error("BASE_URL is required");
// Frozen BTC weekly snapshot; its newest complete week ends 2026-10-18.
const fixture = await fs.readFile(new URL("../tests/fixtures/btc-weekly-v1.json", import.meta.url));
const browser = await chromium.launch();
try {
  const open = async (now, viewport = { width: 1440, height: 1000 }) => {
    const context = await browser.newContext({ viewport });
    await context.route(/btc-weekly-v1\.json/, (route) =>
      route.fulfill({ body: fixture, contentType: "application/json" }),
    );
    await context.route(
      /https:\/\/(finnhub\.io|query1\.finance\.yahoo\.com|www\.bankofcanada\.ca)\//,
      (route) => route.abort(),
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(now);
    await page.goto(new URL("#crypto", base).href);
    await page.locator("#btcTrendContent:not([hidden])").waitFor();
    return { context, page, errors };
  };
  const text = (page, id) => page.locator("#" + id).textContent();

  // Fresh data: the state card carries the verdict, the weekly instruction and the next trigger.
  const fresh = await open("2026-10-20T12:00:00Z");
  let page = fresh.page;
  assert.equal(await text(page, "btcTrendStateLabel"), "持有 100%");
  assert.match(await text(page, "btcTrendAction"), /规则未变化.*100% 持有.*无需调整/);
  assert.match(await text(page, "btcTrendNext"), /减至 25% 核心仓/);
  // Position plan: 10% loss limit over the 25% core mix's 63.4% drawdown, rounded down.
  const planText = await text(page, "btcTrendPlan");
  assert.match(planText, /BTC 预算上限总资产的 15%/);
  assert.match(planText, /规则持有时BTC 约占总资产 15%/);
  assert.match(planText, /规则转出时BTC 约占总资产 3\.75%/);
  assert.match(await text(page, "btcTrendPlanNote"), /保守估算约为总资产的 14%.*不读取你的账户/);
  assert.doesNotMatch(await page.locator("#view-crypto").textContent(), /转为空仓|记为空仓/, "no wording implies a full exit");
  assert.equal(await page.locator("#btcTrendAction").getAttribute("data-state"), "ready");
  assert.match(await text(page, "btcTrendNext"), /\$[\d,]+/);
  assert.equal(await page.locator("#btcTrendState #btcTrendNext").count(), 1, "next trigger sits inside the state card");
  assert.equal(await page.locator("#btcTrendStatus").getAttribute("data-state"), "ready");
  // History: three newest signals shown, older ones folded away but reachable.
  assert.equal(await page.locator("#btcTrendHistory > li:visible").count(), 3);
  const older = await page.locator("#btcTrendHistoryMore > li").count();
  assert.ok(older > 0, "fixture has older signals");
  assert.equal(await page.locator("#btcTrendHistoryMore > li:visible").count(), 0);
  assert.match(await text(page, "btcTrendHistoryMoreSummary"), new RegExp("更早的信号（" + older + " 条）"));
  await page.locator("#btcTrendHistoryMoreSummary").click();
  assert.equal(await page.locator("#btcTrendHistoryMore > li:visible").count(), older);
  // Read-only: one control (re-read) plus disclosure summaries, no trade or order controls.
  assert.deepEqual(
    await page.locator("#view-crypto button").evaluateAll((buttons) => buttons.map((b) => b.id)),
    ["btcTrendRefresh"],
  );
  assert.equal(await page.locator("#view-crypto :is(input, select, form)").count(), 0);
  await page.locator("#btcTrendRefresh").click();
  await page.waitForFunction(() => document.querySelector("#btcTrendRefresh").getAttribute("aria-busy") === "false");
  assert.equal(await text(page, "btcTrendStateLabel"), "持有 100%");

  await fs.mkdir("output/playwright", { recursive: true });
  for (const [name, width, zoom] of [["desktop", 1440, 1], ["mobile", 390, 1], ["zoom", 390, 2]]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((z) => (document.documentElement.style.zoom = z), zoom);
    await page.locator('.workspace-nav a[href="#crypto"]').click();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true,
      name + " horizontal overflow",
    );
    // Main tabs never overlap each other and the active tab is fully inside the tab row.
    const nav = await page.evaluate(() => {
      const row = document.querySelector(".workspace-nav").getBoundingClientRect();
      const links = [...document.querySelectorAll(".workspace-nav a")].map((a) => {
        const r = a.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, active: a.matches(".is-active"), text: a.scrollWidth <= a.clientWidth + 1 };
      });
      return { row: { left: row.left, right: row.right }, links };
    });
    for (let i = 1; i < nav.links.length; i++) {
      const a = nav.links[i - 1], b = nav.links[i];
      const sameRow = a.top < b.bottom && b.top < a.bottom;
      assert.ok(!sameRow || a.right <= b.left + 0.5, `${name} nav links ${i - 1}/${i} overlap`);
    }
    assert.ok(nav.links.every((link) => link.text), name + " nav labels are not clipped");
    const active = nav.links.find((link) => link.active);
    assert.ok(active.left >= nav.row.left - 0.5 && active.right <= nav.row.right + 0.5, name + " active tab in view");
    if (width < 800) {
      // The verdict and the chart start within the first two screens on a phone.
      const y = await page.evaluate(() => ({
        state: document.querySelector("#btcTrendState").getBoundingClientRect().top + scrollY,
        chart: document.querySelector("#btcTrendChartWrap").getBoundingClientRect().top + scrollY,
      }));
      if (zoom === 1) {
        assert.ok(y.state < 450, "state card is on the first phone screen");
        assert.ok(y.chart < 1500, "chart starts within the second phone screen");
      }
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `output/playwright/crypto-${name}.png`, fullPage: true });
  }
  assert.deepEqual(fresh.errors, []);
  await fresh.context.close();

  // Stale data: the weekly instruction is withheld and replaced by a re-read prompt.
  const stale = await open("2026-11-10T12:00:00Z");
  page = stale.page;
  assert.equal(await page.locator("#btcTrendStatus").getAttribute("data-state"), "error");
  assert.equal(await page.locator("#btcTrendAction").getAttribute("data-state"), "stale");
  assert.match(await text(page, "btcTrendAction"), /已过期.*重新读取/);
  assert.doesNotMatch(await text(page, "btcTrendAction"), /无需调整|按本周执行/);
  assert.deepEqual(stale.errors, []);
  await stale.context.close();
  console.log("Crypto smoke passed: verdict card, stale guard, folded history, read-only controls, non-overlapping tabs at desktop, mobile and 200% zoom.");
} finally {
  await browser.close();
}
