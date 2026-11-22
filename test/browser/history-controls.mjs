// Optional Playwright regression, run after npm run build:
// PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs CHROME_BIN=/path/to/chrome node test/browser/history-controls.mjs [dist]
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { PLAYWRIGHT_MODULE, CHROME_BIN } = process.env;
if (!PLAYWRIGHT_MODULE || !CHROME_BIN) throw new Error('Set PLAYWRIGHT_MODULE and CHROME_BIN.');
const { chromium } = await import(pathToFileURL(resolve(PLAYWRIGHT_MODULE)).href);
const root = resolve(process.argv[2] || 'dist'), origin = 'https://wallet-fixture.invalid';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const signature = 'tssFxFSNJAQzk7kAYMFxe8P0WHn36HQ-jZi018a3FUBM6n_P19wMZFcNEwul8vZicXYacEeU2kGOr8-WqEx82JCB28';
const explorer = `https://scan.thru.org/tx/${signature}?network=betanet`;
const browser = await chromium.launch({ executablePath: CHROME_BIN });
try {
  for (const [width, height, theme] of [[320, 445, 'light'], [400, 600, 'dark']]) {
    const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    const external = [], errors = [];
    await ctx.route('**/*', async route => {
      const url = new URL(route.request().url()), path = resolve(root, `.${url.pathname}`);
      if (url.origin !== origin) { external.push(url.href); return route.fulfill({ contentType: 'text/plain', body: 'Navigation intercepted by fixture' }); }
      if (!path.startsWith(`${root}/`) || !mime[extname(path)]) throw new Error(`Unexpected fixture path: ${url.href}`);
      await route.fulfill({ contentType: mime[extname(path)], body: await readFile(path) });
    });
    await ctx.addInitScript(({ theme, signature }) => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.copied = value; } } });
      const address = 'taDemoStudioFixture000000000000000000000000AA';
      const account = { address, label: 'Fixture wallet', balance: '0' };
      const network = { id: 'betanet', label: 'Betanet', isTestnet: true, explorerUrl: 'https://scan.thru.org' };
      const entry = { signature, slot: '249967', success: true, kind: 'other', timestamp: null };
      const replies = { 'system.bootstrap': { contractVersion: 33, hasVault: true, unlocked: true, account, accounts: [account], keyrings: [], network, preferences: { theme }, pending: [] },
        'settings.get': { theme }, 'wallet.hasVault': true, 'wallet.isUnlocked': true, 'keyring.list': [], 'account.list': [account], 'account.getActive': account,
        'network.getActive': network, 'tx.checkHealth': { status: 'healthy' }, 'tx.getPending': [],
        'tx.getCachedHistory': { networkId: network.id, address, entries: [entry], nextCursor: null },
        'tx.getHistoryFeed': { entries: [entry], nextCursor: null, synced: true },
        'tx.getDetail': { ...entry, supported: true, feeDeclaredUnits: null, feeCharged: false, blockTimeMs: null } };
      globalThis.chrome ??= {};
      chrome.runtime = { onMessage: { addListener() {}, removeListener() {} }, getURL: path => `/${path}`,
        sendMessage({ method }, callback) { if (!callback) return Promise.resolve(); queueMicrotask(() => callback(Object.hasOwn(replies, method)
          ? { ok: true, data: structuredClone(replies[method]) } : { ok: false, error: { code: 'UNSUPPORTED', message: 'Unavailable in fixture' } })); } };
    }, { theme, signature });
    const page = await ctx.newPage(); page.setDefaultTimeout(5000); page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${origin}/popup.html#/history`);
    const filters = page.getByRole('group', { name: 'History filters' });
    await filters.getByRole('button', { name: 'All', exact: true }).waitFor();
    assert.deepEqual(await filters.getByRole('button').allTextContents(), ['All', 'Sent', 'Received', 'Failed']);
    const layout = await filters.getByRole('button').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return [r.y, r.height, r.right]; }));
    assert.equal(new Set(layout.map(x => x[0])).size, 1);
    assert.ok(layout.every(([, h, right]) => h >= 30 && right <= width));
    assert.equal(await page.locator('h2.list-group-header').count(), 0, 'no date group headings');
    const card = page.getByRole('article').first();
    const link = card.getByRole('link', { name: /View on explorer/ });
    const copy = card.getByRole('button', { name: 'Copy transaction signature' });
    const details = card.getByRole('button', { name: /transaction details/ });
    const dialog = page.getByRole('dialog', { name: /Transaction detail/ });
    await link.focus(); await page.keyboard.press('Tab');
    assert.ok(await copy.evaluate(el => el === document.activeElement));
    await page.keyboard.press('Space'); assert.equal(await page.evaluate(() => window.copied), signature);
    assert.equal(await dialog.count(), 0, 'copy does not open details');
    await page.keyboard.press('Tab'); assert.ok(await details.evaluate(el => el === document.activeElement));
    assert.equal(await details.locator('a, button').count(), 0, 'no interactive elements nested in details button');
    for (const key of ['Enter', 'Space']) {
      await page.keyboard.press(key); await dialog.waitFor(); await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' }); assert.ok(await details.evaluate(el => el === document.activeElement));
    }
    assert.equal(await link.getAttribute('href'), explorer); assert.deepEqual(external, []);
    await link.focus(); const opened = ctx.waitForEvent('page'); await page.keyboard.press('Enter');
    const tab = await opened; await tab.waitForURL(explorer);
    assert.equal(await dialog.count(), 0); assert.deepEqual(external, [explorer]); assert.deepEqual(errors, []);
    await ctx.close(); console.log(`PASS ${width}x${height} ${theme}: flat History, filters, independent link/copy/details, focus, intercepted explorer`);
  }
} finally { await browser.close(); }
