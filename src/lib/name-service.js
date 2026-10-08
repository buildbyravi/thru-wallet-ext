// Thru name service (system program) — domain + subdomain registration support.
//
// PROVENANCE (2026-10-08, recorded because it is third-party-adjacent and the official
// @thru/programs package deliberately binds NOTHING for this program today):
//   - the @thru/programs 0.4.1 export map has NO name-service module (verified this date);
//     the program ADDRESS comes from the package pin (BOOTSTRAP_PROGRAM_ADDRESSES.name_service)
//     — that part is canonical and follows the pin on bumps.
//   - the WIRE FORMATS (account layouts, opcodes, instruction shapes, derivation) are
//     recovered from the official `thru` CLI binary (unstripped: thru_core::commands::
//     name_service::parse_*), and were confirmed in community production against live chain
//     data since 2026-07-31 (pgreyy/thruscan src/lib/names.js + nameservice.js; their .id
//     root 'taLu3d…' + the grace.id domain). Marked third-party-recovered, NOT official.
//   - every registration WRITE here stays gated (FLAGS.NAME_SERVICE=false, plus registry
//     trust 'unverified' on the program record) until the live probe verifies the shapes on
//     the running chain. Reads are non-destructive by definition.
//
// SECURITY MODEL (owner-reaffirmed invariant, AGENTS.md self-signing):
//   - REGISTER_SUBDOMAIN requires the PARENT's authority to be the fee payer of the tx
//     (authority index 0). So a wallet can register ONLY under a parent it owns (its own
//     root, or its own domain for nested subdomains). No sponsor, no third party, ever:
//     registering under a foreign root is refused by design, with a plain reason.

import { Pubkey, deriveProgramAddress } from '@thru/sdk';
import { BOOTSTRAP_PROGRAM_ADDRESSES } from './bootstrap-pins.js';

export const NAME_SERVICE_PROGRAM = BOOTSTRAP_PROGRAM_ADDRESSES.name_service;

// ---- Format pins (recovered; see provenance) --------------------------------
export const NS_OP_INIT_ROOT = 0;
export const NS_OP_REGISTER_SUBDOMAIN = 1;
export const NS_OP_APPEND_RECORD = 2;

export const NS_KIND_ROOT_REGISTRAR = 1;
export const NS_KIND_DOMAIN = 2;

export const NS_NAME_FIELD = 64;      // zero-padded name buffer (a 32-byte guess reverts)
export const NS_KEY_FIELD = 32;
export const NS_VALUE_FIELD = 256;
export const NS_ROOT_SIZE = 109;      // 1 + 32 + 64 + 4 + 8
export const NS_DOMAIN_HEADER = 145;  // 1 + 32 + 32 + 64 + 4 + 8 + 4 (record_count)
export const NS_RECORD_SIZE = 296;    // 4 + 32 + 4 + 256
export const NS_MAX_NAME_CHARS = 64;

// ---- Pure validation --------------------------------------------------------
// Third-party-documented enforcement rules (impersonation-resistant): lowercase ASCII,
// digits, hyphens; 3..32 chars per label is their front-end recommendation, the on-chain
// field accepts 1..64 bytes — we pin the strict form for everything we build.
export function nameProblem(name) {
  const n = String(name ?? '');
  if (!n || n.length === 0) return 'a name is required';
  if (n.length > NS_MAX_NAME_CHARS) return `names are at most ${NS_MAX_NAME_CHARS} characters`;
  const labels = n.split('.');
  for (const label of labels) {
    if (label.length < 3) return 'each label is at least 3 characters';
    if (label.length > 32) return 'each label is at most 32 characters';
    if (label !== label.toLowerCase()) return 'names are lowercase';
    if (!/^[a-z0-9-]+$/.test(label)) return 'letters, numbers and hyphens only';
    if (label.startsWith('-') || label.endsWith('-')) return 'labels cannot start or end with a hyphen';
    if (label.includes('--')) return 'no double hyphens';
  }
  return null;
}

// ---- Derivation --------------------------------------------------------------
// Domain accounts live at a fixed address, looked up without an index:
//   domain = deriveProgramAddress({ programAddress: NAME_SERVICE, seed: sha256(parent || nameBytes) })
// (raw name bytes, not the padded 64 — confirmed against the official CLI's derivation).
async function sha256(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(digest);
}

