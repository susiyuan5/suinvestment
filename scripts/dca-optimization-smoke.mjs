import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.BASE_URL;
if (!base) throw Error('BASE_URL is required');
const now = '2026-09-30T17:00:00Z', quoteAt = '2026-09-30T16:00:00Z';
// Independent synthetic configuration and holdings; no live account values.
const weeklyWeights = { SPY: .2, QQQ: .15, NVDA: .15, AAPL: .10, ASML: .10, QNT: .075, JOBY: .075, PEP: .075, CBRS: .075 };
const usValues = { SPY: 60, QQQ: 25, NVDA: 25, AAPL: 20, ASML: 20, QNT: 5, CBRS: 5, JOBY: 10, PEP: 10, KO: 10, WMT: 10 };
const symbols = Object.keys(usValues), portfolioKey = 'su-investment-pro:portfolio';
const marketTemplate = JSON.parse(await fs.readFile('data/market-data.json', 'utf8'));
const historyTemplate = JSON.parse(await fs.readFile('data/backtest-prices.json', 'utf8'));
const evidence = { fixture: 'Synthetic isolated browser fixture; not a prediction of live signals.', checks: [] };
const checkpoint = name => console.log('Weekly contribution audit: ' + name);
const browser = await chromium.launch({ headless: true });

async function setup({ missingPublished = [], hardDrawdown = false, stale = false, weights = weeklyWeights } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  context.setDefaultTimeout(30000);
  context.setDefaultNavigationTimeout(30000);
  const errors = [], requests = [], market = structuredClone(marketTemplate), history = structuredClone(historyTemplate);
  market.generatedAt = now; market.symbols = {}; history.generatedAt = now; history.symbols = {};
  for (const symbol of symbols) {
    const hard = hardDrawdown && symbol === 'NVDA', price = hard ? 60 : 100;
    market.symbols[symbol] = { ...structuredClone(marketTemplate.symbols.SPY), symbol, price, latestClose: price,
      latestDate: '2026-09-30', previousClose: price, previousDate: '2026-09-29', weekAgoClose: 100,
      weekAgoDate: '2026-09-23', dailyChange: 0, weeklyChange: hard ? -40 : 0, decisionChange: hard ? -40 : 0,
      quoteTimestamp: quoteAt, fetchTimestamp: now, validationStatus: 'validated', validationReason: '',
      marketState: 'REGULAR', stale: stale && symbol === 'NVDA', staleReason: stale ? 'Smoke stale data' : '', freshnessAgeHours: 1 };
    const length = symbol === 'QNT' ? 8 : 70;
    history.symbols[symbol] = Array.from({ length }, (_, index) => ({
      date: new Date(Date.parse('2026-09-25T00:00:00Z') - (length - index - 1) * 7 * 86400000).toISOString().slice(0, 10),
      close: hard && index === length - 1 ? 60 : 100
    }));
  }
  const published = { formatVersion: 1, generatedAt: now, priceAsOf: '2026-09-30', symbols: symbols
    .filter(symbol => !missingPublished.includes(symbol)).map(symbol => ({ symbol, name: symbol + ' Smoke Company',
      exchange: 'NMS', instrumentType: 'EQUITY', currency: 'USD', price: 100, quoteTimestamp: quoteAt, source: 'Published smoke fixture' })) };
  await context.route('https://finnhub.io/**', route => route.abort());
  await context.route('https://query1.finance.yahoo.com/**', route => route.abort());
  await context.route('https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json**', route => route.fulfill({ json: { observations: [{ d: '2026-09-30', FXUSDCAD: { v: '1.35' } }] } }));
  await context.route('https://raw.githubusercontent.com/susiyuan5/suinvestment/**', async route => {
    const path = new URL(route.request().url()).pathname.split('/').slice(4).join('/'); requests.push(path);
    if (path === 'live-data-manifest.json') return route.fulfill({ json: { formatVersion: 1, dataCommit: 'a'.repeat(40), codeCommit: 'b'.repeat(40), publishedAt: now } });
    if (path === 'data/market-data.json') return route.fulfill({ json: market });
    if (path === 'data/backtest-prices.json') return route.fulfill({ json: history });
    if (path === 'data/us-equity-search-index.json') return route.fulfill({ json: published });
    if (path === 'data/private/wealthsimple-holdings.enc.json') return route.fulfill({ status: 404, body: 'No private fixture' });
    try { return await route.fulfill({ body: await fs.readFile(path), contentType: 'application/json' }); }
    catch { return route.fulfill({ status: 404, body: 'Missing optional fixture' }); }
  });
  await context.addInitScript(({ target, now }) => {
    if (localStorage.getItem('smoke:initialized')) return;
    const rows = Object.entries(target).map(([symbol, allocation]) => ({ symbol, name: symbol, allocation,
      target_allocation: allocation, asset_type: symbol === 'SPY' ? 'core_etf' : symbol === 'QQQ' ? 'growth_etf' : 'individual_stock',
      bucket: symbol === 'SPY' ? 'core' : symbol === 'QQQ' ? 'growth_etf' : 'satellite',
      sector: ['NVDA', 'AAPL', 'ASML'].includes(symbol) ? 'technology' : 'unclassified', preset_version: 'core-satellite-v5' }));
    localStorage.setItem('su-investment-pro:portfolio', JSON.stringify(rows));
    localStorage.setItem('su-investment-pro:core-satellite-state', JSON.stringify({ preset_version: 'core-satellite-v5', allocation_mode: 'manual', migration_completed: true, custom_symbols_enabled: true }));
    localStorage.setItem('su-investment-pro:deployment', JSON.stringify({ normalPool: 250, crashFund: 100 }));
    localStorage.setItem('su-investment-pro:wealthsimple-currency-v1', JSON.stringify({ planningCurrency: 'USD', accountCurrency: 'USD', displayCurrency: 'USD', usdAccountEnabled: true,
      planningMigrationVersion: 'usd-planning-v2', planningMigrationPending: false, fxRate: 1.35, fxAsOf: now, fxFeeRate: 0, fxMaxAgeDays: 3 }));
    localStorage.setItem('su-investment-pro:display-currency', 'USD');
    localStorage.setItem('smoke:initialized', 'true');
  }, { target: weights, now });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.clock.setFixedTime(now);
  await page.goto(base);
  try { await ready(page); }
  catch (error) {
    console.error(JSON.stringify({ errors, requests, state: await page.evaluate(() => ({ title: document.title, refresh: document.querySelector('#refreshBtn')?.outerHTML, signals: window.__SUINVESTMENT_SIGNALS__?.length, warning: document.querySelector('#dataQualityWarning')?.textContent, plan: window.__SUINVESTMENT_WEALTHSIMPLE_PLAN__?.plan })) }, null, 2));
    throw error;
  }
  return { context, page, errors, requests };
}

