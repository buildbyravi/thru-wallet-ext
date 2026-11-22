// Shared static fixture routing. The bridge fixtures stay in each test because their behavior differs.
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { PLAYWRIGHT_MODULE, CHROME_BIN } = process.env;
if (!PLAYWRIGHT_MODULE || !CHROME_BIN) throw new Error('Set PLAYWRIGHT_MODULE and CHROME_BIN.');
export const { chromium } = await import(pathToFileURL(resolve(PLAYWRIGHT_MODULE)).href);
export { CHROME_BIN };
export const origin = 'https://wallet-fixture.invalid';
const root = resolve(process.argv[2] || 'dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png' };

// All network traffic is intercepted. The History test intentionally opens one explorer URL;
// fulfill that request with fixture text instead of contacting the network, and record it.
export async function routeFixture(target, unexpected, { interceptExternal = false } = {}) {
  await target.route('**/*', async route => {
    const url = new URL(route.request().url());
    const path = resolve(root, `.${url.pathname}`);
    if (url.origin !== origin) {
      unexpected.push(url.href);
      if (interceptExternal) return route.fulfill({ contentType: 'text/plain', body: 'Navigation intercepted by fixture' });
      return route.abort();
    }
    if (!path.startsWith(`${root}/`) || !mime[extname(path)]) {
      unexpected.push(url.href);
      return route.abort();
    }
    await route.fulfill({ contentType: mime[extname(path)], body: await readFile(path) });
  });
}
