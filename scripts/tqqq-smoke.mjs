import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
const base = process.env.BASE_URL;
if (!base) throw Error("BASE_URL is required");
// Frozen SPY/QQQ daily snapshot; its latest session is 2026-11-09 (out since 2026-11-05).
const fixture = await fs.readFile(new URL("../tests/fixtures/tqqq-ma-daily-v1.json", import.meta.url));
const browser = await chromium.launch();
try {
  const open = async (now, { data = true, viewport = { width: 1440, height: 1000 } } = {}) => {
    const context = await browser.newContext({ viewport });
    await context.route(/tqqq-ma-daily-v1\.json/, (route) =>
      data ? route.fulfill({ body: fixture, contentType: "application/json" }) : route.fulfill({ status: 404, body: "missing" }),
    );
    await context.route(
      /https:\/\/(finnhub\.io|query1\.finance\.yahoo\.com|www\.bankofcanada\.ca)\//,
      (route) => route.abort(),
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(now);
    await page.goto(new URL("#tqqq", base).href);
    await page.waitForFunction(() => document.querySelector("#tqqqMaRefresh")?.getAttribute("aria-busy") === "false" && document.querySelector("#tqqqMaStatus")?.dataset.state !== "loading" && !!document.querySelector("#tqqqMaStatus")?.dataset.state);
    return { context, page, errors };
  };
  const text = (page, id) => page.locator("#" + id).textContent();

  // Fresh data: verdict, rulers, levels, overheat levels and chart.
  const fresh = await open("2026-11-10T12:00:00Z");
  let page = fresh.page;
  assert.equal(await page.locator('.workspace-nav a[href="#tqqq"]').getAttribute("aria-current"), "page");
  assert.deepEqual(
    await page.locator("[data-workspace-view]:visible").evaluateAll((views) => views.map((v) => v.dataset.workspaceView)),
    ["tqqq"],
  );
  assert.equal(await page.locator("#tqqqMaStatus").getAttribute("data-state"), "ready");
  assert.match(await text(page, "tqqqMaStatus"), /数据截至 2026-11-09 收盘/);
  assert.equal(await page.locator("#tqqqMaVerdict").getAttribute("data-verdict"), "wait");
  assert.equal(await text(page, "tqqqMaVerdictLabel"), "不操作 · 空仓等待");
  assert.match(await text(page, "tqqqMaVerdictText"), /SPY 还要涨 1\.0%，QQQ 还要涨 4\.3%。上次卖出信号：2026-11-05。/);
  assert.equal(await page.locator("#tqqqMaRulers .tqqq-ma-ruler").count(), 2);
  assert.deepEqual(await page.locator("#tqqqMaRulers .tqqq-ma-mark").allTextContents(), ["+3.0%", "−0.3%"]);
  assert.deepEqual(
    await page.locator("#tqqqMaLevels tr").evaluateAll((rows) => rows.map((row) => [...row.children].map((cell) => cell.textContent))),
    [
      ["SPY", "752.69", "730.70", "708.78", "759.93"],
      ["QQQ", "679.35", "681.17", "660.73", "708.42"],
    ],
  );
  assert.match(await text(page, "tqqqMaHeat"), /仅显示价位.*减半仓 885\.52（\+30%），清仓 953\.64（\+40%）。现在是 −0\.3%。/);
  assert.equal(await page.locator("#tqqqMaChart svg polyline").count(), 2);
  assert.match(await page.locator("#tqqqMaChart svg").getAttribute("aria-label"), /2026-11-09/);

  // Position cap: 10% loss limit over the backtest's 85.8% drawdown, rounded down.
  const planText = await text(page, "tqqqMaPlan");
  assert.match(planText, /TQQQ 预算上限总资产的 11%/);
  assert.match(planText, /规则持有时TQQQ 最多占总资产 11%/);
  assert.match(planText, /规则空仓时TQQQ 占总资产 0%/);
  assert.match(await text(page, "tqqqMaPlanNote"), /真实历史（回撤 48\.1%）算约为总资产的 20%.*不读取你的账户/);

  // Manual calculator: prefilled from data, recomputes on input, never stores or sends anything.
  assert.equal(await page.locator("#tqqqMaSpyClose").inputValue(), "752.69");
  assert.match(await text(page, "tqqqMaCalcOut"), /SPY \+3\.0%，两线之间。 QQQ −0\.3%，两线之间。 结论：不操作/);
  await page.locator("#tqqqMaSpyClose").fill("800");
  await page.locator("#tqqqMaQqqClose").fill("720");
  assert.match(await text(page, "tqqqMaCalcOut"), /高于买入线。.*高于买入线。 结论：买入或继续持有。/);
  await page.locator("#tqqqMaQqqClose").fill("650");
  assert.match(await text(page, "tqqqMaCalcOut"), /结论：卖出或继续空仓。/);
  await page.locator("#tqqqMaQqqClose").fill("");
  assert.match(await text(page, "tqqqMaCalcOut"), /再填入 QQQ 的两个数后给出结论/);
  // Read-only: one button (re-read) and the four calculator inputs; nothing that trades.
  assert.deepEqual(
    await page.locator("#view-tqqq button").evaluateAll((buttons) => buttons.map((b) => b.id)),
    ["tqqqMaRefresh"],
  );
  assert.equal(await page.locator("#view-tqqq input").count(), 4);
  assert.doesNotMatch(await page.locator("#view-tqqq").textContent(), /下单成功|立即买入|立即卖出/);
  // TQQQ never enters the weekly plan.
  assert.equal(await page.locator("#weeklyDecisionRows").evaluate((rows) => /TQQQ/.test(rows.textContent)), false);

  await fs.mkdir("output/playwright", { recursive: true });
  for (const [name, width, zoom] of [["desktop", 1440, 1], ["mobile", 390, 1], ["zoom", 390, 2]]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((z) => (document.documentElement.style.zoom = z), zoom);
    await page.locator('.workspace-nav a[href="#tqqq"]').click();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true,
      name + " horizontal overflow",
    );
    const nav = await page.evaluate(() => {
      const row = document.querySelector(".workspace-nav").getBoundingClientRect();
      return {
        row: { left: row.left, right: row.right },
        links: [...document.querySelectorAll(".workspace-nav a")].map((a) => {
          const r = a.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, active: a.matches(".is-active"), fits: a.scrollWidth <= a.clientWidth + 1 };
        }),
      };
    });
    assert.equal(nav.links.length, 6);
    for (let i = 1; i < nav.links.length; i++) {
      const a = nav.links[i - 1], b = nav.links[i];
      assert.ok(!(a.top < b.bottom && b.top < a.bottom) || a.right <= b.left + 0.5, `${name} nav links ${i - 1}/${i} overlap`);
    }
    assert.ok(nav.links.every((link) => link.fits), name + " nav labels are not clipped");
    const active = nav.links.find((link) => link.active);
    assert.ok(active.left >= nav.row.left - 0.5 && active.right <= nav.row.right + 0.5, name + " active tab in view");
    if (name === "mobile") {
      // The levels table fits without sideways scrolling and the chart starts at the latest data.
      assert.equal(await page.locator(".tqqq-ma-scroll").evaluate((e) => e.scrollWidth <= e.clientWidth + 1), true);
      await page.locator("#tqqqMaRefresh").click();
      // Re-reading at phone width leaves the chart scrolled to its right edge.
      await page.waitForFunction(() => {
        const e = document.querySelector("#tqqqMaChart");
        return e.scrollWidth > e.clientWidth && e.scrollLeft + e.clientWidth >= e.scrollWidth - 1;
      });
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `output/playwright/tqqq-${name}.png`, fullPage: true });
  }
  assert.deepEqual(fresh.errors, []);
  await fresh.context.close();

  // Stale data: the verdict is withheld.
  const stale = await open("2026-11-20T12:00:00Z");
  page = stale.page;
  assert.equal(await page.locator("#tqqqMaStatus").getAttribute("data-state"), "error");
  assert.equal(await page.locator("#tqqqMaVerdict").getAttribute("data-verdict"), "stale");
  assert.equal(await text(page, "tqqqMaVerdictLabel"), "数据已过期");
  assert.doesNotMatch(await text(page, "tqqqMaVerdictText"), /买入 TQQQ|清仓 TQQQ|继续持有|空仓等待/);
  assert.deepEqual(stale.errors, []);
  await stale.context.close();

  // No published data: an error is shown and the manual calculator still works.
  const missing = await open("2026-11-10T12:00:00Z", { data: false });
  page = missing.page;
  assert.equal(await page.locator("#tqqqMaStatus").getAttribute("data-state"), "error");
  assert.match(await text(page, "tqqqMaStatus"), /读取失败.*手动计算仍然可用/);
  assert.equal(await page.locator("#tqqqMaContent").isHidden(), true);
  for (const [id, value] of [["tqqqMaSpyClose", "104"], ["tqqqMaSpyMa", "100"], ["tqqqMaQqqClose", "105"], ["tqqqMaQqqMa", "100"]])
    await page.locator("#" + id).fill(value);
  assert.match(await text(page, "tqqqMaCalcOut"), /结论：买入或继续持有。/);
  assert.match(await text(page, "tqqqMaPlan"), /总资产的 11%/, "the cap is shown without data");
  assert.deepEqual(missing.errors, []);
  await missing.context.close();
  console.log("TQQQ smoke passed: verdict, rulers, levels, overheat levels, chart, manual calculator, stale and missing-data guards, read-only controls, six tabs at desktop, mobile and 200% zoom.");
} finally {
  await browser.close();
}
