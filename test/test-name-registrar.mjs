#!/usr/bin/env node
// Registrar (official `.thru` paid-lease registry) — offline pins for the first-party
// formats + honest service branches of contract v22 (name.getRegistry / name.checkLease /
// name.getPaymentBalance reads; purchase/renew/claim signing branches that need no token
// account and no network).
//
// Proves:
//   [0] lease derivation is byte-exact against the first-party CLI's own output
//       (`thru nameservice derive-lease-account alice`, 2026-10-09)
//   [1] config + lease account parsers round-trip the official 244/148-byte layouts and
//       reject wrong sizes (size-discriminated union, no kind byte)
//   [2] purchase instruction bytes match the first-party ABI + txn_tools.rs byte-for-byte
//       (tag, 9 account indices, 64-byte name field, u32 length, u8 years, proofs tail)
//   [3] renew and claim share the ABI args struct (tag 2 vs 3, 6 indices, u8 years)
//   [4] an absent/unparseable registry answers supported:false (UI's unsupported branch)
//       and the signing methods refuse REGISTRY_ABSENT — never a fabricated price
//   [5] a taken name is refused at purchase (NAME_TAKEN), an obsolete-lease purchase is
//       routed to claim (LEASE_CLAIM_REQUIRED)
//   [6] renew refuses a foreign lease (NOT_NAME_OWNER) and claim refuses an active lease
//       (LEASE_NOT_EXPIRED); lease time never gets silently reinterpreted
import assert from 'node:assert/strict';

const storage = new Map();
const session = new Map();
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        if (typeof keys === 'string') return { [keys]: storage.get(keys) };
        if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, storage.get(k)]));
        return Object.fromEntries(storage.entries());
      },
      set: async (obj) => { for (const [k, v] of Object.entries(obj)) storage.set(k, v); },
      remove: async (key) => { for (const k of Array.isArray(key) ? key : [key]) storage.delete(k); },
      clear: async () => storage.clear(),
    },
    session: {
      get: async (key) => ({ [key]: session.get(key) }),
      set: async (obj) => { for (const [k, v] of Object.entries(obj)) session.set(k, v); },
      remove: async (key) => { for (const k of Array.isArray(key) ? key : [key]) session.delete(k); },
      clear: async () => session.clear(),
    },
  },
};

const { handleApiRequest } = await import('../src/background/api-router.js');
const { Pubkey } = await import('@thru/sdk');
const reg = await import('../src/lib/registrar.js');
const ns = await import('../src/lib/name-service.js');

let checks = 0;
function ok(label, cond = true) {
  checks += 1;
  assert.ok(cond, label);
  console.log(`  ok - ${label}`);
}

const walletRes = await handleApiRequest({ method: 'wallet.create', params: { password: 'Password123!' } });
assert.equal(walletRes.ok, true);
const SENDER = walletRes.data.address;
console.log('harness: wallet created (offline), sender', SENDER.slice(0, 12) + '…');

// ---- synthetic chain fixtures ------------------------------------------------
const CONFIG_ADDR = ns.registrarConfigAddress();
const ROOT_THRU = await ns.rootRegistrarAddress('thru');
const TOKEN_PROGRAM = 'taTOKENKRgcl3vO0yVhftATDbXuhgWcfaaxv9xpEEdMdUE';
const TREASURER = Pubkey.from(new Uint8Array(32).fill(0x21)).toThruFmt();
const MINT = Pubkey.from(new Uint8Array(32).fill(0x42)).toThruFmt();
const NAME = 'alice';

function buildConfigBytes({ price = 1_000_000n, sold = 7n, rootName = 'thru' } = {}) {
  const out = new Uint8Array(reg.REG_CONFIG_SIZE);
  out.set(Pubkey.from(reg.NAME_SERVICE_PROGRAM).toBytes(), 0);
  out.set(Pubkey.from(ROOT_THRU).toBytes(), 32);
  out.set(Pubkey.from(TREASURER).toBytes(), 64);
  out.set(Pubkey.from(MINT).toBytes(), 96);
  out.set(Pubkey.from(TOKEN_PROGRAM).toBytes(), 128);
  const nb = new TextEncoder().encode(rootName);
  out.set(nb, 160);
  const dv = new DataView(out.buffer);
  dv.setUint32(224, nb.length, true);
  dv.setBigUint64(228, price, true);
  dv.setBigUint64(236, sold, true);
  return out;
}

