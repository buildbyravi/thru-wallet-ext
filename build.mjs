import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';

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

// Launchpad full-tab bundles.
//
// The output is launchpad.* rather than desktop.*: `desktop.html` is deliberately reserved
// for a future expanded-wallet-in-a-tab view (the sense in which Rabby uses that name), and
// having the launchpad occupy it would guarantee a collision the moment we build that.
await esbuild.build({
  ...shared,
  entryPoints: ['src/launchpad/launchpad.js'],
  outfile: 'dist/launchpad.bundle.js',
});

await esbuild.build({
  bundle: true,
  minify: true,
  logLevel: 'info',
  entryPoints: ['src/launchpad/launchpad.css'],
  outfile: 'dist/launchpad.css',
});

// Everything else in dist/ is a straight copy of authored files under src/ -- nothing is
// hand-edited directly in dist/, so `rm -rf dist && npm run build` always reproduces it
// exactly.
copyFileSync('src/popup/popup.html', 'dist/popup.html');
copyFileSync('src/launchpad/launchpad.html', 'dist/launchpad.html');
copyFileSync('src/manifest.json', 'dist/manifest.json');
mkdirSync('dist/icons', { recursive: true });
for (const file of readdirSync('src/icons')) {
  copyFileSync(`src/icons/${file}`, `dist/icons/${file}`);
}

console.log('Build complete (bundles + static files copied).');