async function ready(page) {
  await page.waitForFunction(() => document.querySelector('#refreshBtn')?.getAttribute('aria-busy') === 'false' && window.__SUINVESTMENT_SIGNALS__?.length > 0);
  assert.match(await page.locator('label[for="stockAllocationInput"] span').textContent(), /每周投入比例\s*%/, 'stock search labels retain weekly contribution semantics after runtime translation');
  assert.match(await page.locator('#portfolioTotal > span').first().textContent(), /每周基础投入合计/, 'rendered contribution total retains weekly Base semantics after runtime translation');
}
const stored = page => page.evaluate(key => localStorage.getItem(key), portfolioKey);
const plan = page => page.evaluate(() => window.__SUINVESTMENT_WEALTHSIMPLE_PLAN__.plan);
async function openDraft(page) {
  if (!await page.locator('#openAllocationDraftBtn').isVisible()) await page.locator('#weeklyAllocationMore').evaluate(el => { el.closest('details').open = true; }).catch(async () => {
    await page.locator('#openAllocationDraftBtn').evaluate(el => { el.closest('details').open = true; });
  });
  await page.locator('#openAllocationDraftBtn').click();
  await page.locator('#allocationSuggestionDraft').waitFor({ state: 'visible' });
}
async function automaticHoldings(page, empty = false, anomaly = '', cash = 100, values = usValues) {
  await page.evaluate(({ usValues, now, empty, anomaly, cash }) => {
    const holdings = empty ? [] : Object.entries(usValues).map(([symbol, value]) => ({ symbol, included_in_stock_plan: true,
      instrument_kind: symbol === 'SPY' || symbol === 'QQQ' ? 'etf' : 'stock', listing_currency: 'USD', position_currency: 'USD',
      exchange: 'XNAS', units: value / 100, price: 100, market_value: value, cost_basis: 100, data_as_of: now }));
    if (!empty) for (const [symbol, value] of [['AEP.VN', 10], ['GRID.TO', 15]]) holdings.push({ symbol,
      included_in_stock_plan: true, instrument_kind: 'stock', listing_currency: 'CAD', position_currency: 'CAD', exchange: 'XTSE',
      units: 1, price: value * 1.35, market_value: value * 1.35, cost_basis: value * 1.35, data_as_of: now });
    if (anomaly === 'unknown-value') {
      const row = holdings.find(holding => holding.symbol === 'NVDA');
      row.market_value = null; row.price = null;
    }
    if (anomaly === 'identity-conflict') holdings.push({ ...holdings.find(holding => holding.symbol === 'SPY'),
      listing_currency: 'CAD', position_currency: 'CAD', exchange: 'XTSE', market_value: 10 });
    const snapshot = { schema_version: 'wealthsimple-holdings-v1', generated_at: now, positions_as_of: now,
      accounts: [{ account_id: 'smoke', account_name: 'Smoke TFSA', account_category: 'registered', balances: [{ currency: 'USD', cash }] }], holdings };
    const risk = SnaptradeHoldingsView.portfolioRisk(snapshot);
    window.dispatchEvent(new CustomEvent('snaptrade:holdings-updated', { detail: { status: 'ready', sourceMode: 'automatic', snapshot, portfolioRisk: risk } }));
  }, { usValues: values, now, empty, anomaly, cash });
  await page.waitForFunction(expected => window.__SUINVESTMENT_WEALTHSIMPLE_PLAN__.plan?.allocationContext?.complete === expected, !anomaly);
}

