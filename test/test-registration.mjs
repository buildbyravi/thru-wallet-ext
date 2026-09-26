// Registration is targeted to a wallet-owned address, including a non-active HD account.
// The fake SDK never makes an RPC or exposes a key over the API router's JSON seam.
import assert from 'node:assert/strict';
import { keys, Pubkey } from '@thru/sdk';
import { handleApiRequest } from '../src/background/api-router.js';
import * as vault from '../src/lib/vault.js';
import * as thruClient from '../src/lib/thru-client.js';
import { getNetworkConfig } from '../src/lib/networks.js';
import { registerCreatedAccount } from '../src/background/services/registration-service.js';

function store() {
  const data = new Map();
  return {
    async get(key) {
      if (key == null) return Object.fromEntries(data);
      if (Array.isArray(key)) return Object.fromEntries(key.map((k) => [k, data.get(k)]));
      return { [key]: data.get(key) };
    },
    async set(next) { for (const [k, v] of Object.entries(next)) data.set(k, v); },
    async remove(key) { for (const k of Array.isArray(key) ? key : [key]) data.delete(k); },
    async clear() { data.clear(); },
  };
}

globalThis.chrome = {
  runtime: { sendMessage: () => Promise.resolve() },
  storage: { local: store(), session: store() },
};

async function call(method, params = {}) {
  const result = await handleApiRequest({ method, params });
  assert.equal(result.ok, true, `${method}: ${result.error?.message || 'unexpected failure'}`);
  return result.data;
}

async function waitUntil(predicate, description) {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
    // Deriving several HD accounts uses async crypto; a fixed number of setImmediate turns
    // can finish before the SDK reaches its proof hook, even on a healthy machine.
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const denied = await handleApiRequest({ method: 'tx.registerAccount', params: { address: 'junk' } });
assert.equal(denied.error.code, 'WALLET_LOCKED');
const created = await call('wallet.create', { password: 'Registration123!' });
const batch = await call('account.addHdBatch', {
  keyringId: (await call('account.getActive')).ref.keyringId, indices: [1, 2],
});
assert.deepEqual(batch.added, [1, 2]);
const accounts = await vault.listAccounts();
const [first, second, third] = accounts;
assert.equal(first.address, created.address);
await call('account.switch', { ref: first.ref });

const signed = [];
const proofs = [];
const broadcasts = [];
const chains = new Map();
function chainFor(id) {
  if (!chains.has(id)) chains.set(id, new Set());
  return chains.get(id);
}
function fakeClient(id) {
  const client = thruClient.getClient();
  client.accounts.get = async (address) => {
    if (chainFor(id).has(address)) return { meta: { balance: 0n } };
    throw Object.assign(new Error('Account not found'), { code: 5 });
  };
  client.proofs.generate = async ({ address }) => {
    proofs.push({ id, address });
    return { proof: { address } };
  };
  client.transactions.buildAndSign = async (request) => {
    signed.push({ id, ...request });
    return { rawTransaction: { address: request.feePayerStateProof.address } };
  };
  client.transactions.sendAndTrack = async function* ({ address }) {
    broadcasts.push({ id, address });
    chainFor(id).add(address);
    yield { executionResult: { vmError: 0 } }; // success without a fabricated signature
  };
  return client;
}

await call('network.setActive', { networkId: 'alphanet' });
let alphaClient = fakeClient('alphanet');
const foreign = (await keys.generateKeyPair()).address;
for (const address of ['bad-address', foreign]) {
  const refused = await handleApiRequest({ method: 'tx.registerAccount', params: { address } });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, address === foreign ? 'NOT_OWNED_ACCOUNT' : 'INVALID_ADDRESS');
}
assert.equal(proofs.length, 0, 'invalid or non-owned addresses cannot reach an RPC proof');
await call('settings.setSecurity', {
  password: 'Registration123!', patch: { requirePasswordForSigning: true },
});
const stillOwnedOnly = await handleApiRequest({ method: 'tx.registerAccount', params: { address: foreign } });
assert.equal(stillOwnedOnly.error.code, 'NOT_OWNED_ACCOUNT',
  'the explicitly unlocked-only v12 exception is not gated like value-moving sends');

