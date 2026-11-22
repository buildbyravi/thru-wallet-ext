// Optional Playwright regression. Use a separately installed playwright-core (no wallet dependency):
//   PLAYWRIGHT_MODULE=/abs/path/to/playwright-core/index.mjs CHROME_BIN=/abs/path/to/chrome \
//     node test/browser/token-cache.mjs [dist]
// Set MEASURE_ONLY=1 to report baseline row churn without enforcing row identity.
import assert from 'node:assert/strict';
import { chromium, CHROME_BIN, origin, routeFixture } from './helpers/fixture.mjs';
const browser = await chromium.launch({ executablePath: CHROME_BIN });
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 600 } });
  page.setDefaultTimeout(4000);
  const errors = [];
  const unexpected = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await routeFixture(page, unexpected);
  await page.addInitScript(() => {
    const address = 'taDemoStudioFixture000000000000000000000000AA';
    const balance = '1284500000000';
    const account = { address, balance, label: 'Fixture wallet' };
    const network = { id: 'betanet', label: 'Betanet', isTestnet: true };
    const count = Number(new URLSearchParams(location.search).get('tokens')) || 10;
    const symbols = ['LAB', 'NEXT', 'EMPTY', 'UNKNOWN',
      ...Array.from({ length: count - 4 }, (_, i) => `ASSET-${i + 4}`)];
    const tokens = symbols.map((symbol, index) => ({
      mintAddress: `taFixtureMint${index}`, symbol, decimals: 6, hidden: false,
    }));
    const row = (i, amountUnits, patch) => ({ ...tokens[i], amountUnits,
      tokenAccountExists: true, error: false, ...patch });
    const cached = { networkId: 'betanet', balances: [row(0, '22918766'), row(1, '1000000')],
      stale: false, fetchedAt: Date.now() };
    for (let i = 4; i < count; i++) cached.balances.push(row(i, '1000000'));
    const replies = {
      'system.bootstrap': { contractVersion: 33, hasVault: true, unlocked: true, account,
        accounts: [account], keyrings: [], network, preferences: { theme: 'light' }, pending: [] },
      'system.getAutoLock': 15, 'settings.get': { theme: 'light' }, 'keyring.list': [],
      'wallet.hasVault': true, 'wallet.isUnlocked': true, 'network.getActive': network,
      'account.getActive': account, 'token.list': tokens, 'token.discover': { adopted: [] },
      'token.getCachedBalances': cached, 'token.readMint': { exists: false }, 'tx.getPending': [],
      'tx.getAccountInfo': { balance, exists: true }, 'tx.checkHealth': { status: 'healthy' },
      'tx.getCachedBalances': { [address]: { balance, stale: false, fetchedAt: Date.now() } },
    };
    globalThis.chrome ??= {};
    chrome.runtime = {
      onMessage: { addListener() {}, removeListener() {} },
      getURL: (path) => `/${path}`,
      sendMessage({ method }, callback) {
        if (!callback) return Promise.resolve();
        if (method === 'token.getBalances') {
          globalThis.finishTokenRefresh = () => callback({ ok: true, data: {
            networkId: 'betanet', balances: [row(0, null, { error: true }), row(1, '2000000'),
              row(2, null, { tokenAccountExists: false }), row(3, null, { error: true }),
              ...cached.balances.slice(2)],
          } });
        } else {
          queueMicrotask(() => callback(Object.hasOwn(replies, method)
            ? { ok: true, data: structuredClone(replies[method]) }
            : { ok: false, error: { code: 'UNSUPPORTED', message: 'Unavailable in fixture.' } }));
        }
      },
    };
  });

  const asset = (symbol) => page.locator('.token-ledger-row').filter({
    has: page.locator('.token-row-symbol', { hasText: new RegExp(`^${symbol}$`) }),
  });
  async function assertNativeLogoHasNoRim(avatar) {
    const shape = await avatar.locator('img').evaluate(async (image) => {
      await image.decode();
      return {
        src: image.getAttribute('src'),
        avatarBorder: getComputedStyle(image.parentElement).borderTopWidth,
        imageBorder: getComputedStyle(image).borderTopWidth,
        radius: getComputedStyle(image.parentElement).borderTopLeftRadius,
      };
    });
    assert.deepEqual(shape, { src: 'icons/thru.png', avatarBorder: '0px', imageBorder: '0px', radius: '50%' });
  }
  for (const count of [10, 100, 200]) {
    await page.setViewportSize({ width: count === 200 ? 320 : 400, height: count === 200 ? 445 : 600 });
    await page.goto(`${origin}/popup.html?tokens=${count}`);
    const summary = page.locator('.dash-balance-summary');
    await summary.getByText(`+${count - 3}`, { exact: true }).waitFor();
    assert.equal(await summary.locator('.token-row-avatar').count(), 4);
    if (!process.env.MEASURE_ONLY) await assertNativeLogoHasNoRim(summary.locator('.token-row-avatar.native'));
    assert.equal(await summary.innerText(), `+${count - 3}`, 'no token names or initials in the balance header');
    const bounds = await page.locator('.dash-balance-card').evaluate((card) => {
      const cta = card.querySelector('.dash-balance-cta').getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      return {
        ctaFits: cta.left >= cardRect.left && cta.right <= cardRect.right,
        cardFits: cardRect.left >= 0 && cardRect.right <= document.documentElement.clientWidth,
      };
    });
    assert.deepEqual(bounds, { ctaFits: true, cardFits: true });
    await page.getByRole('button', { name: 'Open token list' }).click();
    if (!process.env.MEASURE_ONLY) await assertNativeLogoHasNoRim(asset('THRU').locator('.token-row-avatar.native'));
    await asset('LAB').click();
    await page.getByText('22.918766 LAB', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Back to tokens' }).click();
    await page.waitForFunction(() => document.activeElement?.querySelector('.token-row-symbol')?.textContent === 'LAB');
    const last = asset(`ASSET-${count - 1}`);
    await last.focus();
    const listScroll = page.locator('.token-list-scroll');
    const toolbar = page.locator('.token-drawer-toolbar');
    const scrollBefore = await listScroll.evaluate((el) => el.scrollTop);
    assert.ok(scrollBefore > 0);
    const toolbarBounds = await toolbar.boundingBox();
    assert.ok(toolbarBounds.y >= 0 && toolbarBounds.y + toolbarBounds.height <= page.viewportSize().height,
      'drawer actions stay within the popup while scrolling');
    for (const back of ['Escape', 'Back to tokens']) {
      await page.keyboard.press('Enter');
      await page.getByText('My balance', { exact: true }).waitFor();
      if (back === 'Escape') await page.keyboard.press('Escape');
      else await page.getByRole('button', { name: back }).click();
      await page.waitForFunction((symbol) => document.activeElement?.querySelector('.token-row-symbol')?.textContent === symbol,
        `ASSET-${count - 1}`);
      assert.equal(await listScroll.evaluate((el) => el.scrollTop), scrollBefore, `${back} preserves scroll`);
    }
    await last.evaluate((row) => {
      const list = row.parentElement;
      const sheet = list.parentElement;
      sheet.scrollTop = sheet.scrollHeight;
      const visibleRows = Array.from(list.children);
      const scrollTop = sheet.scrollTop;
      // Retain mutation records even if the observer delivers them before the assertion.
      const changes = [];
      const tracker = new MutationObserver((records) => changes.push(...records));
      tracker.observe(list, { childList: true });
      globalThis.readRowChanges = () => {
        changes.push(...tracker.takeRecords());
        tracker.disconnect();
        return {
          inserted: changes.reduce((sum, r) => sum + r.addedNodes.length, 0),
          removed: changes.reduce((sum, r) => sum + r.removedNodes.length, 0),
          sameRows: visibleRows.every((el, index) => list.children[index] === el),
          sameFocus: document.activeElement === row,
          scrollTop,
          scrollDelta: sheet.scrollTop - scrollTop,
        };
      };
    });
    await page.waitForFunction(() => typeof globalThis.finishTokenRefresh === 'function');
    await page.evaluate(() => globalThis.finishTokenRefresh());
    await asset('NEXT').getByText('2', { exact: true }).waitFor();
    assert.equal(await asset('LAB').locator('.token-row-amount').textContent(), '22.918766', 'retain verified cache on partial failure');
    await asset('LAB').getByText('Cached', { exact: true }).waitFor();
    assert.equal(await asset('NEXT').getByText('Cached', { exact: true }).count(), 0);
    await asset('EMPTY').getByText('0', { exact: true }).waitFor();
    await asset('UNKNOWN').getByText('Unavailable', { exact: true }).waitFor();
    const stats = await page.evaluate(() => globalThis.readRowChanges());
    console.log(`${count} synthetic tokens: ${JSON.stringify(stats)}`);
    assert.ok(stats.scrollTop > 0, 'the focused drawer is scrolled before refresh');
    if (process.env.MEASURE_ONLY !== '1') {
      assert.equal(stats.removed + stats.inserted, 0, 'balance refresh must not rebuild or move rows');
      assert.equal(stats.sameRows, true);
      assert.equal(stats.sameFocus, true);
      assert.equal(stats.scrollDelta, 0);
    }
    await asset('UNKNOWN').click();
    await page.getByText('Balance unavailable', { exact: true }).waitFor();
    if (count === 10) {
      const search = page.getByRole('textbox', { name: 'Search' });
      await page.getByRole('button', { name: 'Back to tokens' }).click();
      await search.fill('w'.repeat(180));
      const status = page.getByRole('status').filter({ hasText: 'No matching tokens' });
      await status.waitFor();
      assert.ok(await status.evaluate((el) => el.scrollWidth <= el.clientWidth));
      const stickyCopy = await status.textContent();
      await search.fill('y'.repeat(200));
      assert.equal(await status.textContent(), stickyCopy, 'no-results copy does not repeat each query');
      await search.clear();
      const labRow = await asset('LAB').elementHandle();
      await search.fill('LAB');
      assert.equal(await page.locator('.token-ledger-row').count(), 1);
      if (process.env.MEASURE_ONLY !== '1') {
        assert.equal(await asset('LAB').evaluate((row, previous) => row === previous, labRow), true,
          'filtering retains rows that still match');
      }
      await search.clear();
      assert.equal(await page.locator('.token-ledger-row').count(), 11);
      assert.equal(await search.evaluate((el) => document.activeElement === el), true);
      await labRow.dispose();
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  console.log(`PASS: Chromium ${browser.version()}, cache-first, partial refresh and row identity measurements; no external requests.`);
} finally {
  await browser.close();
}