function buildLeaseBytes(ownerAddress, name = NAME, start = 1_700_000_000n, end = 1_731_536_000n) {
  const out = new Uint8Array(reg.REG_LEASE_SIZE);
  out.set(Pubkey.from(new Uint8Array(32).fill(0x77)).toBytes(), 0); // domain account
  out.set(Pubkey.from(ownerAddress).toBytes(), 32);
  const nb = new TextEncoder().encode(name);
  out.set(nb, 64);
  const dv = new DataView(out.buffer);
  dv.setUint32(128, nb.length, true);
  dv.setBigUint64(132, start, true);
  dv.setBigUint64(140, end, true);
  return out;
}

// Mutable chain-world switchboard
let configPresent = true;
let domainExists = false;
let leaseState = 'absent'; // absent | mine-active | other-active | other-expired
const ENCODER = new TextEncoder();
const OTHER = Pubkey.from(new Uint8Array(32).fill(8)).toThruFmt();
const nowSeconds = Math.floor(Date.now() / 1000);

const LEAF = await ns.domainAccountAddress(ROOT_THRU, NAME);
const LEASE = await reg.leaseAccountAddress(NAME);

const thru = await import('../src/lib/thru-client.js');
const client = thru.getClient();
// An absent account = the SDK's own not-found shape (err.code 5 → the wrapper answers {exists:false}).
const notFound = () => { const e = new Error('account not found'); e.code = 5; throw e; };
client.accounts.get = async (address) => {
  if (address === CONFIG_ADDR) {
    if (!configPresent) return notFound();
    return { meta: { balance: 1n }, data: buildConfigBytes() };
  }
  if (address === LEAF) {
    if (!domainExists) return notFound();
    return { meta: { balance: 1n }, data: new Uint8Array(ns.NS_DOMAIN_HEADER) };
  }
  if (address === LEASE) {
    if (leaseState === 'absent') return notFound();
    const activeEnd = BigInt(nowSeconds + 86_400);
    const expiredEnd = BigInt(nowSeconds - 86_400);
    if (leaseState === 'mine-active') return { meta: { balance: 1n }, data: buildLeaseBytes(SENDER, NAME, BigInt(nowSeconds - 100), activeEnd) };
    if (leaseState === 'other-active') return { meta: { balance: 1n }, data: buildLeaseBytes(OTHER, NAME, BigInt(nowSeconds - 100), activeEnd) };
    return { meta: { balance: 1n }, data: buildLeaseBytes(OTHER, NAME, BigInt(nowSeconds - 999_999), expiredEnd) };
  }
  return notFound();
};

// [0] lease derivation == the first-party CLI output (offline equivalent)
assert.equal(await reg.leaseAccountAddress('alice'), 'ta06ZB32a0KLpwVNHR2yfoMxqjgGt3SIYb43cufpZbaP18');
assert.equal(LEASE, 'ta06ZB32a0KLpwVNHR2yfoMxqjgGt3SIYb43cufpZbaP18');
ok('lease derivation byte-exact: alice → ta06ZB32… (official CLI derive-lease-account, 2026-10-09)');

// [1] layout round-trips + rejections
{
  const cfg = reg.parseRegistrarConfig(buildConfigBytes());
  assert.equal(cfg.nameServiceProgram, reg.NAME_SERVICE_PROGRAM);
  assert.equal(cfg.rootRegistrar, ROOT_THRU);
  assert.equal(cfg.treasurer, TREASURER);
  assert.equal(cfg.tokenMint, MINT);
  assert.equal(cfg.tokenProgram, TOKEN_PROGRAM);
  assert.equal(cfg.rootName, 'thru');
  assert.equal(cfg.pricePerYear, 1_000_000n);
  assert.equal(cfg.totalDomainsSold, 7n);
  const lease = reg.parseLease(buildLeaseBytes(SENDER));
  assert.equal(lease.owner, SENDER);
  assert.equal(lease.name, 'alice');
  let throws = 0;
  try { reg.parseRegistrarConfig(new Uint8Array(148)); } catch { throws += 1; }
  try { reg.parseLease(new Uint8Array(244)); } catch { throws += 1; }
  try { reg.parseLease((() => { const b = buildLeaseBytes(SENDER); b.set([90], 128); return b; })()); } catch { throws += 1; }
  assert.equal(throws, 3);
  ok('config (244B) + lease (148B) layouts round-trip and size/format violations throw');
}

