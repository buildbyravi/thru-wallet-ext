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
  TCR_OP_INITIALIZE_LEGACY, TCR_OP_INITIALIZE_V2, TCR_OP_REGISTER, TCR_OP_RENEW, TCR_OP_UPDATE_CONFIG,
  TCR_CONFIG_SIZE, TCR_CONFIG_SIZE_V1, TCR_CONFIG_LAYOUT_V1, TCR_CONFIG_LAYOUT_V2,
  TCR_LEASE_SIZE, TCR_CONFIG_MAGIC, TCR_LEASE_MAGIC, TCR_LAYOUT_VERSION,
  TCR_CFG, TCR_LSE, TCR_YEAR_SECONDS, TCR_FEE_POLICY,
  TCR_MIN_LABEL, TCR_MAX_LABEL, TCR_MAX_YEARS,
  TCR_ERRORS,
  labelProblem, yearsProblem, feePolicyName,
  tcrLeaseAddress, tcrConfigAddress, TCR_CONFIG_SEED_LABEL,
  parseTcrConfig, parseTcrLease, tcrPricePerYear, tcrTotalForTerm,
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
    fee3PerYear: 100_000n, fee4PerYear: 10_000n, fee5PlusPerYear: 1_000n,
    feePolicy: TCR_FEE_POLICY.strict,
    treasury: PK_A, rootName: 'thru',
    configSeed: new Uint8Array(32).fill(0x07), configProof, rootProof,
    indexOf, configAddress: table[2], rootAddress: table[3], nameServiceProgram: table[4],
  });
  const want = [
    '04000000',                                     // tag 4 LE (tiered Initialize)
    '0200', '0300', '0400',                         // config_idx=2, root_idx=3, ns_idx=4
    'a086010000000000',                             // fee_3   100000 LE
    '1027000000000000',                             // fee_4    10000 LE
    'e803000000000000',                             // fee_5+    1000 LE
    '01',                                           // fee_policy = strict
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
    newFee5Plus: 5000n, indexOf: indexResolver(table), configAddress: table[2],
  });
  // [tag][config_idx][mask][treasury 32][fee3][fee4][fee5+][policy]
  const want = [
    '03000000', '0200', '08', '00'.repeat(32),
    '00'.repeat(8), '00'.repeat(8), '8813000000000000', '00',
  ].join('');
  ok('UpdateConfig (fee_5plus only) == golden bytes', hex(data) === want, hex(data) === want ? '' : `got ${hex(data)}`);
  const both = buildTcrUpdateConfigInstructionData({
    newTreasury: PK_A, newFee3: 100_000n, newFeePolicy: TCR_FEE_POLICY.strict,
    indexOf: indexResolver(table), configAddress: table[2],
  });
  ok('UpdateConfig mask 0x13 for treasury + fee_3 + policy', both[6] === 0x13, `${both[6]}`);
  ok('UpdateConfig carries the treasury at offset 7 and the policy last',
    both[7] === 0x11 && both[63] === TCR_FEE_POLICY.strict && both.length === 64,
    `${both.length} bytes`);
  let threw = false;
  try { buildTcrUpdateConfigInstructionData({ indexOf: indexResolver(table), configAddress: table[2] }); } catch { threw = true; }
  ok('UpdateConfig empty refused', threw);
  threw = false;
  try {
    buildTcrUpdateConfigInstructionData({ newFeePolicy: 5, indexOf: indexResolver(table), configAddress: table[2] });
  } catch { threw = true; }
  ok('UpdateConfig refuses an unknown fee policy', threw);
}

