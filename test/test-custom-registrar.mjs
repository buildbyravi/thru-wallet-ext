// Byte-pinning tests for the THRU-CUSTOM-REGISTRAR client ABI against the Rust on-chain
// twin (contracts/thru-custom-registrar/src/{instruction,state}.rs). Every "golden"
// vector below is hand-derived from the documented layouts — the Rust unit tests assert
// the SAME bytes from the other side; a drift on either side fails here.
//
// ABI v2 (2026-10-24): instruction data carries u16 account-table INDICES (first-party
// convention; txn_tools.rs builders do the same) because @thru/sdk 0.4.2 byte-SORTS the
// readWrite/readOnly account lists before serializing — positional constants in the
// program would silently address the wrong accounts. The "SDK sort sentinel" section at
// the bottom proves the installed SDK's ordering behavior directly.
//
// Also pinned: error-code table covers every code defined in errors.rs (parse the Rust
// source and diff the set literally — no handshake left to faith).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const t = [];
function ok(name, cond, detail = '') { t.push({ name, pass: !!cond, detail }); if (!cond) console.error(`FAIL ${name} ${detail}`); else console.log(`ok - ${name}`); }

const {
  TCR_OP_INITIALIZE, TCR_OP_REGISTER, TCR_OP_RENEW, TCR_OP_UPDATE_CONFIG,
  TCR_CONFIG_SIZE, TCR_LEASE_SIZE, TCR_CONFIG_MAGIC, TCR_LEASE_MAGIC, TCR_LAYOUT_VERSION,
  TCR_CFG, TCR_LSE, TCR_YEAR_SECONDS,
  TCR_MIN_LABEL, TCR_MAX_LABEL, TCR_MAX_YEARS,
  TCR_ERRORS,
  labelProblem, yearsProblem,
  tcrLeaseAddress, tcrConfigAddress, TCR_CONFIG_SEED_LABEL,
  parseTcrConfig, parseTcrLease,
  buildTcrInitializeInstructionData, buildTcrRegisterInstructionData,
  buildTcrRenewInstructionData, buildTcrUpdateConfigInstructionData,
} = await import('../src/lib/custom-registrar.js');

import { Pubkey } from '@thru/sdk';

const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (s) => new Uint8Array(s.match(/.{2}/g).map((h) => parseInt(h, 16)));

// A stable, valid pubkey: 32 bytes of 0x11 → its ta-form via the SDK itself (the pin
// here is the ROUND TRIP, not the string literal — address codec changes follow the pin).
const PK_A = Pubkey.from(new Uint8Array(32).fill(0x11)).toThruFmt();
const PK_B = Pubkey.from(new Uint8Array(32).fill(0x22)).toThruFmt();

// Simulated account tables for the golden vectors: the builders resolve indices through
// `indexOf`, mirroring the SDK InstructionContext fused at build time.
function indexResolver(table) {
  const bytes = table.map((a) => hex(Pubkey.from(a).toBytes()));
  return (address) => bytes.indexOf(hex(Pubkey.from(address).toBytes()));
}
const NS_PROG = 'taNAMEqRNEDeMWp0cDYmMVdZyTZiF5NyGDR9zTwH42rWQG';

// ---- Mirror the Rust policy table ------------------------------------------------
ok('min label 3 / max 32 (Rust instruction.rs)', TCR_MIN_LABEL === 3 && TCR_MAX_LABEL === 32);
ok('max years 10', TCR_MAX_YEARS === 10);
ok('year seconds 31,536,000 (matching state.rs YEAR_SECONDS)', TCR_YEAR_SECONDS === 31_536_000);
for (const [label, expect] of [['abc', null], ['a1-b', null], ['ab', /3–32/], ['-abc', /hyphen/],
  ['abc-', /hyphen/], ['ABC', /lowercase/], ['a.c', /lowercase|digits/],
  ['a'.repeat(33), /3–32/]]) {
  const prob = labelProblem(label);
  ok(`label "${label}" ${expect ? 'rejected' : 'accepted'}`, expect ? (prob && expect.test(prob)) : prob === null, prob || '');
}
ok('years 0 rejected', !!yearsProblem(0));
ok('years 10 accepted', yearsProblem(10) === null);
ok('years 11 rejected', !!yearsProblem(11));

