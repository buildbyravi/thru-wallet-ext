// Minimal static server for previewing dist/ in a browser (dev only).
//
//   node scripts/serve-dist.mjs                 # serves dist/ on :4173
//   node scripts/serve-dist.mjs --root .        # serves the repo, so the harnesses under
//                                               # scripts/ can import src/ modules directly
//   node scripts/serve-dist.mjs --port 8000
//
// The `--root .` mode exists for scripts/preview-tx-review.html, which imports the REAL
// component and the REAL decoders out of src/ (plain ES modules, no bundler needed) instead
// of mirroring their markup. Paths are resolved inside the chosen root only.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const repoRoot = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const requestedRoot = flag('root');
const root = requestedRoot ? resolve(requestedRoot) : join(repoRoot, 'dist');
const port = Number(flag('port', requestedRoot ? 8000 : 4173));
const defaultPath = requestedRoot ? '/scripts/preview-tx-review.html' : '/popup.html';

const types = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  const path = req.url === '/' ? defaultPath : req.url.split('?')[0];
  const file = resolve(join(root, path));
  // Never serve outside the chosen root, even if the request is percent-encoded.
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      'content-type': types[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`serving ${root} on http://0.0.0.0:${port} (open ${defaultPath})`);
});
