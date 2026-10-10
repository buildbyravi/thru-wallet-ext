// Thru registrar program — the official `.thru` paid-lease domain registry.
//
// PROVENANCE (2026-10-09, FIRST-PARTY — not recovered from third parties):
//   1. Official ABI, github.com/Unto-Labs/thru @ main
//      rpc/abi/type-library/tn_thru_registrar_program.abi.yaml — instruction envelope
//      (tag u32 LE + packed args) and account layouts (Config 244 B / Lease 148 B,
//      size-discriminated, NO kind byte).
//   2. First-party CLI source rpc/cli/crates/thru-core/src/commands/name_service.rs —
//      derivations (root registrar raw-name seed; config 'config' seed;
//      lease sha256("lease:"‖name)), the purchase/renew/claim command flows (config
//      parse offsets, owner checks, token-account validation), and
//      THRU_REGISTRAR_PROGRAM_FEE = 0 ("0 fee for now").
//   3. First-party transaction builder rpc/thru-base/src/txn_tools.rs —
//      build_thru_registrar_{initialize_registry,purchase_domain,renew_lease,
//      claim_expired_domain}: exact account sets (sorted RW/RO, indices from 2),
//      instruction byte composition (proofs appended raw after the packed purchase args)
//      and unit budgets (purchase 500k compute / 2 state / 10k memory;
//      renew+claim 300k / 0 / 10k; expiry_after 100 slots).
//   The name-service ABI (tn_name_service_program.abi.yaml) documents the domain account
//   the registrar creates underneath its root — reads for that side stay in
//   src/lib/name-service.js, which is corroborated by the same first-party sources.
//
// SECURITY MODEL (unchanged): the fee payer is always the wallet signer (self-signing
// invariant). Purchase/renew/claim pay from a payer token account OWNED BY THE FEE PAYER
// (the CLI validates `token account owner == fee payer` client-side; the program enforces
// it on-chain). No sponsored path exists here and none is added.
//
// TIME SEMANTICS (honest label): the Lease stores lease_start_time / lease_end_time as
// raw u64 "chain time"; the docs do not state the unit. Purchase year counts imply
// epoch-seconds; this module exposes the raw values and only the service layer renders a
// date, always labelled as chain-time-seconds.

import { Pubkey, deriveProgramAddress, Signature } from '@thru/sdk';
import { THRU_REGISTRAR_PROGRAM, NAME_SERVICE_PROGRAM, registrarConfigAddress } from './name-service.js';

export { THRU_REGISTRAR_PROGRAM, NAME_SERVICE_PROGRAM, registrarConfigAddress };

// ---- Opcodes (official ABI tags, u32 LE) -------------------------------------
export const REG_OP_INITIALIZE_REGISTRY = 0;
export const REG_OP_PURCHASE_DOMAIN = 1;
export const REG_OP_RENEW_LEASE = 2;
export const REG_OP_CLAIM_EXPIRED_DOMAIN = 3;

// ---- Account layout pins (official ABI, size-discriminated union) ------------
export const REG_CONFIG_SIZE = 244; // 5×32 + 64 + 4 + 8 + 8
export const REG_LEASE_SIZE = 148;  // 32 + 32 + 64 + 4 + 8 + 8

// ---- Input bounds (first-party, txn_tools.rs constants) -----------------------
export const REG_MAX_NAME_CHARS = 64;   // TN_NAME_SERVICE_MAX_DOMAIN_LENGTH
export const REG_MAX_YEARS = 255;       // years is u8; CLI rejects 0
export const REG_HEADER_PURCHASE = Object.freeze({ computeUnits: 500_000, memoryUnits: 10_000, stateUnits: 2, fee: 0n });
export const REG_HEADER_RENEW = Object.freeze({ computeUnits: 300_000, memoryUnits: 10_000, stateUnits: 0, fee: 0n });