export async function domainAccountAddress(parentAddress, name) {
  const parentBytes = Pubkey.from(parentAddress).toBytes();
  const nameBytes = new TextEncoder().encode(name);
  if (nameBytes.length === 0 || nameBytes.length > NS_MAX_NAME_CHARS) {
    throw new Error(`name must be 1..${NS_MAX_NAME_CHARS} bytes`);
  }
  const seedInput = new Uint8Array(parentBytes.length + nameBytes.length);
  seedInput.set(parentBytes, 0);
  seedInput.set(nameBytes, parentBytes.length);
  const seed = await sha256(seedInput);
  const derived = deriveProgramAddress({ programAddress: NAME_SERVICE_PROGRAM, seed });
  return String(derived.address); // the helper returns the ta-* string directly
}

// ---- Decoders (read side; input = raw account data bytes) --------------------
export class NameServiceDecodeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NameServiceDecodeError';
  }
}

function zeroTrim(bytes) {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end -= 1;
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(0, end));
}

export function parseRootRegistrar(data) {
  if (!(data instanceof Uint8Array) || data.length !== NS_ROOT_SIZE) {
    throw new NameServiceDecodeError(`root registrar account must be exactly ${NS_ROOT_SIZE} bytes`);
  }
  if (data[0] !== NS_KIND_ROOT_REGISTRAR) {
    throw new NameServiceDecodeError(`kind ${data[0]} is not a root registrar (expect 1)`);
  }
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const nameLen = Number(dv.getUint32(0x61, true));
  return {
    kind: NS_KIND_ROOT_REGISTRAR,
    authority: Pubkey.from(data.slice(0x01, 0x21)).toThruFmt(),
    name: nameLen > 0 ? zeroTrim(data.slice(0x21, 0x61)) : '',
    nameLen,
    totalSubdomains: dv.getBigUint64(0x65, true),
  };
}

export function parseDomainAccount(data) {
  if (!(data instanceof Uint8Array) || data.length < NS_DOMAIN_HEADER
    || (data.length - NS_DOMAIN_HEADER) % NS_RECORD_SIZE !== 0) {
    throw new NameServiceDecodeError(`domain account must be ${NS_DOMAIN_HEADER} + ${NS_RECORD_SIZE}n bytes`);
  }
  if (data[0] !== NS_KIND_DOMAIN) {
    throw new NameServiceDecodeError(`kind ${data[0]} is not a domain (expect 2)`);
  }
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const recordCount = Number(dv.getUint32(0x8d, true));
  if (recordCount !== (data.length - NS_DOMAIN_HEADER) / NS_RECORD_SIZE) {
    throw new NameServiceDecodeError('record_count field disagrees with account size');
  }
  const records = [];
  for (let i = 0; i < recordCount; i += 1) {
    const base = NS_DOMAIN_HEADER + i * NS_RECORD_SIZE;
    const keyLen = Number(dv.getUint32(base, true));
    const valueLen = Number(dv.getUint32(base + 0x24, true));
    if (keyLen > NS_KEY_FIELD || valueLen > NS_VALUE_FIELD) {
      throw new NameServiceDecodeError('record internally inconsistent');
    }
    records.push({
      key: zeroTrim(data.slice(base + 0x04, base + 0x04 + keyLen)),
      value: zeroTrim(data.slice(base + 0x28, base + 0x28 + valueLen)),
    });
  }
  return {
    kind: NS_KIND_DOMAIN,
    parent: Pubkey.from(data.slice(0x01, 0x21)).toThruFmt(),
    owner: Pubkey.from(data.slice(0x21, 0x41)).toThruFmt(),
    name: zeroTrim(data.slice(0x41, 0x81)),
    nameLen: Number(dv.getUint32(0x81, true)),
    registeredAt: dv.getBigUint64(0x85, true),
    records,
  };
}

// ---- Instruction data builders (write side) -----------------------------------
function nameFieldBytes(name) {
  const enc = new TextEncoder().encode(name);
  if (enc.length === 0 || enc.length > NS_NAME_FIELD) throw new Error(`name must be 1..${NS_NAME_FIELD} bytes`);
  const out = new Uint8Array(NS_NAME_FIELD);
  out.set(enc, 0);
  return out;
}