// [2] purchase instruction goldens
{
  const map = new Map([[CONFIG_ADDR, 9], [LEASE, 3], [LEAF, 4], [reg.NAME_SERVICE_PROGRAM, 7]]);
  const indexOf = (a) => map.get(a) ?? 2;
  const lp = new Uint8Array([0xAA, 0xAA]); const dp = new Uint8Array([0xBB, 0xBB, 0xBB]);
  const bytes = reg.buildPurchaseDomainInstructionData({
    name: NAME, years: 3, indexOf,
    configAddress: CONFIG_ADDR, leaseAddress: LEASE, domainAddress: LEAF,
    rootRegistrarAddress: ROOT_THRU, treasurerAddress: TREASURER,
    payerTokenAddress: 'taPAYaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    tokenMintAddress: MINT, tokenProgramAddress: TOKEN_PROGRAM,
    leaseProof: lp, domainProof: dp,
  });
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(dv.getUint32(0, true), reg.REG_OP_PURCHASE_DOMAIN);
  assert.equal(dv.getUint16(4, true), 9);  // config idx from the map
  assert.equal(dv.getUint16(6, true), 3);  // lease
  assert.equal(dv.getUint16(8, true), 4);  // domain
  assert.equal(dv.getUint16(10, true), 7); // name service program
  assert.equal(bytes.slice(22, 22 + NAME.length).join(','), ENCODER.encode(NAME).join(','));
  assert.equal(dv.getUint32(86, true), NAME.length); // name_len u32 pin (official ABI)
  assert.equal(bytes[90], 3);                        // years u8
  assert.deepEqual([...bytes.slice(91)], [...lp, ...dp]); // proofs appended raw, in order
  let threw = 0;
  try { reg.buildPurchaseDomainInstructionData({ name: NAME, years: 0, indexOf, configAddress: CONFIG_ADDR, leaseAddress: LEASE, domainAddress: LEAF, rootRegistrarAddress: ROOT_THRU, treasurerAddress: TREASURER, payerTokenAddress: 'x', tokenMintAddress: MINT, tokenProgramAddress: TOKEN_PROGRAM, leaseProof: lp, domainProof: dp }); } catch { threw += 1; }
  try { reg.buildPurchaseDomainInstructionData({ name: NAME, years: 1, indexOf, configAddress: CONFIG_ADDR, leaseAddress: LEASE, domainAddress: LEAF, rootRegistrarAddress: ROOT_THRU, treasurerAddress: TREASURER, payerTokenAddress: 'x', tokenMintAddress: MINT, tokenProgramAddress: TOKEN_PROGRAM, leaseProof: new Uint8Array(0), domainProof: dp }); } catch { threw += 1; }
  assert.equal(threw, 2);
  ok('purchase instruction = tag + 9 indices + 64B name + u32 len + u8 years + raw proofs; years/proof guards hold');
}

// [3] renew vs claim goldens
{
  const indexOf = () => 5;
  const renew = reg.buildRenewLeaseInstructionData({
    years: 2, indexOf, configAddress: CONFIG_ADDR, leaseAddress: LEASE,
    treasurerAddress: TREASURER, payerTokenAddress: 'taPAYaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    tokenMintAddress: MINT, tokenProgramAddress: TOKEN_PROGRAM,
  });
  const claimB = reg.buildRenewLeaseInstructionData({
    years: 2, indexOf, claim: true, configAddress: CONFIG_ADDR, leaseAddress: LEASE,
    treasurerAddress: TREASURER, payerTokenAddress: 'taPAYaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    tokenMintAddress: MINT, tokenProgramAddress: TOKEN_PROGRAM,
  });
  assert.equal(new DataView(renew.buffer).getUint32(0, true), 2);
  assert.equal(new DataView(claimB.buffer).getUint32(0, true), 3);
  assert.equal(renew.length, 4 + 12 + 1);
  assert.equal(renew[renew.length - 1], 2);
  ok('renew(2)+claim(3) share the 17-byte ABI args struct; years is the final u8');
}