// Even a backend caller cannot cross-sign: a claimed target address/public key paired with
// Account 1's private key must be refused BEFORE generating a registration proof or broadcasting.
await assert.rejects(
  thruClient.createOnChainAccount({ ...third, privateKey: first.privateKey }),
  (error) => error.code === 'REGISTRATION_SIGNER_MISMATCH',
);
await assert.rejects(
  thruClient.createOnChainAccount({ ...third, publicKey: first.publicKey }),
  (error) => error.code === 'REGISTRATION_SIGNER_MISMATCH',
);
assert.equal(proofs.length, 0);
assert.equal(signed.length, 0);
assert.equal(broadcasts.length, 0);
console.log('  ok - a different account\'s private key cannot sign the target\'s registration');

const own = await call('tx.registerAccount', { address: third.address });
assert.deepEqual(own, { address: third.address, networkId: 'alphanet',
  exists: true, created: true, signature: null });
assert.equal(broadcasts[0].address, third.address, 'the non-active destination was registered');
assert.equal((await call('account.getActive')).address, first.address, 'registration does not switch the sender');
assert.deepEqual(signed[0].feePayer.privateKey, third.privateKey, 'SDK signed with the recipient\'s OWN key');
assert.deepEqual(signed[0].feePayer.publicKey, third.publicKey, 'the fee payer is the TARGET, not Account 1');
assert.deepEqual(signed[0].feePayerStateProof, { address: third.address });
const alphaNet = getNetworkConfig('alphanet');
assert.equal(signed[0].program, alphaNet.accountCreateProgramId,
  'registration uses the configured account-creation program, not faucet or transfer');
assert.notEqual(signed[0].program, alphaNet.faucetProgramId);
assert.notEqual(signed[0].program, alphaNet.transferProgramId);
assert.deepEqual(signed[0].header, { fee: 0n, nonce: 0n, stateUnits: 1 },
  'the native self-registration header is exactly zero fee, zero nonce, and one state unit');
assert.ok(!JSON.stringify(own).includes('privateKey'), 'the result contains no key material');
const already = await call('tx.registerAccount', { address: third.address });
assert.equal(already.created, false);
assert.equal(broadcasts.length, 1, 'already registered account is not broadcast again');
console.log('  ok - an unlocked non-active OWN account signs once; foreign addresses cannot sign');

await call('network.setActive', { networkId: 'localnet' });
let localClient = fakeClient('localnet');
const local = await call('tx.registerAccount', { address: third.address });
assert.equal(local.networkId, 'localnet');
assert.equal(local.created, true, 'registration cannot reuse a signature from another chain');
assert.equal(broadcasts.at(-1).id, 'localnet');
console.log('  ok - a second network needs its own registration');

// Prove the guard runs AFTER a slow proof, not just at API entry. Neither a lock nor a
// network switch may sign using a key that was captured while the user was unlocked.
let finishProof;
const originalProof = localClient.proofs.generate;
localClient.proofs.generate = () => new Promise((resolve) => {
  finishProof = () => resolve({ proof: { address: second.address } });
});
const pendingLock = handleApiRequest({ method: 'tx.registerAccount', params: { address: second.address } });
await waitUntil(() => typeof finishProof === 'function', 'the proof before wallet lock');
const beforeLock = broadcasts.length;
await call('wallet.lock');
finishProof();
const locked = await pendingLock;
assert.equal(locked.error.code, 'WALLET_LOCKED');
assert.equal(broadcasts.length, beforeLock, 'locking before the proof returns prevents signing');
await call('wallet.unlock', { password: 'Registration123!' });

finishProof = null;
const pendingSwitch = handleApiRequest({ method: 'tx.registerAccount', params: { address: second.address } });
await waitUntil(() => typeof finishProof === 'function', 'the proof before network switch');
await call('network.setActive', { networkId: 'alphanet' });
finishProof();
const switched = await pendingSwitch;
assert.equal(switched.error.code, 'NETWORK_CHANGED');
assert.equal(broadcasts.length, beforeLock, 'a late proof cannot sign on the wrong chain');
localClient.proofs.generate = originalProof;
console.log('  ok - lock and network changes cancel a pending registration before signing');

