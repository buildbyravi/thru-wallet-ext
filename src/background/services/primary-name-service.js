// Wallet-local domain tracking and primary aliases. This is not a reverse index.
// Stored names are candidates: only a fresh, network-bound owner read enables actions.
import { scopedKey } from '../../shared/network-scope.js';
import { getActiveNetworkConfig, getActiveNetworkId } from './network-service.js';
import * as accountService from './account-service.js';
import * as nameService from './name-service.js';
import * as ns from '../../lib/name-service.js';
import * as thruClient from '../../lib/thru-client.js';
import { purchaseNameProblem } from '../../lib/registrar.js';

const PRIMARY_BASE_KEY = 'thru_primary_names';
const DOMAINS_BASE_KEY = 'thru_registered_domains';
const updates = new Map();
let generation = 0;
const statuses = ['owned', 'not-owned', 'missing', 'unknown'];

function errCode(code, message) {
  return Object.assign(new Error(message), { code, retryable: false });
}

function sameName(a, b) {
  return a?.name === b?.name && a?.rootAddress === b?.rootAddress;
}

function primaryRecord(record) {
  return { name: record.name, rootAddress: record.rootAddress,
    domainAddress: record.domainAddress, verifiedAt: record.verifiedAt };
}

async function readState(networkId) {
  const primaryKey = scopedKey(PRIMARY_BASE_KEY, networkId);
  const domainsKey = scopedKey(DOMAINS_BASE_KEY, networkId);
  const stored = await chrome.storage.local.get([primaryKey, domainsKey]);
  const primary = stored[primaryKey] ?? {};
  const registry = stored[domainsKey];
  if (registry != null && registry.version !== 1) {
    throw errCode('STORAGE_VERSION', 'Domain registry schema is unsupported by this wallet.');
  }
  if (registry && (!Array.isArray(registry.records) || !Number.isSafeInteger(registry.revision) || registry.revision < 0)) {
    throw errCode('STORAGE_INVALID', 'Domain registry is unreadable.');
  }
  // v0 held only primary aliases. Project them on reads; the next mutation persists v1
  // alongside the unchanged primary-key shape. Unlink must migrate BEFORE deleting an alias.
  const records = registry ? registry.records.map(r => ({ ...r })) : Object.entries(primary).map(([accountAddress, r]) => ({
    ...r, accountAddress, status: 'unknown', checkedAt: 0,
  }));
  for (const r of records) {
    if (!r || typeof r.accountAddress !== 'string' || typeof r.name !== 'string'
      || !r.name || typeof r.rootAddress !== 'string'
      || typeof r.domainAddress !== 'string' || !statuses.includes(r.status)
      || !Number.isFinite(r.verifiedAt) || !Number.isFinite(r.checkedAt)) {
      throw errCode('STORAGE_INVALID', 'Domain registry contains an invalid record.');
    }
  }
  return { primary: { ...primary }, records: records.map(r => ({
    accountAddress: r.accountAddress, name: r.name, rootAddress: r.rootAddress,
    domainAddress: r.domainAddress, status: r.status, checkedAt: r.checkedAt, verifiedAt: r.verifiedAt,
  })), revision: registry?.revision ?? 0, primaryKey, domainsKey };
}

function updateState(networkId, edit, expectedGeneration = generation) {
  const prior = updates.get(networkId) || Promise.resolve();
  const job = prior.catch(() => {}).then(async () => {
    if (expectedGeneration !== generation) throw errCode('DOMAIN_CONTEXT_CHANGED', 'Wallet was reset.');
    const state = await readState(networkId);
    const changed = await edit(state);
    if (expectedGeneration !== generation) throw errCode('DOMAIN_CONTEXT_CHANGED', 'Wallet was reset.');
    if (changed !== false) {
      state.revision++;
      await chrome.storage.local.set({
        [state.primaryKey]: state.primary,
        [state.domainsKey]: { version: 1, revision: state.revision, records: state.records },
      });
    }
    return state;
  });
  updates.set(networkId, job);
  return job.finally(() => { if (updates.get(networkId) === job) updates.delete(networkId); });
}

function upsert(state, record) {
  const index = state.records.findIndex(r => r.accountAddress === record.accountAddress && sameName(r, record));
  if (index >= 0) state.records[index] = record;
  else state.records.push(record);
}

