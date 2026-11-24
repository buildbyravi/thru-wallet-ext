// Shared static fixture routing. The bridge fixtures stay in each test because their behavior differs.
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const PLAYWRIGHT_MODULE = process.env.PLAYWRIGHT_MODULE || (process.env.LOCALAPPDATA
  && resolve(process.env.LOCALAPPDATA, 'thru-wallet-browser-tools/node_modules/playwright-core/index.mjs'));
if (!PLAYWRIGHT_MODULE) throw new Error('Set PLAYWRIGHT_MODULE or use the permanent Windows setup in test/browser/README.md.');
export const { chromium } = await import(pathToFileURL(resolve(PLAYWRIGHT_MODULE)).href);
const CHROME_BIN = process.env.CHROME_BIN || chromium.executablePath();
export { CHROME_BIN };
export const origin = 'https://wallet-fixture.invalid';
const root = resolve(process.argv[2] || 'dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };

// All network traffic is intercepted. The History test intentionally opens one explorer URL;
// fulfill that request with fixture text instead of contacting the network, and record it.
export async function routeFixture(target, unexpected, { interceptExternal = false, assets } = {}) {
  await target.route('**/*', async route => {
    const url = new URL(route.request().url());
    const path = resolve(root, `.${url.pathname}`);
    if (url.origin !== origin) {
      unexpected.push(url.href);
      if (interceptExternal) return route.fulfill({ contentType: 'text/plain', body: 'Navigation intercepted by fixture' });
      return route.abort();
    }
    if (!path.startsWith(`${root}${sep}`) || !mime[extname(path)] || (assets && !assets.has(path))) {
      unexpected.push(url.href);
      return route.abort();
    }
    await route.fulfill({ contentType: mime[extname(path)], body: assets ? assets.get(path) : await readFile(path) });
  });
}
