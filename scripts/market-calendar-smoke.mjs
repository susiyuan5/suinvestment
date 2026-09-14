import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.BASE_URL;
if (!base) throw Error("BASE_URL is required");
const original = JSON.parse(await fs.readFile("data/market-data.json", "utf8"));
const browser = await chromium.launch();
try {
  for (const scenario of [
    {
      name: "Monday premarket",
      now: "2026-09-14T12:00:00Z",
      quote: "2026-09-11T20:00:00Z",
      status: "market_closed",
    },
    {
      name: "Monday open",
      now: "2026-09-14T13:30:00Z",
      quote: "2026-09-11T20:00:00Z",
      status: "stale",
    },
    {
      name: "Older Thursday",
      now: "2026-09-14T12:00:00Z",
      quote: "2026-09-10T20:00:00Z",
      status: "stale",
    },
    {
      name: "Intraday is not a close",
      now: "2026-09-14T12:00:00Z",
      quote: "2026-09-11T13:30:00Z",
      status: "stale",
    },
    {
      name: "Calendar unavailable",
      now: "2026-09-14T12:00:00Z",
      quote: "2026-09-11T20:00:00Z",
      status: "stale",
      missing: true,
    },
    {
      name: "Holiday early close",
      now: "2026-12-25T15:00:00Z",
      quote: "2026-12-24T18:00:00Z",
      status: "market_closed",
    },
  ]) {
    const context = await browser.newContext();
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.clock.setFixedTime(scenario.now);
    await context.route(
      /https:\/\/(finnhub\.io|query1\.finance\.yahoo\.com|www\.bankofcanada\.ca)\//,
      (r) => r.abort(),
    );
    if (scenario.missing)
      await context.route("**/data/us-equity-calendar.json", (r) =>
        r.fulfill({ status: 503, body: "unavailable" }),
      );
    await context.route(
      "https://raw.githubusercontent.com/susiyuan5/suinvestment/**",
      async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith("live-data-manifest.json")) {
          return route.fulfill({
            json: {
              formatVersion: 1,
              dataCommit: "a".repeat(40),
              codeCommit: "b".repeat(40),
              publishedAt: scenario.now,
            },
          });
        }
        const file = url.pathname.split("/").slice(4).join("/");
        if (file === "data/market-data.json") {
          const snapshot = structuredClone(original);
          for (const [symbol, row] of Object.entries(snapshot.symbols))
            Object.assign(row, {
              symbol,
              quoteTimestamp: scenario.quote,
              latestDate: scenario.quote.slice(0, 10),
              validationStatus: "validated",
              stale: false,
              trustedSource: true,
            });
          return route.fulfill({ json: snapshot });
        }
        try {
          await route.fulfill({
            body: await fs.readFile(file),
            contentType: "application/json",
          });
        } catch (_) {
          await route.fulfill({ status: 404, body: "missing" });
        }
      },
    );
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        document.querySelector("#refreshBtn")?.getAttribute("aria-busy") ===
          "false" && window.__SUINVESTMENT_SIGNALS__?.length > 0,
    );
    const signals = await page.evaluate(() =>
      window.__SUINVESTMENT_SIGNALS__.filter((s) =>
        ["SPY", "QQQ", "NVDA", "AAPL", "ASML", "KO", "MSFT"].includes(s.symbol),
      ),
    );
    assert.ok(signals.length > 0);
    assert.ok(
      signals.every((s) => s.data_freshness === scenario.status),
      scenario.name +
        ": " +
        JSON.stringify(signals.map((s) => [s.symbol, s.data_freshness])),
    );
    assert.ok(
      signals.every((s) => s.suggested_buy_amount === 0),
      scenario.name + ": no executable buy from closed or stale data",
    );
    const reason = await page.locator("#weeklyDecisionSafety").textContent();
    assert.match(
      reason,
      scenario.status === "market_closed" ? /休市|开市/ : /过期|不可用/,
      scenario.name + ": visible safety reason",
    );
    assert.deepEqual(errors, [], scenario.name);
    await context.close();
  }
  console.log(
    "Calendar browser smoke passed: premarket, opening, old/intraday quotes, calendar failure and holiday close; buys remain blocked.",
  );
} finally {
  await browser.close();
}
