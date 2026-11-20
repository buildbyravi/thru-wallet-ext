// Optional Playwright regression. Use a separately installed playwright-core (no wallet dependency):
//   PLAYWRIGHT_MODULE=/abs/path/to/playwright-core/index.mjs CHROME_BIN=/abs/path/to/chrome \
//     node test/browser/token-cache.mjs [dist]
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { PLAYWRIGHT_MODULE, CHROME_BIN } = process.env;
if (!PLAYWRIGHT_MODULE || !CHROME_BIN) throw new Error('Set PLAYWRIGHT_MODULE and CHROME_BIN.');
const { chromium } = await import(pathToFileURL(resolve(PLAYWRIGHT_MODULE)).href);
const root = resolve(process.argv[2] || 'dist');
const origin = 'https://wallet-fixture.invalid';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png' };
const browser = await chromium.launch({ executablePath: CHROME_BIN });
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 600 } });
  page.setDefaultTimeout(4000);
  const errors = [];
  const unexpected = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const path = resolve(root, `.${url.pathname}`);
    if (url.origin !== origin || !path.startsWith(`${root}/`) || !mime[extname(path)]) {
      unexpected.push(url.href);
      return route.abort();
    }
    await route.fulfill({ contentType: mime[extname(path)], body: await readFile(path) });
  });
  await page.addInitScript(() => {
    const address = 'taDemoStudioFixture000000000000000000000000AA';
    const balance = '1284500000000';
    const account = { address, balance, label: 'Fixture wallet' };
    const network = { id: 'betanet', label: 'Betanet', isTestnet: true };
    const tokens = ['LAB', 'NEXT', 'EMPTY', 'UNKNOWN'].map((symbol, index) => ({
      mintAddress: `taFixtureMint${index}`, symbol, decimals: 6, hidden: false,
    }));
    const row = (i, amountUnits, patch) => ({ ...tokens[i], amountUnits,
      tokenAccountExists: true, error: false, ...patch });
    const cached = { networkId: 'betanet', balances: [row(0, '22918766'), row(1, '1000000')],
      stale: false, fetchedAt: Date.now() };
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
              row(2, null, { tokenAccountExists: false }), row(3, null, { error: true })],
          } });
        } else {
          queueMicrotask(() => callback(Object.hasOwn(replies, method)
            ? { ok: true, data: structuredClone(replies[method]) }
            : { ok: false, error: { code: 'UNSUPPORTED', message: 'Unavailable in fixture.' } }));
        }
      },
    };
  });

  await page.goto(`${origin}/popup.html`);
  await page.getByRole('button', { name: 'Open token list' }).click();
  await page.getByRole('button', { name: /^LAB\b/ }).click();
  await page.getByText('22.918766 LAB', { exact: true }).waitFor();
  await page.waitForFunction(() => typeof globalThis.finishTokenRefresh === 'function');
  await page.evaluate(() => globalThis.finishTokenRefresh());
  await page.getByRole('button', { name: 'Back to tokens' }).click();
  const asset = (symbol) => page.locator('.token-ledger-row').filter({
    has: page.locator('.token-row-symbol', { hasText: new RegExp(`^${symbol}$`) }),
  });
  await asset('NEXT').getByText('2', { exact: true }).waitFor();
  assert.equal(await asset('LAB').locator('.token-row-amount').textContent(), '22.918766', 'retain verified cache on partial failure');
  await asset('LAB').getByText('Cached', { exact: true }).waitFor();
  assert.equal(await asset('NEXT').getByText('Cached', { exact: true }).count(), 0);
  await asset('EMPTY').getByText('0', { exact: true }).waitFor();
  await asset('UNKNOWN').getByText('Unavailable', { exact: true }).waitFor();
  await asset('UNKNOWN').click();
  await page.getByText('Balance unavailable', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  console.log(`PASS: Chromium ${browser.version()}, cache-first and partial refresh, known zero vs unknown; no external requests.`);
} finally {
  await browser.close();
}
