// Optional browser regression: PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs
// CHROME_BIN=/path/to/chrome node test/browser/network-chooser.mjs [dist]
import assert from 'node:assert/strict';
import { chromium, CHROME_BIN, origin, routeFixture } from './helpers/fixture.mjs';
const browser = await chromium.launch({ executablePath: CHROME_BIN });
try {
  for (const [width, height, theme] of [[320, 445, 'light'], [400, 600, 'dark']]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(5000);
    const errors = [], unexpected = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await routeFixture(page, unexpected);
    await page.addInitScript(theme => {
      const address = 'taDemoStudioFixture000000000000000000000000AA';
      const account = { address, balance: '0', label: 'Fixture' };
      let active = { id: 'betanet', label: 'Betanet', isTestnet: true };
      const next = { id: 'testnet', label: 'Fixture testnet', isTestnet: true, selectable: true };
      const custom = { id: 'custom', label: 'Fixture custom', custom: true, selectable: false };
      const data = { 'system.bootstrap': { contractVersion: 33, hasVault: true, unlocked: true, account, accounts: [account], keyrings: [], network: active, preferences: { theme }, pending: [] },
        'system.getAutoLock': 15, 'settings.get': { theme }, 'keyring.list': [], 'wallet.hasVault': true, 'wallet.isUnlocked': true,
        'account.getActive': account, 'token.list': [], 'token.discover': { adopted: [] }, 'token.getCachedBalances': null,
        'tx.getPending': [], 'tx.getAccountInfo': { balance: '0', exists: true }, 'tx.checkHealth': { status: 'healthy' }, 'tx.getCachedBalances': {} };
      globalThis.switchCalls = 0;
      globalThis.chrome ??= {};
      chrome.runtime = { onMessage: { addListener() {}, removeListener() {} }, getURL: (path) => `/${path}`,
        getManifest: () => ({ version: 'fixture' }), sendMessage({ method }, callback) {
          if (!callback) return Promise.resolve();
          if (method === 'network.setActive') {
            globalThis.switchCalls++;
            globalThis.finishSwitch = (success) => {
              if (success) { active = next; callback({ ok: true, data: next }); }
              else callback({ ok: false, error: { code: 'FAIL', message: 'Fixture switch failed' } });
            }; return;
          }
          const value = method === 'network.getActive' ? active : method === 'network.list' ? [active, next, custom] : data[method];
          queueMicrotask(() => callback(value !== undefined ? { ok: true, data: structuredClone(value) }
            : { ok: false, error: { code: 'UNSUPPORTED', message: 'Unavailable in fixture' } }));
        } };
    }, theme);
    await page.goto(`${origin}/popup.html?theme=${theme}#/dashboard`);
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    const opener = page.getByRole('button', { name: /Active network Betanet; choose network/ });
    await opener.waitFor(); await opener.focus(); await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Choose network' });
    await dialog.getByRole('heading', { name: 'Choose network' }).waitFor();
    assert.match(page.url(), /#\/dashboard$/);
    assert.equal(await dialog.getByText('Fixture custom').evaluate(el => el.closest('.row').getAttribute('aria-disabled')), 'true');
    const choice = dialog.getByRole('button', { name: /Fixture testnet/ });
    await choice.focus(); await page.keyboard.press('Enter');
    await dialog.getByRole('status').filter({ hasText: 'Switching to Fixture testnet' }).waitFor();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.switchCalls), 1);
    await page.keyboard.press('Escape');
    assert.equal(await dialog.count(), 1, 'pending switch cannot be dismissed and restarted');
    assert.equal(await choice.getAttribute('aria-disabled'), 'true');
    assert.equal(await choice.evaluate(el => document.activeElement === el), true);
    await page.evaluate(() => window.finishSwitch(false));
    await dialog.getByRole('alert').filter({ hasText: 'Fixture switch failed' }).waitFor();
    assert.equal(await choice.evaluate(el => document.activeElement === el), true);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    assert.equal(await opener.evaluate(el => document.activeElement === el), true);
    await opener.click(); await choice.waitFor(); await choice.click();
    await page.evaluate(() => window.finishSwitch(true)); await dialog.waitFor({ state: 'detached' });
    assert.match(page.url(), /#\/dashboard$/);
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    console.log(`PASS ${width}x${height} ${theme}: dialog, quarantine, pending, duplicate suppression, failure, focus, success`);
    await page.close();
  }
} finally { await browser.close(); }
