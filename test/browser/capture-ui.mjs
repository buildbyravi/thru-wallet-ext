// Capture the real built UI with public fixtures, never a real vault or RPC.
// node test/browser/capture-ui.mjs [dist] [output] [--check]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { encodeRef } from '../../src/shared/refs.js';

const dist = resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'dist');
const output = resolve(process.argv[3] || 'docs/screenshots/current');
assert.notEqual(output, dist, 'Screenshots must not be written into dist.');
assert.ok(!output.startsWith(`${dist}${sep}`), 'Screenshots must stay outside the extension package.');
const hash = data => createHash('sha256').update(data).digest('hex');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const sourcePaths = () => [...new Set(git('ls-files', '-c', '-o', '--exclude-standard', '--',
  'src', 'build.mjs', 'package.json', 'package-lock.json', 'test/browser').split('\n'))].filter(Boolean).sort();
async function sources() {
  const digest = createHash('sha256');
  for (const path of sourcePaths()) digest.update(path).update('\0').update(await readFile(path)).update('\0');
  return digest.digest('hex');
}
async function builds() {
  const hashes = {};
  const entries = await readdir(dist, { recursive: true, withFileTypes: true });
  const paths = entries.filter(entry => entry.isFile())
    .map(entry => relative(dist, resolve(entry.parentPath, entry.name)).split(sep).join('/')).sort();
  for (const path of paths) {
    hashes[path] = hash(await readFile(resolve(dist, path)));
  }
  return hashes;
}

const ref = { keyringId: 'seed_fixture', accountIndex: 0 };
const cases = [
  ['welcome', '/welcome', '.welcome-screen .option-card'],
  ['unlock', '/unlock', '.unlock-screen input'],
  ['dashboard', '/dashboard', '.account-pill-name'],
  ['accounts', '/accounts', '.account-row-current'],
  ['account', `/account?ref=${encodeRef(ref)}`, '.detail-hero'],
  ['add-account', '/add-account', '.option-card'],
  ['keyring', '/keyring?id=seed_fixture', '.detail-table'],
  ['export', `/export?ref=${encodeRef(ref)}`, '.btn'],
  ['send', '/send', 'input[placeholder="0.0"]'],
  ['receive', '/receive', '.qr-container canvas'],
  ['faucet', '/faucet', 'input[readonly]'],
  ['name', '/name', '.name-owner-actions'],
  ['history', '/history', 'article'],
  ['settings', '/settings', '.settings-footer'],
  ['reset', '/reset', 'input[placeholder="RESET"]'],
  ['welcome-create', '/welcome', '.welcome-screen form'],
  ['welcome-import', '/welcome', '.welcome-screen textarea'],
  ['accounts-cached', '/accounts', '.account-row-current'],
  ['accounts-refresh-error', '/accounts', '.accounts-screen .warning'],
  ['accounts-empty-search', '/accounts', '.empty-state'],
  ['dashboard-assets', '/dashboard', '.token-ledger-row'],
  ['settings-theme', '/settings', '[role="dialog"]'],
  ['settings-auto-lock', '/settings', '[role="dialog"]'],
  ['settings-signing', '/settings', '[role="dialog"]'],
  ['settings-bottom', '/settings', '.settings-footer'],
];
const viewports = [{ width: 400, height: 600, context: 'popup-fixture' },
  { width: 320, height: 600, context: 'panel-fixture' },
  { width: 820, height: 720, context: 'wide-panel-fixture' }];
const themes = ['light', 'dark'];
const registered = [...(await readFile('src/ui/app/boot.js', 'utf8')).matchAll(/path:\s*'([^']+)'/g)].map(match => match[1]);
assert.deepEqual([...new Set(cases.map(item => item[1].split('?')[0]))].sort(), registered.sort(), 'Route capture coverage drift.');