async function context(params = {}, live = false) {
  const startedGeneration = generation;
  const networkId = live ? (await getActiveNetworkConfig()).id : await getActiveNetworkId();
  // Capture the client before another context changes the global adapter binding.
  const client = live ? thruClient.getClient() : null;
  if (live && thruClient.getConfiguredNetwork().id !== networkId) throw errCode('DOMAIN_CONTEXT_CHANGED', 'Network changed. Refresh your domains.');
  const accountAddress = (await accountService.getActiveAccount())?.address;
  if (!accountAddress) throw errCode('ACCOUNT_MISSING', 'No active account.');
  if ((params.expectedNetworkId && params.expectedNetworkId !== networkId)
    || (params.expectedAccountAddress && params.expectedAccountAddress !== accountAddress)) {
    throw errCode('DOMAIN_CONTEXT_CHANGED', 'Account or network changed. Refresh your domains.');
  }
  if (startedGeneration !== generation) throw errCode('DOMAIN_CONTEXT_CHANGED', 'Wallet was reset.');
  return { networkId, accountAddress, client, generation: startedGeneration };
}

async function assertCurrent(ctx) {
  await context({ expectedNetworkId: ctx.networkId, expectedAccountAddress: ctx.accountAddress });
}

async function verifyRecord(record, ctx) {
  const checkedAt = Date.now();
  try {
    const result = await nameService.lookupTrackedName(record, ctx.client);
    if (result?.leaf?.address !== record.domainAddress) throw new Error('Stored domain identity does not match.');
    if (result?.leaf?.decodeError) {
      return { ...record, status: 'unknown', error: result.leaf.decodeError, checkedAt };
    }
    const status = result?.leaf?.exists === false ? 'missing'
      : result?.leaf?.domain ? (result.leaf.domain.owner === ctx.accountAddress ? 'owned' : 'not-owned') : 'unknown';
    return { ...record, status, checkedAt, verifiedAt: status === 'owned' ? checkedAt : record.verifiedAt };
  } catch (err) {
    return { ...record, status: 'unknown', error: err?.message, checkedAt };
  }
}

async function view(state, ctx, stale) {
  const roots = { [await ns.rootRegistrarAddress('thru')]: 'thru', [await ns.rootRegistrarAddress('id')]: 'id' };
  return {
    networkId: ctx.networkId, accountAddress: ctx.accountAddress, source: 'tracked',
    items: state.records.filter(r => r.accountAddress === ctx.accountAddress).map(r => ({
      ...r, rootName: roots[r.rootAddress] ?? null, stale: stale || r.status === 'unknown',
      isPrimary: sameName(state.primary[ctx.accountAddress], r),
    })),
  };
}

/** Storage-only first paint; never presents a previous owner check as current. */
export async function getCachedDomains(params = {}) {
  const ctx = await context(params);
  return view(await readState(ctx.networkId), ctx, true);
}

/** Bounded concurrency; a late read cannot overwrite a newer import/untrack/primary edit. */
export async function listDomains(params = {}) {
  const ctx = await context(params, true);
  const snapshot = await readState(ctx.networkId);
  const records = snapshot.records.filter(r => r.accountAddress === ctx.accountAddress);
  const checked = [];
  for (let i = 0; i < records.length; i += 4) {
    checked.push(...await Promise.all(records.slice(i, i + 4).map(r => verifyRecord(r, ctx))));
  }
  let superseded = false;
  const state = await updateState(ctx.networkId, current => {
    if (current.revision !== snapshot.revision) { superseded = true; return false; }
    for (const r of checked) {
      upsert(current, r);
      if (['missing', 'not-owned'].includes(r.status) && sameName(current.primary[ctx.accountAddress], r)) delete current.primary[ctx.accountAddress];
    }
  }, ctx.generation);
  return view(state, ctx, superseded);
}

/** Import a .thru base label or fully qualified .thru name. */
export async function trackDomain(params = {}) {
  const ctx = await context(params, true);
  let name = String(params.name ?? '').trim();
  if (name.toLowerCase().endsWith('.thru')) name = name.slice(0, -5);
  const problem = purchaseNameProblem(name);
  if (problem) throw errCode('INVALID_PARAMS', problem);
  const rootAddress = await ns.rootRegistrarAddress('thru');
  const record = await verifyRecord({ name, rootAddress, accountAddress: ctx.accountAddress,
    domainAddress: await ns.domainAccountAddress(rootAddress, name), verifiedAt: 0, checkedAt: 0, status: 'unknown' }, ctx);
  requireOwned(record);
  await assertCurrent(ctx);
  await updateState(ctx.networkId, state => upsert(state, record), ctx.generation);
  return primaryRecord(record);
}

function requireOwned(record) {
  if (record.status === 'missing') throw errCode('NAME_NOT_FOUND', 'Domain not found.');
  if (record.status === 'not-owned') throw errCode('NOT_NAME_OWNER', 'This domain belongs to another account.');
  if (record.status !== 'owned') {
    throw errCode('NAME_UNREADABLE', record.error ? `Ownership could not be verified: ${record.error}` : 'Ownership could not be verified. Try again.');
  }
}

