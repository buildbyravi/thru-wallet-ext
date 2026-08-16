import assert from 'node:assert/strict';
import { handleApiRequest } from './src/background/api-router.js';

// Setup fake chrome storage
const storage = new Map();
const session = new Map();

globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        if (typeof keys === 'string') return { [keys]: storage.get(keys) };
        if (Array.isArray(keys)) {
          const res = {};
          for (const k of keys) res[k] = storage.get(k);
          return res;
        }
        return Object.fromEntries(storage.entries());
      },
      set: async (obj) => {
        for (const [k, v] of Object.entries(obj)) storage.set(k, v);
      },
      remove: async (key) => storage.delete(key),
      clear: async () => storage.clear(),
    },
    session: {
      get: async (key) => ({ [key]: session.get(key) }),
      set: async (obj) => {
        for (const [k, v] of Object.entries(obj)) session.set(k, v);
      },
      remove: async (key) => session.delete(key),
      clear: async () => session.clear(),
    },
  },
};

console.log('[1] System bootstrap without vault');
const res1 = await handleApiRequest({ method: 'system.bootstrap' });
assert.equal(res1.ok, true);
assert.equal(res1.data.hasVault, false);
assert.equal(res1.data.unlocked, false);
assert.equal(res1.data.network.id, 'alphanet');
console.log('  ok - bootstrap reports hasVault: false');

console.log('[2] Create vault via API router');
const res2 = await handleApiRequest({ method: 'wallet.create', params: { password: 'Password123!' } });
assert.equal(res2.ok, true);
assert.ok(res2.data.mnemonic);
assert.ok(res2.data.address.startsWith('ta'));
console.log('  ok - wallet.create returned mnemonic and address');

console.log('[3] System bootstrap after unlock');
const res3 = await handleApiRequest({ method: 'system.bootstrap' });
assert.equal(res3.ok, true);
assert.equal(res3.data.hasVault, true);
assert.equal(res3.data.unlocked, true);
assert.ok(res3.data.account);
assert.equal(res3.data.account.address, res2.data.address);
assert.equal(res3.data.accounts.length, 1);
console.log('  ok - bootstrap returns active account and list');

console.log('[4] Account management: Add HD account & switch');
const res4 = await handleApiRequest({ method: 'account.addHd' });
assert.equal(res4.ok, true);
const res5 = await handleApiRequest({ method: 'account.list' });
assert.equal(res5.ok, true);
assert.equal(res5.data.length, 2);
console.log('  ok - account.addHd created second account');

console.log('[5] Account renaming via API router');
const accountsList = (await handleApiRequest({ method: 'account.list' })).data;
await handleApiRequest({
  method: 'account.switch',
  params: { ref: accountsList[0].ref }
});
const res6 = await handleApiRequest({
  method: 'account.setLabel',
  params: { address: accountsList[0].address, label: 'Primary Savings' }
});
assert.equal(res6.ok, true);
const res7 = await handleApiRequest({ method: 'account.getActive' });
assert.equal(res7.data.label, 'Primary Savings');
console.log('  ok - account label updated and returned in getActive');

console.log('[6] Lock and unlock via API router');
await handleApiRequest({ method: 'wallet.lock' });
const res8 = await handleApiRequest({ method: 'wallet.isUnlocked' });
assert.equal(res8.data, false);
await handleApiRequest({ method: 'wallet.unlock', params: { password: 'Password123!' } });
const res9 = await handleApiRequest({ method: 'wallet.isUnlocked' });
assert.equal(res9.data, true);
console.log('  ok - lock and unlock cycle works via API router');

console.log('[7] Auto-lock configuration via API router');
const resSet1 = await handleApiRequest({ method: 'system.setAutoLock', params: { minutes: 30 } });
assert.equal(resSet1.ok, true);
assert.equal(resSet1.data.autoLockMinutes, 30);
const resGet1 = await handleApiRequest({ method: 'system.getAutoLock' });
assert.equal(resGet1.data, 30);
console.log('  ok - setting auto-lock to 30 min persists');

