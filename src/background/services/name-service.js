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

/** name.lookup: resolve a dotted name under an explicit root registrar address. */
export async function lookupName({ name, rootAddress } = {}) {
  requireValidName(name);
  requireAddress(rootAddress, 'rootAddress');
  const chain = await ns.resolveNameChain(rootAddress, name);
  const leafAddress = chain[0];
  let info = null;
  try {
    info = await txService.getAccountInfo(leafAddress);
  } catch {
    info = null; // node answered nothing — same as absent for read purposes
  }
  if (!info || !info.exists) {
    return { chain, leaf: { address: leafAddress, exists: false }, rootAddress, name };
  }
  let domain = null;
  try {
    domain = ns.parseDomainAccount(new Uint8Array(info.data ?? new ArrayBuffer(0)));
  } catch (e) {
    return { chain, leaf: { address: leafAddress, exists: true, decodeError: e.message }, rootAddress, name };
  }
  return { chain, leaf: { address: leafAddress, exists: true, domain }, rootAddress, name };
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