/** Capture before signing, save only after confirmation. Reset invalidates late saves. */
export function registrationRecorder({ networkId, accountAddress }) {
  const startedGeneration = generation;
  return async ({ name, rootAddress, domainAddress }) => {
    if (!name || !rootAddress || !domainAddress) throw errCode('INVALID_PARAMS', 'Registration identity is incomplete.');
    await updateState(networkId, state => upsert(state, {
      accountAddress, name, rootAddress, domainAddress, status: 'unknown', verifiedAt: 0, checkedAt: 0,
    }), startedGeneration);
  };
}

export async function clearAllDomains() {
  generation++;
  await Promise.allSettled([...updates.values()]);
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(key => key.startsWith(`${PRIMARY_BASE_KEY}::`) || key.startsWith(`${DOMAINS_BASE_KEY}::`));
  if (keys.length) await chrome.storage.local.remove(keys);
}

export async function setPrimaryDomain(params = {}) {
  const ctx = await context(params, true);
  const snapshot = await readState(ctx.networkId);
  const candidate = snapshot.records.find(r => r.accountAddress === ctx.accountAddress && r.domainAddress === params.domainAddress);
  if (!candidate) throw errCode('NAME_NOT_FOUND', 'This domain is not tracked.');
  const record = await verifyRecord(candidate, ctx);
  requireOwned(record);
  await assertCurrent(ctx);
  await updateState(ctx.networkId, state => {
    if (state.revision !== snapshot.revision) throw errCode('DOMAIN_CONTEXT_CHANGED', 'Domain list changed. Refresh and try again.');
    upsert(state, record);
    state.primary[ctx.accountAddress] = primaryRecord(record);
  }, ctx.generation);
  return primaryRecord(record);
}

export async function untrackDomain(params = {}) {
  const ctx = await context(params);
  await updateState(ctx.networkId, state => {
    const record = state.records.find(r => r.accountAddress === ctx.accountAddress && r.domainAddress === params.domainAddress);
    if (record && sameName(state.primary[ctx.accountAddress], record)) throw errCode('DOMAIN_IS_PRIMARY', 'Unlink the primary name before removing it.');
    state.records = state.records.filter(r => r !== record);
  }, ctx.generation);
  return { untracked: true };
}

// Existing primary APIs retain their response shape and generic name-service validation.
export async function linkPrimaryName({ name, rootAddress } = {}) {
  const problem = ns.nameProblem(String(name ?? ''));
  if (problem) throw errCode('INVALID_PARAMS', `invalid name: ${problem}`);
  const ctx = await context({}, true);
  let root = String(rootAddress ?? '').trim();
  if (!root) {
    const discovered = await nameService.discoverDefaultRoot();
    if (!discovered?.supported) throw errCode('NAME_ROOT_UNKNOWN', discovered?.reason ?? 'No canonical name root.');
    root = discovered.rootAddress;
  }
  const record = await verifyRecord({ name: String(name), rootAddress: root, accountAddress: ctx.accountAddress,
    domainAddress: (await ns.resolveNameChain(root, name))[0], verifiedAt: 0, checkedAt: 0, status: 'unknown' }, ctx);
  requireOwned(record);
  await assertCurrent(ctx);
  await updateState(ctx.networkId, state => {
    upsert(state, record);
    state.primary[ctx.accountAddress] = primaryRecord(record);
  }, ctx.generation);
  return primaryRecord(record);
}

export async function verifyPrimaryName({ address } = {}) {
  const ctx = await context({}, true);
  ctx.accountAddress = address ?? ctx.accountAddress;
  const record = (await readState(ctx.networkId)).primary[ctx.accountAddress] ?? null;
  if (!record) return null;
  const checked = await verifyRecord(record, ctx);
  if (checked.status === 'not-owned') {
    await updateState(ctx.networkId, state => {
      if (sameName(state.primary[ctx.accountAddress], record)) delete state.primary[ctx.accountAddress];
    }, ctx.generation);
    return null;
  }
  return { ...record, stale: checked.status !== 'owned' };
}

export async function unlinkPrimaryName(params = {}) {
  const { address } = params;
  const ctx = await context(params);
  const target = address ?? ctx.accountAddress;
  let unlinked = false;
  await updateState(ctx.networkId, state => {
    if (params.domainAddress && state.primary[target]?.domainAddress !== params.domainAddress) {
      throw errCode('DOMAIN_CONTEXT_CHANGED', 'Primary name changed. Refresh and try again.');
    }
    unlinked = Boolean(state.primary[target]);
    delete state.primary[target];
  }, ctx.generation);
  return { unlinked };
}
