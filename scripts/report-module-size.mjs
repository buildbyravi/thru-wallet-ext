// Module review triggers — a REPORT, not a gate.
//
// The 2026-10-31 review measured the tree (127 files, median 6.4 KB) and concluded the file sizes
// are not a problem. What IS worth noticing is a file that has grown past the point where it
// plausibly has one responsibility: those are the ones worth reading before the next change.
//
// This deliberately does not fail and does not split anything. Byte limits are not a design rule
// (`docs/agent/engineer-directive.md`: modularity is stable responsibilities, not one file per
// function), and a build that fails on a line count teaches people to shuffle lines.
//
// Run: npm run report:size

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const LINES_TRIGGER = 500;
const BYTES_TRIGGER = 25 * 1024;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (['vendor', 'node_modules'].includes(entry)) continue;
      walk(full, out);
    } else if (/\.(js|mjs|css)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const files = ['src', 'test', 'scripts']
  .flatMap((dir) => {
    try { return walk(join(ROOT, dir)); } catch { return []; }
  })
  .map((file) => {
    const text = readFileSync(file, 'utf8');
    return {
      file: relative(ROOT, file).split(sep).join('/'),
      lines: text.split('\n').length,
      bytes: Buffer.byteLength(text),
    };
  })
  .sort((a, b) => b.lines - a.lines);

const overLines = files.filter((f) => f.lines > LINES_TRIGGER);
const overBytes = files.filter((f) => f.bytes > BYTES_TRIGGER);
const median = files.map((f) => f.bytes).sort((a, b) => a - b)[Math.floor(files.length / 2)];

const srcFiles = files.filter((f) => f.file.startsWith('src/'));
const srcMedian = srcFiles.map((f) => f.bytes).sort((a, b) => a - b)[Math.floor(srcFiles.length / 2)];
console.log(`[module-size] ${srcFiles.length} source files, median ${(srcMedian / 1024).toFixed(1)} KB; `
  + `${files.length} files including tests and scripts, median ${(median / 1024).toFixed(1)} KB.`);

const group = (list, title, format) => {
  const src = list.filter((f) => f.file.startsWith('src/'));
  const rest = list.filter((f) => !f.file.startsWith('src/'));
  console.log(`\n${title} — src/ (${src.length}):`);
  for (const f of src) console.log(format(f));
  if (rest.length) {
    console.log(`  ... and ${rest.length} test/script files:`);
    for (const f of rest.slice(0, 8)) console.log(format(f));
  }
};

group(overLines, `Over ${LINES_TRIGGER} lines — review for mixed responsibilities, do not split mechanically`,
  (f) => `  ${String(f.lines).padStart(5)}  ${(f.bytes / 1024).toFixed(1).padStart(6)} KB  ${f.file}`);
group(overBytes, `Over ${Math.round(BYTES_TRIGGER / 1024)} KB`,
  (f) => `  ${(f.bytes / 1024).toFixed(1).padStart(6)} KB  ${f.file}`);

console.log('\nReport only. Nothing here fails the build; `npm test` is the gate.');
process.exit(0);