// The first HD account is active after a batch add, but EVERY newly added index must register.
// Use a real vault, SDK-bound RPC fakes and the actual router; no dashboard visit is involved.
chrome.runtime.getManifest = () => ({ version: 'test' });
chrome.runtime.onMessage = { addListener() {} };
alphaClient = fakeClient('alphanet');
const priorCount = broadcasts.length;
const batch2 = await call('account.addHdBatch', { keyringId: first.ref.keyringId, indices: [3, 4] });
assert.deepEqual(batch2.added, [3, 4]);
const newAccounts = await vault.listAccounts();
const targets = newAccounts.slice(3, 5).map((a) => a.address);
await waitUntil(() => broadcasts.length >= priorCount + 2, 'both newly added HD registrations');
assert.deepEqual(broadcasts.slice(priorCount).map((r) => r.address).sort(), [...targets].sort());
assert.equal((await call('account.getActive')).address, targets[0]);
const repeatedBatch = await call('account.addHdBatch', { keyringId: first.ref.keyringId, indices: [3, 4] });
assert.deepEqual(repeatedBatch.added, []);
console.log('  ok - batched HD creation registers both new indices, not just the active one');
const singleStart = broadcasts.length;
const single = await call('account.addHd', { keyringId: first.ref.keyringId });
await call('account.switch', { ref: first.ref }); // a later choice must not retarget creation
await waitUntil(() => broadcasts.length > singleStart, 'the new HD account registration');
assert.equal(broadcasts.length, singleStart + 1);
assert.equal(broadcasts.at(-1).address, single.address);
assert.equal((await call('account.getActive')).address, first.address);
console.log('  ok - a single new HD account is registered even after switching active accounts');

// The SDK must not switch signers after validating the pair if an asynchronous proof gives
// another caller time to replace the object or mutate its byte arrays. Sign with the snapshot.
const mutable = { ...second,
  publicKey: new Uint8Array(second.publicKey), privateKey: new Uint8Array(second.privateKey) };
const originalMutableProof = alphaClient.proofs.generate;
let finishMutableProof;
alphaClient.proofs.generate = ({ address }) => address === second.address
  ? new Promise((resolve) => { finishMutableProof = () => resolve({ proof: { address } }); })
  : originalMutableProof({ address });
const pendingMutable = thruClient.createOnChainAccount(mutable);
await waitUntil(() => typeof finishMutableProof === 'function', 'the mutable keypair proof');
mutable.publicKey.set(first.publicKey);
mutable.privateKey.set(first.privateKey);
finishMutableProof();
await pendingMutable;
assert.deepEqual(signed.at(-1).feePayer.privateKey, second.privateKey);
assert.equal(signed.at(-1).feePayerStateProof.address, second.address);
alphaClient.proofs.generate = originalMutableProof;
chainFor('alphanet').delete(second.address); // node reset; creation-retry/JIT tests below need it absent
console.log('  ok - a pending proof cannot swap Account 2\'s signer to Account 1');

const wrongChainCount = broadcasts.length;
await registerCreatedAccount(second.address, 'localnet'); // created on localnet, now switched to Alphanet
assert.equal(broadcasts.length, wrongChainCount,
  'a delayed creation continuation cannot register on a network the user did not select then');

