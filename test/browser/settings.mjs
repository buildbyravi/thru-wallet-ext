// Optional Playwright regression, after npm run build:
// PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs CHROME_BIN=/path/to/chrome node test/browser/settings.mjs [dist]
import assert from 'node:assert/strict';
import { chromium, CHROME_BIN, origin, routeFixture } from './helpers/fixture.mjs';
const browser = await chromium.launch({ executablePath: CHROME_BIN });
try {
  for (const [width, height, theme, success] of [[400, 600, 'light', true], [320, 445, 'dark', false]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(5000); const external = [], errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await routeFixture(page, external);
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
    const themeOptions = dialog.locator('.settings-option');
    assert.equal(await themeOptions.count(), 3);
    const geometry = await themeOptions.evaluateAll(els => els.map(el => {
      const r = el.getBoundingClientRect(); const parent = el.parentElement.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, parentWidth: parent.width };
    }));
    assert.ok(geometry.every(r => r.height >= 44 && Math.abs(r.width - r.parentWidth) < 1));
    assert.ok(geometry.every((r, i) => i === 0 || r.y >= geometry[i - 1].y + geometry[i - 1].height));
    assert.equal(await dialog.getByRole('button', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true }).getAttribute('aria-pressed'), 'true');
    if (width === 400) await page.screenshot({ path: 'dist/settings-preview.png' });
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
      const picker = page.getByRole('dialog', { name, exact: true });
      await picker.getByRole('button', { name: choice, exact: true }).waitFor();
      const options = picker.locator('.settings-option');
      assert.equal(await options.count(), name === 'Auto-lock time' ? 7 : 2);
      assert.equal(await options.filter({ has: page.locator('[aria-hidden="true"]') }).count(), await options.count());
      const rows = await options.evaluateAll(els => els.map(el => ({ width: el.getBoundingClientRect().width, parent: el.parentElement.getBoundingClientRect().width, height: el.getBoundingClientRect().height })));
      assert.ok(rows.every(r => r.height >= 44 && Math.abs(r.width - r.parent) < 1));
      assert.equal(await picker.locator('.settings-option[aria-pressed="true"]').count(), 1);
      await options.last().scrollIntoViewIfNeeded();
      const lastVisible = await options.last().evaluate(el => {
        const r = el.getBoundingClientRect(), viewport = el.closest('[role="dialog"]').getBoundingClientRect();
        return r.top >= viewport.top && r.bottom <= viewport.bottom && r.bottom <= innerHeight;
      });
      assert.ok(lastVisible, 'last choice can be scrolled into the visible sheet');
      await picker.getByRole('button', { name: choice, exact: true }).click();
      await picker.waitFor({ state: 'detached' }); const confirmation = page.getByRole('dialog', { name: prompt }); await confirmation.waitFor();
      assert.equal(await page.getByRole('dialog').count(), 1); await page.keyboard.press('Escape'); await confirmation.waitFor({ state: 'detached' });
      assert.ok(await control.evaluate(el => el === document.activeElement));
    }
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    console.log(`PASS ${width}x${height} ${theme}: full-width choices, theme ${success ? 'success' : 'failure'} across reopen, password dialogs, focus, planned rows`);
    await page.close();
  }
} finally { await browser.close(); }