try {
  checkpoint('initialization');
  const main = await setup(), { page } = main;
  const original = await stored(page);
  await openDraft(page);
  assert.equal(await page.locator('[data-draft-symbol]').count(), 11);
  assert.equal(await page.locator('#allocationSuggestionSpy').textContent(), '20.00%');
  assert.equal(await page.locator('#allocationSuggestionTotal').textContent(), '100.00%');
  assert.equal(await stored(page), original, 'opening a suggestion never persists it');
  await page.locator('#cancelAllocationSuggestionBtn').click();
  assert.equal(await stored(page), original, 'cancelling does not persist');
  evidence.checks.push('11-symbol draft opens and cancels without saving; search and allocation total labels retain weekly contribution semantics after runtime translation');

  checkpoint('weekly weights and existing holdings');
  await automaticHoldings(page);
  const current = await plan(page);
  assert.equal(current.allocationContext.securitiesValue.toFixed(2), '200.00');
  assert.deepEqual(current.allocationContext.excludedSymbols.sort(), ['AEP.VN', 'GRID.TO']);
  assert.equal(current.contributionPlan.valid, true);
  assert.equal(current.contributionPlan.allocationMode, 'weekly_contribution');
  assert.equal(current.contributionPlan.baseBudget, 50);
  assert.equal(current.contributionPlan.baseAmounts.SPY, 10);
  assert.equal(current.items.find(row => row.symbol === 'SPY').baseAmount, 10, 'SPY weekly Base is 20% even when its holdings exceed 20%');
  assert.equal(current.items.find(row => row.symbol === 'SPY').finalAmount, 10);
  assert.equal(current.totalPlanned, 50, 'affordable Base exceeds 30% of 100 account cash');
  assert.ok(current.totalPlanned > 100 * .3);
  const risk = await page.evaluate(() => window.__SUINVESTMENT_PORTFOLIO_RISK__);
  assert.equal(risk.positions.SPY.current_allocation, 21.43, 'legacy risk denominator stays plan securities plus cash');
  assert.equal(Object.hasOwn(current.contributionPlan.baseAmounts, 'WMT'), false, 'outside-plan US holdings never become automatic weekly buys');
  assert.equal(await page.locator('.weekly-decision-target').count(), 0, 'weekly operation rows omit current-to-target holdings percentages');
  assert.equal(await page.locator('[data-weekly-allocation-symbol="SPY"]').getAttribute('aria-label'), 'SPY 每周基础投入比例');
  const unknown = await page.evaluate(() => window.__SUINVESTMENT_SIGNALS__.find(row => row.symbol === 'QNT'));
  assert.equal(unknown.risk_data_status, 'unknown');
  assert.equal(current.items.find(row => row.symbol === 'QNT').extraAmount, 0);
  assert.equal(current.items.find(row => row.symbol === 'QNT').crashFundAmount, 0);
  assert.match(await page.locator('[data-symbol="QNT"]').first().textContent(), /风险未知/);
  assert.match(await page.locator('#weeklyDecisionRows > [data-symbol="QNT"] .weekly-decision-status').textContent(), /风险未知/);
  evidence.checks.push('overweight SPY receives its 20% weekly Base of 10 from a funded Base of 50; holdings percentages do not appear in weekly rows; unknown history blocks enhancements');
  evidence.syntheticPlan = { base: current.contributionPlan.baseBudget, spyBase: current.contributionPlan.baseAmounts.SPY, planned: current.totalPlanned, eligibleSecurities: current.allocationContext.securitiesValue, legacySpyPct: risk.positions.SPY.current_allocation };
  await automaticHoldings(page, false, '', 1000);
  const moreCash = await plan(page);
  assert.deepEqual(moreCash.contributionPlan.baseAmounts, current.contributionPlan.baseAmounts);
  assert.deepEqual(moreCash.allocationContext.allocationsPct, current.allocationContext.allocationsPct);
  await automaticHoldings(page, false, '', 100, { ...usValues, SPY: 120 });
  const changedHoldings = await plan(page);
  assert.ok(await page.evaluate(() => window.__SUINVESTMENT_PORTFOLIO_RISK__.positions.SPY.current_allocation > 30), 'fixture exercises a material existing-holdings drift');
  assert.deepEqual(changedHoldings.contributionPlan.baseAmounts, current.contributionPlan.baseAmounts);
  assert.equal(changedHoldings.items.find(row => row.symbol === 'SPY').baseAmount, 10);
  assert.equal(changedHoldings.items.find(row => row.symbol === 'SPY').finalAmount, 10, 'large holdings drift does not pause or halve SPY weekly Base');
  evidence.checks.push('cash and holdings changes leave affordable weekly Base proportions unchanged');
  checkpoint('incomplete holdings');
  await automaticHoldings(page);
  for (const anomaly of ['unknown-value', 'identity-conflict']) {
    await automaticHoldings(page, false, anomaly);
    const uncertain = await plan(page);
    assert.equal(uncertain.contributionPlan.valid, true);
    assert.deepEqual(uncertain.contributionPlan.baseAmounts, current.contributionPlan.baseAmounts, 'uncertain holdings do not become a different weekly contribution allocation');
    assert.ok(uncertain.allocationContext.reasonCodes.some(code => code.startsWith(anomaly === 'unknown-value' ? 'HOLDING_VALUE_UNKNOWN:NVDA' : 'HOLDING_IDENTITY_CONFLICT:SPY')));
    assert.ok(uncertain.items.every(row => row.extraAmount === 0 && row.crashFundAmount === 0));
    assert.ok(uncertain.items.every(row => row.reasonCodes.includes('HOLDINGS_CONTEXT_UNAVAILABLE')));
  }
  await automaticHoldings(page);
  evidence.checks.push('null valuations and conflicting listing identities retain configured weekly contributions and disable all enhancements');

  checkpoint('draft save and reload');
  await openDraft(page);
  await page.locator('[data-draft-symbol="SPY"]').fill('19');
  await page.locator('#normalizeAllocationSuggestionBtn').click();
  assert.equal(Number(await page.locator('[data-draft-symbol="SPY"]').inputValue()), 19);
  assert.equal(await page.locator('#allocationSuggestionTotal').textContent(), '100.00%');
  await page.evaluate(() => {
    window.__smokeSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'su-investment-pro:portfolio') throw new DOMException('Fixture storage full', 'QuotaExceededError');
      return window.__smokeSetItem.call(this, key, value);
    };
  });
  await page.locator('#applyAllocationSuggestionBtn').click();
  await page.waitForFunction(() => document.querySelector('#allocationSuggestionStatus').textContent.includes('保存失败'));
  assert.equal(await stored(page), original);
  assert.equal(await page.locator('#allocationSuggestionDraft').isVisible(), true);
  await page.evaluate(() => { Storage.prototype.setItem = window.__smokeSetItem; delete window.__smokeSetItem; });
  await page.locator('#applyAllocationSuggestionBtn').click();
  await page.locator('#allocationSuggestionDraft').waitFor({ state: 'hidden' }); await ready(page);
  assert.ok(main.requests.includes('data/us-equity-search-index.json'), 'new KO/WMT are checked through the published index');
  const saved = await stored(page), savedRows = JSON.parse(saved);
  assert.equal(savedRows.length, 11);
  assert.equal(savedRows.find(row => row.symbol === 'SPY').allocation, .19);
  assert.equal(savedRows.reduce((sum, row) => sum + Math.round(row.allocation * 10000), 0), 10000);
  await page.reload(); await ready(page);
  assert.equal(await stored(page), saved);
  evidence.checks.push('storage failure retains draft and configuration; retry validates additions, saves SPY 19% and survives reload');
  await automaticHoldings(page, true);
  const emptyPlan = await plan(page);
  assert.equal(emptyPlan.allocationContext.securitiesValue, 0);
  assert.equal(emptyPlan.contributionPlan.baseAmounts.SPY, 9.5);
  assert.equal(emptyPlan.totalPlanned, 50, 'explicit complete empty holdings are distinct from unknown holdings');
  evidence.checks.push('saved SPY 19% survives reload and receives 9.50 from Base 50 with verified empty holdings');
  checkpoint('desktop and mobile layout');
  await fs.mkdir('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/dca-optimization-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await openDraft(page);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.screenshot({ path: 'output/playwright/dca-optimization-mobile.png', fullPage: true });
  assert.deepEqual(main.errors, []);
  await main.context.close();

  checkpoint('unpublished additions');
  const absent = await setup({ missingPublished: ['WMT'] });
  const beforeMissing = await stored(absent.page);
  await openDraft(absent.page); await absent.page.locator('#applyAllocationSuggestionBtn').click();
  await absent.page.waitForFunction(() => document.querySelector('#allocationSuggestionStatus').textContent.includes('WMT：'));
  assert.match(await absent.page.locator('#allocationSuggestionStatus').textContent(), /未在已发布股票池/);
  assert.equal(await stored(absent.page), beforeMissing);
  assert.equal(await absent.page.locator('#allocationSuggestionDraft').isVisible(), true);
  assert.deepEqual(absent.errors, []); await absent.context.close();
  evidence.checks.push('WMT missing from published index blocks application without changing saved configuration');

  checkpoint('hard drawdown');
  const hard = await setup({ hardDrawdown: true }); await automaticHoldings(hard.page);
  const hardPlan = await plan(hard.page);
  const nvda = hardPlan.items.find(row => row.symbol === 'NVDA');
  assert.equal(nvda.finalAmount, 0);
  assert.ok(nvda.reasonCodes.includes('ACTION_REQUIRES_ZERO_AMOUNT'));
  assert.equal(hardPlan.spyRedirected, 0);
  assert.equal(hardPlan.items.find(row => row.symbol === 'SPY').baseAmount, 10);
  assert.deepEqual(hard.errors, []); await hard.context.close();
  evidence.checks.push('35%+ drawdown hard block survives weekly contribution allocation; blocked cash is not redirected to SPY');

  checkpoint('zero weekly weight');
  const zero = await setup({ weights: { ...weeklyWeights, SPY: 0, QQQ: .35 } });
  await automaticHoldings(zero.page);
  const zeroPlan = await plan(zero.page);
  assert.equal(zeroPlan.contributionPlan.baseAmounts.SPY, 0);
  assert.equal(zeroPlan.items.find(row => row.symbol === 'SPY').baseAmount, 0);
  assert.equal(zeroPlan.items.find(row => row.symbol === 'SPY').finalAmount, 0);
  assert.equal(zeroPlan.spyRedirected, 0);
  assert.deepEqual(zero.errors, []); await zero.context.close();
  evidence.checks.push('a configured 0% weekly SPY weight stays zero after rounding and final planning');

  checkpoint('stale data');
  const badData = await setup({ stale: true }); await automaticHoldings(badData.page);
  const badPlan = await plan(badData.page);
  assert.equal(badPlan.safe, false);
  assert.equal(badPlan.totalPlanned, 0);
  assert.ok(badPlan.items.every(row => row.finalAmount === 0));
  assert.deepEqual(badData.errors, []); await badData.context.close();
  evidence.checks.push('one stale asset preserves the global data block');
  evidence.status = 'passed';
  await fs.writeFile('output/playwright/dca-optimization-smoke.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally { await browser.close(); }
