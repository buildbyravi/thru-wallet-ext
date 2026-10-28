// Custom Thru registrar program (thru-custom-registrar) — client ABI for the wallet.
//
// Chain side lives in contracts/thru-custom-registrar/ (this repo) — a side-by-side
// registrar that CPIs into the NATIVE name-service program with a program-owned
// config account as the root authority. Owner directive 2026-10-24: open public
// subdomain registration under OUR OWN root with a protocol fee (1000 base units/year
// on Betanet; mainnet price later, changed at runtime via UpdateConfig).
//
// PROVENANCE (all first-party or same-repo; no third-party layouts):
//   - Program byte layouts & tags: contracts/thru-custom-registrar/src/{instruction,state,
//     cpi}.rs — Rust host tests in those files are the OTHER side of the byte-pin; the
//     golden-hex vectors in test/test-custom-registrar.mjs lock both sides together.
//   - CPI payload re-encoding (init-root tag 0 / register-subdomain tag 1, packed args,
//     inline proofs): first-party txn_tools.rs @ a058dd8 — same source our live-proven
//     name-service register path used on Betanet 2026-10-24.
//   - Account-table ABI: v2 index-carrying formats. @thru/sdk 0.4.2 (the PUBLISHED npm
//     dist — normalizeAccountList in chunk sorting with compareAccounts, verified
//     2026-10-24 live in the sandbox) byte-sorts each readWrite/readOnly segment;
//     the VM-visible table is [feePayer, program, sorted RW, sorted RO]. Positional
//     account constants are therefore INVALID — indices must be resolved at build time
//     through the SDK's own InstructionContext (this module takes an indexOf resolver
//     exactly like buildRegisterSubdomainInstructionData does in name-service.js).
//     Registry scripts pass `instructionData: ({ getAccountIndex }) => buildTcr…(…)`
//     so the SDK itself decides the final indices.
//   - Authority-under-CPI: InvokeAuth (magic 0xC3F7A1D9E5B20846, sys INVOKE 0x0A) —
//     only program-OWNED accounts may be marked authorized (account_safe.rs).
//
// SECURITY MODEL: the user is the signer AND pays the fee (account_transfer user →
// treasury inside the program). No sponsorship, no third-party authority, no hidden
// price: fee_per_year is READ FROM the on-chain config account and shown to the user
// before signing. The extension never fabricates the fee.

import { Pubkey, deriveProgramAddress } from '@thru/sdk';
import { NAME_SERVICE_PROGRAM } from './name-service.js';

export { NAME_SERVICE_PROGRAM };

// ---- Opcodes (u32 LE; mirror instruction.rs TAG_*) -------------------------------
export const TCR_OP_INITIALIZE = 0;
export const TCR_OP_REGISTER = 1;
export const TCR_OP_RENEW = 2;
export const TCR_OP_UPDATE_CONFIG = 3;

// ---- State layout pins (mirror state.rs exactly) ---------------------------------
export const TCR_CONFIG_SIZE = 144;
export const TCR_LEASE_SIZE = 120;
export const TCR_CONFIG_MAGIC = 0x31524354; // bytes "TCR1" little-endian
export const TCR_LEASE_MAGIC = 0x31534c52;  // "RLS1"
export const TCR_LAYOUT_VERSION = 1;
export const TCR_YEAR_SECONDS = 31_536_000;

// Config field offsets (state.rs)
export const TCR_CFG = Object.freeze({
  magic: 0, version: 4, rootNameLen: 5, bump: 6,
  feePerYear: 8, admin: 16, treasury: 48, rootAddress: 80, rootName: 112,
});
// Lease field offsets
export const TCR_LSE = Object.freeze({
  magic: 0, version: 4, labelLen: 5, expiresAt: 8, registeredAt: 16,
  owner: 24, resolver: 56, label: 88,
});

// ---- Policy (mirror instruction.rs) ----------------------------------------------
export const TCR_MIN_LABEL = 3;
export const TCR_MAX_LABEL = 32;
export const TCR_MAX_YEARS = 10;

export class CustomRegistrarDecodeError extends Error {
  constructor(message) { super(message); this.name = 'CustomRegistrarDecodeError'; }
}

