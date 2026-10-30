#!/usr/bin/env node
// The notification surface — `src/ui/kit/toast.js`.
//
// WHY THIS SUITE EXISTS
//
// Three Domain-screen call sites shipped `toast('Transaction confirmed')` against a props API.
// The string destructured into a defaulted parameter object, so `title` and `message` were both
// empty, and the component still built and appended a full-width near-black bar with an icon, an
// empty `.toast-body` and a close button. The user saw "an oversized, nearly empty black
// notification bar". No test existed for this component at all — the only use of `toast(` in
// `test/` was a `dismissAllToasts()` cleanup line inside the route-lifecycle suite.
//
// This file pins the component's contract so that class of defect cannot come back silently:
//
//   [0] a toast with no message NEVER renders — malformed input degrades to nothing, not chrome
//   [1] the exact call shape that caused the defect now renders its text
//   [2] every documented tone paints a distinct, correct state (success/info/warning/error/pending)
//   [3] duration per tone, explicit persistence, dismissal, and pause-on-hover
//   [4] repeated notifications dedupe by key and never stack past the cap
//   [5] a pending toast resolves IN PLACE, and can never be updated into a blank one
//   [6] teardown releases timers and listeners (no callbacks against detached nodes)
//   [7] accessibility: live region, per-toast role, labelled dismiss control
//   [8] source guard: nothing in `src/` calls `toast()` with no arguments at all
//
// Runs on the repository's DOM shim (`test/fixtures/dom-shim.mjs`) with a fake clock. It asserts
// DOM structure and behaviour, not layout: the shim has no layout engine, so the bar's HEIGHT is
// still a stylesheet claim, not something this file can prove. See Hard rule 14 in AGENTS.md.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { installDom } from './fixtures/dom-shim.mjs';

const DOC = installDom();
globalThis.requestAnimationFrame = (fn) => fn();

// ---- fake clock ---------------------------------------------------------------------------
// The component schedules dismissal and the exit transition. A real clock would make this suite
// slow and flaky; the fake one also lets us assert that pending arms NO timer at all.
let now = 0;
let seq = 0;
const timers = new Map();
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms = 0) => {
  const id = ++seq;
  timers.set(id, { fn, at: now + ms, ms });
  return id;
};
globalThis.clearTimeout = (id) => { timers.delete(id); };

function advance(ms) {
  now += ms;
  for (;;) {
    const due = [...timers.entries()].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at);
    if (!due.length) return;
    for (const [id, t] of due) {
      timers.delete(id);
      t.fn();
    }
  }
}

const { toast, dismissAllToasts, activeToasts } = await import('../src/ui/kit/toast.js');

/**
 * Clear the screen between sections: dismiss anything live, let the exit transition run on the
 * fake clock so the nodes are really removed, then reset the clock. Without the advance, a
 * dismissed toast's removal timer is thrown away by `timers.clear()` and its node lingers into
 * the next section — which is exactly how the first draft of this suite produced false failures.
 */
function reset() {
  dismissAllToasts();
  advance(500);
  timers.clear();
  now = 0;
  if (toasts().length !== 0) throw new Error(`test setup left ${toasts().length} toast(s) on screen`);
}

// ---- harness ------------------------------------------------------------------------------
let checks = 0;
let failures = 0;

function ok(label, condition, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`  ok - ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL - ${label}${detail ? `\n         ${detail}` : ''}`);
  }
}