const resSetNever = await handleApiRequest({ method: 'system.setAutoLock', params: { minutes: 0 } });
assert.equal(resSetNever.ok, true);
assert.equal(resSetNever.data.autoLockMinutes, 0);
const resGetNever = await handleApiRequest({ method: 'system.getAutoLock' });
assert.equal(resGetNever.data, 0);
console.log('  ok - setting auto-lock to 0 (Never) persists');

console.log('[8] Every UI-facing response survives JSON serialization');
// chrome.runtime.sendMessage serializes with JSON, and JSON.stringify THROWS on a BigInt,
// which Chrome reports only as the opaque "Could not serialize message." networks.js carries
// faucetMaxPerClaim as a BigInt, so network.getActive / network.setActive / network.list and
// system.bootstrap (which embeds a network) all failed at the port. The legacy UI masked it
// with a try/catch that fell back to individual queries, so the visible symptom was a slow
// start and a blank balance rather than an error.
//
// This walks the real responses and fails on any value the port cannot carry, so the whole
// class is caught here instead of in front of a user.
function findUnserializable(value, path = '$', seen = new WeakSet()) {
  const t = typeof value;
  if (t === 'bigint') return `${path} is a BigInt (${value}n)`;
  if (t === 'function') return `${path} is a function`;
  if (t === 'symbol') return `${path} is a symbol`;
  if (t === 'undefined' || value === null) return null;
  if (t !== 'object') return null;
  if (value instanceof Date || value instanceof RegExp) return null;
  if (seen.has(value)) return `${path} is circular`;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findUnserializable(value[i], `${path}[${i}]`, seen);
      if (hit) return hit;
    }
    return null;
  }
  if (value instanceof Uint8Array) return `${path} is a Uint8Array (would become an object)`;
  for (const [k, v] of Object.entries(value)) {
    const hit = findUnserializable(v, `${path}.${k}`, seen);
    if (hit) return hit;
  }
  return null;
}

await handleApiRequest({ method: 'wallet.unlock', params: { password: 'Password123!' } });

const SERIALIZATION_PROBES = [
  ['system.bootstrap', {}],
  ['network.getActive', {}],
  ['network.list', {}],
  ['network.setActive', { networkId: 'alphanet' }],
  ['account.getActive', {}],
  ['account.list', { withBalances: true }],
  ['account.getActiveRef', {}],
  ['keyring.list', {}],
  ['settings.get', {}],
  ['contacts.list', {}],
  ['token.list', {}],
  ['tx.getPending', {}],
  ['wallet.getLockoutState', {}],
];

for (const [method, params] of SERIALIZATION_PROBES) {
  const res = await handleApiRequest({ method, params });
  const offender = findUnserializable(res, method);
  assert.equal(
    offender,
    null,
    `${method} returned something the message port cannot serialize: ${offender}`,
  );
  // Belt and braces: prove the actual serializer accepts it.
  try {
    JSON.stringify(res);
  } catch (error) {
    assert.fail(`${method} response is not JSON-serializable: ${error.message}`);
  }
}
console.log(`  ok - all ${SERIALIZATION_PROBES.length} probed responses are JSON-safe (no BigInt at the port)`);

// Guard the specific field that caused it, and confirm the value is preserved as a string
// rather than silently dropped.
const netRes = await handleApiRequest({ method: 'network.getActive' });
assert.equal(netRes.ok, true);
assert.equal(
  typeof netRes.data.faucetMaxPerClaim,
  'string',
  'faucetMaxPerClaim must cross the port as a string, not a BigInt',
);
assert.equal(BigInt(netRes.data.faucetMaxPerClaim) > 0n, true, 'the value must survive, not be nulled');
console.log('  ok - faucetMaxPerClaim is preserved as a string and re-widens to BigInt');

console.log('\nAll background API router integration tests passed.');

