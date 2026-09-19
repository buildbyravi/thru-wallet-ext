#!/usr/bin/env node
// Guard: no nested CSS rules in our stylesheets.
//
// Why: a rule written inside another rule is VALID modern CSS, so esbuild emits zero
// warnings — but it means the descendant selector (`.outer .inner`), never the same-element
// selector the author usually intended (`.outer.inner` or a top-level `.inner`). The
// receive screen's .copy-address block shipped inside .monospace-block this way: every
// hover/copied/flex style was dead in Chrome while the build and all tests passed green.
// House style is flat CSS; the only legal braces-inside-braces are @media/@supports/
// @keyframes containers. Usage: node scripts/check-css-nesting.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const STYLES_DIR = new URL('../src/popup/styles', import.meta.url).pathname;
const ALLOWED_AT = /^@(media|supports|keyframes)\b/;

let errors = 0;

for (const file of readdirSync(STYLES_DIR).filter((f) => f.endsWith('.css')).sort()) {
  const text = readFileSync(join(STYLES_DIR, file), 'utf8');
  const stack = []; // 'rule' | 'at'
  let inComment = false;
  let lineStart = 0;
  let line = 1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '\n') { line++; lineStart = i + 1; continue; }
    if (inComment) {
      if (ch === '*' && next === '/') { inComment = false; i++; }
      continue;
    }
    if (ch === '/' && next === '*') { inComment = true; i++; continue; }

    if (ch === '{') {
      const head = text.slice(lineStart, i).trim();
      if (stack.length > 0 && stack[stack.length - 1] === 'rule') {
        console.error(`  NESTED RULE: ${file}:${line}: '${head.slice(0, 60)}' opened inside a rule body.`);
        console.error('  Nesting means the descendant selector; write a top-level rule instead.');
        errors++;
      }
      stack.push(ALLOWED_AT.test(head) ? 'at' : 'rule');
    } else if (ch === '}') {
      if (!stack.length) {
        console.error(`  UNBALANCED: ${file}:${line}: '}' with no open block.`);
        errors++;
      } else stack.pop();
    }
  }
  if (stack.length) {
    console.error(`  UNBALANCED: ${file}: ${stack.length} block(s) never closed.`);
    errors++;
  }
}

if (errors) {
  console.error(`check-css-nesting: FAILED with ${errors} problem(s).`);
  process.exit(1);
}
console.log('check-css-nesting: all stylesheets are flat (no nested rules).');