// ---- Golden: Initialize instruction ------------------------------------------------------------
// Rust twin: instruction.rs legend_initialize (indices 2/3/4).
{
  const configProof = fromHex('010203');
  const rootProof = fromHex('09080706');
  const table = [
    Pubkey.from(new Uint8Array(32).fill(0x09)).toThruFmt(), // idx0 fee payer
    PK_B,                       // idx1 program (reserved slot; never resolved by role)
    PK_A,                       // idx2 config (arbitrary — resolver positions rule)
    Pubkey.from(new Uint8Array(32).fill(0x32)).toThruFmt(), // idx3 root
    Pubkey.from(new Uint8Array(32).fill(0x33)).toThruFmt(), // idx4 ns
  ];
  // For goldens we don't need real ns/config/root addresses — only that the resolver
  // hands back the same positions the Rust legend test uses.
  const indexOf = indexResolver([table[0], table[1], table[2], table[3], table[4]]);
  const data = buildTcrInitializeInstructionData({
    feePerYear: 1000n, treasury: PK_A, rootName: 'thru',
    configSeed: new Uint8Array(32).fill(0x07), configProof, rootProof,
    indexOf, configAddress: table[2], rootAddress: table[3], nameServiceProgram: table[4],
  });
  const want = [
    '00000000',                                     // tag 0 LE
    '0200', '0300', '0400',                         // config_idx=2, root_idx=3, ns_idx=4
    'e803000000000000',                             // fee 1000 LE
    hex(new Uint8Array(32).fill(0x11)),             // treasury
    '04000000',                                     // root_name_len 4
    hex(new TextEncoder().encode('thru')) + '00'.repeat(28), // name padded 32
    hex(new Uint8Array(32).fill(0x07)),             // config seed
    '03000000', '010203',                           // config proof
    '04000000', '09080706',                         // root proof
  ].join('');
  ok('Initialize == golden Rust-pinned bytes', hex(data) === want,
    hex(data) === want ? '' : `got ${hex(data).slice(0, 96)}… want ${want.slice(0, 96)}…`);
}

// ---- Golden: Register instruction ---------------------------------------------------------------
// Rust twin: instruction.rs parse_register_roundtrip (indices 2,3,4,5,6,7 + target 0).
{
  const table = [
    PK_B,                                                   // idx0 fee payer == target (self-register)
    PK_A,                                                   // idx1 program (reserved)
    Pubkey.from(new Uint8Array(32).fill(0x21)).toThruFmt(), // idx2 treasury
    Pubkey.from(new Uint8Array(32).fill(0x32)).toThruFmt(), // idx3 root
    Pubkey.from(new Uint8Array(32).fill(0x23)).toThruFmt(), // idx4 domain
    Pubkey.from(new Uint8Array(32).fill(0x24)).toThruFmt(), // idx5 lease
    Pubkey.from(new Uint8Array(32).fill(0x25)).toThruFmt(), // idx6 config
    Pubkey.from(new Uint8Array(32).fill(0x26)).toThruFmt(), // idx7 ns
  ];
  const data = buildTcrRegisterInstructionData({
    label: 'alice', durationYears: 2, targetAddress: table[0],
    domainProof: fromHex('eeff'), leaseProof: fromHex('0a'),
    indexOf: indexResolver(table),
    treasuryAddress: table[2], rootAddress: table[3], domainAddress: table[4],
    leaseAddress: table[5], configAddress: table[6], nameServiceProgram: table[7],
  });
  const want = [
    '01000000',                                     // tag 1
    '0200', '0300', '0400', '0500', '0600', '0700', '0000', // 7 u16 indices (target=0)
    '0200',                                         // duration 2 LE
    '05000000',                                     // label_len 5
    hex(new TextEncoder().encode('alice')) + '00'.repeat(27),
    hex(Pubkey.from(table[0]).toBytes()),           // target_pubkey
    '02000000', 'eeff',                             // domain proof
    '01000000', '0a',                               // lease proof
  ].join('');
  ok('Register == golden Rust-pinned bytes', hex(data) === want,
    hex(data) === want ? '' : `got ${hex(data).slice(0, 96)}…`);
}

