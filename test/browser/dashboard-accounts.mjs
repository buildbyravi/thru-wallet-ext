// Responsive visual smoke for the dashboard account entry and grouped account switcher.
// Uses the real built popup CSS and a synthetic bridge; no vault, wallet secret or RPC.
// PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs CHROME_BIN=/path/to/chrome node test/browser/dashboard-accounts.mjs [dist]
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, CHROME_BIN, origin, routeFixture } from './helpers/fixture.mjs';

const accounts = [
  { address: 'taDemoStudioFixture000000000000000000000000AA', label: 'Main account', ref: { keyringId: 'seed_test1', index: 0, accountIndex: 0 }, keyring: { id: 'seed_test1', type: 'seed', label: 'Recovery phrase' }, balance: '1250000000' },
  { address: 'taDemoStudioFixture000000000000000000000000BB', label: 'Savings account with a long name', ref: { keyringId: 'seed_test1', index: 1, accountIndex: 1 }, keyring: { id: 'seed_test1', type: 'seed', label: 'Recovery phrase' }, balance: '420000000' },
  { address: 'taDemoStudioFixture000000000000000000000000CC', label: 'Imported account', ref: { keyringId: 'pk_test01', index: 0, accountIndex: 0 }, keyring: { id: 'pk_test01', type: 'privateKey', label: 'Imported key' }, balance: null },
];
const active = accounts[0];
const keyrings = [
  { id: 'seed_test1', type: 'seed', label: 'Recovery phrase', origin: 'imported', accountCount: 2, backedUpAt: 1 },
  { id: 'pk_test01', type: 'privateKey', label: 'Imported key', origin: 'imported', accountCount: 1 },
];
const network = { id: 'betanet', label: 'Betanet', isTestnet: true };
const balances = Object.fromEntries(accounts.filter(a => a.balance != null).map(a => [a.address, { balance: a.balance, stale: false, fetchedAt: Date.now() }]));
const browser = await chromium.launch({ executablePath: CHROME_BIN });
await mkdir('test-results', { recursive: true });
try {
  for (const width of [400, 320]) {
    console.log(`Checking dashboard/account UI at ${width}px.`);
    const page = await browser.newPage({ viewport: { width, height: 600 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(7000);
    const errors = [], unexpected = [];
    page.on('pageerror', error => errors.push(error.message));
    await routeFixture(page, unexpected);
    await page.addInitScript(({ accounts: fixtureAccounts, keyrings: fixtureKeyrings, activeAccount, activeNetwork, balancesByAddress }) => {
      const listeners = new Set();
      const replies = {
        'system.bootstrap': { contractVersion: 33, hasVault: true, unlocked: true, account: activeAccount, accounts: fixtureAccounts, keyrings: fixtureKeyrings, network: activeNetwork, preferences: { theme: 'light' }, pending: [] },
        'settings.get': { theme: 'light' }, 'wallet.hasVault': true, 'wallet.isUnlocked': true,
        'keyring.list': fixtureKeyrings, 'account.getActive': activeAccount,
        'account.getActiveRef': activeAccount.ref, 'account.list': fixtureAccounts,
        'network.getActive': activeNetwork, 'tx.getCachedBalances': balancesByAddress,
        'tx.getBalances': balancesByAddress, 'tx.getAccountInfo': { exists: true, balance: activeAccount.balance },
        'tx.getPending': [], 'token.list': [], 'token.discover': { adopted: [] },
        'token.getCachedBalances': { networkId: activeNetwork.id, balances: [] },
        'token.getBalances': { networkId: activeNetwork.id, balances: [] },
        'tx.checkHealth': { status: 'healthy', latencyMs: 18 },
      };
      globalThis.chrome ??= {};
      chrome.runtime = {
        onMessage: { addListener(fn) { listeners.add(fn); }, removeListener(fn) { listeners.delete(fn); } },
        getURL: path => `/${path}`,
        sendMessage({ method }, callback) {
          if (!callback) return Promise.resolve();
          const value = Object.hasOwn(replies, method) ? structuredClone(replies[method]) : {};
          queueMicrotask(() => callback({ ok: true, data: value }));
        },
      };
    }, { accounts, keyrings, activeAccount: active, activeNetwork: network, balancesByAddress: balances });

    await page.goto(`${origin}/popup.html#/dashboard`);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `test-results/dashboard-${width}.png`, fullPage: true });
    const accountPill = page.locator('.account-pill');
    await accountPill.waitFor({ state: 'visible' });
    assert.match(await accountPill.innerText(), /Main account/);
    await page.locator('.dash-balance-card').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Send', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('body').evaluate(el => el.scrollWidth <= el.clientWidth), true, `dashboard overflows at ${width}px`);

    await accountPill.click();
    await page.getByRole('heading', { name: 'Accounts', exact: true }).waitFor();
    await page.getByText('Savings account with a long name', { exact: true }).waitFor();
    assert.equal(await page.locator('.accounts-screen .row.active .account-row-current').count(), 1);
    assert.equal(await page.locator('.accounts-screen .list-group').count(), 2);
    assert.equal(await page.locator('body').evaluate(el => el.scrollWidth <= el.clientWidth), true, `account switcher overflows at ${width}px`);
    await page.screenshot({ path: `test-results/dashboard-accounts-${width}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpected, []);
    await page.close();
  }
  console.log('PASS: dashboard and grouped account switcher render without horizontal overflow at 400px and 320px.');
} finally {
  await browser.close();
}
