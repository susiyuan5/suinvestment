const test = require('node:test');
const assert = require('node:assert/strict');
const refresh = require('../research-refresh.js');

test('refresh controller whitelists tasks and blocks duplicate/cooldown runs', async () => {
  const calls = []; let clock = 1000; const store = new Map();
  const controller = refresh.createController({ now: () => clock, cooldownMs: 60000, gatewayUrl: 'https://gateway.example', storage: { getItem: (key) => store.get(key) || null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) }, fetcher: async (url) => { calls.push(url); return { ok: true, json: async () => ({ run_id: 'r1', status: 'queued' }) }; } });
  await controller.request('today');
  assert.equal(calls[0], 'https://gateway.example/refresh/today');
  await assert.rejects(() => controller.request('today'), /refresh_cooldown_or_running/);
  assert.equal(controller.canStart('unknown'), false);
  clock += 60001; controller.mark({ status: 'success' }); assert.equal(controller.canStart('universe'), true);
});

test('published results use cache busting and authorization is not persisted by default', async () => {
  const store = new Map(); let requested = '';
  const controller = refresh.createController({ storage: { getItem: (key) => store.get(key) || null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) }, fetcher: async (url) => { requested = url; return { ok: true, json: async () => ({ research_only: true }) }; } });
  controller.setSecret('user-secret', false); assert.equal(controller.getSecret(), 'user-secret');
  await controller.published('/result.json', 'abc'); assert.match(requested, /result\.json\?v=abc/); controller.clearSecret(); assert.equal(controller.getSecret(), '');
});