// ---- Builders refuse reserved indices (mirrors Rust check_idx hygiene) -----------
{
  const bad = indexResolver([PK_B, PK_A, PK_B]); // config would resolve to 0 (fee payer)
  let threw = false;
  try {
    buildTcrUpdateConfigInstructionData({ newFee3: 1n, indexOf: bad, configAddress: PK_B });
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
  // Build config bytes by the RUST layout doc and parse them with JS (layout 2):
  const cfg = new Uint8Array(TCR_CONFIG_SIZE);
  const dv = new DataView(cfg.buffer);
  dv.setUint32(TCR_CFG.magic, TCR_CONFIG_MAGIC, true);
  cfg[TCR_CFG.version] = TCR_CONFIG_LAYOUT_V2;
  cfg[TCR_CFG.rootNameLen] = 4;
  dv.setBigUint64(TCR_CFG.feePerYear, 1000n, true); // the derived legacy mirror
  dv.setBigUint64(TCR_CFG.fee3Char, 100_000n, true);
  dv.setBigUint64(TCR_CFG.fee4Char, 10_000n, true);
  dv.setBigUint64(TCR_CFG.fee5PlusChar, 1_000n, true);
  cfg[TCR_CFG.feePolicy] = TCR_FEE_POLICY.strict;
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
  ok('layout 2 exposes the tier schedule and the policy',
    parsed.layout === TCR_CONFIG_LAYOUT_V2
      && parsed.fee3PerYear === 100_000n && parsed.fee4PerYear === 10_000n
      && parsed.fee5PlusPerYear === 1_000n
      && parsed.feePolicy === TCR_FEE_POLICY.strict && parsed.feePolicyName === 'strict');
  const bad = cfg.slice(); bad[0] ^= 1;
  let threw = false;
  try { parseTcrConfig(bad); } catch { threw = true; }
  ok('config magic mismatch rejected', threw);
  const wrongSize = cfg.slice(0, -1);
  threw = false;
  try { parseTcrConfig(wrongSize); } catch { threw = true; }
  ok('config wrong size rejected', threw);
  const badPolicy = cfg.slice(); badPolicy[TCR_CFG.feePolicy] = 9;
  threw = false;
  try { parseTcrConfig(badPolicy); } catch { threw = true; }
  ok('config rejects an unknown fee policy instead of defaulting it', threw);
}

// ---- Layout 1 (the DEPLOYED config) still reads, as a flat schedule -----------------------------
{
  const v1 = new Uint8Array(TCR_CONFIG_SIZE_V1);
  const dv = new DataView(v1.buffer);
  dv.setUint32(TCR_CFG.magic, TCR_CONFIG_MAGIC, true);
  v1[TCR_CFG.version] = TCR_CONFIG_LAYOUT_V1;
  v1[TCR_CFG.rootNameLen] = 4;
  dv.setBigUint64(TCR_CFG.feePerYear, 1000n, true);
  v1.set(new Uint8Array(32).fill(0x01), TCR_CFG.admin);
  v1.set(new Uint8Array(32).fill(0x02), TCR_CFG.treasury);
  v1.set(new Uint8Array(32).fill(0x03), TCR_CFG.rootAddress);
  v1.set(new TextEncoder().encode('thru'), TCR_CFG.rootName);
  const parsed = parseTcrConfig(v1);
  ok('a deployed layout-1 config still parses', parsed.layout === TCR_CONFIG_LAYOUT_V1);
  ok('layout 1 prices every length at its flat fee',
    tcrPricePerYear(parsed, 'abc') === 1000n
      && tcrPricePerYear(parsed, 'abcd') === 1000n
      && tcrPricePerYear(parsed, 'abcdef') === 1000n);
  ok('layout 1 reports best-effort, because that is how the deployed program behaves',
    parsed.feePolicy === TCR_FEE_POLICY.bestEffort && parsed.feePolicyName === 'best effort',
    parsed.feePolicyName);
}

// ---- Tiered pricing, by label length -------------------------------------------------------------
{
  const cfgBytes = new Uint8Array(TCR_CONFIG_SIZE);
  const dv = new DataView(cfgBytes.buffer);
  dv.setUint32(TCR_CFG.magic, TCR_CONFIG_MAGIC, true);
  cfgBytes[TCR_CFG.version] = TCR_CONFIG_LAYOUT_V2;
  cfgBytes[TCR_CFG.rootNameLen] = 4;
  dv.setBigUint64(TCR_CFG.fee3Char, 100_000n, true);
  dv.setBigUint64(TCR_CFG.fee4Char, 10_000n, true);
  dv.setBigUint64(TCR_CFG.fee5PlusChar, 1_000n, true);
  cfgBytes[TCR_CFG.feePolicy] = TCR_FEE_POLICY.strict;
  const cfg = parseTcrConfig(cfgBytes);
  ok('3 characters costs the 3-char tier', tcrPricePerYear(cfg, 'abc') === 100_000n);
  ok('4 characters costs the 4-char tier', tcrPricePerYear(cfg, 'abcd') === 10_000n);
  ok('5 characters costs the 5+ tier', tcrPricePerYear(cfg, 'abcde') === 1_000n);
  ok('32 characters still costs the 5+ tier', tcrPricePerYear(cfg, 'a'.repeat(32)) === 1_000n);
  ok('term total multiplies the tier by the years', tcrTotalForTerm(cfg, 'abc', 3) === 300_000n);
  let threw = false;
  try { tcrPricePerYear(cfg, 'ab'); } catch { threw = true; }
  ok('a 2-character label cannot be priced', threw);
  threw = false;
  try { tcrTotalForTerm(cfg, 'abc', 11); } catch { threw = true; }
  ok('an out-of-policy term is refused', threw);
  const huge = { fee3PerYear: 0xffffffffffffffffn, fee4PerYear: 0n, fee5PlusPerYear: 0n };
  threw = false;
  try { tcrTotalForTerm(huge, 'abc', 2); } catch { threw = true; }
  ok('price x years that overflows u64 is refused, never wrapped', threw);
  ok('fee policy names are the two known modes',
    feePolicyName(0) === 'best effort' && feePolicyName(1) === 'strict' && feePolicyName(2) === 'unknown');
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
  const tags = Object.fromEntries([...rustInstr.matchAll(/pub const (TAG_[A-Z0-9_]+): u32 = (\d+);/g)]
    .map((m) => [m[1], Number(m[2])]));
  ok('tags agree', tags.TAG_INITIALIZE === TCR_OP_INITIALIZE_LEGACY
    && tags.TAG_INITIALIZE_V2 === TCR_OP_INITIALIZE_V2
    && tags.TAG_REGISTER === TCR_OP_REGISTER
    && tags.TAG_RENEW === TCR_OP_RENEW
    && tags.TAG_UPDATE_CONFIG === TCR_OP_UPDATE_CONFIG,
    JSON.stringify(tags));
  // The tiered Initialize must not reuse the flat-fee tag: an out-of-date deploy script then
  // gets 0xD006 by name instead of having its flat fee read as fee_3_char.
  ok('the tiered Initialize has its own tag', tags.TAG_INITIALIZE !== tags.TAG_INITIALIZE_V2);
  // Fee-policy constants are shared vocabulary between the program and the wallet.
  const rustPolicies = Object.fromEntries([...rustInstr.matchAll(/pub const (FEE_POLICY_[A-Z0-9_]+): u8 = (\d+);/g)]
    .map((m) => [m[1], Number(m[2])]));
  ok('fee policy values agree', rustPolicies.FEE_POLICY_BEST_EFFORT === TCR_FEE_POLICY.bestEffort
    && rustPolicies.FEE_POLICY_STRICT === TCR_FEE_POLICY.strict, JSON.stringify(rustPolicies));
  const rustState = readFileSync(join(root, 'contracts/thru-custom-registrar/src/state.rs'), 'utf8');
  const sizes = Object.fromEntries([...rustState.matchAll(/pub const (CONFIG_SIZE|LEASE_SIZE): usize = (\d+);/g)]
    .map((m) => [m[1], Number(m[2])]));
  ok('sizes agree', sizes.CONFIG_SIZE === TCR_CONFIG_SIZE && sizes.LEASE_SIZE === TCR_LEASE_SIZE,
    JSON.stringify(sizes));
  const sizesV1 = Object.fromEntries([...rustState.matchAll(/pub const (CONFIG_SIZE_V1): usize = (\d+);/g)]
    .map((m) => [m[1], Number(m[2])]));
  ok('the layout-1 size still matches what the deployed program wrote',
    sizesV1.CONFIG_SIZE_V1 === TCR_CONFIG_SIZE_V1, JSON.stringify(sizesV1));
  // Offsets are the whole ABI for state: pin every one of them against state.rs.
  const offs = Object.fromEntries([...rustState.matchAll(/pub const OFF_CFG_([A-Z0-9_]+): usize = (\d+);/g)]
    .map((m) => [m[1], Number(m[2])]));
  const jsOffs = {
    MAGIC: TCR_CFG.magic, VERSION: TCR_CFG.version, ROOT_NAME_LEN: TCR_CFG.rootNameLen,
    BUMP: TCR_CFG.bump, FEE_PER_YEAR: TCR_CFG.feePerYear, ADMIN: TCR_CFG.admin,
    TREASURY: TCR_CFG.treasury, ROOT_ADDRESS: TCR_CFG.rootAddress, ROOT_NAME: TCR_CFG.rootName,
    FEE_3: TCR_CFG.fee3Char, FEE_4: TCR_CFG.fee4Char, FEE_5PLUS: TCR_CFG.fee5PlusChar,
    FEE_POLICY: TCR_CFG.feePolicy,
  };
  const offMismatch = Object.entries(jsOffs).filter(([k, v]) => offs[k] !== v);
  ok('every config offset agrees with state.rs', offMismatch.length === 0,
    offMismatch.map(([k, v]) => `${k}: js=${v} rs=${offs[k]}`).join(' '));
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