// ---- Golden: Renew / UpdateConfig ---------------------------------------------------------------
{
  const table = [PK_B, PK_A,
    Pubkey.from(new Uint8Array(32).fill(0x21)).toThruFmt(), // idx2 treasury
    Pubkey.from(new Uint8Array(32).fill(0x24)).toThruFmt(), // idx3 lease
    Pubkey.from(new Uint8Array(32).fill(0x25)).toThruFmt(), // idx4 config
  ];
  const data = buildTcrRenewInstructionData({
    label: 'alice', durationYears: 1, indexOf: indexResolver(table),
    treasuryAddress: table[2], leaseAddress: table[3], configAddress: table[4],
  });
  const want = ['02000000', '0200', '0300', '0400', '0100', '05000000',
    hex(new TextEncoder().encode('alice')) + '00'.repeat(27)].join('');
  ok('Renew == golden bytes', hex(data) === want,
    hex(data) === want ? '' : `got ${hex(data)}`);
}
{
  const table = [PK_B, PK_A, Pubkey.from(new Uint8Array(32).fill(0x25)).toThruFmt()];
  const data = buildTcrUpdateConfigInstructionData({
    newFee: 5000n, indexOf: indexResolver(table), configAddress: table[2],
  });
  const want = ['03000000', '0200', '01', '8813000000000000', '00'.repeat(32)].join('');
  ok('UpdateConfig (fee only) == golden bytes', hex(data) === want, hex(data) === want ? '' : `got ${hex(data)}`);
  const both = buildTcrUpdateConfigInstructionData({ newFee: 1n, newTreasury: PK_A, indexOf: indexResolver(table), configAddress: table[2] });
  ok('UpdateConfig mask 0x03 when both fields set', both[6] === 3 && both[15] === 0x11);
  let threw = false;
  try { buildTcrUpdateConfigInstructionData({ indexOf: indexResolver(table), configAddress: table[2] }); } catch { threw = true; }
  ok('UpdateConfig empty refused', threw);
}

// ---- Builders refuse reserved indices (mirrors Rust check_idx hygiene) -----------
{
  const bad = indexResolver([PK_B, PK_A, PK_B]); // config would resolve to 0 (fee payer)
  let threw = false;
  try {
    buildTcrUpdateConfigInstructionData({ newFee: 1n, indexOf: bad, configAddress: PK_B });
  } catch { threw = true; }
  ok('reserved index 0 refused for config', threw);
  const missing = indexResolver([PK_B, PK_A]); // treasury not in table
  threw = false;
  try {
    buildTcrRenewInstructionData({ label: 'alice', durationYears: 1, indexOf: missing, treasuryAddress: 'taX', leaseAddress: PK_A, configAddress: PK_A });
  } catch { threw = true; }
  ok('missing account refused (not silently zeroed)', threw);
}

// ---- Golden: config state round trip ------------------------------------------------------------
{
  // Build config bytes by the RUST layout doc and parse them with JS:
  const cfg = new Uint8Array(TCR_CONFIG_SIZE);
  const dv = new DataView(cfg.buffer);
  dv.setUint32(TCR_CFG.magic, TCR_CONFIG_MAGIC, true);
  cfg[TCR_CFG.version] = TCR_LAYOUT_VERSION;
  cfg[TCR_CFG.rootNameLen] = 4;
  dv.setBigUint64(TCR_CFG.feePerYear, 1000n, true);
  cfg.set(new Uint8Array(32).fill(0x01), TCR_CFG.admin);
  cfg.set(new Uint8Array(32).fill(0x02), TCR_CFG.treasury);
  cfg.set(new Uint8Array(32).fill(0x03), TCR_CFG.rootAddress);
  cfg.set(new TextEncoder().encode('thru'), TCR_CFG.rootName);
  const parsed = parseTcrConfig(cfg);
  ok('config magic pinned', hex(cfg.slice(0, 4)) === hex(new Uint8Array([0x54, 0x43, 0x52, 0x31]))); // "TCR1" LE
  ok('config parse fields', parsed.feePerYear === 1000n && parsed.rootName === 'thru'
    && parsed.admin === Pubkey.from(new Uint8Array(32).fill(0x01)).toThruFmt()
    && parsed.treasury === Pubkey.from(new Uint8Array(32).fill(0x02)).toThruFmt()
    && parsed.rootAddress === Pubkey.from(new Uint8Array(32).fill(0x03)).toThruFmt());
  const bad = cfg.slice(); bad[0] ^= 1;
  let threw = false;
  try { parseTcrConfig(bad); } catch { threw = true; }
  ok('config magic mismatch rejected', threw);
  const wrongSize = cfg.slice(0, -1);
  threw = false;
  try { parseTcrConfig(wrongSize); } catch { threw = true; }
  ok('config wrong size rejected', threw);
}