// ---- Pure validation -----------------------------------------------------------
export function purchaseNameProblem(name) {
  const n = String(name ?? '');
  const bytes = new TextEncoder().encode(n);
  if (!n || bytes.length === 0) return 'a name is required';
  if (bytes.length > REG_MAX_NAME_CHARS) return `names are at most ${REG_MAX_NAME_CHARS} characters`;
  if (n.includes('.')) return 'enter the base name only (no dots, no .thru suffix)';
  // The chain accepts any 1..64 bytes; the CLI applies no other rule. We keep the wallet
  // conservative about what we encode ourselves: printable ASCII only.
  if (!/^[\x21-\x7e]+$/.test(n)) return 'printable ASCII without spaces';
  return null;
}

export function yearsProblem(years) {
  const y = Number(years);
  if (!Number.isInteger(y) || y < 1 || y > REG_MAX_YEARS) {
    return `years must be a whole number 1–${REG_MAX_YEARS}`;
  }
  return null;
}

async function sha256(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(digest);
}

// ---- Derivation (first-party: name_service.rs derive_lease_account_pubkey) ----
// lease = deriveProgramAddress(registrar program, sha256("lease:" ‖ domain name))
export async function leaseAccountAddress(name, registrarProgram = THRU_REGISTRAR_PROGRAM) {
  const nameBytes = new TextEncoder().encode(name);
  if (nameBytes.length === 0 || nameBytes.length > REG_MAX_NAME_CHARS) {
    throw new Error(`name must be 1..${REG_MAX_NAME_CHARS} bytes`);
  }
  const input = new Uint8Array(6 + nameBytes.length);
  input.set(new TextEncoder().encode('lease:'), 0);
  input.set(nameBytes, 6);
  const seed = await sha256(input);
  return String(deriveProgramAddress({ programAddress: registrarProgram, seed }).address);
}

// Registry-config address is re-exported from name-service.js (registrarConfigAddress).

/** SDK signature-value bytes → the display format used across the wallet (adapter-local). */
export function formatSignature(signatureValueBytes) {
  return Signature.from(signatureValueBytes).toThruFmt();
}

// ---- Decoders (read side; input = raw account data bytes) ----------------------
export class RegistrarDecodeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RegistrarDecodeError';
  }
}

function addr(data, off) {
  return Pubkey.from(data.slice(off, off + 32)).toThruFmt();
}

function zeroTrim(bytes) {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end -= 1;
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(0, end));
}

export function parseRegistrarConfig(data) {
  if (!(data instanceof Uint8Array) || data.length !== REG_CONFIG_SIZE) {
    throw new RegistrarDecodeError(`registrar config account must be exactly ${REG_CONFIG_SIZE} bytes`);
  }
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const nameLen = Number(dv.getUint32(224, true));
  if (nameLen > 64) throw new RegistrarDecodeError(`config declares a ${nameLen}-byte root name (max 64)`);
  return {
    nameServiceProgram: addr(data, 0),
    rootRegistrar: addr(data, 32),
    treasurer: addr(data, 64),
    tokenMint: addr(data, 96),
    tokenProgram: addr(data, 128),
    rootName: nameLen > 0 ? zeroTrim(data.slice(160, 224)) : '',
    pricePerYear: dv.getBigUint64(228, true),
    totalDomainsSold: dv.getBigUint64(236, true),
  };
}

export function parseLease(data) {
  if (!(data instanceof Uint8Array) || data.length !== REG_LEASE_SIZE) {
    throw new RegistrarDecodeError(`lease account must be exactly ${REG_LEASE_SIZE} bytes`);
  }
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const nameLen = Number(dv.getUint32(128, true));
  if (nameLen > 64) throw new RegistrarDecodeError(`lease declares a ${nameLen}-byte domain name (max 64)`);
  return {
    domainAccount: addr(data, 0),
    owner: addr(data, 32),
    name: nameLen > 0 ? zeroTrim(data.slice(64, 128)) : '',
    leaseStartTime: dv.getBigUint64(132, true),
    leaseEndTime: dv.getBigUint64(140, true),
  };
}

