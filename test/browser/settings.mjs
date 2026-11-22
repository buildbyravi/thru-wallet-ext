// Optional Playwright regression, after npm run build:
// PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs CHROME_BIN=/path/to/chrome node test/browser/settings.mjs [dist]
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { PLAYWRIGHT_MODULE, CHROME_BIN } = process.env;
if (!PLAYWRIGHT_MODULE || !CHROME_BIN) throw new Error('Set PLAYWRIGHT_MODULE and CHROME_BIN.');
const { chromium } = await import(pathToFileURL(resolve(PLAYWRIGHT_MODULE)).href);
const root = resolve(process.argv[2] || 'dist'), origin = 'https://wallet-fixture.invalid';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const browser = await chromium.launch({ executablePath: CHROME_BIN });
try {
  for (const [width, theme, success] of [[400, 'light', true], [320, 'dark', false]]) {
    const page = await browser.newPage({ viewport: { width, height: 600 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(5000); const external = [], errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url()), path = resolve(root, `.${url.pathname}`);
      if (url.origin !== origin || !path.startsWith(`${root}/`) || !mime[extname(path)]) { external.push(url.href); return route.abort(); }
      await route.fulfill({ contentType: mime[extname(path)], body: await readFile(path) });
    });
    await page.addInitScript(theme => {
      const address = 'taDemoStudioFixture000000000000000000000000AA';
      const account = { address, label: 'Fixture wallet' }, network = { id: 'betanet', label: 'Betanet', isTestnet: true };
      const prefs = { theme, requirePasswordForSigning: false, sidePanelMode: false };
      const replies = { 'system.bootstrap': { contractVersion: 33, hasVault: true, unlocked: true, account, accounts: [account], keyrings: [], network, preferences: prefs, pending: [] },
        'settings.get': prefs, 'system.getAutoLock': 15, 'network.list': [network], 'network.getActive': network,
        'wallet.hasVault': true, 'wallet.isUnlocked': true, 'keyring.list': [], 'account.getActive': account, 'tx.checkHealth': { status: 'healthy' } };
      window.themeWrites = 0; globalThis.chrome ??= {};
      chrome.runtime = { onMessage: { addListener() {}, removeListener() {} }, getURL: path => `/${path}`,
        getManifest: () => ({ version: 'fixture' }), sendMessage({ method, params }, callback) {
          if (!callback) return Promise.resolve();
          if (method === 'settings.set' && params?.patch?.theme) {
            window.themeWrites++; window.finishTheme = ok => {
              if (ok) { prefs.theme = params.patch.theme; callback({ ok: true, data: { ...prefs } }); }
              else callback({ ok: false, error: { code: 'FIXTURE_ERROR', message: 'Fixture theme failure' } });
            }; return;
          }
          queueMicrotask(() => callback(Object.hasOwn(replies, method) ? { ok: true, data: structuredClone(replies[method]) }
            : { ok: false, error: { code: 'UNSUPPORTED', message: 'Unavailable in fixture' } }));
        } };
    }, theme);
    await page.goto(`${origin}/popup.html#/settings`);
    const row = page.getByRole('button', { name: /^Theme Mode/ }); await row.waitFor();
    for (const name of ['Language Planned', 'Currency Planned']) assert.equal(await page.getByRole('button', { name, exact: true }).isDisabled(), true);
    assert.equal(await page.locator('.settings-footer img').getAttribute('src'), 'icons/icon128.png');
    await row.focus(); await page.keyboard.press('Enter');
    let dialog = page.getByRole('dialog', { name: 'Theme Mode' });
    const option = success ? 'Dark' : 'Light';
    await dialog.getByRole('button', { name: option, exact: true }).click();
    assert.equal(await page.evaluate(() => window.themeWrites), 1);
    assert.equal(await dialog.getByRole('button', { name: option, exact: true }).getAttribute('aria-disabled'), 'true');
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    assert.ok(await row.evaluate(el => el === document.activeElement));
    await row.click(); dialog = page.getByRole('dialog', { name: 'Theme Mode' });
    await dialog.getByRole('button', { name: option, exact: true }).dispatchEvent('click');
    assert.equal(await page.evaluate(() => window.themeWrites), 1, 'reopened picker cannot duplicate save');
    await page.evaluate(success => window.finishTheme(success), success);
    if (success) {
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
      assert.equal(await dialog.getByRole('button', { name: 'Dark', exact: true }).getAttribute('aria-pressed'), 'true');
      await page.keyboard.press('Escape');
    } else {
      await dialog.getByRole('alert').filter({ hasText: 'Fixture theme failure' }).waitFor();
      assert.equal(await dialog.getByRole('button', { name: 'Dark', exact: true }).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
      await page.keyboard.press('Escape');
    }
    await dialog.waitFor({ state: 'detached' });
    for (const [pattern, name, choice, prompt] of [[/^Auto-lock time/, 'Auto-lock time', 'Never', 'Disable auto-lock?'], [/^Signing security/, 'Signing security', 'Require password', 'Require password for signing']]) {
      const control = page.getByRole('button', { name: pattern }); await control.click();
      const picker = page.getByRole('dialog', { name, exact: true }); await picker.getByRole('button', { name: choice, exact: true }).click();
      await picker.waitFor({ state: 'detached' }); const confirmation = page.getByRole('dialog', { name: prompt }); await confirmation.waitFor();
      assert.equal(await page.getByRole('dialog').count(), 1); await page.keyboard.press('Escape'); await confirmation.waitFor({ state: 'detached' });
      assert.ok(await control.evaluate(el => el === document.activeElement));
    }
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    console.log(`PASS ${width}x600 ${theme}: theme ${success ? 'success' : 'failure'} across reopen, password dialogs, focus, planned rows, wallet logo`);
    await page.close();
  }
} finally { await browser.close(); }
