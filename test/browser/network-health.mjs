// Isolated health-indicator browser regression; no real RPC or vault.
// PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs CHROME_BIN=/path/to/chrome node test/browser/network-health.mjs [dist]
import assert from 'node:assert/strict';
import { chromium, CHROME_BIN, origin, routeFixture } from './helpers/fixture.mjs';
const browser = await chromium.launch({ executablePath: CHROME_BIN });
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 600 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(7000); const unexpected = [], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await routeFixture(page, unexpected);
  await page.addInitScript(() => {
    const account = { address: 'taDemoStudioFixture000000000000000000000000AA', label: 'Fixture', balance: '0' };
    const networks = { betanet: { id: 'betanet', label: 'Betanet', isTestnet: true }, testnet: { id: 'testnet', label: 'Fixture testnet', isTestnet: true } };
    let active = networks.betanet;
    const listeners = new Set();
    window.healthMode = 'offline'; window.healthCalls = 0;
    window.changeNetwork = (id) => { active = networks[id]; for (const f of listeners) f({ type: 'EVENT', event: 'networkChanged', data: active }, {}); };
    const replies = { 'system.bootstrap': { contractVersion: 33, hasVault: true, unlocked: true, account, accounts: [account], keyrings: [], network: active, preferences: { theme: 'light' }, pending: [] },
      'settings.get': { theme: 'light' }, 'wallet.hasVault': true, 'wallet.isUnlocked': true, 'keyring.list': [], 'account.getActive': account,
      'tx.getPending': [], 'token.list': [], 'token.discover': { adopted: [] }, 'token.getCachedBalances': null,
      'tx.getAccountInfo': { exists: true, balance: '0' }, 'tx.getCachedBalances': {} };
    globalThis.chrome ??= {};
    chrome.runtime = { onMessage: { addListener(f) { listeners.add(f); }, removeListener(f) { listeners.delete(f); } }, getURL: path => `/${path}`,
      sendMessage({ method }, cb) {
        if (!cb) return Promise.resolve();
        if (method === 'network.getActive') { queueMicrotask(() => cb({ ok: true, data: structuredClone(active) })); return; }
        if (method === 'tx.checkHealth') {
          window.healthCalls++;
          if (window.healthMode === 'held') { window.finishOldHealth = () => cb({ ok: true, data: { status: 'healthy', latencyMs: 11 } }); return; }
          const data = window.healthMode === 'healthy' ? { status: 'healthy', latencyMs: 27 } : { status: 'offline', latencyMs: null };
          queueMicrotask(() => cb({ ok: true, data })); return;
        }
        queueMicrotask(() => cb(Object.hasOwn(replies, method) ? { ok: true, data: structuredClone(replies[method]) }
          : { ok: false, error: { code: 'UNSUPPORTED', message: 'Unavailable in fixture' } }));
      } };
  });
  await page.goto(`${origin}/popup.html#/dashboard`);
  const badge = page.locator('.current-connection-net');
  await badge.getByText('offline', { exact: true }).waitFor();
  // A transient failed startup probe should not leave the indicator stale indefinitely.
  await page.evaluate(() => { window.healthMode = 'healthy'; });
  await badge.getByText('27ms', { exact: true }).waitFor({ timeout: 6000 });
  const calls = await page.evaluate(() => window.healthCalls); assert.ok(calls >= 2);
  // A delayed result for the old network must never paint over a newer network's result.
  await page.evaluate(() => { window.healthMode = 'held'; window.dispatchEvent(new Event('online')); });
  await page.waitForFunction(() => typeof window.finishOldHealth === 'function');
  await page.evaluate(() => { window.healthMode = 'offline'; window.changeNetwork('testnet'); });
  await badge.getByText('Fixture testnet').waitFor(); await badge.getByText('offline', { exact: true }).waitFor();
  await page.evaluate(() => window.finishOldHealth());
  await page.waitForTimeout(50);
  assert.equal(await badge.getByText('11ms', { exact: true }).count(), 0);
  assert.equal(await badge.getByText('offline', { exact: true }).count(), 1);
  await page.evaluate(() => { window.healthMode = 'healthy'; window.dispatchEvent(new Event('online')); });
  await badge.getByText('27ms', { exact: true }).waitFor();
  // Do not leave background retries running when the dashboard is no longer visible.
  await page.evaluate(() => { window.healthMode = 'offline'; window.dispatchEvent(new Event('online')); });
  await badge.getByText('offline', { exact: true }).waitFor();
  await page.evaluate(() => { location.hash = '#/settings'; });
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
  const afterLeaving = await page.evaluate(() => window.healthCalls);
  await page.waitForTimeout(3300);
  assert.equal(await page.evaluate(() => window.healthCalls), afterLeaving, 'pending retry stops away from dashboard');
  await page.evaluate(() => { window.healthMode = 'healthy'; location.hash = '#/dashboard'; });
  await badge.getByText('27ms', { exact: true }).waitFor();
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  console.log('PASS: transient offline recovers; online, route lifecycle and stale-network response guarded; no external requests');
  await page.close();
} finally { await browser.close(); }
