import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const base = process.env.BASE_URL;
if (!base) throw Error('BASE_URL is required');
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // Use one deterministic data release and unavailable optional providers.
  await context.route('https://finnhub.io/**', r => r.abort());
  await context.route('https://query1.finance.yahoo.com/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/v1/finance/search')) {
      const query = (url.searchParams.get('q') || '').toUpperCase();
      const quotes = query === 'VOO' ? [{ symbol: 'VOO', longname: 'Vanguard S&P 500 ETF', exchange: 'PCX', quoteType: 'ETF', currency: 'USD', regularMarketPrice: 650 }]
        : query === 'SHOP' ? [{ symbol: 'SHOP.TO', longname: 'Shopify Inc.', exchange: 'TOR', quoteType: 'EQUITY', currency: 'CAD', regularMarketPrice: 200 }]
        : [{ symbol: 'MSFT', longname: 'Microsoft Corporation', exchange: 'NMS', quoteType: 'EQUITY', currency: 'USD', regularMarketPrice: 420, regularMarketTime: 1789502400 }];
      return route.fulfill({ json: { quotes } });
    }
    if (url.pathname.includes('/v8/finance/chart/MSFT')) {
      const timestamp = [1788897600, 1788984000, 1789070400, 1789156800, 1789416000, 1789502400], close = [410, 412, 414, 416, 418, 420];
      return route.fulfill({ json: { chart: { result: [{ meta: { symbol: 'MSFT', longName: 'Microsoft Corporation', exchangeName: 'NMS', currency: 'USD', instrumentType: 'EQUITY', regularMarketPrice: 420, regularMarketTime: 1789502400, chartPreviousClose: 418 }, timestamp, indicators: { quote: [{ close }] } }] } } });
    }
    return route.abort();
  });
  await context.route('https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json**', r => r.fulfill({ json: { observations: [{ d: '2026-09-15', FXUSDCAD: { v: '1.35' } }] } }));
  await context.route('https://raw.githubusercontent.com/susiyuan5/suinvestment/**', async route => {
    const path = new URL(route.request().url()).pathname.split('/').slice(4).join('/');
    if (path === 'live-data-manifest.json') return route.fulfill({ json: { formatVersion: 1, dataCommit: 'a'.repeat(40), codeCommit: 'b'.repeat(40), publishedAt: '2026-09-16T12:00:00Z' } });
    if (path === 'data/us-equity-search-index.json') return route.fulfill({ json: {
      formatVersion: 1,
      generatedAt: '2026-09-16T12:00:00Z',
      priceAsOf: '2026-09-15',
      symbols: [
        { symbol: 'MSFT', name: 'Microsoft Corporation', exchange: 'NMS', instrumentType: 'EQUITY', currency: 'USD', price: 420, quoteTimestamp: '2026-09-15T20:00:00Z', source: 'Smoke fixture' },
        { symbol: 'VOO', name: 'Vanguard S&P 500 ETF', exchange: 'PCX', instrumentType: 'ETF', currency: 'USD', price: 650, quoteTimestamp: '2026-09-15T20:00:00Z', source: 'Smoke fixture' }
      ]
    } });
    try { await route.fulfill({ body: await fs.readFile(path), contentType: 'application/json' }); }
    catch { await route.fulfill({ status: 404, body: 'missing' }); }
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.setFixedTime('2026-09-16T12:00:00Z');
  const ready = () => page.waitForFunction(() => document.querySelector('#refreshBtn')?.getAttribute('aria-busy') === 'false' && window.__SUINVESTMENT_SIGNALS__?.length > 0);
  await page.goto(base); await ready();
  const portfolio = () => page.evaluate(() => JSON.parse(localStorage.getItem('su-investment-pro:portfolio')));
  const checkTotal = async () => { const rows = await portfolio(); assert.equal(rows.reduce((s, r) => s + Math.round(r.allocation * 10000), 0), 10000); return rows; };
  await page.waitForFunction(() => document.querySelector('#dipStatus')?.textContent && !document.querySelector('#dipStatus').textContent.includes('正在'));
  const ledger = () => page.evaluate(async () => JSON.stringify(await DipLedger.transact(indexedDB, b => b)));
  const originalLedger = await ledger();
  const field = symbol => page.locator('[data-weekly-allocation-symbol="' + symbol + '"]');
  const apply = symbol => page.getByRole('button', { name: '应用 ' + symbol + ' 的比例并自动调节其余标的', exact: true }).click();
  assert.equal(await page.locator('#stockSearchInput').isVisible(), true);
  assert.equal(await page.locator('#weeklyAddStockBtn').isDisabled(), true);
  await field('NVDA').fill('10.55'); await apply('NVDA');
  assert.equal(Math.round((await checkTotal()).find(r => r.symbol === 'NVDA').allocation * 10000), 1055);
  await page.locator('#stockSearchInput').fill('微软');
  await page.locator('#stockAllocationInput').fill('5');
  await page.waitForFunction(() => document.querySelector('#stockSearchResults')?.textContent.includes('USD 420'));
  assert.match(await page.locator('#stockSearchResults').textContent(), /USD 420/);
  await page.locator('#stockSearchInput').press('ArrowDown'); await page.locator('#stockSearchInput').press('Enter');
  await page.waitForFunction(() => document.querySelector('#weeklyAddStockBtn')?.disabled === false);
  assert.match(await page.locator('#stockSearchResults').textContent(), /可加入/);
  await page.locator('#weeklyAddStockBtn').click(); await ready();
  assert.equal((await checkTotal()).find(r => r.symbol === 'MSFT').allocation, .05);
  assert.equal(await field('MSFT').isVisible(), true);
  assert.equal(await page.locator('#weeklyDecisionRows .weekly-allocation-control').count(), 7);
  const plan = await page.evaluate(() => window.__SUINVESTMENT_WEALTHSIMPLE_PLAN__.plan);
  assert.equal(plan.items.length, 7);
  assert.equal(plan.items.find(r => r.symbol === 'MSFT').originalBaseAmount, Math.round(plan.items.reduce((sum, r) => sum + r.originalBaseAmount, 0) * .05 * 100) / 100);
  let saved = await portfolio();
  assert.equal(await page.locator('#weeklyAddStockBtn').isDisabled(), true, 'add requires a currently verified selection');
  await field('MSFT').fill('101'); await apply('MSFT');
  assert.match(await page.locator('#weeklyAllocationStatus').textContent(), /0% 至 100%|有效比例/);
  assert.deepEqual(await portfolio(), saved, 'invalid edit does not persist');
  await page.evaluate(() => {
    window.__testSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'su-investment-pro:portfolio') throw new DOMException('Storage full', 'QuotaExceededError');
      return window.__testSetItem.call(this, key, value);
    };
  });
  await field('MSFT').fill('6'); await apply('MSFT');
  assert.match(await page.locator('#weeklyAllocationStatus').textContent(), /保存失败/);
  assert.deepEqual(await portfolio(), saved, 'storage failure preserves the previous configuration');
  await page.evaluate(() => { Storage.prototype.setItem = window.__testSetItem; delete window.__testSetItem; });
  await page.locator('#stockSearchInput').fill('MSFT'); await page.locator('#stockSearchBtn').click();
  await page.locator('#stockSearchResults .stock-autocomplete-item').filter({ hasText: 'MSFT' }).click();
  assert.match(await page.locator('#stockSearchResults').textContent(), /已在定投清单/);
  assert.equal(await page.locator('#weeklyAddStockBtn').isDisabled(), true);
  assert.deepEqual(await portfolio(), saved, 'duplicate does not change allocation');
  await page.reload(); await ready();
  assert.deepEqual(await portfolio(), saved, 'reload preserves the added stock and weights');
  assert.equal(await field('MSFT').inputValue(), '5.00');
  await page.locator('#stockSearchInput').focus();
  assert.match(await page.locator('#stockSearchResults').textContent(), /最近添加.*MSFT/s);
  await page.locator('#stockSearchInput').fill('VOO'); await page.locator('#stockSearchBtn').click();
  await page.waitForFunction(() => document.querySelector('#stockSearchResults')?.textContent.includes('仅支持美股普通股'));
  assert.match(await page.locator('#stockSearchResults').textContent(), /仅支持美股普通股或 ADR/);
  assert.equal(await page.locator('#stockSearchResults .stock-autocomplete-item').getAttribute('aria-disabled'), 'true');
  assert.equal(await page.locator('#weeklyAddStockBtn').isDisabled(), true, 'ETF cannot be added');
  await page.locator('#openSettingsBtn').click(); await page.locator('[data-settings-tab="allocation"]').click();
  assert.equal(await page.locator('[data-allocation-symbol="MSFT"]').count(), 1);
  await page.locator('[data-allocation-symbol="MSFT"]').fill('6');
  await page.locator('#saveSettingsChangesBtn').click();
  assert.equal(await page.locator('#settingsDirtyState').getAttribute('data-dirty'), 'false', await page.locator('#settingsModalStatus').textContent());
  assert.equal((await checkTotal()).find(row => row.symbol === 'MSFT').allocation, .06);
  await page.locator('#closeSettingsBtn').click();
  await page.locator('.allocation-equal-button').click();
  assert.equal((await checkTotal()).length, 7, 'equal weights retain added symbols');
  assert.ok((await portfolio()).every(row => row.allocation >= 0 && row.allocation <= 1));
  saved = await portfolio();
  await page.reload(); await ready();
  assert.deepEqual(await portfolio(), saved, 'settings and equal weights persist');
  await page.locator('#refreshBtn').click(); await ready();
  assert.equal(await ledger(), originalLedger, 'allocation changes and refresh do not debit or duplicate dip ledger entries');
  await fs.mkdir('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/weekly-allocation-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await field('MSFT').isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no mobile overflow');
  await page.screenshot({ path: 'output/playwright/weekly-allocation-mobile.png', fullPage: true });
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '将 MSFT 移出定投清单', exact: true }).click(); await ready();
  assert.equal((await checkTotal()).length, 6);
  assert.equal(await field('MSFT').count(), 0);
  assert.equal(await ledger(), originalLedger, 'removing a target does not change the dip ledger');
  assert.deepEqual(errors, []);
  console.log('Weekly allocation smoke passed: verified search, add, edit, caps, exact 100%, reload, settings, ledger and mobile.');
} finally { await browser.close(); }