// [4] registry present → full read; absent → supported:false + REGISTRY_ABSENT on signing
{
  const res = await handleApiRequest({ method: 'name.getRegistry' });
  assert.equal(res.ok, true);
  assert.equal(res.data.supported, true);
  assert.equal(res.data.registry.rootName, 'thru');
  assert.equal(res.data.registry.pricePerYear, '1000000');
  assert.equal(res.data.configAddress, CONFIG_ADDR);
  ok('name.getRegistry parses the live config (price, root, treasurer, mint)');

  configPresent = false;
  const gone = await handleApiRequest({ method: 'name.getRegistry' });
  assert.equal(gone.ok, true);
  assert.equal(gone.data.supported, false);
  const buy = await handleApiRequest({ method: 'name.purchase', params: { name: NAME, years: 1, password: 'Password123!' } });
  assert.equal(buy.ok, false);
  assert.equal(buy.error.code, 'REGISTRY_ABSENT');
  ok('no config → supported:false read + REGISTRY_ABSENT signing refusal (no fabricated price)');
  configPresent = true;
}

// [5] NAME_TAKEN / LEASE_CLAIM_REQUIRED routing
{
  const free = await handleApiRequest({ method: 'name.checkLease', params: { name: NAME } });
  assert.equal(free.ok, true);
  assert.equal(free.data.supported, true);
  assert.equal(free.data.leaseExists, false);
  assert.equal(free.data.domainExists, false);

  domainExists = true;
  const taken = await handleApiRequest({ method: 'name.purchase', params: { name: NAME, years: 1, password: 'Password123!' } });
  assert.equal(taken.ok, false);
  assert.equal(taken.error.code, 'NAME_TAKEN');
  domainExists = false;

  leaseState = 'other-expired';
  const claimRoute = await handleApiRequest({ method: 'name.purchase', params: { name: NAME, years: 1, password: 'Password123!' } });
  assert.equal(claimRoute.ok, false);
  assert.equal(claimRoute.error.code, 'LEASE_CLAIM_REQUIRED');
  leaseState = 'absent';
  ok('taken → NAME_TAKEN; live-but-expired lease → LEASE_CLAIM_REQUIRED (creation proofs never hit an existing account)');
}

// [6] renew/claim guards
{
  const missing = await handleApiRequest({ method: 'name.renewLease', params: { name: NAME, years: 1, password: 'Password123!' } });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'LEASE_NOT_FOUND');

  leaseState = 'other-active';
  const foreign = await handleApiRequest({ method: 'name.renewLease', params: { name: NAME, years: 1, password: 'Password123!' } });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.error.code, 'NOT_NAME_OWNER');
  const notExpired = await handleApiRequest({ method: 'name.claimExpired', params: { name: NAME, years: 1, password: 'Password123!' } });
  assert.equal(notExpired.ok, false);
  assert.equal(notExpired.error.code, 'LEASE_NOT_EXPIRED');

  leaseState = 'other-expired';
  const badYears = await handleApiRequest({ method: 'name.claimExpired', params: { name: NAME, years: 0, password: 'Password123!' } });
  assert.equal(badYears.ok, false);
  assert.equal(badYears.error.code, 'INVALID_YEARS');
  leaseState = 'absent';
  ok('renew: LEASE_NOT_FOUND + NOT_NAME_OWNER; claim: LEASE_NOT_EXPIRED; years validated before any chain call');
}

// validation surface
{
  assert.ok(reg.purchaseNameProblem('') !== null);
  assert.ok(reg.purchaseNameProblem('has space') !== null);
  assert.ok(reg.purchaseNameProblem('sub.domain') !== null);
  assert.ok(reg.purchaseNameProblem('x'.repeat(65)) !== null);
  assert.equal(reg.purchaseNameProblem('valid-name_99'), null);
  assert.ok(reg.yearsProblem(0) !== null && reg.yearsProblem(256) !== null && reg.yearsProblem(1.5) !== null);
  assert.equal(reg.yearsProblem('2'), null);
  ok('name/year validation is strict and honest (never silently normalized into a paid write)');
}

console.log(`\ntest-name-registrar: ${checks} checks passed`);