/** Program-side revert codes (errors.rs + instruction.rs) → human text. */
export const TCR_ERRORS = Object.freeze({
  0xd001: 'truncated instruction data', 0xd002: 'unknown instruction',
  0xd003: 'name too long', 0xd004: 'proof too long',
  0xd005: 'bad account index (reserved slot or role collision)',
  0xd100: 'bad label (need 3–32 of [a-z0-9-], no edge hyphens)',
  0xd101: 'bad duration (1–10 years)', 0xd102: 'missing accounts',
  0xd103: 'not admin', 0xd104: 'already initialized',
  0xd105: 'account not owned by registrar', 0xd106: 'wrong root account',
  0xd107: 'wrong treasury account', 0xd108: 'config parse failed',
  0xd109: 'lease parse failed', 0xd10a: 'name already taken',
  0xd10b: 'no lease found', 0xd10c: 'lease label mismatch',
  0xd10d: 'target account missing from transaction', 0xd10e: 'fee math overflow',
  0xd10f: 'treasury index/pubkey mismatch',
  0xd200: 'config creation failed', 0xd201: 'lease creation failed',
  0xd202: 'fee transfer failed', 0xd203: 'root init CPI failed',
  0xd204: 'register CPI failed', 0xd205: 'state proof parse failed',
});

export function describeTcrError(code) {
  const c = Number(code);
  if (TCR_ERRORS[c]) return TCR_ERRORS[c];
  if (c === 53770 || c === 0xd20a) {
    return 'fee transfer failed (account not writable)';
  }
  const sysNames = {
    0x0a: 'account not writable',
    0x08: 'invalid account index',
    0x09: 'account does not exist',
    0x26: 'insufficient balance',
  };
  if ((c & 0xff00) === 0xd200) {
    const sysCode = c & 0xff;
    const detail = sysNames[sysCode] ? ' (' + sysNames[sysCode] + ')' : ' (syscall error ' + sysCode + ')';
    if (sysCode === 0x26) {
      return TCR_ERRORS[0xd202] + detail;
    }
    const base = c & ~0xff;
    if (TCR_ERRORS[base]) {
      return TCR_ERRORS[base] + detail;
    }
  }
  return 'unknown registrar error ' + code;
}

// ---- Pure validation -------------------------------------------------------------
export function labelProblem(name) {
  const n = String(name ?? '');
  if (!/^[a-z0-9-]*$/.test(n)) return 'only lowercase letters, digits and hyphens';
  if (n.length < TCR_MIN_LABEL || n.length > TCR_MAX_LABEL) {
    return `names are ${TCR_MIN_LABEL}–${TCR_MAX_LABEL} characters`;
  }
  if (n.startsWith('-') || n.endsWith('-')) return 'no leading or trailing hyphen';
  return null;
}

export function yearsProblem(years) {
  const y = Number(years);
  if (!Number.isInteger(y) || y < 1 || y > TCR_MAX_YEARS) {
    return `years must be a whole number 1–${TCR_MAX_YEARS}`;
  }
  return null;
}

// ---- Derivations (CLI-proven primitive: deriveProgramAddress) --------------------
/** Lease = deriveProgramAddress(registrar_program, label_zero_padded_to_32). */
export function tcrLeaseAddress(registrarProgram, label) {
  const prob = labelProblem(label);
  if (prob) throw new Error(prob);
  const seed = new Uint8Array(32);
  seed.set(new TextEncoder().encode(label));
  return String(deriveProgramAddress({ programAddress: registrarProgram, seed }).address);
}

/**
 * Config = deriveProgramAddress(registrar_program, configSeed32) — the seed is chosen
 * at Initialize time; the deploy script fixes it to TCR_CONFIG_SEED_LABEL zero-padded
 * so this helper can always re-derive it. Never hardcode the resulting address.
 */
// NB: the label deliberately CANNOT be a valid registerable name — the seed space the
// config account and lease accounts share would then let a user register a label whose
// lease address equals the config address (lease_seed == padded label). Uppercase and
// the colon are both rejected by labelProblem/validate_label, so no user label can ever
// collide with this seed.
export const TCR_CONFIG_SEED_LABEL = 'TCR:config:v1';
export function tcrConfigAddress(registrarProgram, seedLabel = TCR_CONFIG_SEED_LABEL) {
  const bytes = new TextEncoder().encode(seedLabel);
  if (bytes.length === 0 || bytes.length > 32) throw new Error('config seed label must be 1..32 bytes');
  const seed = new Uint8Array(32);
  seed.set(bytes);
  return String(deriveProgramAddress({ programAddress: registrarProgram, seed }).address);
}

