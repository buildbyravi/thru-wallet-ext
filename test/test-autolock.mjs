// Auto-lock regression suite.
//
// The idle clock must survive service-worker restarts: chrome.alarms wakes (and therefore
// restarts) the worker on every tick, so any unconditional activity stamp at worker start
// resets the clock moments before each check and auto-lock can never fire. That was the
// bug behind "I set 1 min lock, 30 minutes passed, still open".
//
// Also pins: the settings write arms the check alarm, the inactivity comparison itself,
// the no-stamp safety fallback, the never-lock option, and the lock-badge toolbar icon.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const localData = new Map();
const sessionData = new Map();
const alarms = new Map();
let lastIcon = null;

globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        return { [key]: localData.get(key) };
      },
      async set(next) {
        for (const [k, v] of Object.entries(next)) localData.set(k, v);
      },
    },
    session: {
      async get(key) {
        return { [key]: sessionData.get(key) };
      },
      async set(next) {
        for (const [k, v] of Object.entries(next)) sessionData.set(k, v);
      },
    },
  },
  alarms: {
    create(name, opts) {
      alarms.set(name, opts);
    },
    clear(name) {
      return alarms.delete(name);
    },
    async get(name) {
      return alarms.has(name) ? { name, ...alarms.get(name) } : undefined;
    },
  },
  action: {
    async setIcon({ path }) {
      lastIcon = path;
    },
  },
};

const system = await import('../src/background/services/system-service.js');
const { syncActionIcon } = await import('../src/background/services/icon-service.js');

// ---- The settings write arms the check alarm -------------------------------
const set = await system.setAutoLockMinutes(1);
assert.equal(set.autoLockMinutes, 1);
assert.equal(localData.get('thru_system_autolock_minutes'), 1);
assert.ok(alarms.has('thru-auto-lock'), 'a 1-minute window arms the check alarm');
assert.equal(alarms.get('thru-auto-lock').periodInMinutes, 1);
console.log('  ok - setAutoLockMinutes(1) persists the window and arms the heartbeat alarm');

// ---- The inactivity comparison itself -------------------------------------
sessionData.set('thru_last_activity_at', Date.now() - 120_000);
assert.equal(await system.shouldAutoLock(), true,
  'two idle minutes with a 1-minute window must lock');
sessionData.set('thru_last_activity_at', Date.now() - 5_000);
assert.equal(await system.shouldAutoLock(), false,
  'recent activity keeps the session');
console.log('  ok - shouldAutoLock compares the idle stamp against the window');

// ---- No stamp means "unknown", never "locked out" -------------------------
sessionData.delete('thru_last_activity_at');
assert.equal(await system.shouldAutoLock(), false, 'a session with no stamp is not locked out');
assert.ok(Number(sessionData.get('thru_last_activity_at')) > 0, 'the fallback stamps activity');
console.log('  ok - a missing stamp is stamped, not treated as idle since epoch');

// ---- Never-lock option ----------------------------------------------------
await system.setAutoLockMinutes(0);
assert.ok(!alarms.has('thru-auto-lock'), 'minutes=0 clears the alarm');
assert.equal(await system.shouldAutoLock(), false, '0 means never lock');
await system.setAutoLockMinutes(1);
console.log('  ok - the never-lock option disables auto-lock cleanly');

// ---- THE REGRESSION: worker start must not touch the idle clock -----------
// The startup path may arm the alarm and sync the icon, but must not call
// touchActivity(): alarms restart the worker on every tick, and a boot-time stamp made
// every check see "active just now".
const bootSrc = (await readFile(new URL('../src/background/index.js', import.meta.url), 'utf8'))
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');
assert.ok(!/^\s*touchActivity\(\);/m.test(bootSrc),
  'worker start must not stamp activity (it resets the idle clock every alarm tick)');
assert.ok(bootSrc.includes('ensureAutoLockAlarm();'), 'worker start still arms the alarm');
console.log('  ok - service-worker start arms the alarm without resetting the idle clock');

// ---- The toolbar icon follows lock state ----------------------------------
localData.delete('vault');
sessionData.delete('unlocked_session');
await syncActionIcon();
assert.equal(lastIcon?.[16], 'icons/icon16.png', 'no vault yet: plain icon (onboarding)');
localData.set('vault', { salt: 'x', v: 2 });
sessionData.delete('unlocked_session');
await syncActionIcon();
assert.equal(lastIcon?.[16], 'icons/icon16-locked.png', 'vault present, no session: lock badge');
sessionData.set('unlocked_session', { vaultData: {}, rawKeyB64: 'x' });
await syncActionIcon();
assert.equal(lastIcon?.[16], 'icons/icon16.png', 'live session: plain icon');
console.log('  ok - the toolbar icon shows the lock badge exactly when the wallet is locked');

console.log('Auto-lock regression tests passed.');
