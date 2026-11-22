// Optional Playwright regression, run after npm run build:
// PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs CHROME_BIN=/path/to/chrome node test/browser/history-controls.mjs [dist]
import assert from 'node:assert/strict';
import { chromium, CHROME_BIN, origin, routeFixture } from './helpers/fixture.mjs';
const signature = 'tssFxFSNJAQzk7kAYMFxe8P0WHn36HQ-jZi018a3FUBM6n_P19wMZFcNEwul8vZicXYacEeU2kGOr8-WqEx82JCB28';
const explorer = `https://scan.thru.org/tx/${signature}?network=betanet`;
const browser = await chromium.launch({ executablePath: CHROME_BIN });
try {
  for (const [width, height, theme] of [[320, 445, 'light'], [400, 600, 'dark']]) {
    const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    const external = [], errors = [];

    await routeFixture(ctx, external, { interceptExternal: true });
    await ctx.addInitScript(({ theme, signature }) => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.copied = value; } } });
      const address = 'taDemoStudioFixture000000000000000000000000AA';
      const account = { address, label: 'Fixture wallet', balance: '0' };
      const network = { id: 'betanet', label: 'Betanet', isTestnet: true, explorerUrl: 'https://scan.thru.org', faucetProgramId: 'fixture-program', faucetStateAccount: 'fixture-state', faucetMaxPerClaim: '10000' };
      const entry = { signature, slot: '249967', success: true, kind: 'other', timestamp: null };
      const replies = { 'system.bootstrap': { contractVersion: 33, hasVault: true, unlocked: true, account, accounts: [account], keyrings: [], network, preferences: { theme }, pending: [] },
        'settings.get': { theme }, 'wallet.hasVault': true, 'wallet.isUnlocked': true, 'keyring.list': [], 'account.list': [account], 'account.getActive': account,
        'network.getActive': network, 'tx.checkHealth': { status: 'healthy' }, 'tx.getPending': [],
        'tx.getCachedHistory': { networkId: network.id, address, entries: [entry], nextCursor: null },
        'tx.getHistoryFeed': { entries: [entry], nextCursor: null, synced: false },
        'tx.getDetail': { ...entry, supported: true, feeDeclaredUnits: null, feeCharged: false, blockTimeMs: null } };
      globalThis.chrome ??= {};
      chrome.runtime = { onMessage: { addListener() {}, removeListener() {} }, getURL: path => `/${path}`,
        sendMessage({ method }, callback) { if (!callback) return Promise.resolve(); queueMicrotask(() => callback(Object.hasOwn(replies, method)
          ? { ok: true, data: structuredClone(replies[method]) } : { ok: false, error: { code: 'UNSUPPORTED', message: 'Unavailable in fixture' } })); } };
    }, { theme, signature });
    const page = await ctx.newPage(); page.setDefaultTimeout(5000); page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${origin}/popup.html#/history`);
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await page.getByText('Cached · Sync unavailable', { exact: true }).waitFor();
    assert.equal(await page.getByText(/Showing cached activity/).count(), 0);
    const filters = page.getByRole('group', { name: 'History filters' });
    await filters.getByRole('button', { name: 'All', exact: true }).waitFor();
    assert.deepEqual(await filters.getByRole('button').allTextContents(), ['All', 'Sent', 'Received', 'Failed']);
    const allFilter = filters.getByRole('button', { name: 'All', exact: true });
    const sentFilter = filters.getByRole('button', { name: 'Sent', exact: true });
    assert.equal(await allFilter.getAttribute('aria-pressed'), 'true');
    assert.equal(await sentFilter.getAttribute('aria-pressed'), 'false');
    await sentFilter.click();
    assert.equal(await sentFilter.getAttribute('aria-pressed'), 'true');
    assert.equal(await allFilter.getAttribute('aria-pressed'), 'false');
    await allFilter.click();
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
    await page.goto(`${origin}/popup.html#/faucet`);
    const amount = page.getByLabel('Claim amount'); await amount.waitFor();
    assert.equal(await amount.inputValue(), '0.00001 THRU');
    assert.equal(await amount.getAttribute('readonly'), '');
    assert.equal(await page.getByText(/Fixed claim of|paid to your active account|no gas required to claim/i).count(), 0);
    await page.getByRole('button', { name: 'Claim', exact: true }).waitFor();
    assert.deepEqual(errors, []); assert.deepEqual(external, [explorer]);
    await ctx.close(); console.log(`PASS ${width}x${height} ${theme}: History controls and cached status; Faucet amount without extra copy`);
  }
} finally { await browser.close(); }
