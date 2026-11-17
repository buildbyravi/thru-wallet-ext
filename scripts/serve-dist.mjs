// Minimal static server for previewing dist/ in a browser (dev only).
//
//   node scripts/serve-dist.mjs                 # serves dist/ on :4173
//   node scripts/serve-dist.mjs --root .        # serves the repo, so the harnesses under
//                                               # scripts/ can import src/ modules directly
//   node scripts/serve-dist.mjs --port 8000
//   node scripts/serve-dist.mjs --root . --host 0.0.0.0   # explicit LAN opt-in
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
// Loopback by default. `--root .` serves the repository, .git included, over plain HTTP; binding
// that to every interface published the checkout to the whole network for a harness that only
// ever needs localhost. A LAN preview is an explicit opt-in, not the default.
const host = flag('host', '127.0.0.1');
const defaultPath = requestedRoot ? '/scripts/preview-tx-review.html' : '/popup.html';

const types = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

// A path under `root` that this server is willing to read: no `.` segment (so `.git/`, `.env` and
// friends stay private) and no dependency tree. `--root .` publishes the checkout, and a dev
// server that will read `.git/config` is one copy-pasted URL away from handing out a remote it
// was never asked to disclose (2026-11-12: the review-card harness served `/.git/config` with 200
// while bound to `0.0.0.0`).
function resolveRequested(rootDir, urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const segments = decoded.split('/').filter(Boolean);
  if (segments.some((part) => part.startsWith('.') || part === 'node_modules')) return null;
  const file = resolve(join(rootDir, decoded));
  // Never serve outside the chosen root, even if the request is percent-encoded.
  if (file !== rootDir && !file.startsWith(rootDir + sep)) return null;
  return file;
}

createServer(async (req, res) => {
  const file = resolveRequested(root, req.url === '/' ? defaultPath : req.url.split('?')[0]);
  if (!file) {
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
}).listen(port, host, () => {
  console.log(`serving ${root} on http://${host}:${port} (open ${defaultPath})`);
});