// Bounded exponential retry, including the stop condition. No periodic alarm is installed.
const secondPriorBroadcasts = broadcasts.filter((b) => b.address === second.address).length;
const originalGet = alphaClient.accounts.get;
const originalTimeout = globalThis.setTimeout;
const delays = [];
let attempted = 0;
alphaClient.accounts.get = async (address) => {
  if (address === second.address) {
    attempted += 1;
    throw new Error('RPC offline');
  }
  return originalGet(address);
};
globalThis.setTimeout = (fn, ms) => {
  delays.push(ms);
  queueMicrotask(fn); // fast-forward only this deterministic backoff test
  return 0;
};
try {
  await registerCreatedAccount(second.address);
} finally {
  globalThis.setTimeout = originalTimeout;
  alphaClient.accounts.get = originalGet;
}
assert.equal(attempted, 4, 'one immediate attempt + at most three retries');
assert.deepEqual(delays, [500, 1000, 2000], 'backoff doubles and ends');
assert.equal(broadcasts.filter((b) => b.address === second.address).length, secondPriorBroadcasts);
await call('tx.registerAccount', { address: second.address });
assert.equal(broadcasts.filter((b) => b.address === second.address).length, secondPriorBroadcasts + 1,
  'a later explicit Send-style activation can recover after bounded creation retries');
console.log('  ok - offline creation retries are bounded; just-in-time activation remains available');

// In-memory "registered" status may not mask a later chain reset.
chainFor('alphanet').delete(second.address);
await call('tx.registerAccount', { address: second.address });
assert.equal(broadcasts.filter((b) => b.address === second.address).length, secondPriorBroadcasts + 2);
console.log('  ok - node reset is checked against the chain, never worker memory');

// Two JIT calls for the same owned address share the SDK's in-flight transaction, and a
// removed account cannot finish signing after an earlier proof has already been requested.
const fourth = newAccounts[4];
chainFor('alphanet').delete(fourth.address);
const originalAlphaProof = alphaClient.proofs.generate;
let finishFourth;
alphaClient.proofs.generate = ({ address }) => address === fourth.address
  ? new Promise((resolve) => { finishFourth = () => resolve({ proof: { address } }); })
  : originalAlphaProof({ address });
let sendsBefore = broadcasts.length;
const firstJit = handleApiRequest({ method: 'tx.registerAccount', params: { address: fourth.address } });
const secondJit = handleApiRequest({ method: 'tx.registerAccount', params: { address: fourth.address } });
await waitUntil(() => typeof finishFourth === 'function', 'the concurrent JIT proof');
await new Promise((r) => setImmediate(r)); // allow the second caller to join the in-flight map
finishFourth();
const [one, two] = await Promise.all([firstJit, secondJit]);
assert.equal(one.ok, true);
assert.equal(two.ok, true);
assert.equal(broadcasts.length, sendsBefore + 1, 'two JIT calls cannot broadcast twice');
console.log('  ok - concurrent activation of one owned account is deduplicated');

chainFor('alphanet').delete(fourth.address); // simulate a node reset before the next proof
finishFourth = null;
sendsBefore = broadcasts.length;
const pendingRemoval = handleApiRequest({ method: 'tx.registerAccount', params: { address: fourth.address } });
await waitUntil(() => typeof finishFourth === 'function', 'the proof before account removal');
await call('account.removeHd', { ref: fourth.ref });
finishFourth();
const removed = await pendingRemoval;
assert.equal(removed.error.code, 'NOT_OWNED_ACCOUNT');
assert.equal(broadcasts.length, sendsBefore,
  'a removed account cannot sign using the key captured before its RPC proof');
alphaClient.proofs.generate = originalAlphaProof;
console.log('  ok - removing an account while its proof is pending cancels signing');

for (const tx of signed) {
  const target = tx.feePayerStateProof.address;
  assert.equal(tx.program, getNetworkConfig('alphanet').accountCreateProgramId,
    'every registration uses the configured account-creation program (no faucet/dummy transfer)');
  assert.deepEqual(tx.header, { fee: 0n, nonce: 0n, stateUnits: 1 });
  assert.equal(Pubkey.from(tx.feePayer.publicKey).toThruFmt(), target,
    'every fee payer public key matches the target proof address');
  assert.equal(Pubkey.from(await keys.fromPrivateKey(tx.feePayer.privateKey)).toThruFmt(), target,
    'every fee payer private key belongs to the target, including all HD indices');
}
assert.equal(signed.length, broadcasts.length,
  'all signed transactions are the account creations recorded as broadcasts');
console.log('  ok - every creation, retry, and JIT registration is signed solely by its own account');
