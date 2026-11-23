// Optional MV3 security smoke test. Requires PLAYWRIGHT_MODULE and CHROME_BIN as described in README.md.
// This confirms only the currently shipped absence of a page provider and basic extension loading;
// it does not test future DApp authorization or signing behavior.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, CHROME_BIN } from './helpers/fixture.mjs';

const extensionPath = resolve(process.argv[2] || 'dist');
const manifest = JSON.parse(await readFile(`${extensionPath}/manifest.json`, 'utf8'));
assert.equal(manifest.manifest_version, 3);
const directives = manifest.content_security_policy.extension_pages.split(';').map(x => x.trim());
assert.ok(directives.includes("script-src 'self'"));
assert.ok(directives.includes("object-src 'none'"));

const context = await chromium.launchPersistentContext('', {
  executablePath: CHROME_BIN,
  headless: true,
  args: ['--headless=new', `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});
try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.locator('#app').waitFor({ state: 'visible' });
  assert.equal(await popup.evaluate(() => typeof window.thru), 'undefined');
  await popup.close();

  const site = await context.newPage();
  await site.route('https://security-fixture.invalid/**', route => route.fulfill({
    status: 200, contentType: 'text/html',
    body: '<!doctype html><body>Fixture</body>',
  }));
  await site.goto('https://security-fixture.invalid/');
  assert.equal(await site.evaluate(() => typeof window.thru), 'undefined');
  assert.equal(await site.evaluate(() => typeof window.ethereum), 'undefined');

  // A page-originated message is inert because no provider/content-script bridge is installed.
  await site.evaluate(() => window.postMessage({ type: 'THRU_CONNECT_REQUEST' }, '*'));
  assert.deepEqual(context.pages().filter(p => p.url().startsWith(`chrome-extension://${extensionId}/`)).map(p => p.url()), []);
  await site.close();
  console.log('PASS: MV3 extension loads; no page provider or bridge is exposed.');
} finally {
  await context.close();
}
