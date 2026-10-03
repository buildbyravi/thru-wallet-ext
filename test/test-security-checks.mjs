// Security posture evaluation (src/shared/security-checks.js) — pure logic, no DOM.
//
// The Security tile used to be a "coming soon" banner. These checks pin the honesty rules the
// real sheet depends on: unknown is never a pass, only ok/warn are graded, and no protocol
// behaviour is claimed that the extension does not have.

import assert from 'node:assert/strict';
import { evaluateSecurity, CHECK_STATUS } from '../src/shared/security-checks.js';

let passed = 0;
function ok(name, cond, detail = '') {
  assert.ok(cond, `${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`  ok - ${name}`);
  passed += 1;
}
const byId = (result, id) => result.checks.find((c) => c.id === id);

console.log('\n[a fully protected wallet]');
{
  const r = evaluateSecurity({
    prefs: { requirePasswordForSigning: true, enforceWhitelist: true, whitelist: ['a', 'b'] },
    autoLockMinutes: 15,
    keyrings: [{ id: 'k1', type: 'seed', origin: 'generated', backedUpAt: 1 }],
  });
  ok('level is good', r.level === 'good');
  // backup + auto-lock + signing + an ENABLED whitelist are all graded; a disabled whitelist is not.
  ok('every graded check is ok', r.okCount === r.gradedCount && r.gradedCount === 4, `${r.okCount}/${r.gradedCount}`);
  ok('whitelist count is stated', byId(r, 'whitelist').detail.includes('2 saved addresses'));
}

console.log('\n[an unbacked generated phrase is the first thing to fix]');
{
  const r = evaluateSecurity({
    prefs: { requirePasswordForSigning: false, enforceWhitelist: false, whitelist: [] },
    autoLockMinutes: 15,
    keyrings: [{ id: 'k 1', type: 'seed', origin: 'generated', label: 'Main', backedUpAt: null }],
  });
  const backup = byId(r, 'backup');
  ok('backup is a warning', backup.status === CHECK_STATUS.WARN);
  ok('backup routes to the keyring screen with an encoded id', backup.action.route === '/keyring?id=k%201', backup.action.route);
  ok('level needs attention', r.level === 'attention');
  ok('unsigned-session protection is a warning', byId(r, 'signing').status === CHECK_STATUS.WARN);
}

console.log('\n[imported phrases and keys do not nag]');
{
  const seedImported = evaluateSecurity({
    prefs: {}, autoLockMinutes: 5,
    keyrings: [{ id: 'k', type: 'seed', origin: 'imported', backedUpAt: null }],
  });
  ok('an imported phrase is not flagged as unbacked', byId(seedImported, 'backup').status === CHECK_STATUS.OK);
  const keysOnly = evaluateSecurity({
    prefs: {}, autoLockMinutes: 5,
    keyrings: [{ id: 'k', type: 'privateKey', origin: 'imported' }],
  });
  ok('imported keys only is informational, not graded', byId(keysOnly, 'backup').status === CHECK_STATUS.INFO);
}

console.log('\n[auto-lock]');
{
  const off = evaluateSecurity({ prefs: {}, autoLockMinutes: 0, keyrings: [] });
  ok('never-lock (0) is a warning', byId(off, 'autolock').status === CHECK_STATUS.WARN);
  const on = evaluateSecurity({ prefs: {}, autoLockMinutes: 60, keyrings: [] });
  ok('a positive window is ok and labelled', byId(on, 'autolock').detail.includes('1 hr'), byId(on, 'autolock').detail);
}

console.log('\n[unknown is never assumed good or bad]');
{
  const r = evaluateSecurity({ prefs: null, autoLockMinutes: null, keyrings: null });
  ok('every unreadable check is unknown', ['backup', 'autolock', 'signing'].every((id) => byId(r, id).status === CHECK_STATUS.UNKNOWN));
  ok('nothing is graded when nothing could be read', r.gradedCount === 0 && r.okCount === 0);
  ok('level is unknown, not good', r.level === 'unknown');
  ok('no whitelist row is invented without preferences', !byId(r, 'whitelist'));
}

console.log('\n[optional and contextual rows never lower the grade]');
{
  const r = evaluateSecurity({
    prefs: { requirePasswordForSigning: true, enforceWhitelist: false, whitelist: [] },
    autoLockMinutes: 15,
    keyrings: [{ id: 'k', type: 'seed', origin: 'generated', backedUpAt: 1 }],
  });
  ok('an off whitelist is info, not a warning', byId(r, 'whitelist').status === CHECK_STATUS.INFO);
  ok('the wallet still grades as good', r.level === 'good' && r.gradedCount === 3, String(r.gradedCount));
  ok('the test-network row is informational', byId(r, 'network').status === CHECK_STATUS.INFO);
  ok('site connections do not claim a provider that does not exist',
    byId(r, 'connections').detail.includes('does not expose a provider'));
  const main = evaluateSecurity({ prefs: {}, autoLockMinutes: 15, keyrings: [], isTestNetwork: false });
  ok('the test-network row disappears on mainnet', !byId(main, 'network'));
}

console.log(`\nsecurity-check tests: ${passed} passed.`);
