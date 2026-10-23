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
// initRoot / setRecord stay gated behind FLAGS.NAME_SERVICE (false in this build): initRoot
// creates NEW roots (a namespace-level action — the answer to "are user-level roots allowed
// here" is a live question for the running chain), and records are a separate responsibility.
import { FLAGS } from '../../shared/flags.js';
import * as ns from '../../lib/name-service.js';
import * as txService from './tx-service.js';
import * as thruClient from '../../lib/thru-client.js';
import * as vault from '../../lib/vault.js';
import { getActiveNetworkConfig } from './network-service.js';
import * as pending from './pending-tx-service.js';
import { formatSignature } from '../../lib/registrar.js';

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
    const parsed = ns.parseDomainAccount(info.raw);
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

let discoveredCache = null; // session-scoped; one RPC on first use per worker

/**
 * The chain's canonical root registrar, auto-discovered by on-chain proof.
 * @returns {{ supported: true, rootAddress, name, authority, provenance } | { supported: false, reason }}
 */
export async function discoverDefaultRoot() {
  if (discoveredCache) return discoveredCache;
  const tries = [];
  for (const candidate of await canonicalRootCandidates()) {
    try {
      const info = await thruClient.getAccountInfo(candidate.address);
      if (!info?.exists) { tries.push(`${candidate.address.slice(0, 12)}…: absent`); continue; }
      const root = parseRootRegistrar(info.raw);
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

/** name.getCanonicalRoot (v23): expose the on-chain-proof canonical-root discovery that
 *  name.lookup performs internally. auth:none — a read-only truth ask. */
export async function getCanonicalRoot() {
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
export async function registerName({ name, parentAddress } = {}) {
  if (name && String(name).includes('.')) {
    const err = new Error('register one label at a time under its parent (no dotted forms)');
    err.code = 'INVALID_PARAMS';
    throw err;
  }
  requireValidName(name);
  await getActiveNetworkConfig(); // bind the SDK RPC binding to the active network before any read

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
  const parentInfo = await thruClient.getAccountInfo(parent).catch(() => null);
  if (!parentInfo?.exists) {
    throw coded('PARENT_UNKNOWN', `the parent name account ${parent.slice(0, 12)}… does not exist on this network`);
  }
  try {
    const raw = ns.extractAccountData(parentInfo.raw);
    try {
      ns.parseRootRegistrar(raw);
    } catch {
      ns.parseDomainAccount(raw);
    }
  } catch (e) {
    throw coded('PARENT_UNKNOWN', `the parent account at ${parent.slice(0, 12)}… does not parse as a name-service account (${e?.message ?? e})`);
  }

  const n = String(name);
  const domainAddress = await ns.domainAccountAddress(parent, n);
  const domainInfo = await thruClient.getAccountInfo(domainAddress).catch(() => null);
  if (domainInfo?.exists) {
    throw coded('NAME_TAKEN', `'${n}' is already registered under this parent on-chain.`);
  }

  const feePayer = await vault.getActiveAccount();

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
        return { signature: formatted, domainAddress };
      }
      const userCode = update.executionResult.userErrorCode ?? 0;
      throw coded(
        'REGISTRATION_FAILED',
        `Registration transaction reverted on-chain (vmError=${update.executionResult.vmError}${userCode ? `, name-service error ${userCode}` : ''}).`
        + ' A revert here usually means the chain failed the authority check — the parent root must canonically allow the registering key.',
      );
    }
  }
  throw coded('TX_RESULT_MISSING', 'Registration transaction never returned an execution result (timed out?).', { retryable: true });
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