// ---- Instruction builders (byte-exact per first-party txn_tools.rs) ------------
function nameFieldBytes(name) {
  const enc = new TextEncoder().encode(name);
  if (enc.length === 0 || enc.length > REG_MAX_NAME_CHARS) {
    throw new Error(`name must be 1..${REG_MAX_NAME_CHARS} bytes`);
  }
  const out = new Uint8Array(64);
  out.set(enc, 0);
  return out;
}

function u16pair(v) {
  if (!Number.isInteger(v) || v < 0 || v > 0xffff || v === 0) {
    throw new Error('account index must be a non-zero u16 (index 0 is the fee payer)');
  }
  return v;
}

/**
 * PURCHASE_DOMAIN: [u32 1][9×u16 idx: config, lease, domain, nameServiceProgram,
 * rootRegistrar, treasurer, payerToken, tokenMint, tokenProgram][64 name][u32 nameByteLen]
 * [u8 years][leaseProof…][domainProof…] — proofs appended raw per txn_tools.rs.
 */
export function buildPurchaseDomainInstructionData({
  name, years, indexOf,
  configAddress, leaseAddress, domainAddress, rootRegistrarAddress, treasurerAddress,
  payerTokenAddress, tokenMintAddress, tokenProgramAddress,
  leaseProof, domainProof,
}) {
  if (typeof indexOf !== 'function') throw new Error('indexOf resolver is required');
  const prob = yearsProblem(years);
  if (prob) throw new Error(prob);
  if (!(leaseProof instanceof Uint8Array) || leaseProof.length === 0) throw new Error('leaseProof is required');
  if (!(domainProof instanceof Uint8Array) || domainProof.length === 0) throw new Error('domainProof is required');
  const head = new Uint8Array(4 + 9 * 2 + 64 + 4 + 1);
  const dv = new DataView(head.buffer);
  dv.setUint32(0, REG_OP_PURCHASE_DOMAIN, true);
  const addrs = [
    configAddress, leaseAddress, domainAddress, NAME_SERVICE_PROGRAM, rootRegistrarAddress,
    treasurerAddress, payerTokenAddress, tokenMintAddress, tokenProgramAddress,
  ];
  addrs.forEach((a, i) => dv.setUint16(4 + i * 2, u16pair(indexOf(a)), true));
  head.set(nameFieldBytes(name), 4 + 9 * 2);
  dv.setUint32(4 + 9 * 2 + 64, new TextEncoder().encode(name).length, true);
  head[4 + 9 * 2 + 64 + 4] = Number(years);
  const out = new Uint8Array(head.length + leaseProof.length + domainProof.length);
  out.set(head, 0);
  out.set(leaseProof, head.length);
  out.set(domainProof, head.length + leaseProof.length);
  return out;
}

/**
 * RENEW_LEASE / CLAIM_EXPIRED_DOMAIN share one args struct (official ABI):
 *   [u32 tag][6×u16 idx: config, lease, treasurer, payerToken, tokenMint, tokenProgram][u8 years]
 */
export function buildRenewLeaseInstructionData({
  years, indexOf,
  configAddress, leaseAddress, treasurerAddress, payerTokenAddress, tokenMintAddress, tokenProgramAddress,
  claim = false,
}) {
  if (typeof indexOf !== 'function') throw new Error('indexOf resolver is required');
  const prob = yearsProblem(years);
  if (prob) throw new Error(prob);
  const head = new Uint8Array(4 + 6 * 2 + 1);
  const dv = new DataView(head.buffer);
  dv.setUint32(0, claim ? REG_OP_CLAIM_EXPIRED_DOMAIN : REG_OP_RENEW_LEASE, true);
  const addrs = [configAddress, leaseAddress, treasurerAddress, payerTokenAddress, tokenMintAddress, tokenProgramAddress];
  addrs.forEach((a, i) => dv.setUint16(4 + i * 2, u16pair(indexOf(a)), true));
  head[4 + 6 * 2] = Number(years);
  return head;
}
