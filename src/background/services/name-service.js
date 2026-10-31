// Backend handlers for the name.* contract methods (v19, 2026-10-08; register live 2026-10-24).
//
// Read paths (lookup/checkAvailability/getCanonicalRoot) are ON in every build: they derive
// addresses from the pinned package's name-service program + recoverable layouts (provenance
// pinned in src/lib/name-service.js) and read chain state — non-destructive truth asks,
// answers honest about what is on the chain.
//
// name.register is LIVE (owner-directed, 2026-10-24): the wire format is first-party
// (Unto-Labs/thru rpc/thru-base/src/txn_tools.rs build_name_service_register_subdomain +
// tn_name_service ABI — our encoder matches it byte-for-byte, goldens in
// test/test-name-service.mjs), and the first-party builder carries ZERO payment accounts
// with NAME_SERVICE_PROGRAM_FEE = 0, so registration under an existing root is free of
// registry pricing. The write is strictly self-signed — authority = fee payer = the active
// account, the ONLY key a wallet can offer. If the chain requires a different parent
// authority (e.g. a closed foreign root), the transaction reverts on-chain and we surface
// that honestly; we never sponsor or proxy another authority.
//
// name.setRecord is a REAL self-signed write as of contract v31 (2026-10-29): opcode 2 is the
// first-party APPEND_RECORD (tn_name_service ABI), the write is authority = fee payer = the
// active account, and it only lands on a domain that account provably owns. It is reached
// through the shared review pipeline (kind `domain-record`), declared auth:'signing', and listed
// in TRANSACTION_METHODS.
//
// name.initRoot stays gated behind FLAGS.NAME_SERVICE (false in this build): creating NEW roots
// is a namespace-level action, and "are user-level roots allowed here" is still an open live
// question for the running chain.
import { FLAGS } from '../../shared/flags.js';
import * as ns from '../../lib/name-service.js';
import * as txService from './tx-service.js';
import * as thruClient from '../../lib/thru-client.js';
import * as vault from '../../lib/vault.js';
import { getActiveNetworkConfig } from './network-service.js';
import * as pending from './pending-tx-service.js';
import { formatSignature, purchaseNameProblem } from '../../lib/registrar.js';

function featureDisabled() {
  const err = new Error(
    'this name service write stays gated: flip FLAGS.NAME_SERVICE only after '
    + 'scripts/probe-name-service.mjs passes on the running chain',
  );
  err.code = 'FEATURE_DISABLED';
  throw err;
}