function concatBytes(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/**
 * INIT_ROOT: [u32 0][u16 registrarIdx][u16 pad][64 name][u64 nameByteLen][stateProof…].
 * The fee payer at account index 0 becomes the root's authority — owning this root is what
 * allows self-signed registration of subdomains underneath it. Whether the running chain
 * currently permits user-level root init is UNVERIFIED (gate notes carry the reason).
 */
export function buildInitRootInstructionData({ name, registrarAccountIndex, stateProof }) {
  const head = new Uint8Array(4 + 2 + 2 + NS_NAME_FIELD + 8);
  const dv = new DataView(head.buffer);
  dv.setUint32(0, NS_OP_INIT_ROOT, true);
  dv.setUint16(4, registrarAccountIndex, true);
  dv.setUint16(6, 0, true); // pad
  head.set(nameFieldBytes(name), 8);
  const byteLen = new TextEncoder().encode(name).length;
  dv.setBigUint64(4 + 2 + 2 + NS_NAME_FIELD, BigInt(byteLen), true);
  if (!(stateProof instanceof Uint8Array) || stateProof.length === 0) throw new Error('stateProof is required');
  return concatBytes(head, stateProof);
}

/**
 * REGISTER_SUBDOMAIN:
 *   [u32 1][u16 domainIdx][u16 parentIdx][u16 ownerIdx][u16 authorityIdx=0][64 name][u64 nameByteLen][stateProof…]
 * indexOf maps an address to its index in the transaction's account lists. authority = 0 =
 * the fee payer — per the self-signing invariant, the fee payer must BE the parent's
 * authority (own root / own domain). owner can be any account in `ownerIdx` — the own flow
 * passes the caller's own address anyway.
 */
export function buildRegisterSubdomainInstructionData({ name, indexOf, domainAddress, parentAddress, ownerAddress, stateProof }) {
  if (typeof indexOf !== 'function') throw new Error('indexOf resolver is required');
  const head = new Uint8Array(4 + 2 * 4 + NS_NAME_FIELD + 8);
  const dv = new DataView(head.buffer);
  dv.setUint32(0, NS_OP_REGISTER_SUBDOMAIN, true);
  dv.setUint16(4, indexOf(domainAddress), true);
  dv.setUint16(6, indexOf(parentAddress), true);
  dv.setUint16(8, ownerAddress ? indexOf(ownerAddress) : 0, true);
  dv.setUint16(10, 0, true); // authority: the fee payer (must be the parent's authority)
  head.set(nameFieldBytes(name), 12);
  const byteLen = new TextEncoder().encode(name).length;
  dv.setBigUint64(4 + 2 * 4 + NS_NAME_FIELD, BigInt(byteLen), true);
  if (!(stateProof instanceof Uint8Array) || stateProof.length === 0) throw new Error('stateProof is required');
  return concatBytes(head, stateProof);
}

/**
 * APPEND_RECORD: [u32 2][u16 domainIdx][u16 authorityIdx=0][u32 keyLen][32 key][u32 valueLen][256 value].
 * No state proof: the domain account already exists. Caller must OWN the domain
 * (authority = fee payer, enforced where built).
 */
export function buildAppendRecordInstructionData({ domainAddress, key, value, indexOf }) {
  if (typeof indexOf !== 'function') throw new Error('indexOf resolver is required');
  if (typeof domainAddress !== 'string' || !domainAddress) throw new Error('domainAddress is required');
  const keyBytes = new TextEncoder().encode(String(key ?? ''));
  const valueBytes = new TextEncoder().encode(String(value ?? ''));
  if (keyBytes.length === 0) throw new Error('record key is required');
  if (keyBytes.length > NS_KEY_FIELD) throw new Error('record key is too long (max 32 bytes)');
  if (valueBytes.length > NS_VALUE_FIELD) throw new Error('record value is too long (max 256 bytes)');
  const out = new Uint8Array(4 + 2 + 2 + 4 + NS_KEY_FIELD + 4 + NS_VALUE_FIELD);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, NS_OP_APPEND_RECORD, true);
  dv.setUint16(4, indexOf(domainAddress), true);
  dv.setUint16(6, 0, true); // authority: the fee payer
  dv.setUint32(8, keyBytes.length, true);
  out.set(keyBytes, 12);
  dv.setUint32(12 + NS_KEY_FIELD, valueBytes.length, true);
  out.set(valueBytes, 16 + NS_KEY_FIELD);
  return out;
}

/**
 * Resolve a dotted name to its on-chain account addresses, walking the chain
 * root-ward → leaf: parent(root registrar address) + "x" → x's domain account, then
 * x's domain account + "y" → y.x, … The caller provides the ROOT REGISTRAR address
 * (e.g. a well-known root; there is no canonical `.thru` child-parent model today —
 * a foreign root's authority is third-party and unwanted here by invariant).
 */
export async function resolveNameChain(rootRegistrarAddress, dottedName) {
  const problem = nameProblem(dottedName);
  if (problem) throw new Error(problem);
  const labels = dottedName.split('.');
  const chain = [rootRegistrarAddress];
  for (let i = labels.length - 1; i >= 0; i -= 1) {
    chain.push(await domainAccountAddress(chain[chain.length - 1], labels[i]));
  }
  return chain.reverse(); // [leaf … parent root registrar]
}
