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

console.log('\nAll background API router integration tests passed.');