// ---- State parsers ---------------------------------------------------------------
function addr(data, off) {
  return Pubkey.from(data.slice(off, off + 32)).toThruFmt();
}

export function parseTcrConfig(input) {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (data.length !== TCR_CONFIG_SIZE) {
    throw new CustomRegistrarDecodeError(`config account must be exactly ${TCR_CONFIG_SIZE} bytes`);
  }
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (Number(dv.getUint32(TCR_CFG.magic, true)) !== TCR_CONFIG_MAGIC) {
    throw new CustomRegistrarDecodeError('config magic mismatch (not a thru-custom-registrar config)');
  }
  if (data[TCR_CFG.version] !== TCR_LAYOUT_VERSION) {
    throw new CustomRegistrarDecodeError(`config version ${data[TCR_CFG.version]} unsupported (expect ${TCR_LAYOUT_VERSION})`);
  }
  const rootNameLen = data[TCR_CFG.rootNameLen];
  if (rootNameLen === 0 || rootNameLen > 32) {
    throw new CustomRegistrarDecodeError(`config declares a ${rootNameLen}-byte root name (1–32 expected)`);
  }
  return {
    admin: addr(data, TCR_CFG.admin),
    treasury: addr(data, TCR_CFG.treasury),
    feePerYear: dv.getBigUint64(TCR_CFG.feePerYear, true),
    rootAddress: addr(data, TCR_CFG.rootAddress),
    rootName: String.fromCharCode(...data.slice(TCR_CFG.rootName, TCR_CFG.rootName + rootNameLen)),
    bump: data[TCR_CFG.bump],
  };
}

export function parseTcrLease(input) {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (data.length !== TCR_LEASE_SIZE) {
    throw new CustomRegistrarDecodeError(`lease account must be exactly ${TCR_LEASE_SIZE} bytes`);
  }
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (Number(dv.getUint32(TCR_LSE.magic, true)) !== TCR_LEASE_MAGIC) {
    throw new CustomRegistrarDecodeError('lease magic mismatch (not a thru-custom-registrar lease)');
  }
  if (data[TCR_LSE.version] !== TCR_LAYOUT_VERSION) {
    throw new CustomRegistrarDecodeError(`lease version ${data[TCR_LSE.version]} unsupported`);
  }
  const labelLen = data[TCR_LSE.labelLen];
  if (labelLen < TCR_MIN_LABEL || labelLen > TCR_MAX_LABEL) {
    throw new CustomRegistrarDecodeError(`lease declares a ${labelLen}-byte label (3–32 expected)`);
  }
  return {
    owner: addr(data, TCR_LSE.owner),
    resolver: addr(data, TCR_LSE.resolver),
    expiresAtSeconds: dv.getBigUint64(TCR_LSE.expiresAt, true),
    registeredAtSeconds: dv.getBigUint64(TCR_LSE.registeredAt, true),
    label: String.fromCharCode(...data.slice(TCR_LSE.label, TCR_LSE.label + labelLen)),
  };
}

// ---- Instruction builders (byte-exact twins of the Rust parsers) ------------------
function assertProof(proof, name) {
  if (!(proof instanceof Uint8Array) || proof.length === 0) throw new Error(`${name} is required`);
  if (proof.length > 2048) throw new Error(`${name} exceeds the 2048-byte proof cap (matches instruction.rs)`);
}

function padded32(text, what) {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length === 0 || bytes.length > 32) throw new Error(`${what} must be 1..32 bytes`);
  const out = new Uint8Array(32);
  out.set(bytes);
  return { bytes, buf: out };
}

function resolvedIndex(indexOf, address, role, { allowZero = false } = {}) {
  if (typeof indexOf !== 'function') throw new Error('indexOf resolver is required (SDK getAccountIndex context)');
  const idx = indexOf(address);
  if (!Number.isInteger(idx) || idx < 0) throw new Error(`${role} address is not in the transaction account table`);
  if (!allowZero && idx <= 1) throw new Error(`${role} resolved to reserved index ${idx} (0=feePayer, 1=program)`);
  return idx;
}

