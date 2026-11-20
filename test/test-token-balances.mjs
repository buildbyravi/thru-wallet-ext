// Service-level send/ledger checks without a public RPC or a signing key.
// The port shape stays the same: absent token account = proven zero; a failed balance OR
// unverified mint denomination = unknown and unsendable. Several registered mints must not
// be fetched serially, nor may a long registry open an unbounded number of RPC sockets.
import assert from 'node:assert/strict';
import { readRegisteredTokenBalances } from '../src/background/services/token-service.js';
import { formatTokenAmount } from '../src/shared/format.js';

const registry = (ids) => ids.map((id) => ({
  mintAddress: id, symbol: `LOCAL-${id}`, name: `Token ${id}`,
  decimals: 9, imageUrl: '', hidden: false, source: 'imported',
}));

console.log('[token balances] distinguish verified value, proven zero and unknown');
const mintReads = [];
const mixed = await readRegisteredTokenBalances('owner', registry([
  'funded', 'absent', 'empty', 'offline', 'mint-offline', 'mint-missing', 'mint-invalid', 'bad-units',
]), {
  readBalance: async (_owner, mintAddress) => {
    if (mintAddress === 'offline') throw new Error('RPC unavailable');
    if (mintAddress === 'absent') return { tokenAccount: mintAddress, exists: false, amount: null };
    if (mintAddress === 'empty') return { tokenAccount: mintAddress, exists: true, amount: 0n };
    if (mintAddress === 'bad-units') return { tokenAccount: mintAddress, exists: true, amount: -1n };
    return { tokenAccount: mintAddress, exists: true, amount: 123456789n };
  },
  readMint: async (mintAddress) => {
    mintReads.push(mintAddress);
    if (mintAddress === 'mint-offline') throw new Error('mint node timed out');
    if (mintAddress === 'mint-missing') return { exists: false };
    if (mintAddress === 'mint-invalid') return { exists: true, decimals: 19 };
    return { exists: true, decimals: 6, ticker: 'CHAIN' };
  },
});
const byMint = new Map(mixed.balances.map((row) => [row.mintAddress, row]));
assert.equal(mixed.balances.length, 8);
assert.equal(mixed.anyError, true);
assert.deepEqual(mixed.balances.map((row) => row.mintAddress), [
  'funded', 'absent', 'empty', 'offline', 'mint-offline', 'mint-missing', 'mint-invalid', 'bad-units',
]);
assert.equal(byMint.get('funded').amountUnits, '123456789');
assert.equal(byMint.get('funded').decimals, 6, 'chain decimals override imported metadata');
assert.equal(byMint.get('funded').symbol, 'CHAIN', 'chain ticker overrides imported metadata');
assert.equal(formatTokenAmount(BigInt(byMint.get('funded').amountUnits), byMint.get('funded').decimals),
  '123.456789', 'the user sees the correctly denominated amount before entering Send');
assert.equal(byMint.get('absent').tokenAccountExists, false);
assert.equal(byMint.get('absent').amountUnits, null);
assert.equal(byMint.get('absent').error, false, 'absent is a proven zero, not an error');
assert.equal(byMint.get('empty').tokenAccountExists, true);
assert.equal(byMint.get('empty').amountUnits, '0');
assert.equal(byMint.get('empty').error, false);
for (const id of ['offline', 'mint-offline', 'mint-missing', 'mint-invalid', 'bad-units']) {
  assert.equal(byMint.get(id).amountUnits, null, `${id} must not pretend to know the raw balance`);
  assert.equal(byMint.get(id).error, true, `${id} must not be sendable`);
}
assert.equal(byMint.get('mint-offline').tokenAccountExists, true,
  'a verified token account still exists, but the denomination is unknown');
assert.deepEqual(mintReads.sort(), ['funded', 'mint-invalid', 'mint-missing', 'mint-offline'].sort(),
  'zero balances and failed account reads require no mint RPC');
console.log('  ok - no registry decimals are used for a positive balance without a live mint');

