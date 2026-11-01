#!/usr/bin/env node
// Review lifecycle — consent does not survive a session boundary.
//
// WHY THIS SUITE EXISTS
//
// A prepared review lives 120 seconds in chrome.storage. It is bound to an account, a network and
// a binding hash, and `tx.confirmReview` re-checks all three — which is sound. But until this
// suite existed nothing discarded a review when the wallet LOCKED, the account changed or the
// network changed: a review prepared before a lock could be confirmed after it, and "the user
// approved this" would have been true only of a wallet state that no longer existed.
//
// The check is deliberately at the boundary, not in the card: the card is one of several callers,
// and a rule enforced by a UI component is a rule the next caller does not have to follow.
//
//   [0] a prepared review is stored and readable
//   [1] lock discards every prepared review, on every network
//   [2] account switch discards
//   [3] network switch discards
//   [4] a discarded review cannot be confirmed (REVIEW_NOT_FOUND, never a silent re-sign)
//   [5] an unrelated call discards NOTHING (the control: the assertions above can fail)
//
// Real background services, real store, real router; only chrome.storage is the in-memory shim.

import assert from 'node:assert/strict';

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
      set: async (obj) => { for (const [k, v] of Object.entries(obj)) storage.set(k, v); },
      remove: async (key) => {
        const keys = Array.isArray(key) ? key : [key];
        for (const k of keys) storage.delete(k);
      },
      clear: async () => storage.clear(),
    },
    session: {
      get: async (key) => ({ [key]: session.get(key) }),
      set: async (obj) => { for (const [k, v] of Object.entries(obj)) session.set(k, v); },
      remove: async (key) => {
        const keys = Array.isArray(key) ? key : [key];
        for (const k of keys) session.delete(k);
      },
      clear: async () => session.clear(),
    },
  },
  runtime: { sendMessage: async () => ({}), onMessage: { addListener: () => {} } },
};

const { handleApiRequest } = await import('../src/background/api-router.js');
const store = await import('../src/background/services/review/store.js');
const { scopedKey } = await import('../src/shared/network-scope.js');

let checks = 0;
let failures = 0;
function ok(label, condition, detail = '') {
  checks += 1;
  if (!condition) failures += 1;
  console.log(`  ${condition ? 'ok' : 'FAIL'} - ${label}${detail ? ` (${detail})` : ''}`);
}
function section(title) { console.log(`\n${title}`); }

/** Every live prepared-review key currently in storage. */
function reviewKeys() {
  return [...storage.keys()].filter((key) => key.startsWith(`${store.REVIEW_BASE_KEY}::`));
}

async function prepareFakeRecord(reviewId, networkId = 'betanet') {
  await store.put(networkId, {
    reviewId,
    kind: 'native-send',
    facts: { amountUnits: '1', toAddress: 'ta-test' },
    bindingHash: 'hash',
    acknowledgements: [],
    expiresAt: Date.now() + 60_000,
    createdAt: Date.now(),
  });
  return store.get(networkId, reviewId);
}

// ---------------------------------------------------------------------------------------------
section('[1] a fresh wallet');
const created = await handleApiRequest({ method: 'wallet.create', params: { password: 'Password123!' } });
ok('the wallet is created and unlocked', created.ok === true && created.data.address.startsWith('ta'));

// ---------------------------------------------------------------------------------------------
section('[0] a prepared review is stored and readable');
const record = await prepareFakeRecord('review-1');
ok('the review round-trips through the store', record?.reviewId === 'review-1');
ok('exactly one review key exists', reviewKeys().length === 1, reviewKeys().join(','));

// A second record on another network proves the discard is not scoped to the active network.
await prepareFakeRecord('review-2', 'testnet');
ok('a review on another network is stored too', reviewKeys().length === 2, reviewKeys().join(','));

// ---------------------------------------------------------------------------------------------
section('[5] control — an unrelated call discards nothing');
await handleApiRequest({ method: 'system.bootstrap' });
ok('a read call leaves both reviews in place', reviewKeys().length === 2,
  `${reviewKeys().length} keys`);
ok('and the record is still readable', (await store.get('betanet', 'review-1'))?.reviewId === 'review-1');

// ---------------------------------------------------------------------------------------------
section('[2] an account switch discards prepared reviews');
const added = await handleApiRequest({ method: 'account.addHd' });
ok('a second account exists to switch to', added.ok === true);
const accounts = (await handleApiRequest({ method: 'account.list' })).data;
const switched = await handleApiRequest({ method: 'account.switch', params: { ref: accounts[1].ref } });
ok('the switch succeeded', switched.ok === true);
ok('every prepared review is gone', reviewKeys().length === 0, reviewKeys().join(','));

// ---------------------------------------------------------------------------------------------
section('[3] a network switch discards prepared reviews');
await prepareFakeRecord('review-3');
ok('a review exists before the switch', reviewKeys().length === 1);
const net = await handleApiRequest({ method: 'network.setActive', params: { networkId: 'betanet' } });
ok('the network call still answers with the public network shape',
  net.ok === true && net.data?.id === 'betanet', JSON.stringify(net.data ?? net.error));
ok('the review is gone after a network switch', reviewKeys().length === 0, reviewKeys().join(','));

// ---------------------------------------------------------------------------------------------
section('[1] a lock discards prepared reviews');
await prepareFakeRecord('review-4');
await prepareFakeRecord('review-5', 'testnet');
ok('two reviews exist before locking', reviewKeys().length === 2);
const locked = await handleApiRequest({ method: 'wallet.lock' });
ok('the lock succeeded', locked.ok === true);
ok('the session is locked', (await handleApiRequest({ method: 'wallet.isUnlocked' })).data === false);
ok('every review key is removed, on every network', reviewKeys().length === 0, reviewKeys().join(','));

// ---------------------------------------------------------------------------------------------
section('[4] a discarded review cannot be confirmed');
await handleApiRequest({ method: 'wallet.unlock', params: { password: 'Password123!' } });
const confirm = await handleApiRequest({
  method: 'tx.confirmReview',
  params: { reviewId: 'review-4', bindingHash: 'hash', acknowledgements: [] },
});
ok('confirming a discarded review fails', confirm.ok === false, JSON.stringify(confirm.error));
ok('the failure is REVIEW_NOT_FOUND, not a silent success',
  confirm.error?.code === 'REVIEW_NOT_FOUND', confirm.error?.code ?? 'none');

// The store is empty, not merely unreadable: a later read must not resurrect the record.
ok('a direct store read finds nothing either', (await store.get('betanet', 'review-4')) === null);

// ---------------------------------------------------------------------------------------------
section('[6] reset also clears (the other session boundary)');
await prepareFakeRecord('review-6');
ok('a review exists before the reset', reviewKeys().length === 1);
const reset = await handleApiRequest({
  method: 'wallet.reset',
  params: { confirmation: 'RESET', password: 'Password123!' },
});
ok('the reset succeeded', reset.ok === true, JSON.stringify(reset.error));
ok('no review survives a wallet reset', reviewKeys().length === 0, reviewKeys().join(','));

// ---------------------------------------------------------------------------------------------
console.log('');
if (failures) {
  console.error(`review-lifecycle checks: ${checks - failures} passed, ${failures} failed.`);
  process.exit(1);
}
console.log(`All review-lifecycle checks passed: ${checks}/${checks}.`);
process.exit(0);
