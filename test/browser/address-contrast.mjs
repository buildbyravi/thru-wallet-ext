// Optional Chromium regression. PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs
// CHROME_BIN=/path/to/chrome node test/browser/address-contrast.mjs [dist]
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
  for (const theme of ['dark', 'light']) {
    const page = await browser.newPage({ viewport: { width: 400, height: 600 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(4000);
    const errors = [], external = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url()), path = resolve(root, `.${url.pathname}`);
      if (url.origin !== origin || !path.startsWith(`${root}/`) || !mime[extname(path)]) { external.push(url.href); return route.abort(); }
      await route.fulfill({ contentType: mime[extname(path)], body: await readFile(path) });
    });
    await page.addInitScript((theme) => {
      const address = 'taDemoStudioFixture000000000000000000000000AA';
      const ring = { id: 'fixture', type: 'seed', label: 'Fixture seed' };
      const account = { address, label: 'Fixture wallet', keyring: ring, ref: { keyringId: 'fixture', accountIndex: 0 } };
      const network = { id: 'betanet', label: 'Betanet', isTestnet: true };
      const token = { mintAddress: 'taFixtureMint0000000000000000000000000000000', symbol: 'LAB', decimals: 6, hidden: false };
      const replies = { 'system.bootstrap': { contractVersion: 33, hasVault: true, unlocked: true, account, accounts: [account], keyrings: [ring], network, preferences: { theme }, pending: [] },
        'settings.get': { theme }, 'keyring.list': [ring], 'account.list': [account], 'account.getActiveRef': account.ref,
        'wallet.hasVault': true, 'wallet.isUnlocked': true, 'network.getActive': network, 'account.getActive': account,
        'token.list': [token], 'token.discover': { adopted: [] }, 'token.getCachedBalances': { networkId: 'betanet', balances: [{ ...token, amountUnits: '0', tokenAccountExists: true, error: false }] },
        'tx.getPending': [], 'tx.getAccountInfo': { balance: '0', exists: true }, 'tx.checkHealth': { status: 'healthy' }, 'tx.getCachedBalances': {}, 'tx.getBalances': {} };
      globalThis.chrome ??= {};
      chrome.runtime = { onMessage: { addListener() {}, removeListener() {} }, getURL: path => `/${path}`,
        sendMessage({ method }, cb) { if (!cb) return Promise.resolve(); queueMicrotask(() => cb(Object.hasOwn(replies, method)
          ? { ok: true, data: structuredClone(replies[method]) } : { ok: false, error: { code: 'UNSUPPORTED', message: 'Fixture' } })); } };
    }, theme);
    const contrast = async (text, background) => text.evaluate((el, bgSelector) => {
      const values = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
      const luminance = rgb => rgb.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; })
        .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      const color = values(getComputedStyle(el).color);
      const bg = values(getComputedStyle(el.closest(bgSelector)).backgroundColor);
      const a = luminance(color), b = luminance(bg);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    }, background);
    await page.goto(`${origin}/popup.html#/dashboard`);
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    const head = page.locator('.account-pill-address .mono'); await head.waitFor();
    assert.equal(await head.evaluate(el => getComputedStyle(el).color),
      await head.evaluate(el => getComputedStyle(el.parentElement).color), 'dashboard header preserves its contrast-specific inherited color');
    await page.getByRole('button', { name: 'Open token list' }).click();
    const token = page.locator('.token-ledger-row').filter({ has: page.locator('.token-row-symbol', { hasText: 'LAB' }) });
    const tokenAddress = token.locator('.mono'); await tokenAddress.waitFor();
    for (const hover of [false, true]) {
      if (hover) await token.hover();
      const ratio = await contrast(tokenAddress, '.token-ledger-row');
      assert.ok(ratio >= 4.5, `${theme} token address ${hover ? 'hover' : 'normal'} contrast ${ratio}`);
    }
    assert.equal(await tokenAddress.getAttribute('aria-label'), 'taFixtureMint0000000000000000000000000000000');
    await page.locator('.token-drawer-close').first().click();
    await page.locator('.account-pill').click();
    const row = page.locator('.row-content-btn').first();
    const address = row.locator('.mono'); await address.waitFor();
    for (const hover of [false, true]) {
      if (hover) await row.hover();
      const ratio = await contrast(address, '.row');
      assert.ok(ratio >= 4.5, `${theme} account address ${hover ? 'hover' : 'normal'} contrast ${ratio}`);
    }
    assert.equal(await address.getAttribute('aria-label'), 'taDemoStudioFixture000000000000000000000000AA');
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    console.log(`PASS ${theme}: token and account address contrast, hover, accessible full address, dashboard header inheritance`);
    await page.close();
  }
} finally { await browser.close(); }