/**
 * INITIALIZE: [u32 0][u16 config_idx][u16 root_idx][u16 ns_idx]
 * [u64 fee_per_year][32 treasury][u32 root_name_len][root_name 32p]
 * [32 config_seed][u32 config_proof_len][proof][u32 root_proof_len][proof]
 */
export function buildTcrInitializeInstructionData({
  feePerYear, treasury, rootName, configSeed, configProof, rootProof,
  indexOf, configAddress, rootAddress,
  nameServiceProgram = NAME_SERVICE_PROGRAM,
}) {
  if (typeof feePerYear !== 'bigint' || feePerYear < 0n) throw new Error('feePerYear must be a non-negative bigint of base units');
  assertProof(configProof, 'configProof');
  assertProof(rootProof, 'rootProof');
  const idxConfig = resolvedIndex(indexOf, configAddress, 'config');
  const idxRoot = resolvedIndex(indexOf, rootAddress, 'root');
  const idxNs = resolvedIndex(indexOf, nameServiceProgram, 'nameServiceProgram');
  const treasuryBytes = Pubkey.from(treasury).toBytes();
  const { bytes: nameBytes, buf: nameBuf } = padded32(rootName, 'root name');
  const seed = configSeed instanceof Uint8Array && configSeed.length === 32
    ? configSeed
    : padded32(configSeed, 'config seed').buf;
  const total = 4 + 6 + 8 + 32 + 4 + 32 + 32 + 4 + configProof.length + 4 + rootProof.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let w = 0;
  dv.setUint32(w, TCR_OP_INITIALIZE, true); w += 4;
  dv.setUint16(w, idxConfig, true); w += 2;
  dv.setUint16(w, idxRoot, true); w += 2;
  dv.setUint16(w, idxNs, true); w += 2;
  dv.setBigUint64(w, feePerYear, true); w += 8;
  out.set(treasuryBytes, w); w += 32;
  dv.setUint32(w, nameBytes.length, true); w += 4;
  out.set(nameBuf, w); w += 32;
  out.set(seed, w); w += 32;
  dv.setUint32(w, configProof.length, true); w += 4;
  out.set(configProof, w); w += configProof.length;
  dv.setUint32(w, rootProof.length, true); w += 4;
  out.set(rootProof, w); w += rootProof.length;
  return out;
}

/**
 * REGISTER: [u32 1][u16 treasury][u16 root][u16 domain][u16 lease][u16 config][u16 ns][u16 target]
 * [u16 duration_years][u32 label_len][label 32p][32 target_pubkey]
 * [u32 domain_proof_len][proof][u32 lease_proof_len][proof]
 */
export function buildTcrRegisterInstructionData({
  label, durationYears, targetAddress, domainProof, leaseProof, indexOf,
  treasuryAddress, rootAddress, domainAddress, leaseAddress, configAddress,
  nameServiceProgram = NAME_SERVICE_PROGRAM,
}) {
  const lp = labelProblem(label);
  if (lp) throw new Error(lp);
  const yp = yearsProblem(durationYears);
  if (yp) throw new Error(yp);
  assertProof(domainProof, 'domainProof');
  assertProof(leaseProof, 'leaseProof');
  const idxTreasury = resolvedIndex(indexOf, treasuryAddress, 'treasury');
  const idxRoot = resolvedIndex(indexOf, rootAddress, 'root');
  const idxDomain = resolvedIndex(indexOf, domainAddress, 'domain');
  const idxLease = resolvedIndex(indexOf, leaseAddress, 'lease');
  const idxConfig = resolvedIndex(indexOf, configAddress, 'config');
  const idxNs = resolvedIndex(indexOf, nameServiceProgram, 'nameServiceProgram');
  // target may BE the fee payer (index 0) — the common self-register case.
  const idxTarget = resolvedIndex(indexOf, targetAddress, 'target', { allowZero: true });
  const { bytes: labelBytes, buf: labelBuf } = padded32(label, 'label');
  const targetBytes = Pubkey.from(targetAddress).toBytes();
  const total = 4 + 14 + 2 + 4 + 32 + 32 + 4 + domainProof.length + 4 + leaseProof.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let w = 0;
  dv.setUint32(w, TCR_OP_REGISTER, true); w += 4;
  for (const idx of [idxTreasury, idxRoot, idxDomain, idxLease, idxConfig, idxNs, idxTarget]) {
    dv.setUint16(w, idx, true); w += 2;
  }
  dv.setUint16(w, Number(durationYears), true); w += 2;
  dv.setUint32(w, labelBytes.length, true); w += 4;
  out.set(labelBuf, w); w += 32;
  out.set(targetBytes, w); w += 32;
  dv.setUint32(w, domainProof.length, true); w += 4;
  out.set(domainProof, w); w += domainProof.length;
  dv.setUint32(w, leaseProof.length, true); w += 4;
  out.set(leaseProof, w); w += leaseProof.length;
  return out;
}