function coded(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  if (extra.retryable !== undefined) err.retryable = extra.retryable;
  return err;
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
// Root names come off the chain with a leading dot on some roots (`.id`), and without one on
// others. Suffix handling has to agree with the bytes either way.
function normalizeRootName(value) {
  return String(value ?? '').trim().toLowerCase().replace(/^\.+/, '');
}

// The community `.id` namespace is derived, not discovered. Discovery returns the official
// `.thru` root whenever both exist, so a user who typed `alice.id` would be read against the
// wrong namespace — or refused, because `id` is shorter than the name-service's 3-character
// label minimum (reviewer #22: that minimum is a rule for labels UNDER a root, not for the
// root suffix the user typed).
const KNOWN_ROOT_SUFFIXES = Object.freeze(['thru', 'id']);

export async function lookupName({ name, rootAddress } = {}) {
  const typed = String(name ?? '').trim().toLowerCase();
  let cleanName = typed;
  let suffix = null;
  for (const known of KNOWN_ROOT_SUFFIXES) {
    if (cleanName.length > known.length + 1 && cleanName.endsWith('.' + known)) {
      suffix = known;
      cleanName = cleanName.slice(0, -(known.length + 1));
      break;
    }
  }

  // Validate the LABEL, after peeling the suffix. A name the paid registry accepts but the
  // name-service label rules do not (`MiX_9`) is still readable — it just needs the registrar
  // address derivation instead of the dotted-chain walk.
  const labelProblem = ns.nameProblem(cleanName);
  const readsAsRegistrarLabel = Boolean(labelProblem) && !purchaseNameProblem(cleanName);
  if (labelProblem && !readsAsRegistrarLabel) {
    const err = new Error(`invalid name: ${labelProblem}`);
    err.code = 'INVALID_PARAMS';
    throw err;
  }
  await getActiveNetworkConfig();

  const supplied = String(rootAddress ?? '').trim();
  if (supplied) {
    requireAddress(supplied, 'rootAddress');
    if (suffix) {
      // The caller named both a namespace and a root account; they must be the same namespace,
      // or the wallet would read one root while the screen says the other.
      const parsed = await thruClient.getAccountInfo(supplied)
        .then((info) => (info?.exists ? parseRootRegistrar(info.raw) : null))
        .catch(() => null);
      const suppliedName = normalizeRootName(parsed?.name);
      if (suppliedName && suppliedName !== suffix) {
        const err = new Error(`rootAddress is the .${suppliedName} root, but the name asks for .${suffix}`);
        err.code = 'INVALID_PARAMS';
        throw err;
      }
    }
    return readName(cleanName, supplied, thruClient.getClient(), readsAsRegistrarLabel);
  }

  if (suffix) {
    return readName(cleanName, await ns.rootRegistrarAddress(suffix), thruClient.getClient(),
      readsAsRegistrarLabel);
  }

  const discovered = await discoverDefaultRoot();
  if (!discovered?.supported) {
    const err = new Error(discovered?.reason ?? 'no canonical name root on this network');
    err.code = 'NAME_ROOT_UNKNOWN';
    throw err;
  }
  return readName(cleanName, discovered.rootAddress, thruClient.getClient(), readsAsRegistrarLabel);
}

// Internal tracked-domain read: paid .thru labels have a wider official alphabet than
// generic name-service labels. Keep that validator at the backend boundary, not in UI.
export async function lookupTrackedName({ name, rootAddress }, boundClient) {
  const thruRoot = await ns.rootRegistrarAddress('thru');
  const registrarLabel = rootAddress === thruRoot && !String(name).includes('.');
  const problem = registrarLabel ? purchaseNameProblem(name) : ns.nameProblem(name);
  if (problem) throw coded('INVALID_PARAMS', `invalid name: ${problem}`);
  requireAddress(rootAddress, 'rootAddress');
  return readName(name, rootAddress, boundClient, registrarLabel, true);
}

async function readName(name, root, boundClient, registrarLabel = false, checked = false) {
  const chain = registrarLabel
    ? [await ns.domainAccountAddress(root, name), root]
    : await ns.resolveNameChain(root, name);
  const leafAddress = chain[0];
  // Direct client read preserves domain bytes for owner decoding. Propagate RPC errors:
  // unreadable is unknown, never evidence that a name is available.
  const info = await thruClient.getAccountInfo(leafAddress, boundClient);
  if (!info || !info.exists) {
    return { chain, leaf: { address: leafAddress, exists: false }, rootAddress: root, name };
  }
  let domain = null;
  try {
    if (checked && thruClient.getAccountOwnerAddress(info.raw) !== ns.NAME_SERVICE_PROGRAM) {
      throw new Error('Domain program ownership could not be verified.');
    }
    const parsed = ns.parseDomainAccount(info.raw);
    const expected = name.split('.')[0].toLowerCase();
    if (checked && (parsed.parent !== chain[1] || parsed.name.toLowerCase() !== expected
      || parsed.nameLen !== new TextEncoder().encode(parsed.name).length)) {
      throw new Error('Domain identity does not match the requested name.');
    }
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
  await getActiveNetworkConfig();
  requireAddress(parentAddress, 'parentAddress');
  const address = await ns.domainAccountAddress(parentAddress, name);
  const info = await txService.getAccountInfo(address);
  const exists = Boolean(info && info.exists);
  return { address, exists, name, parentAddress };
}

// ---- Canonical-root auto-discovery (2026-10-09, owner-directed) ------------------------
// Candidate ADDRESSES are DERIVED, never fetched from third parties: root registrar
// addresses derive officially from the root name itself (src/lib/name-service.js —
// recovered from the first-party thru CLI 0.4.1 + thru.org registrar docs, 2026-10-09).
// Candidates, in priority order:
//   1. the official `.thru` registry root — the canonical Thru namespace
//      (thru.org/docs/cli-reference/registrar-commands: paid leases, purchase/renew). On
//      networks where the registry is not initialized yet, it simply doesn't parse.
//   2. the `.id` root — ThruScan's community root registrar; real on Betanet today
//      (probe-verified) but a THIRD-PARTY namespace, so it loses to .thru whenever both
//      exist on the running chain.
// Even derived addresses are never trusted blind: each candidate is fetched and must PARSE
// as a root registrar (kind = 1) before it is used for anything. A candidate that does not
// parse on this chain is skipped, never trusted blind.
import { parseRootRegistrar, rootRegistrarAddress } from '../../lib/name-service.js';

// Candidates are derived lazily inside discoverDefaultRoot (the derivation is async for
// the >32-byte hash edge case); order: official `.thru` first, community `.id` fallback.
async function canonicalRootCandidates() {
  return [
    { address: await rootRegistrarAddress('thru'), provenance: 'official .thru registry root (derived per thru docs, 2026-10-09)' },
    { address: await rootRegistrarAddress('id'), provenance: 'community .id root (ThruScan; official derivation formula)' },
  ];
}

let discoveredCache = null; // positive result scoped to the stable active network id

/**
 * The chain's canonical root registrar, auto-discovered by on-chain proof.
 * @returns {{ supported: true, rootAddress, name, authority, provenance } | { supported: false, reason }}
 */
export async function discoverDefaultRoot() {
  const network = await getActiveNetworkConfig();
  if (discoveredCache?.networkId === network.id) return discoveredCache.result;
  const tries = [];
  for (const candidate of await canonicalRootCandidates()) {
    try {
      const info = await thruClient.getAccountInfo(candidate.address);
      if (!info?.exists) { tries.push(`${candidate.address.slice(0, 12)}…: absent`); continue; }
      const root = parseRootRegistrar(info.raw);
      const result = {
        supported: true,
        rootAddress: candidate.address,
        name: root.name,
        authority: root.authority,
        provenance: candidate.provenance,
      };
      discoveredCache = { networkId: network.id, result };
      return result;
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

/** name.getCanonicalRoot (v23): expose the on-chain-proof canonical-root discovery that
 *  name.lookup performs internally. auth:none — a read-only truth ask. */
export async function getCanonicalRoot({ root } = {}) {
  await getActiveNetworkConfig();
  if (root && typeof root === 'string' && root.trim()) {
    const rName = root.trim().toLowerCase();
    const address = await rootRegistrarAddress(rName);
    const info = await thruClient.getAccountInfo(address);
    if (!info?.exists) {
      return { supported: false, reason: `root '${rName}' (${address.slice(0, 12)}…) does not exist on this network` };
    }
    try {
      const parsed = parseRootRegistrar(info.raw);
      return {
        supported: true,
        rootAddress: address,
        rootName: parsed.name,
        authority: parsed.authority,
        provenance: `explicit .${rName} root registrar`,
      };
    } catch (e) {
      return { supported: false, reason: `root '${rName}' present but unparseable (${e?.message ?? e})` };
    }
  }
  const discovered = await discoverDefaultRoot();
  if (!discovered?.supported) {
    return { supported: false, reason: discovered?.reason ?? 'no canonical name root on this network' };
  }
  return {
    supported: true,
    rootAddress: discovered.rootAddress,
    rootName: discovered.name,
    authority: discovered.authority,
    provenance: discovered.provenance,
  };
}

/** name.register (v23 — live): self-signed, fee-0n registration of a single label under an
 *  existing parent (the canonical root by default). Exact mirror of the first-party CLI
 *  `thru nameservice register-subdomain` (txn_tools.rs build_name_service_register_subdomain):
 *  NAME_SERVICE_PROGRAM_FEE = 0, compute 500_000 / state 1 / memory 10_000, accounts
 *  [domain (rw), parent (rw), owner (ro), authority (ro)] with authority = fee payer.
 *  A foreign-authority parent lets the CHAIN decide — a revert is surfaced verbatim, never
 *  retried silently or sponsored with a different key. */
export async function registerName({ name, parentAddress, expectedNetworkId, expectedAccountAddress } = {}) {
  if (name && String(name).includes('.')) {
    const err = new Error('register one label at a time under its parent (no dotted forms)');
    err.code = 'INVALID_PARAMS';
    throw err;
  }
  requireValidName(name);
  const network = await getActiveNetworkConfig(); // bind the SDK RPC binding to the active network before any read
  if (expectedNetworkId && expectedNetworkId !== network.id) {
    throw coded('REVIEW_NETWORK_CHANGED', 'The active network changed after review. Check the name again before signing.');
  }

  let parent = String(parentAddress ?? '').trim();
  let rootName = null;
  if (!parent) {
    const discovered = await discoverDefaultRoot();
    if (!discovered?.supported) {
      throw coded('NAME_ROOT_UNKNOWN', discovered?.reason ?? 'no canonical name root on this network', );
    }
    parent = discovered.rootAddress;
    rootName = discovered.name;
  } else {
    requireAddress(parent, 'parentAddress');
  }

  // The parent must exist and parse as a name-service registrar root (or domain) — never
  // register against an account we cannot even read. Honest absence beats blind creation.
  const parentInfo = await thruClient.getAccountInfo(parent);
  if (!parentInfo?.exists) {
    throw coded('PARENT_UNKNOWN', `the parent name account ${parent.slice(0, 12)}… does not exist on this network`);
  }
  let parentAuthority = null;
  try {
    const raw = ns.extractAccountData(parentInfo.raw);
    try {
      parentAuthority = ns.parseRootRegistrar(raw).authority ?? null;
    } catch {
      parentAuthority = ns.parseDomainAccount(raw).owner ?? null;
    }
  } catch (e) {
    throw coded('PARENT_UNKNOWN', `the parent account at ${parent.slice(0, 12)}… does not parse as a name-service account (${e?.message ?? e})`);
  }

  const feePayer = await vault.getActiveAccount();
  if (expectedAccountAddress && expectedAccountAddress !== feePayer?.address) {
    throw coded('REVIEW_ACCOUNT_CHANGED', 'The active account changed after review. Check the name again before signing.');
  }

  // Authority pre-verification. Live evidence (Betanet probe, 2026-10-24): the name-service
  // program reverts register-subdomain with error 3 (access authority mismatch) whenever the
  // signer is not the parent root's authority / parent domain's owner. The chain enforces
  // this — so a wallet that self-signs MUST NOT broadcast a write it can prove will revert.
  // When the authority field is unreadable we keep the original posture: let the chain decide
  // and surface any revert verbatim.
  if (parentAuthority && parentAuthority !== feePayer.address) {
    throw coded('NAME_PARENT_AUTHORITY',
      `only the parent's authority (${parentAuthority.slice(0, 12)}…) may register names under it — the chain reverts any other signer (name-service error 3, live-verified 2026-10-24 on Betanet). Your active account ${feePayer.address.slice(0, 12)}… is not this parent's authority; no transaction was broadcast.`);
  }

  const n = String(name);
  const domainAddress = await ns.domainAccountAddress(parent, n);
  const domainInfo = await thruClient.getAccountInfo(domainAddress);
  if (domainInfo?.exists) {
    throw coded('NAME_TAKEN', `'${n}' is already registered under this parent on-chain.`);
  }

  // A Creation (proofType 1) state proof — the chain demand for every account-instantiating
  // instruction; the same class the token account initializer and registrar purchase carry.
  const client = thruClient.getClient();
  const proofObj = await client.proofs.generate({ address: domainAddress, proofType: 1 });

  const { rawTransaction } = await client.transactions.buildAndSign({
    feePayer: { publicKey: feePayer.publicKey, privateKey: feePayer.privateKey },
    program: ns.NAME_SERVICE_PROGRAM,
    // Exactly the first-party CLI conversion: fee 0n; units from
    // build_name_service_register_subdomain (500k CU / 1 SU / 10k MU). Never autoUnits.
    header: { computeUnits: 500_000, memoryUnits: 10_000, stateUnits: 1, fee: 0n },
    accounts: {
      readWrite: [domainAddress, parent],
      // feePayer is implicit index 0; adding it to readOnly creates duplicate accounts
    },
    instructionData: ({ getAccountIndex }) => ns.buildRegisterSubdomainInstructionData({
      name: n,
      indexOf: getAccountIndex,
      domainAddress,
      parentAddress: parent,
      ownerAddress: feePayer.address,
      stateProof: proofObj.proof,
    }),
  });

  const label = rootName ? `${n}.${rootName}` : `${n} (parent ${parent.slice(0, 12)}…)`;
  let formatted = null;
  try {
    for await (const update of client.transactions.sendAndTrack(rawTransaction)) {
      if (update?.signature?.value && formatted === null) {
        formatted = formatSignature(update.signature.value);
        const network = await getActiveNetworkConfig();
        await pending.track({
          signature: formatted, kind: 'name-register', from: feePayer.address, to: feePayer.address,
          amountUnits: '0', displayAmount: `register '${label}' (fee 0n — no payment)`, networkId: network.id,
        }).catch(() => null);
      }
      if (update?.executionResult) {
        if (update.executionResult.vmError === 0) {
          return { signature: formatted, domainAddress, rootAddress: parent };
        }
        const userCode = update.executionResult.userErrorCode ?? 0;
        throw coded(
          'REGISTRATION_FAILED',
          `Registration transaction reverted on-chain (vmError=${update.executionResult.vmError}${userCode ? `, name-service error ${userCode}` : ''}).`
          + ' A revert here usually means the chain failed the authority check — the parent root must canonically allow the registering key.',
        );
      }
    }
  } catch (err) {
    if (err?.code === 'REGISTRATION_FAILED') throw err;
    throw coded('TX_RESULT_MISSING', `The registration submission could not be resolved${formatted ? ` (signature ${formatted})` : ''}. Check pending transactions and the name before retrying.`, { retryable: true });
  }
  throw coded('TX_RESULT_MISSING', 'Registration transaction never returned an execution result (timed out?).', { retryable: true });
}

/** name.setRecord: appends a key/value record on a domain the active account owns. */
export async function setRecord({
  name, rootAddress, key, value, expectedNetworkId, expectedAccountAddress,
} = {}) {
  let cleanName = String(name ?? '').trim();
  if (!cleanName) {
    const err = new Error('name is required');
    err.code = 'INVALID_PARAMS';
    throw err;
  }
  let root = String(rootAddress ?? '').trim();
  let rootName = 'thru';
  if (!root) {
    const discovered = await discoverDefaultRoot();
    if (!discovered?.supported) {
      throw coded('NAME_ROOT_UNKNOWN', discovered?.reason ?? 'no canonical name root on this network');
    }
    root = discovered.rootAddress;
    rootName = String(discovered.name || 'thru').toLowerCase();
  } else {
    requireAddress(root, 'rootAddress');
    try {
      const info = await thruClient.getAccountInfo(root);
      if (info?.exists) {
        const parsed = ns.parseRootRegistrar(ns.extractAccountData(info.raw));
        if (parsed?.name) rootName = String(parsed.name).toLowerCase();
      }
    } catch {}
  }
  if (cleanName.endsWith('.' + rootName)) {
    cleanName = cleanName.slice(0, -(rootName.length + 1));
  }
  requireValidName(cleanName);

  if (typeof key !== 'string' || !key.trim()) {
    const err = new Error('key is required');
    err.code = 'INVALID_PARAMS';
    throw err;
  }
  const cleanKey = key.trim();
  const keyBytes = new TextEncoder().encode(cleanKey);
  if (keyBytes.length > ns.NS_KEY_FIELD) {
    const err = new Error(`key is too long (max ${ns.NS_KEY_FIELD} bytes)`);
    err.code = 'INVALID_PARAMS';
    throw err;
  }

  if (typeof value !== 'string') {
    const err = new Error('value is required');
    err.code = 'INVALID_PARAMS';
    throw err;
  }
  const valueBytes = new TextEncoder().encode(value);
  if (valueBytes.length > ns.NS_VALUE_FIELD) {
    const err = new Error(`value is too long (max ${ns.NS_VALUE_FIELD} bytes)`);
    err.code = 'INVALID_PARAMS';
    throw err;
  }

  const network = await getActiveNetworkConfig();
  if (expectedNetworkId && expectedNetworkId !== network.id) {
    throw coded('REVIEW_NETWORK_CHANGED', 'The active network changed after review. Check the record again before signing.');
  }

  const feePayer = await vault.getActiveAccount();
  if (expectedAccountAddress && expectedAccountAddress !== feePayer?.address) {
    throw coded('REVIEW_ACCOUNT_CHANGED', 'The active account changed after review. Check the record again before signing.');
  }

  const domainAddress = await ns.domainAccountAddress(root, cleanName);
  const domainInfo = await thruClient.getAccountInfo(domainAddress);
  if (!domainInfo?.exists) {
    throw coded('NAME_NOT_FOUND', `'${cleanName}.${rootName}' is not registered on-chain.`);
  }

  let parsedDomain = null;
  try {
    parsedDomain = ns.parseDomainAccount(domainInfo.raw);
  } catch (e) {
    throw coded('DOMAIN_UNREADABLE', `failed to read domain account for '${cleanName}.${rootName}': ${e?.message ?? e}`);
  }

  if (parsedDomain.owner !== feePayer.address) {
    throw coded('NOT_NAME_OWNER', `your active account ${feePayer.address.slice(0, 12)}… does not own '${cleanName}.${rootName}'.`);
  }

  const client = thruClient.getClient();
  const { rawTransaction } = await client.transactions.buildAndSign({
    feePayer: { publicKey: feePayer.publicKey, privateKey: feePayer.privateKey },
    program: ns.NAME_SERVICE_PROGRAM,
    header: { computeUnits: 300_000, memoryUnits: 10_000, stateUnits: 1, fee: 0n },
    accounts: {
      readWrite: [domainAddress],
    },
    instructionData: ({ getAccountIndex }) => ns.buildAppendRecordInstructionData({
      domainAddress,
      key: cleanKey,
      value,
      indexOf: getAccountIndex,
    }),
  });

  const displayLabel = `'${cleanKey}' on '${cleanName}.${rootName}'`;
  let formatted = null;
  try {
    for await (const update of client.transactions.sendAndTrack(rawTransaction)) {
      if (update?.signature?.value && formatted === null) {
        formatted = formatSignature(update.signature.value);
        const net = await getActiveNetworkConfig();
        await pending.track({
          signature: formatted,
          kind: 'name-record',
          from: feePayer.address,
          to: domainAddress,
          amountUnits: '0',
          displayAmount: `set record ${displayLabel} (fee 0n)`,
          networkId: net.id,
        }).catch(() => null);
      }
      if (update?.executionResult) {
        if (update.executionResult.vmError === 0) {
          return { signature: formatted, domainAddress, rootAddress: root, key: cleanKey, value };
        }
        const userCode = update.executionResult.userErrorCode ?? 0;
        throw coded(
          'RECORD_UPDATE_FAILED',
          `Record update reverted on-chain (vmError=${update.executionResult.vmError}${userCode ? `, code ${userCode}` : ''}).`,
        );
      }
    }
  } catch (err) {
    if (err?.code === 'RECORD_UPDATE_FAILED') throw err;
    throw coded('TX_RESULT_MISSING', `The record update submission could not be resolved${formatted ? ` (signature ${formatted})` : ''}. Check pending transactions before retrying.`, { retryable: true });
  }
  throw coded('TX_RESULT_MISSING', 'Record update transaction never returned an execution result (timed out?).', { retryable: true });
}