function eq(label, actual, expected) {
  ok(label, Object.is(actual, expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function section(title) { console.log(`\n[${title}]`); }

const nodes = (sel) => DOC.body.querySelectorAll(sel);
const toasts = () => nodes('.toast');
const hosts = () => nodes('.toast-host');
/** The most recently created toast — document order is creation order. */
const lastToast = () => { const all = toasts(); return all[all.length - 1]; };
const bodyText = (node) => String(node?.textContent ?? '');
const hasClass = (node, cls) => Boolean(node?.classList?.contains(cls));

/** Everything the user could read inside the toast, icon/close chrome excluded. */
function messageText(el) {
  return [...el.querySelectorAll('.toast-title'), ...el.querySelectorAll('.toast-message')]
    .map((n) => bodyText(n)).join(' ').trim();
}

// =============================================================================================
section('0] a toast with no message never renders');
{
  reset();
  const before = DOC.body.childNodes.length;

  const inputs = [undefined, {}, null, 123, true, [], { title: '' }, { message: '' },
    { title: '   ', message: '\n\t' }, { tone: 'success' }];
  const handles = inputs.map((input) => toast(input));

  eq('no toast node is created for ten malformed payloads', toasts().length, 0);
  eq('the body is untouched, so no empty host is appended either', DOC.body.childNodes.length, before);
  ok('every malformed call returns an inert handle that still supports the API',
    handles.every((h) => typeof h.dismiss === 'function' && typeof h.update === 'function' && h.el === null));

  toast('   ');
  eq('a whitespace-only string is not a message', toasts().length, 0);

  // Control: the same component DOES render when there is something to say. Without this, the
  // assertions above would also pass on a component that renders nothing at all.
  toast({ title: 'Rendered' });
  eq('control: a real message renders one toast', toasts().length, 1);
}

// =============================================================================================
section('1] the exact defect call shape now renders its text');
{
  reset();
  // This is verbatim `src/ui/app/routes/name.js:867` before the fix.
  toast('Transaction confirmed');
  eq('toast("Transaction confirmed") creates one toast', toasts().length, 1);
  eq('its title carries the message', bodyText(toasts()[0].querySelector('.toast-title')), 'Transaction confirmed');
  eq('its visible text is not empty', messageText(toasts()[0]), 'Transaction confirmed');
  ok('the empty-body state that caused the defect is unreachable',
    messageText(toasts()[0]).length > 0 && toasts()[0].querySelectorAll('.toast-body').length === 1);

  reset();
  toast({ message: 'Only a second line' });
  eq('a message with no title renders too', messageText(toasts()[0]), 'Only a second line');
}

// =============================================================================================
section('2] tones: success / info / warning / error / pending');
{
  const expected = {
    success: { cls: 'toast-success', role: 'status' },
    info: { cls: 'toast-info', role: 'status' },
    warning: { cls: 'toast-warning', role: 'status' },
    error: { cls: 'toast-error', role: 'alert' },
    pending: { cls: 'toast-pending', role: 'status' },
  };
  for (const [tone, want] of Object.entries(expected)) {
    reset();
    toast({ tone, title: `A ${tone} message` });
    const el = lastToast();
    ok(`${tone}: paints ${want.cls}`, hasClass(el, want.cls));
    eq(`${tone}: data-tone is readable`, el.getAttribute('data-tone'), tone);
    eq(`${tone}: role is ${want.role}`, el.getAttribute('role'), want.role);
    ok(`${tone}: still has an icon`, el.querySelectorAll('.toast-icon').length === 1);
    eq(`${tone}: the message survived`, messageText(el), `A ${tone} message`);
  }

  reset();
  toast({ tone: 'pending', title: 'Submitting…' });
  ok('pending spins its icon instead of showing a verdict glyph',
    hasClass(lastToast().querySelector('.toast-icon').querySelector('svg'), 'spinning'));

  reset();
  toast({ tone: 'nonsense', title: 'Falls back' });
  ok('an unknown tone degrades to info instead of throwing', hasClass(lastToast(), 'toast-info'));
}

// =============================================================================================
section('3] duration, persistence and dismissal');
{
  const cases = [['success', 3000], ['info', 3500], ['warning', 5000], ['error', 6000], ['pending', null]];
  for (const [tone, ms] of cases) {
    reset();
    toast({ tone, title: `${tone} lifetime` });
    const armed = [...timers.values()].map((t) => t.ms);
    if (ms === null) eq(`${tone}: arms no timer (persists until resolved or dismissed)`, armed.length, 0);
    else {
      eq(`${tone}: arms exactly one timer`, armed.length, 1);
      eq(`${tone}: at its documented duration`, armed[0], ms);
    }
  }

  reset();
  toast({ tone: 'success', title: 'Sticky', duration: 0 });
  eq('an explicit duration: 0 never expires', timers.size, 0);

  reset();
  toast({ tone: 'success', title: 'Custom', duration: 1200 });
  eq('a custom duration is honoured', [...timers.values()][0].ms, 1200);

  reset();
  const handle = toast({ tone: 'info', title: 'Dismiss me' });
  handle.dismiss();
  // The countdown is gone; the only timer left is the exit transition that removes the node.
  ok('dismiss() clears the dismissal timer',
    [...timers.values()].every((t) => t.ms === 160), JSON.stringify([...timers.values()].map((t) => t.ms)));
  ok('dismiss() marks the toast as leaving', hasClass(lastToast(), 'leaving'));
  advance(160);
  eq('the node is removed after the exit transition', toasts().length, 0);

  reset();
  toast({ tone: 'error', title: 'Closable' });
  const close = lastToast().querySelector('.toast-close');
  close.listeners.get('click')[0]();
  advance(160);
  eq('the close button dismisses', toasts().length, 0);

  reset();
  toast({ tone: 'warning', title: 'Hover' });
  const el = lastToast();
  el.listeners.get('mouseenter')[0]();
  eq('hovering pauses the countdown', timers.size, 0);
  el.listeners.get('mouseleave')[0]();
  eq('leaving re-arms it', timers.size, 1);

  reset();
  toast({ tone: 'success', title: 'Expires' });
  advance(3000);
  advance(160);
  eq('a toast expires on its own after its duration', toasts().length, 0);
}

// =============================================================================================
section('4] repeated notifications: dedupe by key, bounded stacking');
{
  reset();
  toast({ tone: 'info', title: 'Primary name updated', key: 'primary' });
  toast({ tone: 'info', title: 'Primary name updated', key: 'primary' });
  eq('a repeated event with the same key does not stack', toasts().length, 1);

  toast({ tone: 'success', title: 'Primary name set', key: 'primary' });
  eq('it updates the existing toast instead', toasts().length, 1);
  eq('the newest text wins', messageText(lastToast()), 'Primary name set');
  ok('the tone follows the update', hasClass(lastToast(), 'toast-success'));

  reset();
  toast({ title: 'one' });
  toast({ title: 'two' });
  toast({ title: 'three' });
  eq('never more than two are on screen at once', activeToasts().length, 2);
  const texts = activeToasts().map((t) => t.text);
  ok('the oldest yields first', !texts.includes('one') && texts.includes('two') && texts.includes('three'),
    `visible: ${texts.join(', ')}`);

  reset();
  toast({ title: 'a' });
  toast({ title: 'b' });
  dismissAllToasts();
  eq('dismissAllToasts clears every live toast', activeToasts().length, 0);

  reset();
  toast({ title: 'after a clear' });
  eq('the host is reusable after a clear', toasts().length, 1);
}

// =============================================================================================
section('5] pending resolves in place and can never become blank');
{
  reset();
  const pending = toast({ tone: 'pending', title: 'Submitting registration…', key: 'submit' });
  eq('pending arms no timer', timers.size, 0);

  pending.update({ tone: 'success', title: 'Registration confirmed' });
  eq('resolving keeps exactly one toast', toasts().length, 1);
  eq('the text is the verdict', messageText(toasts()[0]), 'Registration confirmed');
  ok('the tone moved to success', hasClass(toasts()[0], 'toast-success'));
  eq('a verdict is now dismissible on a timer', [...timers.values()][0].ms, 3000);

  reset();
  const second = toast({ tone: 'pending', title: 'Submitting…' });
  second.update({ tone: 'error', title: 'Submission failed' });
  eq('pending can resolve to an error', lastToast().getAttribute('role'), 'alert');

  reset();
  const third = toast({ tone: 'pending', title: 'Submitting…' });
  third.update({ title: '', message: '' });
  advance(160);
  eq('updating into a blank toast dismisses it instead of leaving an empty bar', toasts().length, 0);

  reset();
  const fourth = toast({ tone: 'info', title: 'Finite' });
  fourth.dismiss();
  fourth.update({ title: 'after dismiss' });
  advance(160);
  eq('update() after dismiss() is a no-op, not a resurrection', toasts().length, 0);
}

// =============================================================================================
section('6] teardown releases timers and listeners');
{
  reset();
  toast({ tone: 'warning', title: 'Listeners' });
  const el = lastToast();
  const before = [...el.listeners.values()].reduce((n, list) => n + list.length, 0);
  ok('the toast registers its interaction listeners', before >= 4, `registered ${before}`);
  el.listeners.get('click'); // (close button is a child; the el itself has hover/focus pairs)
  const close = el.querySelector('.toast-close');
  ok('the close control is wired', close.listeners.get('click')?.length === 1);

  advance(5000); // auto-dismiss fires
  ok('the dismiss timer does not survive its own firing', timers.size <= 1,
    `timers left: ${timers.size}`); // at most the 160ms exit transition
  advance(160);
  const emptied = (node) => [...node.listeners.values()].every((l) => l.length === 0);
  ok('el listeners are removed on dismiss', emptied(el),
    JSON.stringify([...el.listeners.entries()].map(([k, v]) => [k, v.length])));
  ok('close-button listeners are removed too', emptied(close),
    JSON.stringify([...close.listeners.entries()].map(([k, v]) => [k, v.length])));
  eq('the detached toast is gone', toasts().length, 0);
  // If a timer had survived, advancing far past it would throw against a detached node.
  advance(60_000);
  ok('nothing fires after teardown', true);
}

// =============================================================================================
section('7] accessibility');
{
  reset();
  toast({ title: 'Announced' });
  const host = hosts()[0];
  eq('the host is a labelled region', host.getAttribute('role'), 'region');
  eq('the host is a polite live region', host.getAttribute('aria-live'), 'polite');
  eq('the host has an accessible name', host.getAttribute('aria-label'), 'Notifications');

  const close = lastToast().querySelector('.toast-close');
  eq('the dismiss control has a name', close.getAttribute('aria-label'), 'Dismiss notification');
  eq('the dismiss control is a real button', close.tagName, 'BUTTON');
  eq('the close control is not focus-trapping or hidden', close.getAttribute('aria-hidden'), null);

  reset();
  toast({ tone: 'error', title: 'Assertive' });
  eq('an error interrupts the screen reader', lastToast().getAttribute('role'), 'alert');
  reset();
  toast({ tone: 'success', title: 'Polite' });
  eq('everything else waits its turn', lastToast().getAttribute('role'), 'status');
}

// =============================================================================================
section('8] source guard: no argument-less toast calls');
{
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  })('src');

  // `toast()` with nothing at all is the one call shape no guard inside the component can catch:
  // it is indistinguishable from the inert no-op. Catch it statically instead.
  const offenders = [];
  for (const file of files) {
    if (file.endsWith('src/ui/kit/toast.js')) continue;
    // Strip whole-line comments first: `dashboard.js` documents the API in prose
    // ("Transient one-line feedback uses toast(), persistent state uses Banner") and a scan
    // that counts documentation as a call site would be wrong in both directions.
    const source = readFileSync(file, 'utf8')
      .split('\n')
      .map((line) => (line.trimStart().startsWith('//') ? '' : line))
      .join('\n');
    for (const match of source.matchAll(/(?<![\w.])toast\(\s*\)/g)) {
      const line = source.slice(0, match.index).split('\n').length;
      offenders.push(`${file}:${line}`);
    }
  }
  eq('every toast() call passes something', offenders.length, 0);
  if (offenders.length) console.error(`         ${offenders.join('\n         ')}`);

  // Positive control: the scanner does see a call when one exists, so a green result above is
  // evidence and not a regex that never matches anything.
  const sample = 'toast(); toast(x); toast ();';
  eq('control: the scanner finds the pattern it looks for', [...sample.matchAll(/(?<![\w.])toast\(\s*\)/g)].length, 1);

  // The shape that caused the original defect is LEGAL now (a string means "title"), which is
  // why the invariant above is about emptiness rather than about strings. But the route that
  // shipped it should still read as intent: a tone and a message, not an ambiguous bare string.
  const called = readFileSync('src/ui/app/routes/name.js', 'utf8');
  const bareStrings = [...called.matchAll(/(?<![\w.])toast\(\s*'/g)].length;
  eq('the Domain route passes an explicit tone + message, not a bare string', bareStrings, 0);
}

// =============================================================================================
console.log('');
if (failures) {
  console.error(`toast checks: ${checks - failures} passed, ${failures} failed.`);
  process.exit(1);
}
console.log(`All toast checks passed: ${checks}/${checks}.`);
process.exit(0);