function validateRecord(record, sourceSha256, buildSha256) {
  assert.equal(record.version, 1, 'Unknown visual record version.');
  assert.equal(new Date(record.capturedAt).toISOString(), record.capturedAt, 'Invalid capture timestamp.');
  assert.match(record.revision, /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/, 'Invalid source revision.');
  assert.equal(record.sourceSha256, sourceSha256, 'Visual record is stale: source changed.');
  assert.deepEqual(record.buildSha256, buildSha256, 'Visual record is stale: build changed.');
  assert.equal(record.screenshots.length, cases.length * viewports.length * themes.length);
  for (const [scenario, routePath] of cases) for (const viewport of viewports) for (const theme of themes) {
    const image = record.screenshots.filter(item => item.scenario === scenario && item.theme === theme
      && item.viewport.width === viewport.width && item.viewport.height === viewport.height);
    assert.equal(image.length, 1, `Missing or duplicate capture: ${scenario} ${theme} ${viewport.width}`);
    assert.equal(image[0].file, `${scenario}-${theme}-${viewport.width}x${viewport.height}.png`);
    assert.equal(image[0].route, routePath.split('?')[0]);
    assert.deepEqual(image[0].viewport, viewport);
  }
}

if (process.argv.includes('--check')) {
  const record = JSON.parse(await readFile(resolve(output, 'manifest.json'), 'utf8'));
  const sourceSha256 = await sources(), buildSha256 = await builds();
  validateRecord(record, sourceSha256, buildSha256);
  assert.throws(() => validateRecord({ ...record, sourceSha256: 'stale' }, sourceSha256, buildSha256));
  assert.throws(() => validateRecord({ ...record, buildSha256: {} }, sourceSha256, buildSha256));
  assert.throws(() => validateRecord({ ...record, screenshots: record.screenshots.slice(1) }, sourceSha256, buildSha256));
  assert.throws(() => validateRecord({ ...record, screenshots: record.screenshots.map(image =>
    ({ ...image, route: '/wrong-route' })) }, sourceSha256, buildSha256));
  assert.throws(() => validateRecord({ ...record, screenshots: record.screenshots.map(image =>
    ({ ...image, viewport: { ...image.viewport, context: 'wrong-context' } })) }, sourceSha256, buildSha256));
  const icon = Object.keys(buildSha256).find(path => path.startsWith('icons/'));
  assert.ok(icon, 'Asset-change control requires a built icon.');
  assert.throws(() => validateRecord({ ...record, buildSha256: { ...buildSha256, [icon]: 'changed' } }, sourceSha256, buildSha256));
  for (const image of record.screenshots) {
    const buffer = await readFile(resolve(output, image.file));
    assert.equal(hash(buffer), image.sha256, 'Screenshot hash changed.');
    assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Not a PNG screenshot.');
    assert.equal(buffer.readUInt32BE(16), image.viewport.width, 'PNG width does not match viewport.');
    assert.equal(buffer.readUInt32BE(20), image.viewport.height, 'PNG height does not match viewport.');
  }
  console.log(`PASS visual record: ${record.screenshots.length} screenshots, source/build/image hashes, PNG dimensions and matrix coverage; 6 freshness/coverage negative controls rejected.`);
} else {
  assert.equal(dist, resolve('dist'), 'Capture builds the standard dist directory; alternate builds are check-only.');
  const sourceSha256 = await sources();
  execFileSync(process.execPath, ['build.mjs'], { stdio: 'inherit' });
  assert.equal(await sources(), sourceSha256, 'Source changed during build; discard this run.');
  const buildSha256 = await builds();
  console.log('Build provenance recorded; launching isolated browser.');
  const { chromium, CHROME_BIN, origin, routeFixture } = await import('./helpers/fixture.mjs');
  const browser = await chromium.launch({ executablePath: CHROME_BIN });
  console.log(`Browser ${browser.version()}; exercising network controls.`);
  const screenshots = [], buffers = [];
  try {
    // Negative controls: interception must reject both an external origin and non-asset paths.
    const control = await browser.newContext({ serviceWorkers: 'block' });
    const rejected = [];
    await routeFixture(control, rejected);
    const probe = await control.newPage();
    for (const url of ['https://blocked.invalid/probe', `${origin}/../package.json`]) {
      await assert.rejects(() => probe.goto(url));
    }
    assert.equal(rejected.length, 2);
    console.log('HTTP negative controls rejected.');
    await control.close();
    const socketControl = await browser.newContext({ serviceWorkers: 'block' });
    await routeFixture(socketControl, rejected);
    const sockets = [];
    let socketMatched;
    const socketRequest = new Promise(resolve => { socketMatched = resolve; });
    await socketControl.routeWebSocket('**/*', socket => {
      sockets.push(socket.url()); socket.close(); socketMatched();
    });
    const socketProbe = await socketControl.newPage();
    await socketProbe.evaluate(() => { void new WebSocket('wss://blocked.invalid/probe'); });
    let socketTimeout;
    try {
      await Promise.race([socketRequest, new Promise((_, reject) => {
        socketTimeout = setTimeout(() => reject(new Error('WebSocket interception control did not run.')), 8000);
      })]);
    } finally { clearTimeout(socketTimeout); }
    assert.equal(sockets.length, 1);
    console.log('WebSocket negative control rejected.');
    await socketControl.close();

    for (const viewport of viewports) for (const theme of themes) for (const [scenario, routePath, ready] of cases) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height },
        reducedMotion: 'reduce', colorScheme: theme, deviceScaleFactor: 1, serviceWorkers: 'block' });
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      const errors = [], external = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await routeFixture(context, external);
      await context.routeWebSocket('**/*', socket => { errors.push('Unexpected WebSocket request'); socket.close(); });
      context.on('page', popup => { errors.push('Unexpected popup'); void popup.close(); });
      await page.addInitScript(({ theme, scenario, routePath, ref }) => {
        const ring = { id: ref.keyringId, type: 'seed', origin: 'imported', label: 'Fixture recovery phrase',
          accountCount: 2, backedUpAt: 1795435200000 };
        const account = { address: 'taDemoStudioFixture000000000000000000000000AA', label: 'Fixture wallet',
          ref, hdIndex: 0, keyring: ring, balance: '12500000000', balanceStale: true };
        const accounts = [account, { ...account, label: 'Savings fixture', hdIndex: 1,
          ref: { ...ref, accountIndex: 1 }, address: 'taDemoStudioFixture000000000000000000000000BB', balance: '2500000000' }];
        const network = { id: 'betanet', label: 'Betanet', isTestnet: true, enabled: true,
          rpcUrl: 'https://rpc.betanet.thru.org', explorerUrl: 'https://scan.thru.org',
          faucetProgramId: 'fixture-faucet', faucetStateAccount: 'fixture-state', faucetMaxPerClaim: '10000' };
        const prefs = { theme, requirePasswordForSigning: false, sidePanelMode: false };
        const noVault = routePath === '/welcome', unlocked = !noVault && routePath !== '/unlock';
        const balances = Object.fromEntries(accounts.map(a => [a.address,
          { balance: a.balance, exists: true, stale: false, fetchedAt: 1795435200000 }]));
        const entry = { signature: 'tssFxFSNJAQzk7kAYMFxe8P0WHn36HQ-jZi018a3FUBM6n_P19wMZFcNEwul8vZicXYacEeU2kGOr8-WqEx82JCB28',
          slot: '249967', success: true, kind: 'other', timestamp: null };
        const domains = { networkId: network.id, accountAddress: account.address, items: [] };
        const replies = {
          'system.bootstrap': { contractVersion: 33, hasVault: !noVault, unlocked, account,
            accounts, keyrings: [ring], network, preferences: prefs, pending: [] },
          'settings.get': prefs, 'system.getAutoLock': 15, 'network.list': [network], 'network.getActive': network,
          'system.ping': { ok: true, contractVersion: 33 },
          'wallet.hasVault': !noVault, 'wallet.isUnlocked': unlocked, 'wallet.getLockoutState': { retryInMs: 0 },
          'account.getActive': account, 'account.getActiveRef': ref, 'account.list': accounts, 'keyring.list': [ring],
          'contacts.list': [], 'tx.checkHealth': { status: 'healthy', latencyMs: 25 },
          'tx.getAccountInfo': balances[account.address], 'tx.getCachedBalances': balances, 'tx.getBalances': balances,
          'tx.estimateFee': { networkId: network.id, supported: true, feeUnits: '1', reserveUnits: '1000' },
          'tx.getPending': [], 'token.list': [], 'token.discover': { adopted: [] },
          'token.getCachedBalances': { networkId: network.id, balances: [] },
          'token.getBalances': { networkId: network.id, balances: [] },
          'tx.getCachedHistory': { networkId: network.id, address: account.address, entries: [entry], nextCursor: null },
          'tx.getHistoryFeed': { entries: [entry], nextCursor: null, synced: false },
          'name.getCachedDomains': domains, 'name.listDomains': domains, 'name.getRegistry': { supported: false },
          'name.getCustomRegistrar': { supported: true, rootMatchesNameService: true, rootName: 'thru', root: 'fixture-root' },
        };
        // Only explicitly enumerated reads/local discovery can succeed. No secret payload exists.
        globalThis.captureUnexpectedMethods = [];
        globalThis.chrome = { runtime: { onMessage: { addListener() {}, removeListener() {} },
          getURL: path => `/${path}`, getManifest: () => ({ version: 'fixture' }),
          sendMessage({ method }, callback) {
            if (!callback) return Promise.resolve();
            if (scenario === 'accounts-cached' && ['account.list', 'keyring.list', 'account.getActiveRef'].includes(method)) return;
            if (scenario === 'accounts-refresh-error' && method === 'account.list') {
              queueMicrotask(() => callback({ ok: false, error: { code: 'FIXTURE_ERROR', message: 'Fixture refresh failed' } })); return;
            }
            if (!Object.hasOwn(replies, method)) globalThis.captureUnexpectedMethods.push(method);
            queueMicrotask(() => callback(Object.hasOwn(replies, method)
              ? { ok: true, data: structuredClone(replies[method]) }
              : { ok: false, error: { code: 'UNSUPPORTED', message: 'Not allowed in visual fixture' } }));
          } } };
      }, { theme, scenario, routePath, ref });
      const panel = viewport.context !== 'popup-fixture' ? '?thru_panel=1' : '';
      await page.goto(`${origin}/popup.html${panel}#${routePath}`, { waitUntil: 'networkidle' });
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      assert.equal(new URL(page.url()).hash.slice(1).split('?')[0], routePath.split('?')[0], `${scenario}: unexpected redirect`);
      if (scenario === 'welcome-create') await page.getByRole('button', { name: /^Create a new wallet/ }).click();
      if (scenario === 'welcome-import') await page.getByRole('button', { name: /^I already have a recovery phrase/ }).click();
      if (scenario === 'accounts-empty-search') await page.getByRole('searchbox', { name: 'Search accounts' }).fill('no-match-fixture');
      if (scenario === 'dashboard-assets') await page.getByRole('button', { name: 'Open token list' }).click();
      const picker = { 'settings-theme': 'Theme Mode', 'settings-auto-lock': 'Auto-lock time', 'settings-signing': 'Signing security' }[scenario];
      if (picker) {
        const opener = page.getByRole('button', { name: new RegExp(`^${picker}`) });
        await opener.focus(); await page.keyboard.press('Enter');
      }
      await page.locator(ready).first().waitFor({ state: scenario === 'name' ? 'attached' : 'visible' });
      if (scenario === 'settings-bottom') await page.locator('.settings-footer').scrollIntoViewIfNeeded();
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map(image => image.decode()));
      });
      // Only public fixture labels/search may be filled; sensitive forms stay blank, never masked.
      assert.equal(await page.locator('input:not([readonly]), textarea').evaluateAll(els =>
        els.some(el => el.value && el.type !== 'search'
          && !['Fixture wallet', 'Fixture recovery phrase'].includes(el.value))), false, `${scenario}: unexpected filled input`);
      const geometry = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth, appScrollHeight: document.querySelector('#app').scrollHeight,
        appClientHeight: document.querySelector('#app').clientHeight }));
      const file = `${scenario}-${theme}-${viewport.width}x${viewport.height}.png`;
      const buffer = await page.screenshot({ animations: 'disabled', fullPage: false });
      assert.deepEqual(errors, [], `${scenario}: browser errors`);
      assert.deepEqual(external, [], `${scenario}: external or invalid asset requests`);
      assert.deepEqual(await page.evaluate(() => globalThis.captureUnexpectedMethods), [], `${scenario}: unmodelled bridge calls`);
      screenshots.push({ scenario, route: routePath.split('?')[0], theme, viewport, file, sha256: hash(buffer), geometry });
      buffers.push(buffer);
      if (picker) {
        await page.keyboard.press('Escape');
        await page.getByRole('dialog').waitFor({ state: 'detached' });
        assert.ok(await page.getByRole('button', { name: new RegExp(`^${picker}`) }).evaluate(el => el === document.activeElement));
      }
      await context.close();
      console.log(`Captured ${file}`);
    }
    assert.equal(await sources(), sourceSha256, 'Source changed during capture; discard this run.');
    assert.deepEqual(await builds(), buildSha256, 'Build changed during capture; discard this run.');
    await mkdir(output, { recursive: true });
    for (const [i, image] of screenshots.entries()) await writeFile(resolve(output, image.file), buffers[i]);
    const record = { version: 1, capturedAt: new Date().toISOString(), revision: git('rev-parse', 'HEAD'),
      branch: git('branch', '--show-current'), sourceChanges: git('status', '--short', '--',
        'src', 'build.mjs', 'package.json', 'package-lock.json', 'test/browser'),
      evidence: 'TESTED: real built UI, mocked bridge; not MV3 or live-network verification',
      browser: browser.version(), platform: process.platform, sourceSha256, buildSha256,
      negativeControls: ['external origin rejected', 'non-asset path rejected', 'WebSocket rejected'],
      limitations: ['No real vault, secrets, signing, RPC or native popup/panel host.',
        'Selected route states only; review, pending/outcome, zoom, forced colors and live resize need separate checks.',
        'Viewport captures at initial scroll, plus Settings bottom; scrolling is not exhaustively verified.',
        'Screenshots are observations, not design approval or a pixel-diff test.'], screenshots };
    await writeFile(resolve(output, 'manifest.json'), `${JSON.stringify(record, null, 2)}\n`);
    const gallery = ['# Current UI Captures', '', record.evidence, '',
      `Captured: ${record.capturedAt}. Source revision: \`${record.revision}\` (branch \`${record.branch}\`).`,
      `Browser: ${record.browser}, ${record.platform}. See [manifest](manifest.json) for hashes, source changes and limitations.`, '',
      ...screenshots.flatMap(image => [`## ${image.scenario} / ${image.theme} / ${image.viewport.width}x${image.viewport.height}`, '',
        `![${image.scenario}, ${image.theme}, ${image.viewport.context}](<${image.file}>)`, ''])];
    await writeFile(resolve(output, 'gallery.md'), `${gallery.join('\n')}\n`);
    console.log(`TESTED ${screenshots.length} screenshots in ${relative(process.cwd(), output)}; fixture evidence only.`);
  } finally { await browser.close(); }
}
