import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';

// dist/ is generated and gitignored, and nothing in it is hand-edited, so it is wiped before
// every build. Without this, a file an older build emitted survives the removal of its entry
// point — every checkout built before the launchpad was quarantined would keep shipping a
// stale, loadable dist/launchpad.html. `npm run build` now always reproduces dist/ from src/
// exactly.
rmSync('dist', { recursive: true, force: true });

const shared = {
  bundle: true,
  format: 'iife',
  target: 'chrome115',
  minify: true,
  logLevel: 'info',
};

await esbuild.build({
  ...shared,
  entryPoints: ['src/background/index.js'],
  outfile: 'dist/background.bundle.js',
});

await esbuild.build({
  ...shared,
  entryPoints: ['src/popup/popup.js'],
  outfile: 'dist/popup.bundle.js',
});

// popup.css is an aggregator of @imports under src/popup/styles/ — bundle it
// so dist keeps shipping a single popup.css.
await esbuild.build({
  bundle: true,
  minify: true,
  logLevel: 'info',
  entryPoints: ['src/popup/popup.css'],
  outfile: 'dist/popup.css',
});

// The legacy launchpad/DEX/prediction full-tab bundles are gone with the rest of the
// quarantined surface (src/launchpad/**). When a launchpad returns it comes back as an
// isolated `src/features/launchpad/**` module per docs/MODULE_BOUNDARIES.md, with its own
// entry point — and `desktop.html` stays reserved for the future expanded-wallet-in-a-tab
// view (the sense in which Rabby uses that name), which is why the old output was named
// launchpad.* rather than desktop.*.

// Everything else in dist/ is a straight copy of authored files under src/ -- nothing is
// hand-edited directly in dist/, and with the wipe above `npm run build` alone reproduces it
// exactly.
copyFileSync('src/popup/popup.html', 'dist/popup.html');
copyFileSync('src/manifest.json', 'dist/manifest.json');
mkdirSync('dist/icons', { recursive: true });
for (const file of readdirSync('src/icons')) {
  copyFileSync(`src/icons/${file}`, `dist/icons/${file}`);
}

console.log('Build complete (bundles + static files copied).');
