// Backend handlers for the name.* contract methods (v19, 2026-10-08).
//
// Read paths (lookup/checkAvailability) are ON in every build: they derive addresses from
// the pinned package's name-service program + recoverable layouts (provenance pinned in
// src/lib/name-service.js) and read chain state — non-destructive truth asks, answers honest
// about what is on the chain.
//
// Write paths (register / setRecord / initRoot) are GATED at this layer: they throw
// FEATURE_DISABLED until (a) the live probe (scripts/probe-name-service.mjs) verifies the
// recovered wire formats on the running chain and (b) there is a reason later — the
// self-signing invariant also means a wallet can only legitimately act under a parent it
// owns; sponsored/foreign-authority registration is rejected by design, never circumvented.
import { FLAGS } from '../../shared/flags.js';
import * as ns from '../../lib/name-service.js';
import * as txService from './tx-service.js';
import * as thruClient from '../../lib/thru-client.js';
import { BOOTSTRAP_PROGRAM_ADDRESSES } from '../../lib/bootstrap-pins.js';

function featureDisabled() {
  const err = new Error(
    'name service writes are gated: the recovered wire formats (official thru CLI binary, '
    + 'community-verified live) still need the on-chain live probe for the running chain — '
    + 'flip FLAGS.NAME_SERVICE only after scripts/probe-name-service.mjs passes',
  );
  err.code = 'FEATURE_DISABLED';
  throw err;
}

function requireValidName(name) {
  const problem = ns.nameProblem(name ?? '');
  if (problem) {
    const err = new Error(`invalid name: ${problem}`);
    err.code = 'INVALID_PARAMS';
    throw err;
  }
}

function requireAddress(value, field) {
  if (typeof value !== 'string' || !value || value.length < 40) {
    const err = new Error(`${field} is required (a ta... address string)`);
    err.code = 'INVALID_PARAMS';
    throw err;
  }
}

/** name.lookup: resolve a dotted name under an explicit root registrar address (blank root
 *  → auto-discovered canonical root, proven on-chain; NAME_ROOT_UNKNOWN when none exists). */
export async function lookupName({ name, rootAddress } = {}) {
  requireValidName(name);
  let root = String(rootAddress ?? '').trim();
  if (!root) {
    const discovered = await discoverDefaultRoot();
    if (!discovered?.supported) {
      const err = new Error(discovered?.reason ?? 'no canonical name root on this network');
      err.code = 'NAME_ROOT_UNKNOWN';
      throw err;
    }
    root = discovered.rootAddress;
  } else {
    requireAddress(root, 'rootAddress');
  }
  const chain = await ns.resolveNameChain(root, name);
  const leafAddress = chain[0];
  let info = null;
  try {
    // Direct client read: tx-service's getAccountInfo drops the raw account DATA, and a
    // domain's owner/records live in that data — a wrapper without it produced a permanent
    // decodeError for every existing name. Reads stay truth-only either way.
    info = await thruClient.getAccountInfo(leafAddress);
  } catch {
    info = null; // node answered nothing — same as absent for read purposes
  }
  if (!info || !info.exists) {
    return { chain, leaf: { address: leafAddress, exists: false }, rootAddress: root, name };
  }
  let domain = null;
  try {
    const parsed = ns.parseDomainAccount(new Uint8Array(info.raw?.data ?? new ArrayBuffer(0)));
    // Bridge-safe: registeredAt is a chain BigInt and cannot cross the message port as-is.
    domain = { ...parsed, registeredAt: parsed.registeredAt.toString() };
  } catch (e) {
    return { chain, leaf: { address: leafAddress, exists: true, decodeError: e.message }, rootAddress: root, name };
  }
  return { chain, leaf: { address: leafAddress, exists: true, domain }, rootAddress: root, name };
}

/** name.checkAvailability: derived address + taken/available under an explicit parent. */
export async function checkAvailability({ name, parentAddress } = {}) {
  if (!name || typeof name !== 'string' || name.includes('.')) {
    const err = new Error('a single label is expected here (no dots)');
    err.code = 'INVALID_PARAMS';
    throw err;
  }
  requireValidName(name);
  requireAddress(parentAddress, 'parentAddress');
  const address = await ns.domainAccountAddress(parentAddress, name);
  let exists = false;
  try {
    const info = await txService.getAccountInfo(address);
    exists = Boolean(info && info.exists);
  } catch {
    exists = false;
  }
  return { address, exists, name, parentAddress };
}

