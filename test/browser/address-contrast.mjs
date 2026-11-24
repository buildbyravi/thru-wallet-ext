// Optional Chromium regression. PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs
// CHROME_BIN=/path/to/chrome node test/browser/address-contrast.mjs [dist]
import assert from 'node:assert/strict';
import { chromium, CHROME_BIN, origin, routeFixture } from './helpers/fixture.mjs';
const browser = await chromium.launch({ executablePath: CHROME_BIN });
try {
  for (const theme of ['dark', 'light']) {
    const page = await browser.newPage({ viewport: { width: 400, height: 600 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(4000);
    const errors = [], external = [];
    page.on('pageerror', e => errors.push(e.message));

    await routeFixture(page, external);
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
      const parseRgba = str => {
        const parts = str.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
        if (!parts) throw new Error('Unsupported computed color requires pixel verification.');
        return [Number(parts[1]), Number(parts[2]), Number(parts[3]), parts[4] === undefined ? 1 : Number(parts[4])];
      };
      const luminance = rgb => rgb.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; })
        .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
       if (!el.closest(bgSelector)) throw new Error('Contrast surface is missing.');
       const over = (top, bottom) => {
         const alpha = top[3] + bottom[3] * (1 - top[3]);
         return alpha === 0 ? [0, 0, 0, 0] : [
           ...top.slice(0, 3).map((channel, i) =>
             (channel * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / alpha), alpha,
         ];
       };
       let foreground = parseRgba(getComputedStyle(el).color), backdrop = [0, 0, 0, 0];
       for (let current = el; current; current = current.parentElement) {
         const style = getComputedStyle(current);
         if (style.backgroundImage !== 'none' && (foreground[3] < 1 || backdrop[3] < 1)) {
           throw new Error('Contrast over a background image requires pixel verification.');
         }
         const paint = parseRgba(style.backgroundColor);
         foreground = over(foreground, paint);
         backdrop = over(backdrop, paint);
         foreground[3] *= Number(style.opacity);
         backdrop[3] *= Number(style.opacity);
       }
       const canvas = [255, 255, 255, 1];
       const a = luminance(over(foreground, canvas).slice(0, 3));
       const b = luminance(over(backdrop, canvas).slice(0, 3));
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    }, background);
    await page.goto(`${origin}/popup.html#/dashboard`);
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await page.evaluate(() => {
      const outer = document.createElement('div');
      outer.id = 'contrast-controls';
      outer.style.position = 'fixed'; outer.style.left = '-1000px';
      outer.style.backgroundColor = 'rgb(0, 0, 0)';
      const samples = [
        ['opaque-pass', 'rgb(255, 255, 255)', 'transparent', '1'],
        ['opaque-fail', 'rgb(100, 100, 100)', 'transparent', '1'],
        ['text-alpha-fail', 'rgba(255, 255, 255, 0.1)', 'transparent', '1'],
        ['ancestor-alpha-fail', 'rgb(255, 255, 255)', 'rgba(255, 255, 255, 0.8)', '1'],
        ['group-opacity', 'rgb(255, 255, 255)', 'rgb(0, 0, 0)', '0.5'],
      ];
      for (const [id, color, background, opacity] of samples) {
        const layer = document.createElement('div');
        layer.style.backgroundColor = background; layer.style.opacity = opacity;
        const text = document.createElement('span'); text.id = id; text.textContent = 'Contrast control';
        text.style.color = color; layer.append(text); outer.append(layer);
      }
      document.body.append(outer);
    });
    const controls = [
      ['opaque-pass', 21, true], ['opaque-fail', 3.5487536087, false],
      ['text-alpha-fail', 1.2004565115, false], ['ancestor-alpha-fail', 1.6059285649, false],
      ['group-opacity', 5.2808228096, true],
    ];
    for (const [id, expected, passes] of controls) {
      const ratio = await contrast(page.locator(`#${id}`), '#contrast-controls');
      assert.ok(Math.abs(ratio - expected) < 1e-6, `${id}: independently specified ratio ${ratio}`);
      assert.equal(ratio >= 4.5, passes, `${id}: contrast threshold negative control`);
    }
    const unsupported = page.locator('#opaque-pass');
    await unsupported.evaluate(el => { el.style.backgroundImage = 'linear-gradient(black, white)'; });
    await assert.rejects(() => contrast(unsupported, '#contrast-controls'), /background image requires pixel verification/);
    await unsupported.evaluate(el => {
      el.style.backgroundImage = 'none'; el.style.color = 'color(srgb 1 1 1)';
    });
    await assert.rejects(() => contrast(unsupported, '#contrast-controls'), /Unsupported computed color/);
    await page.locator('#contrast-controls').evaluate(el => el.remove());
    const head = page.locator('.account-pill-address .mono'); await head.waitFor();
    assert.equal(await head.evaluate(el => getComputedStyle(el).color),
      await head.evaluate(el => getComputedStyle(el.parentElement).color), 'dashboard header preserves its contrast-specific inherited color');
    await page.getByRole('button', { name: 'Open token list' }).click();
    const token = page.locator('.token-ledger-row').filter({ has: page.locator('.token-row-symbol', { hasText: 'LAB' }) });
    const tokenAddress = token.locator('.mono'); await tokenAddress.waitFor();
    await page.waitForFunction(() => {
      for (let el = document.querySelector('.token-ledger-row .mono'); el; el = el.parentElement) {
        if (Number(getComputedStyle(el).opacity) !== 1) return false;
      }
      return true;
    });
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
    console.log(`PASS ${theme}: token/account contrast, hover, full address, header inheritance; 5 ratio and 2 unsupported-surface controls`);
    await page.close();
  }
} finally { await browser.close(); }