console.log('[token balances] bounded concurrent RPC, stable list order under out-of-order replies');
const tokenCount = 100;
let inFlight = 0;
let peak = 0;
const started = [];
const gates = new Map();
const running = readRegisteredTokenBalances('owner', registry(Array.from({ length: tokenCount }, (_, i) => `mint-${i}`)), {
  readBalance: async (_owner, mintAddress) => {
    started.push(mintAddress);
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    return new Promise((resolve) => {
      gates.set(mintAddress, () => {
        inFlight -= 1;
        resolve({ tokenAccount: mintAddress, exists: true, amount: 0n });
      });
    });
  },
  readMint: async () => { throw new Error('Zero requires no mint read'); },
});
assert.equal(started.length, 4, 'four RPC reads may start before any finishes');
for (let i = 0; i < tokenCount; i += 1) {
  const id = started[i] || `mint-${i}`;
  assert.equal(gates.has(id), true, `mint ${id} should have started`);
  gates.get(id)();
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(inFlight <= 4, 'concurrency must stay bounded');
}
const bounded = await running;
assert.equal(started.length, tokenCount);
assert.equal(peak, 4, 'a slow first read must not serialize other mints');
assert.deepEqual(bounded.balances.map((row) => row.mintAddress),
  Array.from({ length: tokenCount }, (_, i) => `mint-${i}`));
assert.equal(bounded.anyError, false);
assert.ok(bounded.balances.every((row) => row.amountUnits === '0' && row.error === false));
assert.deepEqual(await readRegisteredTokenBalances('owner', []), { balances: [], anyError: false });
console.log('  ok - 100 mints were checked with at most four concurrent reads');

console.log('[send intent] in-flight guard includes chain and mint, releases after failure');
const { beginTransfer } = await import('../src/background/services/pending-tx-service.js');
const intent = { networkId: 'betanet', from: 'sender', to: 'recipient', amountUnits: '100' };
const releaseNative = beginTransfer(intent);
assert.throws(() => beginTransfer(intent), (error) => error.code === 'DUPLICATE_SUBMISSION');
const releaseMintA = beginTransfer({ ...intent, mint: 'mint-a' });
const releaseMintB = beginTransfer({ ...intent, mint: 'mint-b' });
const releaseOtherNetwork = beginTransfer({ ...intent, networkId: 'localnet' });
assert.throws(() => beginTransfer({ ...intent, mint: 'mint-a' }),
  (error) => error.code === 'DUPLICATE_SUBMISSION');
releaseMintA();
releaseMintB();
releaseOtherNetwork();
releaseNative();
const releaseRetry = beginTransfer(intent);
releaseRetry();
console.log('  ok - the same intent cannot run twice, while distinct mints/networks remain independent');

console.log('[verified import] real router, SDK mint bytes, detached persisted preferences');
const { Pubkey } = await import('@thru/sdk');
const { TokenMintAccount } = await import('@thru/programs/token');
const { mintAccountBytes } = await import('./fixtures/token-accounts.mjs');
const { handleApiRequest } = await import('../src/background/api-router.js');
const client = await import('../src/lib/thru-client.js');
const networks = await import('../src/background/services/network-service.js');
const local = new Map([['thru_active_network', 'betanet']]);
const session = new Map();
let preferenceReadGate = null;
const area = (data) => ({
  async get(key) {
    const result = structuredClone(key === null ? Object.fromEntries(data) : { [key]: data.get(key) });
    if (key === 'thru_prefs' && preferenceReadGate) {
      const gate = preferenceReadGate;
      preferenceReadGate = null;
      gate.enter();
      await gate.wait;
    }
    return result;
  },
  async set(values) {
    for (const [key, value] of Object.entries(values)) data.set(key, structuredClone(value));
  },
  async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) data.delete(key); },
});
globalThis.chrome = { storage: { local: area(local), session: area(session) } };
const network = await networks.getActiveNetworkConfig();
const sdk = client.getClient();
const originalGet = sdk.accounts.get;
const mintAddress = Pubkey.from(new Uint8Array(32).fill(17)).toThruFmt();
function mintAccount({ decimals = 6, ticker = 'CHAIN', owner = network.tokenProgramId } = {}) {
  const tickerBytes = new Uint8Array(9);
  tickerBytes[0] = ticker.length;
  tickerBytes.set(new TextEncoder().encode(ticker), 1);
  const bytes = mintAccountBytes(TokenMintAccount.builder().set_decimals(decimals).set_supply(42n)
    .set_has_freeze_authority(0).set_ticker(tickerBytes).finish().buffer);
  return { meta: { balance: 1n, owner: Pubkey.from(owner) }, data: { data: bytes } };
}
const callImport = (params = { mintAddress, symbol: 'LOCAL' }) =>
  handleApiRequest({ method: 'token.importVerified', params });
