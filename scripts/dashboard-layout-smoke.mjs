import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.BASE_URL;
if (!base) throw Error('BASE_URL is required');
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route(/https:\/\/(finnhub\.io|query1\.finance\.yahoo\.com|www\.bankofcanada\.ca)\//, r => r.abort());
  await context.route('https://raw.githubusercontent.com/susiyuan5/suinvestment/**', async route => {
    const path = new URL(route.request().url()).pathname.split('/').slice(4).join('/');
    if (path === 'live-data-manifest.json') return route.fulfill({ json: { formatVersion: 1, dataCommit: 'a'.repeat(40), codeCommit: 'b'.repeat(40), publishedAt: '2026-09-22T12:00:00Z' } });
    try { await route.fulfill({ body: await fs.readFile(path), contentType: 'application/json' }); }
    catch { await route.fulfill({ status: 404, body: 'missing' }); }
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.setFixedTime('2026-09-22T12:00:00Z');
  await page.goto(base);
  await page.waitForFunction(() => document.querySelector('#refreshBtn')?.getAttribute('aria-busy') === 'false' && window.__SUINVESTMENT_SIGNALS__?.length > 0);
  const finances = () => page.evaluate(() => JSON.stringify({
    plan: window.__SUINVESTMENT_WEALTHSIMPLE_PLAN__.plan,
    portfolio: localStorage.getItem('su-investment-pro:portfolio'),
    risk: window.__SUINVESTMENT_PORTFOLIO_RISK__,
  }));
  const before = await finances();
  assert.equal(await page.locator('.weekly-allocation-table th[scope=col]').count(), 7);
  const buttons = page.locator('.weekly-expand-button');
  assert.equal(await page.locator('.weekly-decision-expanded:visible').count(), 0);
  await buttons.nth(0).focus();
  await page.keyboard.press('Enter');
  await buttons.nth(1).click();
  assert.equal(await page.locator('.weekly-decision-expanded:visible').count(), 2, 'details expand independently');
  assert.equal(await buttons.nth(0).getAttribute('aria-expanded'), 'true');
  assert.equal(await finances(), before, 'expansion does not change plans, allocations or risk');
  await buttons.nth(0).click();
  await buttons.nth(1).click();
  const menu = page.locator('.allocation-tools > summary');
  await menu.focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.allocation-tools > summary').getAttribute('aria-expanded') === 'true');
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('.allocation-normalize-button').evaluate(e => e === document.activeElement), true);
  await page.keyboard.press('Escape');
  assert.equal(await menu.evaluate(e => e === document.activeElement), true);
  await menu.click();
  await page.locator('.allocation-normalize-button').click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('su-investment-pro:portfolio')).reduce((sum, row) => sum + Math.round(row.allocation * 10000), 0)), 10000);
  await page.locator('#weeklyListSort').selectOption('manual');
  const symbols = () => page.locator('.weekly-decision-row[data-symbol]').evaluateAll(rows => rows.map(row => row.dataset.symbol));
  const original = await symbols();
  await page.getByRole('button', { name: original[0] + ' 下移', exact: true }).click();
  assert.deepEqual((await symbols()).slice(0, 2), [original[1], original[0]]);
  await page.locator('#weeklyListSort').selectOption('suggested');
  await fs.mkdir('output/playwright', { recursive: true });
  const results = [];
  for (const [width, height] of [[1920, 1080], [1440, 900], [1200, 900], [1000, 900], [800, 900], [799, 900], [390, 844], [320, 844]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => scrollTo(0, 0));
    const result = await page.evaluate(() => {
      const rect = el => el.getBoundingClientRect();
      const summary = rect(document.querySelector('.summary-grid'));
      const plan = rect(document.querySelector('#weeklyDecisionPlan'));
      const rows = [...document.querySelectorAll('.weekly-decision-row[data-symbol]')];
      const overflow = [...document.querySelectorAll('#view-weekly *')].filter(el => {
        const r = rect(el); return el.checkVisibility() && !el.closest('thead') && r.width > 0 && r.height > 0 && (r.right > innerWidth + 1 || r.left < -1);
      }).map(el => el.id || el.className);
      return { width: innerWidth, overflow, columns: getComputedStyle(document.querySelector('.summary-grid')).gridTemplateColumns.split(' ').length,
        summaryAbovePlan: summary.bottom <= plan.top, planWidth: plan.width,
        visibleRows: rows.filter(el => rect(el).bottom <= innerHeight).length,
        rowHeight: rect(rows[0]).height };
    });
    assert.deepEqual(result.overflow, [], `${width}px element overflow`);
    assert.equal(result.summaryAbovePlan, true);
    assert.equal(result.columns, width >= 1200 ? 4 : width >= 380 ? 2 : 1);
    if (width >= 1440) {
      assert.ok(result.visibleRows >= 5, `${width}px first screen shows five or more stocks`);
      assert.ok(result.rowHeight >= 58 && result.rowHeight <= 68);
    }
    results.push(result);
    await page.screenshot({ path: `output/playwright/dashboard-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const firstSymbol = (await symbols())[0];
  await page.getByRole('button', { name: firstSymbol + ' 详情', exact: true }).click();
  assert.equal(await page.locator('.weekly-decision-expanded:visible').count(), 1);
  const input = page.locator('[data-weekly-allocation-symbol]').first();
  await input.fill('8');
  await page.getByRole('button', { name: `应用 ${firstSymbol} 的比例并自动调节其余标的`, exact: true }).click();
  assert.equal(await page.locator(`[data-weekly-allocation-symbol="${firstSymbol}"]`).inputValue(), '8.00');
  assert.equal(await page.locator(`[data-weekly-allocation-symbol="${firstSymbol}"]`).evaluate(e => e === document.activeElement), true, 'focus follows edited symbol');
  assert.deepEqual(errors, []);
  await fs.writeFile('output/playwright/dashboard-layout-results.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
  console.log('Dashboard layout passed: 8 viewport sizes, independent details, keyboard dropdown, normalization, manual move, mobile editing and financial invariance.');
} finally { await browser.close(); }
