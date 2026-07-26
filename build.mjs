import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';

const shared = {
  bundle: true,
  format: 'esm',
  target: 'chrome115',
  minify: true,
  logLevel: 'info',
};

await esbuild.build({
  ...shared,
  entryPoints: ['src/background.js'],
  outfile: 'dist/background.bundle.js',
});

await esbuild.build({
  ...shared,
  entryPoints: ['src/popup/popup.js'],
  outfile: 'dist/popup.bundle.js',
});

// Everything else in dist/ is a straight copy of authored files under src/ -- nothing is
// hand-edited directly in dist/, so `rm -rf dist && npm run build` always reproduces it
// exactly. This bit us once already (see README) when popup.html/css were forgotten in a
// rebuild; copying manifest.json and icons/ here too closes the same gap for those.
copyFileSync('src/popup/popup.html', 'dist/popup.html');
copyFileSync('src/popup/popup.css', 'dist/popup.css');
copyFileSync('src/manifest.json', 'dist/manifest.json');
mkdirSync('dist/icons', { recursive: true });
for (const file of readdirSync('src/icons')) {
  copyFileSync(`src/icons/${file}`, `dist/icons/${file}`);
}

console.log('Build complete (bundles + static files copied).');