// ---- Canonical-root auto-discovery (2026-10-09, owner-directed) ------------------------
// The chain's canonical root registrar is NOT exported by the pinned @thru packages and is
// NOT derivable from them (proven 2026-10-09: ten parent×name seed combinations —
// program/registrar/zero/root-manager × id/.id/thru/.thru — never reproduce the public .id
// root; a root account's parent+authority are external). So the wallet discovers it by
// READING: each candidate below is fetched and must PARSE as a root registrar (kind = 1)
// before it is used for anything. A candidate that does not parse on this chain is skipped,
// never trusted blind.
//
// Candidate provenance:
//   1. BOOTSTRAP_PROGRAM_ADDRESSES.thru_registrar — first-party pinned bootstrap address;
//      on chains where the registrar itself doubles as a root it parses cleanly.
//   2. The public .id root registrar (third-party PUBLIC fact, corroboration-only — the
//      same address scripts/probe-name-service.mjs uses to cross-check wire formats).
import { parseRootRegistrar } from '../../lib/name-service.js';

const CANONICAL_ROOT_CANDIDATES = Object.freeze([
  { address: BOOTSTRAP_PROGRAM_ADDRESSES.thru_registrar, provenance: 'pinned bootstrap thru_registrar' },
  { address: 'taLu3d1rxGdQWWHJxUOK6eT9ti4lWeTijNp0Kk_5YKHARg', provenance: 'public .id root (third-party fact, on-chain-verified)' },
]);

let discoveredCache = null; // session-scoped; one RPC on first use per worker

/**
 * The chain's canonical root registrar, auto-discovered by on-chain proof.
 * @returns {{ supported: true, rootAddress, name, authority, provenance } | { supported: false, reason }}
 */
export async function discoverDefaultRoot() {
  if (discoveredCache) return discoveredCache;
  const tries = [];
  for (const candidate of CANONICAL_ROOT_CANDIDATES) {
    try {
      const info = await thruClient.getAccountInfo(candidate.address);
      if (!info?.exists) { tries.push(`${candidate.address.slice(0, 12)}…: absent`); continue; }
      const root = parseRootRegistrar(new Uint8Array(info.raw?.data ?? new ArrayBuffer(0)));
      discoveredCache = {
        supported: true,
        rootAddress: candidate.address,
        name: root.name,
        authority: root.authority,
        provenance: candidate.provenance,
      };
      return discoveredCache;
    } catch (e) {
      tries.push(`${candidate.address.slice(0, 12)}…: ${String(e?.message ?? e).slice(0, 80)}`);
    }
  }
  // No cache of the NEGATIVE: a root that deploys/migrates later should be found on retry.
  return {
    supported: false,
    reason: `no canonical name root found on this network (${tries.join('; ') || 'no candidates ran'})`,
  };
}

/** name.initRoot — gated (see header); owning the created root is what unlocks self-signed
 *  registration underneath it. Whether user-level roots are permitted on the running chain
 *  is itself a live question; it is answered by the same probe run that enables the method. */
export async function initRoot({ name } = {}) {
  requireValidName(name);
  featureDisabled();
}

/** name.register — gated (see header); only ever under a parent the signer owns
 *  (authority = fee payer = the signer by the self-signing invariant). */
export async function registerName({ name, parentAddress } = {}) {
  if (name && String(name).includes('.')) {
    const err = new Error('register one label at a time under its parent (no dotted forms)');
    err.code = 'INVALID_PARAMS';
    throw err;
  }
  requireValidName(name);
  requireAddress(parentAddress, 'parentAddress');
  featureDisabled();
}

/** name.setRecord — gated (see header); appends a record on a domain the signer owns. */
export async function setRecord({ name, rootAddress, key, value } = {}) {
  requireValidName(name);
  requireAddress(rootAddress, 'rootAddress');
  if (!key || typeof key !== 'string') {
    const err = new Error('key is required');
    err.code = 'INVALID_PARAMS';
    throw err;
  }
  if (typeof value !== 'string') featureDisabledSoftValue(value);
  featureDisabled();
}

function featureDisabledSoftValue(value) {
  if (typeof value === 'undefined' || value === null) {
    const err = new Error('value is required');
    err.code = 'INVALID_PARAMS';
    throw err;
  }
}
