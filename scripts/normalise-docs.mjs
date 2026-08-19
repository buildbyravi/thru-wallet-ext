// One-off: normalise the always-read docs to pure ASCII.
//
// WHY: a PowerShell Get-Content/Set-Content round-trip re-encoded these files and produced
// mojibake, and my attempted "repair" (re-decoding as latin1) replaced the damaged characters
// with U+FFFD instead of restoring them. U+FFFD is unrecoverable -- the original byte is gone.
//
// Every damaged position in these three files was an em dash, a section sign, or a warning
// triangle. Rather than guess per position, the docs are normalised to ASCII. They gain nothing
// from typography, and this removes the entire encoding failure class permanently.
//
// Run: node scripts/normalise-docs.mjs

import { readFileSync, writeFileSync } from 'node:fs';

const FILES = ['AGENTS.md', 'CONTEXT.md', 'README.md'];

const MAP = [
  [/\uFFFD/g, '--'],
  [/[\u2014\u2013]/g, '--'],
  [/[\u2018\u2019]/g, "'"],
  [/[\u201C\u201D]/g, '"'],
  [/\u2026/g, '...'],
  [/\u00A7/g, 'Sec '],
  [/\u25B2/g, '!'],
  [/[\u2192\u21D2]/g, '->'],
  [/\u00D7/g, 'x'],
];

for (const file of FILES) {
  let text = readFileSync(file, 'utf8');
  for (const [pattern, replacement] of MAP) text = text.replace(pattern, replacement);

  const leftover = [...new Set(text.match(/[^\x00-\x7F]/g) || [])];
  // Strip anything still non-ASCII (stray emoji/status glyphs) so this cannot recur.
  text = text.replace(/[^\x00-\x7F]/g, '');

  writeFileSync(file, text, 'utf8');
  const note = leftover.length
    ? `  (stripped ${leftover.map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase()}`).join(' ')})`
    : '';
  console.log(`  ${file.padEnd(12)} ASCII-only${note}`);
}