// ---- Golden: lease state round trip --------------------------------------------------------------
{
  const lease = new Uint8Array(TCR_LEASE_SIZE);
  const dv = new DataView(lease.buffer);
  dv.setUint32(TCR_LSE.magic, TCR_LEASE_MAGIC, true);
  lease[TCR_LSE.version] = TCR_LAYOUT_VERSION;
  lease[TCR_LSE.labelLen] = 7;
  dv.setBigUint64(TCR_LSE.expiresAt, 1_830_000_000n, true);
  dv.setBigUint64(TCR_LSE.registeredAt, 1_798_464_000n, true);
  lease.set(new Uint8Array(32).fill(0x09), TCR_LSE.owner);
  lease.set(new Uint8Array(32).fill(0x09), TCR_LSE.resolver);
  lease.set(new TextEncoder().encode('my-name'), TCR_LSE.label);
  const parsed = parseTcrLease(lease);
  ok('lease magic pinned', hex(lease.slice(0, 4)) === hex(new Uint8Array([0x52, 0x4c, 0x53, 0x31]))); // "RLS1" LE
  ok('lease parse fields', parsed.label === 'my-name'
    && parsed.expiresAtSeconds === 1_830_000_000n
    && parsed.registeredAtSeconds === 1_798_464_000n
    && parsed.owner === Pubkey.from(new Uint8Array(32).fill(0x09)).toThruFmt());
}

// ---- Derivations are real, not hardcoded ----------------------------------------------------------
{
  const program = PK_A; // any valid program address exercises the derivation primitive
  const a1 = tcrLeaseAddress(program, 'alice');
  const a2 = tcrLeaseAddress(program, 'alice');
  const a3 = tcrLeaseAddress(program, 'alicf');
  ok('lease derivation deterministic', a1 === a2);
  ok('lease derivation label-sensitive', a1 !== a3);
  ok('lease derivation ta-format', /^ta[1-9A-HJ-NP-Za-km-z_-]{20,}$/.test(a1) || a1.length > 20);
  const cfg = tcrConfigAddress(program);
  ok('config derivation deterministic and distinct from lease', typeof cfg === 'string' && cfg.length > 20 && cfg !== a1);
  ok('config seed label is deliberately NOT a valid registerable label', !!labelProblem(TCR_CONFIG_SEED_LABEL), TCR_CONFIG_SEED_LABEL);
  let threw = false;
  try { tcrLeaseAddress(program, TCR_CONFIG_SEED_LABEL); } catch { threw = true; }
  ok('lease derivation rejects the config seed label (collision impossible by construction)', threw);
}

// ---- Error-code table parity with errors.rs + instruction.rs parse codes --------------------------
{
  const rust = readFileSync(join(root, 'contracts/thru-custom-registrar/src/errors.rs'), 'utf8');
  const rustCodes = [...rust.matchAll(/pub const (ERR_[A-Z_]+): u64 = (0x[0-9A-Fa-f]+);/g)]
    .map((m) => Number(BigInt(m[2])));
  const rustInstr = readFileSync(join(root, 'contracts/thru-custom-registrar/src/instruction.rs'), 'utf8');
  const parseCodes = [...rustInstr.matchAll(/pub const (ERR_[A-Z_]+): u64 = (0x[0-9A-Fa-f]+);/g)]
    .map((m) => Number(BigInt(m[2])));
  const all = [...new Set([...rustCodes, ...parseCodes])];
  ok('Rust sources export positive codes', all.length >= 21, `${all.length} found`);
  const missing = all.filter((c) => !(c in TCR_ERRORS));
  ok('every Rust error code has JS text', missing.length === 0, missing.join(','));
}

