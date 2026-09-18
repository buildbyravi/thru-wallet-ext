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
      remove: async (key) => {
        const keys = Array.isArray(key) ? key : [key];
        for (const k of keys) storage.delete(k);
      },
      clear: async () => storage.clear(),
    },
    session: {
      get: async (key) => ({ [key]: session.get(key) }),
      set: async (obj) => {
        for (const [k, v] of Object.entries(obj)) session.set(k, v);
      },
      remove: async (key) => {
        const keys = Array.isArray(key) ? key : [key];
        for (const k of keys) session.delete(k);
      },
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
const autoLockMissingPassword = await handleApiRequest({ method: 'system.setAutoLock', params: { minutes: 30 } });
assert.equal(autoLockMissingPassword.ok, false);
assert.equal(autoLockMissingPassword.error.code, 'AUTH_REQUIRED');
console.log('  ok - auto-lock change rejects missing password');

const autoLockWrongPassword = await handleApiRequest({
  method: 'system.setAutoLock',
  params: { minutes: 30, password: 'WrongPassword!' },
});
assert.equal(autoLockWrongPassword.ok, false);
assert.equal(autoLockWrongPassword.error.code, 'AUTH_REQUIRED');
console.log('  ok - auto-lock change rejects wrong password');

const resSet1 = await handleApiRequest({
  method: 'system.setAutoLock',
  params: { minutes: 30, password: 'Password123!' },
});
assert.equal(resSet1.ok, true);
assert.equal(resSet1.data.autoLockMinutes, 30);
const resGet1 = await handleApiRequest({ method: 'system.getAutoLock' });
assert.equal(resGet1.data, 30);
console.log('  ok - setting auto-lock to 30 min persists after password re-auth');

const resSetNever = await handleApiRequest({
  method: 'system.setAutoLock',
  params: { minutes: 0, password: 'Password123!' },
});
assert.equal(resSetNever.ok, true);
assert.equal(resSetNever.data.autoLockMinutes, 0);
const resGetNever = await handleApiRequest({ method: 'system.getAutoLock' });
assert.equal(resGetNever.data, 0);
console.log('  ok - setting auto-lock to 0 (Never) is password-gated');

await handleApiRequest({ method: 'wallet.lock' });
const autoLockWhileLocked = await handleApiRequest({
  method: 'system.setAutoLock',
  params: { minutes: 15, password: 'Password123!' },
});
assert.equal(autoLockWhileLocked.ok, false);
assert.equal(autoLockWhileLocked.error.code, 'WALLET_LOCKED');
await handleApiRequest({ method: 'wallet.unlock', params: { password: 'Password123!' } });
console.log('  ok - auto-lock change is refused while locked');

console.log('[8] Signing re-authentication defaults to on and is password-gated');
const prefsDefault = await handleApiRequest({ method: 'settings.get' });
assert.equal(prefsDefault.ok, true);
assert.equal(prefsDefault.data.requirePasswordForSigning, true);

const signingWithoutPassword = [
  ['tx.send', { toAddress: res2.data.address, amountUnits: '1' }],
  ['tx.claimFaucet', { amountUnits: '1' }],
  ['tx.autoCreateAccount', {}],
  ['token.deploy', {
    mintSeed: 'a'.repeat(64),
    name: 'Audit Token',
    symbol: 'AUDIT',
    decimals: 6,
    description: '',
    imageUrl: '',
  }],
];
for (const [method, params] of signingWithoutPassword) {
  const res = await handleApiRequest({ method, params });
  assert.equal(res.ok, false, `${method} without password must fail`);
  assert.equal(res.error.code, 'AUTH_REQUIRED', `${method} without password must require auth`);
}

const sendWrongPassword = await handleApiRequest({
  method: 'tx.send',
  params: { toAddress: res2.data.address, amountUnits: '1', password: 'wrong password' },
});
assert.equal(sendWrongPassword.ok, false);
assert.equal(sendWrongPassword.error.code, 'AUTH_REQUIRED');

const unsafeSettingsSet = await handleApiRequest({
  method: 'settings.set',
  params: { patch: { requirePasswordForSigning: false } },
});
assert.equal(unsafeSettingsSet.ok, false);
const disableWrongPassword = await handleApiRequest({
  method: 'settings.setSecurity',
  params: { patch: { requirePasswordForSigning: false }, password: 'wrong password' },
});
assert.equal(disableWrongPassword.ok, false);
assert.equal(disableWrongPassword.error.code, 'AUTH_REQUIRED');
const disableWithPassword = await handleApiRequest({
  method: 'settings.setSecurity',
  params: { patch: { requirePasswordForSigning: false }, password: 'Password123!' },
});
assert.equal(disableWithPassword.ok, true);
assert.equal(disableWithPassword.data.requirePasswordForSigning, false);

const sessionOnlySend = await handleApiRequest({
  method: 'tx.send',
  params: { toAddress: res2.data.address, amountUnits: '1' },
});
assert.equal(sessionOnlySend.ok, false);
assert.notEqual(sessionOnlySend.error.code, 'AUTH_REQUIRED');
assert.match(sessionOnlySend.error.message, /address you're sending from/i);

const enableWithPassword = await handleApiRequest({
  method: 'settings.setSecurity',
  params: { patch: { requirePasswordForSigning: true }, password: 'Password123!' },
});
assert.equal(enableWithPassword.ok, true);
assert.equal(enableWithPassword.data.requirePasswordForSigning, true);
console.log('  ok - signing auth rejects missing/wrong passwords and session-only opt-out reaches the signing handler');
console.log('[9] Every UI-facing response survives JSON serialization');
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

console.log('[10] Per-network data isolation');
// Getting the global-vs-scoped split wrong is a data-model bug that only surfaces the first
// time someone switches network — at which point they see the previous network's pending
// transactions and a token list of mints that do not exist where they now are.
const { GLOBAL_KEYS, SCOPED_KEYS, scopedKey, baseKeyOf, networkOf } =
  await import('./src/shared/network-scope.js');
const { listNetworks, listAllNetworks } = await import('./src/lib/networks.js');

const overlap = GLOBAL_KEYS.filter((k) => SCOPED_KEYS.includes(k));
assert.equal(overlap.length, 0, `a key cannot be both global and scoped: ${overlap.join(', ')}`);

// The vault must never be scoped. The same key controls the same address on every Thru
// network, so scoping it would make switching network look like the wallet had been erased.
for (const k of ['vault', 'unlocked_session', 'active_account_ref']) {
  assert.equal(GLOBAL_KEYS.includes(k), true, `${k} must be declared global`);
  assert.equal(SCOPED_KEYS.includes(k), false, `${k} must never be network-scoped`);
}
console.log('  ok - vault, session and active-ref keys are global, never scoped');

assert.equal(scopedKey('thru_pending_txs', 'alphanet'), 'thru_pending_txs::alphanet');
assert.equal(baseKeyOf('thru_pending_txs::alphanet'), 'thru_pending_txs');
assert.equal(networkOf('thru_pending_txs::alphanet'), 'alphanet');
assert.equal(networkOf('vault'), null, 'an unscoped key reports no network');
assert.throws(() => scopedKey('thru_pending_txs', ''), 'a missing network id must throw, not silently produce a global key');
console.log('  ok - scopedKey round-trips and refuses an empty network id');

// Only enabled networks are selectable; declared-but-unfinished ones stay out of the UI.
const selectable = listNetworks().map((n) => n.id);
const declared = listAllNetworks().map((n) => n.id);
assert.equal(selectable.includes('alphanet'), true, 'alphanet is selectable');
assert.equal(declared.includes('mainnet'), true, 'mainnet is declared');
assert.equal(selectable.includes('mainnet'), false, 'mainnet is NOT selectable while unverified');
assert.equal(declared.includes('testnet'), true, 'testnet is declared');
assert.equal(selectable.includes('testnet'), false, 'testnet is NOT selectable while unverified');
console.log(`  ok - ${selectable.length} of ${declared.length} networks selectable; unverified ones declared but disabled`);

// The real behavioural check: pending transactions must not leak across a network switch.
await handleApiRequest({ method: 'wallet.unlock', params: { password: 'Password123!' } });
const activeAcct = (await handleApiRequest({ method: 'account.getActive' })).data;

await handleApiRequest({ method: 'network.setActive', params: { networkId: 'alphanet' } });
const { track } = await import('./src/background/services/pending-tx-service.js');
await track({
  signature: 'sig-on-alphanet',
  kind: 'transfer',
  from: activeAcct.address,
  to: activeAcct.address,
  amountUnits: '1',
  networkId: 'alphanet',
});
const alphaPending = (await handleApiRequest({ method: 'tx.getPending' })).data;
assert.equal(alphaPending.some((r) => r.signature === 'sig-on-alphanet'), true, 'the record is visible on the network it was made on');

await handleApiRequest({ method: 'network.setActive', params: { networkId: 'localnet' } });
const localPending = (await handleApiRequest({ method: 'tx.getPending' })).data;
assert.equal(
  localPending.some((r) => r.signature === 'sig-on-alphanet'),
  false,
  'an alphanet transaction must NOT appear after switching to localnet',
);
console.log('  ok - pending transactions do not leak across a network switch');

await handleApiRequest({ method: 'network.setActive', params: { networkId: 'alphanet' } });
const backAgain = (await handleApiRequest({ method: 'tx.getPending' })).data;
assert.equal(
  backAgain.some((r) => r.signature === 'sig-on-alphanet'),
  true,
  'switching back restores that network\'s own records rather than having wiped them',
);
console.log('  ok - switching back preserves each network\'s own records');

// Account labels are the counter-example: they describe an address, not a chain, so they must
// survive a switch.
await handleApiRequest({ method: 'account.setLabel', params: { address: activeAcct.address, label: 'CrossNet' } });
await handleApiRequest({ method: 'network.setActive', params: { networkId: 'localnet' } });
const labelAfterSwitch = (await handleApiRequest({ method: 'account.getActive' })).data.label;
assert.equal(labelAfterSwitch, 'CrossNet', 'account labels are global and survive a network switch');
await handleApiRequest({ method: 'network.setActive', params: { networkId: 'alphanet' } });
console.log('  ok - account labels are global and survive a network switch');

console.log('[11] Contract-v7 custom-network quarantine is background-enforced');
const LEGACY_CUSTOM_ID = 'legacy-custom';
const legacyCustom = {
  id: LEGACY_CUSTOM_ID,
  name: 'Legacy custom',
  rpcUrl: 'https://legacy-node.example/rpc',
  explorerUrl: 'https://legacy-node.example/explorer',
  environment: 'devnet',
  nativeAsset: 'THRU',
};
storage.set('thru_custom_networks', [legacyCustom]);

// N1: a direct message-port request cannot activate a stored custom endpoint. Its permanent error
// must survive router normalization, and neither persisted selection nor thru-client binding moves.
const thruClient = await import('./src/lib/thru-client.js');
const { getNetworkConfig } = await import('./src/lib/networks.js');
await handleApiRequest({ method: 'network.setActive', params: { networkId: 'alphanet' } });
const configuredBeforeRefusal = { ...thruClient.getConfiguredNetwork() };
const storedBeforeRefusal = storage.get('thru_active_network');
const customRefusal = await handleApiRequest({
  method: 'network.setActive',
  params: { networkId: LEGACY_CUSTOM_ID },
});
assert.equal(customRefusal.ok, false);
assert.equal(customRefusal.error.code, 'CUSTOM_NETWORK_DISABLED');
assert.equal(customRefusal.error.retryable, false, 'a policy refusal must never offer Retry');
assert.match(customRefusal.error.message, /will not build or sign/i);
assert.equal(storage.get('thru_active_network'), storedBeforeRefusal,
  'rejection must not rewrite the active-network pointer');
assert.deepEqual(thruClient.getConfiguredNetwork(), configuredBeforeRefusal,
  'rejection must not bind thru-client to the custom endpoint');
console.log('  ok - direct custom activation is permanently refused with storage and RPC binding untouched');

// N2: legacy records remain visible for deletion and carry an explicit non-selectable contract.
const listedNetworks = await handleApiRequest({ method: 'network.list' });
assert.equal(listedNetworks.ok, true);
const listedBuiltIn = listedNetworks.data.find((network) => network.id === 'alphanet');
const listedCustom = listedNetworks.data.find((network) => network.id === LEGACY_CUSTOM_ID);
assert.equal(listedBuiltIn.selectable, true);
assert.equal(listedCustom.custom, true);
assert.equal(listedCustom.selectable, false);
assert.equal(listedCustom.label, 'Legacy custom');
assert.match(listedCustom.unselectableReason, /chain programs.*not verified/i);
console.log('  ok - network.list marks built-ins selectable and legacy custom records non-selectable');

// N3: network.getActive self-heals a legacy pointer before rebinding. Pre-binding the custom record
// here reproduces the unsafe state from contract v6 and proves the read returns to a verified built-in.
storage.set('thru_active_network', LEGACY_CUSTOM_ID);
thruClient.configureNetwork(legacyCustom);
assert.equal(thruClient.getConfiguredNetwork().id, LEGACY_CUSTOM_ID,
  'control: the old client accepted this incomplete custom record');
const healedActive = await handleApiRequest({ method: 'network.getActive' });
assert.equal(healedActive.ok, true);
assert.equal(healedActive.data.id, 'alphanet');
assert.equal(storage.get('thru_active_network'), 'alphanet');
assert.equal(thruClient.getConfiguredNetwork().id, 'alphanet');
assert.notEqual(thruClient.getConfiguredNetwork().rpcUrl, legacyCustom.rpcUrl);
console.log('  ok - network.getActive heals storage and binds alphanet instead of the legacy endpoint');

// N4: system.bootstrap is the fresh-worker startup path. Run it while locked so its background
// balance refresh cannot make a live RPC call; the network heal itself remains fully exercised.
await handleApiRequest({ method: 'wallet.lock' });
storage.set('thru_active_network', LEGACY_CUSTOM_ID);
thruClient.configureNetwork(legacyCustom);
const healedBootstrap = await handleApiRequest({ method: 'system.bootstrap' });
assert.equal(healedBootstrap.ok, true);
assert.equal(healedBootstrap.data.unlocked, false);
assert.equal(healedBootstrap.data.network.id, 'alphanet');
assert.equal(storage.get('thru_active_network'), 'alphanet');
assert.equal(thruClient.getConfiguredNetwork().id, 'alphanet');
await handleApiRequest({
  method: 'wallet.unlock',
  params: { password: 'Password123!' },
});
console.log('  ok - startup bootstrap self-heals before any custom endpoint can be bound');

// N5: declared-but-disabled networks are not a bypass, either by direct request or stale storage.
const disabledRefusal = await handleApiRequest({
  method: 'network.setActive',
  params: { networkId: 'testnet' },
});
assert.equal(disabledRefusal.ok, false);
assert.match(disabledRefusal.error.message, /unknown network/i);
assert.equal(storage.get('thru_active_network'), 'alphanet');
storage.set('thru_active_network', 'testnet');
thruClient.configureNetwork(getNetworkConfig('localnet'));
const healedDisabled = await handleApiRequest({ method: 'network.getActive' });
assert.equal(healedDisabled.ok, true);
assert.equal(healedDisabled.data.id, 'alphanet');
assert.equal(storage.get('thru_active_network'), 'alphanet');
assert.equal(thruClient.getConfiguredNetwork().id, 'alphanet');
console.log('  ok - disabled built-ins are refused directly and healed when found in storage');

// N6/N7: removal is still available to an unlocked wallet, including when it is the first call to
// encounter a stale pointer. Unknown removals fail rather than pretending success.
storage.set('thru_active_network', LEGACY_CUSTOM_ID);
thruClient.configureNetwork(legacyCustom);
const removedCustom = await handleApiRequest({
  method: 'network.removeCustom',
  params: { networkId: LEGACY_CUSTOM_ID },
});
assert.equal(removedCustom.ok, true);
assert.equal(removedCustom.data.removed, LEGACY_CUSTOM_ID);
assert.equal(storage.get('thru_custom_networks').length, 0);
assert.equal(storage.get('thru_active_network'), 'alphanet');
assert.equal(thruClient.getConfiguredNetwork().id, 'alphanet');
const removedAgain = await handleApiRequest({
  method: 'network.removeCustom',
  params: { networkId: LEGACY_CUSTOM_ID },
});
assert.equal(removedAgain.ok, false);
assert.match(removedAgain.error.message, /unknown network/i);
const deletedActivation = await handleApiRequest({
  method: 'network.setActive',
  params: { networkId: LEGACY_CUSTOM_ID },
});
assert.equal(deletedActivation.ok, false);
assert.notEqual(deletedActivation.error.code, 'CUSTOM_NETWORK_DISABLED',
  'a deleted record is unknown, not a stored custom network');
assert.equal(storage.get('thru_active_network'), 'alphanet');
console.log('  ok - removal remains available; deleted/unknown ids cannot become active');

console.log('[12] Reset is background-enforced');
const resetMissingConfirmation = await handleApiRequest({ method: 'wallet.reset' });
assert.equal(resetMissingConfirmation.ok, false);
assert.equal(resetMissingConfirmation.error.code, 'AUTH_REQUIRED');
console.log('  ok - reset rejects missing confirmation on a direct API call');

const resetMissingPassword = await handleApiRequest({ method: 'wallet.reset', params: { confirmation: 'RESET' } });
assert.equal(resetMissingPassword.ok, false);
assert.equal(resetMissingPassword.error.code, 'AUTH_REQUIRED');
console.log('  ok - reset rejects an unlocked session without password');

const resetWrongPassword = await handleApiRequest({
  method: 'wallet.reset',
  params: { confirmation: 'RESET', password: 'WrongPassword!' },
});
assert.equal(resetWrongPassword.ok, false);
assert.equal(resetWrongPassword.error.code, 'AUTH_REQUIRED');
assert.equal((await handleApiRequest({ method: 'wallet.hasVault' })).data, true);
console.log('  ok - reset rejects a wrong password and leaves the vault intact');

session.clear(); // Simulates a service-worker/session restart while the encrypted vault remains.
const unlockedAfterRestart = await handleApiRequest({ method: 'wallet.isUnlocked' });
assert.equal(unlockedAfterRestart.data, false);
const lockedReset = await handleApiRequest({ method: 'wallet.reset', params: { confirmation: 'RESET' } });
assert.equal(lockedReset.ok, true);
assert.equal((await handleApiRequest({ method: 'wallet.hasVault' })).data, false);
console.log('  ok - locked forgotten-password reset succeeds with confirmation after worker restart');

const recreated = await handleApiRequest({ method: 'wallet.create', params: { password: 'Password123!' } });
assert.equal(recreated.ok, true);
const unlockedReset = await handleApiRequest({
  method: 'wallet.reset',
  params: { confirmation: 'RESET', password: 'Password123!' },
});
assert.equal(unlockedReset.ok, true);
assert.equal((await handleApiRequest({ method: 'wallet.hasVault' })).data, false);
console.log('  ok - unlocked reset succeeds only with confirmation and password');

console.log('\nAll background API router integration tests passed.');