const resetImports = () => local.set('thru_prefs', { version: 1, customTokens: [] });
const savedImports = () => local.get('thru_prefs').customTokens;
function gate() {
  let enter;
  let release;
  return { entered: new Promise((resolve) => { enter = resolve; }),
    wait: new Promise((resolve) => { release = resolve; }),
    enter: () => enter(), release: () => release() };
}
let reads = 0;
try {
  sdk.accounts.get = async (address) => {
    reads += 1;
    assert.equal(address, mintAddress);
    return mintAccount();
  };
  resetImports();
  assert.equal((await callImport()).error.code, 'WALLET_LOCKED');
  assert.equal(reads, 0);
  session.set('unlocked_session', { vaultData: {} });
  for (const extra of [{ decimals: 0 }, { name: 'Forged' }, { decimals: 6, name: 'CHAIN' }]) {
    const refusal = await callImport({ mintAddress, ...extra });
    assert.equal(refusal.error?.code, 'INVALID_INPUT', JSON.stringify(refusal));
    assert.deepEqual(savedImports(), []);
  }
  assert.equal(reads, 0, 'unknown metadata must reach strict validation, never be silently stripped');
  const imported = await callImport({ mintAddress: ` ${mintAddress} `, symbol: 'LOCAL' });
  assert.equal(imported.ok, true, imported.error?.message);
  assert.equal(reads, 1, 'verification parses one captured account snapshot');
  assert.equal(imported.data.decimals, 6);
  assert.equal(imported.data.symbol, 'CHAIN');
  assert.equal(imported.data.name, 'CHAIN');
  assert.equal(imported.data.networkId, 'betanet');
  assert.deepEqual(savedImports(), [imported.data], 'verified decimals survive detached persistence');
  const listed = await handleApiRequest({ method: 'token.list' });
  assert.equal(listed.data.find((token) => token.mintAddress === mintAddress).decimals, 6);
  assert.equal((await callImport()).error.code, 'ALREADY_EXISTS');
  assert.deepEqual(savedImports(), [imported.data], 'duplicates cannot replace verified metadata');
  console.log('  ok - unlocked import persists chain decimals; locked/extra-field/duplicate calls refuse');

  const balanceOwner = Pubkey.from(new Uint8Array(32).fill(23)).toThruFmt();
  const readBalances = (method) => handleApiRequest({ method, params: { address: balanceOwner } });
  sdk.accounts.get = async () => { throw Object.assign(new Error('absent'), { code: 5 }); };
  const unheld = await readBalances('token.getBalances');
  assert.equal(unheld.ok, true);
  assert.equal(unheld.data.balances[0]?.tokenAccountExists, false);
  assert.equal(unheld.data.balances[0]?.amountUnits, null, 'proven zero keeps the existing wire shape');
  await new Promise(setImmediate); // the snapshot write is intentionally asynchronous
  const cachedUnheld = await readBalances('token.getCachedBalances');
  assert.ok(cachedUnheld.data.fetchedAt > 0, 'a clean snapshot with a proven zero is stored');
  assert.deepEqual(cachedUnheld.data.balances, unheld.data.balances);
  sdk.accounts.get = async () => { throw new Error('RPC unavailable'); };
  const offline = await readBalances('token.getBalances');
  assert.equal(offline.data.balances[0]?.error, true, 'transport failure is not a zero');
  await new Promise(setImmediate);
  assert.deepEqual((await readBalances('token.getCachedBalances')).data, cachedUnheld.data,
    'a failed refresh preserves the verified snapshot and its original timestamp');
  console.log('  ok - verified absence persists; a transport failure does not overwrite the snapshot');

  const secondMint = Pubkey.from(new Uint8Array(32).fill(36)).toThruFmt();
  const oldGate = gate();
  let balanceReads = 0;
  sdk.accounts.get = async (address) => {
    if (address === secondMint) return mintAccount({ ticker: 'NEW' });
    if (++balanceReads === 1) { oldGate.enter(); await oldGate.wait; }
    throw Object.assign(new Error('absent'), { code: 5 });
  };
  const oldRefresh = readBalances('token.getBalances');
  await oldGate.entered;
  const added = await callImport({ mintAddress: secondMint });
  assert.equal(added.ok, true, JSON.stringify(added));
  const afterImport = readBalances('token.getBalances');
  const sameSnapshot = readBalances('token.getBalances');
  let freshResult;
  afterImport.then((reply) => { freshResult = reply; });
  await new Promise(setImmediate); // all fresh fixture reads can finish without releasing the old RPC
  const completedBeforeRelease = freshResult;
  oldGate.release();
  const [old, refreshed, joined] = await Promise.all([oldRefresh, afterImport, sameSnapshot]);
  assert.ok(completedBeforeRelease?.data?.balances.some((row) => row.mintAddress === secondMint),
    'the first refresh after import reads the new mint without waiting for the old refresh');
  assert.equal(old.data.balances.length, 1);
  assert.deepEqual(joined.data, refreshed.data, 'concurrent requests for the same registry still coalesce');
  assert.equal(balanceReads, 3, 'one old read plus one read per mint in the new registry');
  assert.deepEqual((await readBalances('token.getCachedBalances')).data.balances, refreshed.data.balances,
    'the slower pre-import read cannot replace the fresh two-mint cache');
  console.log('  ok - post-import refresh includes the new mint while older RPC is pending and protects its cache');

  for (const [label, response, code] of [
    ['wrong owner', () => mintAccount({ owner: mintAddress }), 'UNSUPPORTED'],
    ['unsupported decimals', () => mintAccount({ decimals: 19 }), 'UNSUPPORTED'],
    ['wrong footprint', () => ({ ...mintAccount(), data: { data: new Uint8Array(12) } }), 'UNSUPPORTED'],
    ['missing account', () => { throw Object.assign(new Error('absent'), { code: 5 }); }, 'ACCOUNT_MISSING'],
    ['RPC failure', () => { throw new Error('offline'); }, 'RPC_UNAVAILABLE'],
  ]) {
    resetImports();
    sdk.accounts.get = async () => response();
    const result = await callImport();
    assert.equal(result.error?.code, code, `${label}: ${JSON.stringify(result)}`);
    assert.deepEqual(savedImports(), [], `${label} must not persist a guessed record`);
  }
  resetImports();
  sdk.accounts.get = async () => mintAccount({ decimals: 0, ticker: '' });
  const fallback = await callImport();
  assert.equal(fallback.ok, true, fallback.error?.message);
  assert.equal(savedImports()[0].decimals, 0, 'verified zero decimals remain valid');
  assert.equal(savedImports()[0].symbol, 'LOCAL', 'fallback is used only when chain ticker is empty');
  console.log('  ok - owner/layout/denomination/absence/transport refusals persist nothing');

  for (const phase of ['RPC', 'preference queue']) {
    resetImports();
    const barrier = gate();
    sdk.accounts.get = async () => {
      if (phase === 'RPC') { barrier.enter(); await barrier.wait; }
      return mintAccount();
    };
    if (phase === 'preference queue') preferenceReadGate = barrier;
    const importing = callImport();
    await barrier.entered;
    const before = networks.getNetworkGeneration();
    await networks.setActiveNetwork('betanet');
    assert.ok(networks.getNetworkGeneration() > before);
    assert.equal(client.getClient(), sdk, 'same-id boundary retains client identity');
    barrier.release();
    const result = await importing;
    assert.equal(result.error?.code, 'CONTEXT_CHANGED', `${phase}: ${JSON.stringify(result)}`);
    assert.deepEqual(savedImports(), [], `${phase} context change must refuse before persistence`);
  }
  console.log('  ok - network generation fences RPC and queued preference reads even with the same client');

  sdk.accounts.get = async () => { throw new Error('Legacy import must not read RPC'); };
  const legacy = await handleApiRequest({ method: 'token.import',
    params: { mintAddress, symbol: 'OLD', name: 'Legacy', decimals: 9 } });
  assert.equal(legacy.ok, true, legacy.error?.message);
  assert.equal(savedImports()[0].decimals, 9);
  const replacement = await handleApiRequest({ method: 'token.import',
    params: { mintAddress, symbol: 'OLD2', decimals: 3 } });
  assert.equal(replacement.ok, true, replacement.error?.message);
  assert.equal(savedImports().length, 1);
  assert.equal(savedImports()[0].decimals, 3, 'legacy metadata replacement remains compatible');
  console.log('  ok - legacy metadata-only import retains replacement compatibility');
} finally {
  sdk.accounts.get = originalGet;
}