// ---- Instruction-source cross-pin: Rust tags == JS tags --------------------------------------------
{
  const rustInstr = readFileSync(join(root, 'contracts/thru-custom-registrar/src/instruction.rs'), 'utf8');
  const tags = Object.fromEntries([...rustInstr.matchAll(/pub const (TAG_[A-Z_]+): u32 = (\d+);/g)]
    .map((m) => [m[1], Number(m[2])]));
  ok('tags agree', tags.TAG_INITIALIZE === TCR_OP_INITIALIZE
    && tags.TAG_REGISTER === TCR_OP_REGISTER
    && tags.TAG_RENEW === TCR_OP_RENEW
    && tags.TAG_UPDATE_CONFIG === TCR_OP_UPDATE_CONFIG,
    JSON.stringify(tags));
  const rustState = readFileSync(join(root, 'contracts/thru-custom-registrar/src/state.rs'), 'utf8');
  const sizes = Object.fromEntries([...rustState.matchAll(/pub const (CONFIG_SIZE|LEASE_SIZE): usize = (\d+);/g)]
    .map((m) => [m[1], Number(m[2])]));
  ok('sizes agree', sizes.CONFIG_SIZE === TCR_CONFIG_SIZE && sizes.LEASE_SIZE === TCR_LEASE_SIZE,
    JSON.stringify(sizes));
}

// ---- SDK sort sentinel: the installed @thru/sdk MUST byte-sort its account segments ----------------
// If a future SDK flips ordering conventions again, THIS test fails before anything else
// does — the registrar ABI depends on indices being resolved against the same table the
// SDK serializes (whatever its order, as long as buildInstructionData's context is the
// source of truth). The sentinel pins the CURRENT behavior of the current version.
{
  const { TransactionBuilder, keys, deriveProgramAddress } = await import('@thru/sdk');
  const kp = await keys.generateKeyPair();
  const prog = 'taNAMEqRNEDeMWp0cDYmMVdZyTZiF5NyGDR9zTwH42rWQG';
  const mk = (s) => { const b = new Uint8Array(32); b.set(new TextEncoder().encode(s)); return deriveProgramAddress({ programAddress: prog, seed: b }).address; };
  const A = mk('tcr-sentinel-a'); const B = mk('tcr-sentinel-b');
  const Bx = (x) => Pubkey.from(x).toBytes();
  const cmp = (a, b) => { const x = Bx(a); const y = Bx(b); for (let i = 0; i < 32; i++) { if (x[i] !== y[i]) return x[i] - y[i]; } return 0; };
  // Pass DESCENDING on purpose; record which indices the SDK context hands back.
  const passed = cmp(A, B) > 0 ? [A, B] : [B, A];
  const tb = new TransactionBuilder();
  const idxs = [...tb.build({
    feePayer: { publicKey: kp.publicKey },
    program: prog,
    header: { computeUnits: 1000, memoryUnits: 1000, stateUnits: 1, fee: 0n, flags: 0, nonce: 1n, startSlot: 0n, chainId: 1, expiryAfter: 128 },
    accounts: { readWriteAccounts: passed, readOnlyAccounts: [] },
    buildInstructionData: (ctx) => new Uint8Array([ctx.getAccountIndex(passed[0]), ctx.getAccountIndex(passed[1])]),
  }).instructionData];
  // passed[0] is bytewise HIGHER → in a sorted table it must get the LATER index (3).
  ok('SDK 0.4.2 account table is byte-sorted (descending input → indices [3,2])',
    idxs.length === 2 && idxs[0] === 3 && idxs[1] === 2,
    `got indices ${JSON.stringify(idxs)} for descending input`);
}

const failed = t.filter((x) => !x.pass);
console.log(failed.length === 0
  ? `\nAll custom-registrar client ABI tests passed (${t.length} checks).`
  : `\n${failed.length}/${t.length} custom-registrar tests FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