/**
 * RENEW: [u32 2][u16 treasury_idx][u16 lease_idx][u16 config_idx]
 * [u16 duration_years][u32 label_len][label 32p]
 */
export function buildTcrRenewInstructionData({
  label, durationYears, indexOf, treasuryAddress, leaseAddress, configAddress,
}) {
  const lp = labelProblem(label);
  if (lp) throw new Error(lp);
  const yp = yearsProblem(durationYears);
  if (yp) throw new Error(yp);
  const idxTreasury = resolvedIndex(indexOf, treasuryAddress, 'treasury');
  const idxLease = resolvedIndex(indexOf, leaseAddress, 'lease');
  const idxConfig = resolvedIndex(indexOf, configAddress, 'config');
  const { bytes: labelBytes, buf: labelBuf } = padded32(label, 'label');
  const out = new Uint8Array(4 + 6 + 2 + 4 + 32);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, TCR_OP_RENEW, true);
  dv.setUint16(4, idxTreasury, true);
  dv.setUint16(6, idxLease, true);
  dv.setUint16(8, idxConfig, true);
  dv.setUint16(10, Number(durationYears), true);
  dv.setUint32(12, labelBytes.length, true);
  out.set(labelBuf, 16);
  return out;
}

/**
 * UPDATE_CONFIG: [u32 3][u16 config_idx][u8 mask][u64 new_fee][32 new_treasury]
 * mask bit0 = apply new_fee, bit1 = apply new_treasury.
 */
export function buildTcrUpdateConfigInstructionData({ newFee = null, newTreasury = null, indexOf, configAddress }) {
  if (newFee === null && newTreasury === null) throw new Error('nothing to update');
  if (newFee !== null && (typeof newFee !== 'bigint' || newFee < 0n)) throw new Error('newFee must be a non-negative bigint');
  const idxConfig = resolvedIndex(indexOf, configAddress, 'config');
  const out = new Uint8Array(4 + 2 + 1 + 8 + 32);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, TCR_OP_UPDATE_CONFIG, true);
  dv.setUint16(4, idxConfig, true);
  out[6] = (newFee !== null ? 1 : 0) | (newTreasury !== null ? 2 : 0);
  dv.setBigUint64(7, newFee ?? 0n, true);
  out.set(newTreasury !== null ? Pubkey.from(newTreasury).toBytes() : new Uint8Array(32), 15);
  return out;
}

// ---- Account lists (semantic roles; ORDER IS IRRELEVANT — SDK 0.4.2 byte-sorts) ---
// Pass these sets to buildAndSign({ accounts: { readWrite, readOnly } }) and resolve
// indices through the SDK InstructionContext inside the instructionData callback.
// `target` (the future domain owner) appears as an extra read-only entry only when it
// differs from the fee payer/user; when equal, index 0 covers it (allowZero).
export const TCR_ACCOUNT_LISTS = Object.freeze({
  initialize: { readWrite: ['config', 'root'], readOnly: ['nameServiceProgram'] },
  register: {
    readWrite: ['treasury', 'root', 'domain', 'lease'],
    readOnly: ['config', 'nameServiceProgram', 'target?'],
  },
  renew: { readWrite: ['treasury', 'lease'], readOnly: ['config'] },
  updateConfig: { readWrite: ['config'], readOnly: [] },
});

// Back-compat export: older drafts named this TCR_ACCOUNT_ORDERS. Same data.
export const TCR_ACCOUNT_ORDERS = TCR_ACCOUNT_LISTS;
