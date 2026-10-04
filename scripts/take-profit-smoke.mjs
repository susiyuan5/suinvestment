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
const symbols = ["AAPL", "MSFT", "SPY", "NVDA", "META", "TSLA", "WMT"];
const index = { schema_version: "take-profit-browser-index-v1", research_only: true, currency: "USD", as_of: expected, symbol_count: symbols.length, symbols: {} };
const payloads = {};
for (const symbol of symbols) {
  const daily = rows(symbol);
  index.symbols[symbol] = { path: `data/take-profit-v1/symbols/${symbol}.json`, first_date: daily[0].date, last_date: daily.at(-1).date, rows: daily.length };
  payloads[symbol] = { schema_version: "take-profit-browser-bars-v1", research_only: true, currency: "USD", as_of: expected, symbol: symbol === "TSLA" ? "MSFT" : symbol, rows: daily };
}
async function installFixtures(context, requests, isStale = () => false) {
  await context.route(/https:\/\/(finnhub\.io|query1\.finance\.yahoo\.com|www\.bankofcanada\.ca)\//, (route) => route.abort());
  await context.route("https://raw.githubusercontent.com/susiyuan5/suinvestment/**", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").slice(4).join("/");
    if (name === "live-data-manifest.json") return route.fulfill({ json: { formatVersion: 1, dataCommit: "a".repeat(40), codeCommit: "b".repeat(40), publishedAt: "2026-10-04T12:00:00Z" } });
    if (name.includes("..")) return route.fulfill({ status: 404, body: "invalid path" });
    try { await route.fulfill({ body: await fs.readFile(path.join(root, name)), contentType: "application/json" }); }
    catch { await route.fulfill({ status: 404, body: "missing fixture" }); }
  });
  // Preserve the actual calendar interface and pure indicator. Only the clock's
  // expected session and network snapshots are controlled by this test fixture.
  await context.route("**/market-calendar.js*", async (route) => {
    const source = await fs.readFile(path.join(root, "market-calendar.js"), "utf8");
    await route.fulfill({ contentType: "text/javascript", body: source + `\nwindow.__TP_EXPECTED__=${JSON.stringify(expected)}; const originalAssess=MarketCalendar.assess; MarketCalendar.assess=(q,n)=>Object.assign({},originalAssess(q,n),{known:!window.__TP_CALENDAR_DOWN__,expectedClose:window.__TP_CALENDAR_DOWN__?null:window.__TP_EXPECTED__+'T20:00:00Z'});` });
  });
  await context.route("**/data/take-profit-v1/**", async (route) => {
    const url = new URL(route.request().url());
    const name = url.pathname.slice(url.pathname.indexOf("data/take-profit-v1/"));
    requests.push(name);
    if (name === "data/take-profit-v1/index.json") return route.fulfill({ json: isStale() ? { ...index, as_of: "2026-10-01" } : index });
    const symbol = path.basename(name, ".json");
    if (symbol === "META") return route.fulfill({ status: 503, body: "fixture unavailable" });
    if (!payloads[symbol]) return route.fulfill({ status: 404, body: "unknown symbol" });
    return route.fulfill({ json: payloads[symbol] });
  });
}
const financialSnapshotOf = (page) => page.evaluate(async (ownKey) => ({
  ledger: await DipLedger.transact(indexedDB, (value) => value),
  storage: Object.fromEntries(Object.entries(localStorage).filter(([name]) => name !== ownKey)),
}), key);
const browser = await chromium.launch({ headless: true });
try {
  // These isolated contexts deliberately omit the source preference, matching a
  // default installation with automatic holdings still locked. Use the real
  // app getter rather than substituting a take-profit-only holdings API.
  for (const [name, manualPositions] of [
    ["default-manual-fallback", { AAPL: { shares: 2, average_cost: 100, current_value: 200 }, WMT: { average_cost: 100, current_value: 250 } }],
    ["default-empty-locked", {}],
  ]) {
    const fallbackContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN" });
    try {
      await fallbackContext.addInitScript((positions) => {
        localStorage.setItem("su-investment-pro:portfolio-risk", JSON.stringify({ available_cash: 1000, positions }));
        localStorage.setItem("su-investment-pro:wealthsimple-currency-v1", JSON.stringify({ planningCurrency: "USD", planningMigrationVersion: "usd-planning-v2" }));
      }, manualPositions);
      const initialRequests = [], initialErrors = [];
      await installFixtures(fallbackContext, initialRequests);
      const fallbackPage = await fallbackContext.newPage();
      fallbackPage.on("pageerror", (error) => initialErrors.push(error.message));
      await fallbackPage.clock.setFixedTime("2026-10-04T12:00:00Z");
      await fallbackPage.goto(base, { waitUntil: "domcontentloaded" });
      await fallbackPage.waitForFunction(() => document.querySelector("#refreshBtn")?.getAttribute("aria-busy") === "false" && document.querySelector("#snaptradeSyncStatus")?.dataset.state === "locked");
      assert.equal(await fallbackPage.evaluate(() => localStorage.getItem("su-investment-pro:holdings-source-mode")), null, name + " retains the default automatic preference");
      assert.equal(initialRequests.length, 0, name + " does not eagerly load stop-profit data");
      const originalFinancialState = await financialSnapshotOf(fallbackPage);
      await fallbackPage.locator('.workspace-nav a[href="#take-profit"]').click();
      await fallbackPage.waitForFunction(() => document.querySelector("#takeProfitRefresh")?.getAttribute("aria-busy") === "false");
      const actualSource = await fallbackPage.evaluate(() => __SUINVESTMENT_HOLDINGS_API__.current());
      assert.equal(actualSource.sourceMode, "manual");
      assert.equal(actualSource.requestedSourceMode, "automatic");
      assert.equal(actualSource.automaticStatus, "locked");
      assert.equal(actualSource.usingManualFallback, true);
      assert.equal(await fallbackPage.evaluate((name) => localStorage.getItem(name), key), null, name + " never auto-imports observations into storage");
      if (Object.keys(manualPositions).length) {
        assert.deepEqual(await fallbackPage.locator(".take-profit-card").evaluateAll((cards) => cards.map((card) => card.dataset.symbol).sort()), ["AAPL", "WMT"]);
        assert.deepEqual(await fallbackPage.locator("#takeProfitSymbol option").evaluateAll((options) => options.map((option) => option.value).filter(Boolean).sort()), ["AAPL", "WMT"]);
        assert.equal(await fallbackPage.locator("#takeProfitSymbol").isEnabled(), true, "actual manual holdings remain selectable while automatic source is locked");
        assert.match(await fallbackPage.locator("#takeProfitHoldingsStatus").textContent(), /人工持仓/);
        const unknownQuantity = fallbackPage.locator('.take-profit-card[data-symbol="WMT"]');
        assert.match(await unknownQuantity.textContent(), /股数待补充|数量待补充/);
        assert.equal(await unknownQuantity.locator("progress").count(), 0);
        assert.equal(actualSource.rows.find((row) => row.symbol === "WMT").shares, null, "current market value cannot fabricate a held share quantity");
        await fallbackPage.locator("#takeProfitSymbol").selectOption("AAPL");
        assert.equal(await fallbackPage.locator("#takeProfitCost").inputValue(), "100");
        assert.equal(await fallbackPage.locator("#takeProfitCost").getAttribute("readonly"), "");
        assert.equal(await fallbackPage.locator("#takeProfitDate").inputValue(), "", "no current holding imports an invented entry date");
        await fallbackPage.locator("#takeProfitSymbol").selectOption("WMT");
        await fallbackPage.locator("#takeProfitDate").fill(dates[20]);
        await fallbackPage.locator("#takeProfitSave").click();
        await fallbackPage.waitForFunction(() => document.querySelector("#takeProfitRefresh")?.getAttribute("aria-busy") === "false");
        assert.equal(await unknownQuantity.locator("progress").count(), 0, "saving a date does not remove the unknown-quantity block");
        assert.match(await unknownQuantity.textContent(), /数量待补充/);
      } else {
        assert.equal(await fallbackPage.locator(".take-profit-card").count(), 0, "empty actual holdings do not import target-list stocks");
        assert.equal(await fallbackPage.locator("#takeProfitSymbol").isDisabled(), true);
        assert.equal(await fallbackPage.locator("#takeProfitSave").isDisabled(), true);
        assert.match(await fallbackPage.locator("#takeProfitRows").textContent(), /解锁|锁定/);
        assert.match(await fallbackPage.locator("#takeProfitSymbolHelp").textContent(), /解锁持仓/);
        assert.equal(await fallbackPage.locator("#takeProfitHoldingsSettings").textContent(), "解锁持仓");
        await fallbackPage.locator("#takeProfitHoldingsSettings").click();
        assert.equal(await fallbackPage.locator("#settingsModal").isVisible(), true, "unlock guidance opens the existing account settings");
        await fallbackPage.waitForFunction(() => document.activeElement?.id === "snaptradeSnapshotKeyInput");
        await fallbackPage.locator("#closeSettingsBtn").click();
        assert.equal(await fallbackPage.locator("#settingsModal").isVisible(), false);
        assert.equal(new URL(fallbackPage.url()).hash, "#take-profit", "unlock guidance retains the stop-profit route");
      }
      assert.deepEqual(initialRequests, ["data/take-profit-v1/index.json"], name + " fetches no histories without a usable entry basis");
      assert.deepEqual(await financialSnapshotOf(fallbackPage), originalFinancialState, name + " preserves all other financial state");
      assert.deepEqual(initialErrors, []);
    } finally { await fallbackContext.close(); }
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN" });
  await context.addInitScript(() => {
    localStorage.setItem("su-investment-pro:holdings-source-mode", "manual");
    if (!localStorage.getItem("su-investment-pro:portfolio-risk")) localStorage.setItem("su-investment-pro:portfolio-risk", JSON.stringify({ available_cash: 1000,
      positions: Object.fromEntries(["AAPL","MSFT","SPY","NVDA","META","TSLA"].map(symbol => [symbol,{shares:2,average_cost:100,current_value:200}])) }));
  });
  const requests = [];
  let staleIndex = false;
  await installFixtures(context, requests, () => staleIndex);
  const page = await context.newPage(), errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime("2026-10-04T12:00:00Z");
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#refreshBtn")?.getAttribute("aria-busy") === "false");
  assert.equal(requests.length, 0, "take-profit data must not load on weekly route");
  assert.equal(await page.locator("#view-take-profit").isVisible(), false);
  const financialSnapshot = () => financialSnapshotOf(page);
  const before = await financialSnapshot();
  await page.locator('.workspace-nav a[href="#take-profit"]').click();
  await page.waitForFunction(() => document.querySelector("#takeProfitSave")?.disabled === false);
  assert.deepEqual(requests, ["data/take-profit-v1/index.json"], "index loads first, no unselected symbol history");
  assert.equal(await page.locator(".take-profit-card").count(), 6, "actual held stocks appear without manual import");
  assert.equal(await page.locator("#takeProfitSymbol option").count(), 7, "selection is restricted to the six held stocks");
  assert.equal(await page.locator('.take-profit-card[data-symbol="WMT"]').count(), 0, "unheld index stocks do not enter the list");
  assert.equal(await page.locator('.take-profit-card[data-state="pending"]').count(), 6, "missing dates cannot infer entry peaks");
  assert.equal(await page.evaluate(name => localStorage.getItem(name), key), null, "automatic display never persists imported holdings");
  assert.deepEqual(await page.locator("[data-workspace-view]:visible").evaluateAll((items) => items.map((item) => item.dataset.workspaceView)), ["take-profit"]);
  assert.equal(await page.locator('.workspace-nav a[href="#take-profit"]').getAttribute("aria-current"), "page");
  const watch = (symbol) => page.locator(`.take-profit-card[data-symbol="${symbol}"]`);
  const saved = () => page.evaluate((name) => JSON.parse(localStorage.getItem(name) || "null"), key);
  const savePosition = async (symbol, cost = "100", entryDate = dates[20]) => {
    await page.locator("#takeProfitSymbol").selectOption(symbol);
    await page.locator("#takeProfitDate").fill(entryDate);
    assert.equal(await page.locator("#takeProfitCost").getAttribute("readonly"), "", "source USD cost is read-only");
    assert.equal(await page.locator("#takeProfitCost").inputValue(), cost);
    await page.locator("#takeProfitSave").click();
    await watch(symbol).waitFor({ state: "visible" });
    await page.waitForFunction((symbol) => document.querySelector(`.take-profit-card[data-symbol="${symbol}"]`)?.dataset.state !== "loading", symbol);
  };
  await page.locator("#takeProfitSymbol").selectOption("AAPL");
  await page.locator("#takeProfitSave").click();
  assert.equal(await saved(), null, "missing actual date/cost cannot save a fabricated position");
  assert.equal(await page.locator("#takeProfitDate").getAttribute("aria-invalid"), "true");
  await page.locator("#takeProfitDate").fill(dates[20]);
  await page.locator("#takeProfitDate").fill("2026-10-05");
  await page.locator("#takeProfitSave").click();
  assert.equal(await saved(), null, "future entry date is rejected");

  await savePosition("AAPL");
  assert.equal(await watch("AAPL").getAttribute("data-state"), "triggered");
  const firstTriggerText = await watch("AAPL").locator(".take-profit-card-reason").textContent();
  assert.match(firstTriggerText, /首次触发/);
  assert.equal(await watch("AAPL").locator("progress").count(), 1);
  assert.deepEqual((await saved()).positions.map(({holdingBasis,...entry})=>entry), [{ symbol: "AAPL", date: dates[20], cost: 100 }], "only explicit entry inputs are persisted");
  assert.equal(typeof (await saved()).positions[0].holdingBasis, "string");
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
  await page.locator("#takeProfitCost").evaluate(input => { input.value = "95"; });
  await page.locator("#takeProfitSave").click();
  await page.waitForFunction((name) => JSON.parse(localStorage.getItem(name)).positions.find((p) => p.symbol === "MSFT").cost === 100, key);
  await watch("META").getByRole("button", { name: "清除入场信息", exact: true }).click();
  assert.equal((await saved()).positions.length, 6, "remove request waits for inline confirmation");
  await watch("META").getByRole("button", { name: "取消", exact: true }).click();
  assert.equal((await saved()).positions.length, 6);
  await watch("META").getByRole("button", { name: "清除入场信息", exact: true }).click();
  await watch("META").getByRole("button", { name: "确认清除" }).click();
  assert.equal((await saved()).positions.length, 5);
  await page.waitForFunction(() => document.querySelector('.take-profit-card[data-symbol="META"]')?.dataset.state === "pending");
  assert.equal(await watch("META").count(), 1, "clearing an entry never hides actual holdings");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#takeProfitRefresh")?.getAttribute("aria-busy") === "false" && document.querySelectorAll(".take-profit-card").length === 6);
  assert.equal(await watch("AAPL").locator(".take-profit-card-reason").textContent(), firstTriggerText, "first trigger remains after reload and recovery");
  assert.equal((await saved()).positions.find((p) => p.symbol === "MSFT").cost, 100, "DOM tampering cannot override source cost");
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
    await page.evaluate(() => window.scrollTo(0,0));
    await page.screenshot({ path: path.join(root, `output/playwright/take-profit-${name}.png`), fullPage: true });
  }
  await page.evaluate((name) => {
    document.documentElement.style.zoom = 1;
    const records = JSON.parse(localStorage.getItem(name));
    records.positions.push({symbol:"GOOG",date:"2026-09-14",cost:100});
    localStorage.setItem(name,JSON.stringify(records));
    window.dispatchEvent(new StorageEvent("storage",{key:name}));
  },key);
  await page.waitForFunction(() => document.querySelector("#takeProfitRefresh")?.getAttribute("aria-busy") === "false");
  assert.equal(await watch("GOOG").count(),0,"saved nonheld observations do not become current holdings");
  const publishAutomatic = async ({changed=false,status="ready",empty=false,stale=false}={}) => {
    await page.evaluate(({changed,status,empty,stale}) => {
      localStorage.setItem("su-investment-pro:holdings-source-mode","automatic");
      const at = stale ? "2026-09-30T12:00:00Z" : new Date().toISOString();
      const holding = (symbol,units,cost=100,fields={}) => ({symbol,units,cost_basis:cost,price:100,market_value:units*100,
        position_currency:"USD",listing_currency:"USD",exchange:"NASDAQ",instrument_kind:"stock",included_in_stock_plan:true,...fields});
      const snapshot={schema_version:"wealthsimple-holdings-v1",generated_at:at,positions_as_of:at,
        accounts:[{account_name:"Synthetic test",balances:[{currency:"USD",cash:100}]}],holdings:empty?[]:[
          holding("AAPL",changed?3:2,changed?105:100),holding("AAPL",.5),holding("WMT",1),holding("NEWT",1),
          holding("SHOP",1,100,{listing_currency:"CAD",exchange:"TSX"}),holding("SPY",0),holding("META",-2),
          holding("USD",100,1,{cash_equivalent:true,included_in_stock_plan:false,instrument_kind:"cash"})]};
      window.dispatchEvent(new CustomEvent("snaptrade:holdings-updated",{detail:{status,sourceMode:"automatic",snapshot,portfolioRisk:SnaptradeHoldingsView.portfolioRisk(snapshot)}}));
    },{changed,status,empty,stale});
    await page.waitForFunction(() => document.querySelector("#takeProfitRefresh")?.getAttribute("aria-busy") === "false");
  };
  const beforeImport = JSON.stringify(await saved()), beforeImportRequests=requests.length;
  await publishAutomatic();
  assert.equal(await page.locator(".take-profit-card").count(),4,"outside-plan stocks are included; cash, shorts and zeros are excluded");
  assert.equal(await watch("WMT").getAttribute("data-state"),"pending");
  assert.equal(await watch("AAPL").getAttribute("data-state"),"review","switching holding source requires explicit review");
  assert.equal(await watch("NEWT").getAttribute("data-state"),"blocked");
  assert.equal(await watch("SHOP").getAttribute("data-state"),"blocked");
  assert.match(await watch("AAPL").textContent(),/持有 2.5 股/);
  assert.equal(JSON.stringify(await saved()),beforeImport,"importing current holdings never writes a plaintext holdings cache");
  assert.equal(requests.length,beforeImportRequests,"unconfirmed source changes and missing dates do not fetch price histories");
  const automaticFinancialBefore = await financialSnapshot();
  await savePosition("WMT");
  assert.equal(await watch("WMT").getAttribute("data-state"),"inactive");
  await savePosition("AAPL");
  assert.equal(await watch("AAPL").getAttribute("data-state"),"triggered");
  assert.deepEqual(await financialSnapshot(),automaticFinancialBefore,"saving automatic holding entry information leaves broker, cash and ledger state unchanged");
  assert.ok((await saved()).positions.some(p=>p.symbol==="GOOG"),"unheld saved records survive current holding entry changes");
  await publishAutomatic({changed:true});
  assert.equal(await watch("AAPL").getAttribute("data-state"),"review","new quantity/cost cannot reuse an old profit line");
  assert.equal(await watch("AAPL").locator("progress").count(),0);
  await watch("AAPL").getByRole("button",{name:"编辑 / 重置"}).click();
  assert.equal(await page.locator("#takeProfitDate").inputValue(),dates[20]);
  assert.equal(await page.locator("#takeProfitCost").getAttribute("readonly"),"");
  await page.locator("#takeProfitSave").click();
  await page.waitForFunction(() => ['active','inactive','triggered'].includes(document.querySelector('.take-profit-card[data-symbol="AAPL"]')?.dataset.state));
  const beforeSourceFallback = await financialSnapshot();
  const savedBeforeSourceFallback = JSON.stringify(await saved());
  await publishAutomatic({stale:true});
  assert.equal(await page.locator(".take-profit-card").count(),0,"a stale snapshot still selected as the actual automatic source cannot generate signals");
  assert.match(await page.locator("#takeProfitHoldingsStatus").textContent(),/超过 3 天/);
  const assertManualFallback = async (automaticStatus) => {
    const actual = await page.evaluate(() => __SUINVESTMENT_HOLDINGS_API__.current());
    assert.equal(actual.sourceMode,"manual","the take-profit panel follows the app's actual manual fallback");
    assert.equal(actual.requestedSourceMode,"automatic");
    assert.equal(actual.automaticStatus,automaticStatus);
    assert.equal(actual.usingManualFallback,true);
    assert.deepEqual(await page.locator(".take-profit-card").evaluateAll(cards=>cards.map(card=>card.dataset.symbol).sort()),["AAPL","META","MSFT","NVDA","SPY","TSLA"]);
    for (const symbol of ["WMT","NEWT","SHOP"]) assert.equal(await watch(symbol).count(),0,"automatic-only holding "+symbol+" must disappear from manual fallback");
    assert.match(await page.locator("#takeProfitHoldingsStatus").textContent(),/人工持仓/);
    assert.equal(await watch("AAPL").getAttribute("data-state"),"review","a different actual source requires explicit confirmation of its entry basis");
    assert.equal(await watch("AAPL").locator("progress").count(),0,"unreviewed source changes cannot reuse an automatic profit line");
    assert.equal(actual.rows.find(row=>row.symbol==="AAPL").shares,2,"fallback quantity comes from actual manual holdings");
    assert.equal(JSON.stringify(await saved()),savedBeforeSourceFallback,"source fallback preserves all saved entry observations");
    assert.deepEqual(await financialSnapshot(),beforeSourceFallback,"source fallback changes no saved financial data or ledger");
  };
  await publishAutomatic({status:"warning",stale:true});
  await assertManualFallback("warning");
  assert.match(await page.locator("#takeProfitHoldingsStatus").textContent(),/时效/);
  await publishAutomatic({empty:true});
  assert.equal(await page.locator(".take-profit-card").count(),0,"sold holdings disappear without deleting saved entry information");
  await publishAutomatic();
  await page.locator("#takeProfitSymbol").selectOption("AAPL");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("snaptrade:holdings-forgotten")));
  await page.waitForFunction(() => document.querySelectorAll(".take-profit-card").length===6 && document.querySelector("#takeProfitRefresh")?.getAttribute("aria-busy")==="false");
  await assertManualFallback("locked");
  assert.equal(await page.locator("#takeProfitCost").inputValue(),"100","forgetting the key replaces imported cost with actual manual holding cost");
  assert.equal(await page.locator("#takeProfitCost").getAttribute("readonly"),"");
  assert.match(await page.locator("#takeProfitHoldingsStatus").textContent(),/锁定/);
  await page.evaluate(() => {
    localStorage.setItem("su-investment-pro:holdings-source-mode","manual");
    window.dispatchEvent(new CustomEvent("snaptrade:holdings-mode",{detail:{mode:"manual"}}));
  });
  await page.waitForFunction(() => document.querySelectorAll(".take-profit-card").length===6 && document.querySelector("#takeProfitRefresh")?.getAttribute("aria-busy")==="false");
  await savePosition("AAPL");
  assert.equal(await watch("AAPL").locator(".take-profit-card-reason").textContent(),firstTriggerText);
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
  await fs.writeFile(path.join(root, "output/playwright/take-profit-smoke.json"), JSON.stringify({ passed: true, checks: ["default-locked-manual-fallback", "default-locked-empty-guidance", "unknown-manual-quantity-block", "route-lazy-load", "symbol-lazy-load", "current-held-stocks-only", "outside-plan-holdings", "no-automatic-holdings-persistence", "source-cost-readonly", "date-input-validation", "entry-persistence", "source-and-cost-review", "sold-holdings-clearing", "stale-automatic-source-block", "warning-and-forgotten-manual-fallback", "nonheld-record-preservation", "sticky-first-trigger", "active-inactive", "missing-stale-corrupt-identity", "calendar-unavailable", "new-close-revalidation", "cross-release-block", "ledger-invariance", "hidden-focus", "mobile-and-200-percent-zoom", "no-page-errors"] }, null, 2));
  console.log("Take-profit smoke passed: default and changed manual fallback, unknown quantity, current holdings, source cost/date review, stale/sold state, isolated storage, lazy data, sticky trigger, calendar, ledger and responsive layouts.");
} finally { await browser.close(); }
