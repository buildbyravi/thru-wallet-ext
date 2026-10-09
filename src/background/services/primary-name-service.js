// Primary-name (domain) linking for the dashboard (2026-10-09, owner-directed UX slice).
//
// What this is: a wallet-local, network-scoped record that says "the active account owns this
// name". Ownership is PROVEN on-chain at link time — the name's domain account is resolved
// through the always-on read path (name.lookup) and its `owner` field must equal the active
// account's address. No signing, no writes, nothing gated: reads are live truth asks and the
// self-signing invariant is untouched because nothing is signed at all.
//
// What this is NOT: a reverse index. The chain cannot answer "which names does address X own"
// today, so the wallet asks the user for the name and verifies it — never guesses one, and
// silently keeping a name the account no longer owns is caught on the next verify (dashboard
// re-verifies on load in the background of the displayed record; a broken record falls back
// to the raw address, honestly).
import { scopedKey } from '../../shared/network-scope.js';
import { getActiveNetworkConfig } from './network-service.js';
import * as accountService from './account-service.js';
import * as nameService from './name-service.js';
import * as ns from '../../lib/name-service.js';

const PRIMARY_BASE_KEY = 'thru_primary_names';

function errCode(code, message) {
  const err = new Error(message);
  err.code = code;
  err.retryable = false;
  return err;
}

async function readAll(networkId) {
  const key = scopedKey(PRIMARY_BASE_KEY, networkId);
  const out = await chrome.storage.local.get(key);
  return out[key] && typeof out[key] === 'object' ? out[key] : {};
}

async function writeAll(networkId, records) {
  const key = scopedKey(PRIMARY_BASE_KEY, networkId);
  await chrome.storage.local.set({ [key]: records });
}

/** The verified primary name of an address on the active network, or null. */
export async function getPrimaryName({ address } = {}) {
  const network = await getActiveNetworkConfig();
  const target = address ?? (await accountService.getActiveAccount())?.address;
  if (!target) return null;
  return (await readAll(network.id))[target] ?? null;
}

/**
 * Link a primary name to the ACTIVE account after on-chain ownership verification.
 * `rootAddress` may be omitted/blank: the canonical root is then AUTO-DISCOVERED by
 * on-chain proof (see nameService.discoverDefaultRoot) — the wallet never asks the user
 * for an address the chain can prove by itself. When no canonical root exists on this
 * network the call returns NAME_ROOT_UNKNOWN and the UI offers the manual root field.
 * @param {{ name: string, rootAddress?: string }} params
 * @returns the stored record (rootAddress = the root that actually verified)
 */
export async function linkPrimaryName({ name, rootAddress } = {}) {
  const problem = ns.nameProblem(String(name ?? ''));
  if (problem) throw errCode('INVALID_PARAMS', `invalid name: ${problem}`);
  const account = await accountService.getActiveAccount();
  if (!account?.address) throw errCode('ACCOUNT_MISSING', 'no active account');

  let root = String(rootAddress ?? '').trim();
  if (!root) {
    const discovered = await nameService.discoverDefaultRoot();
    if (!discovered?.supported) {
      throw errCode('NAME_ROOT_UNKNOWN', discovered?.reason ?? 'no canonical name root on this network');
    }
    root = discovered.rootAddress;
  }

  const result = await nameService.lookupName({ name, rootAddress: root });
  if (!result?.leaf?.exists) {
    throw errCode('NAME_NOT_FOUND', `no on-chain domain '${name}' under that root registrar`);
  }
  const { domain } = result.leaf;
  if (!domain) {
    throw errCode('NAME_UNREADABLE', `the domain account exists but its record cannot be read: ${result.leaf.decodeError}`);
  }
  if (domain.owner !== account.address) {
    throw errCode('NOT_NAME_OWNER', 'that name is owned by a different account — only the owner can link it here');
  }

  const network = await getActiveNetworkConfig();
  const record = {
    name: String(name),
    rootAddress: root,
    domainAddress: result.leaf.address,
    verifiedAt: Date.now(),
  };
  const all = await readAll(network.id);
  all[account.address] = record;
  await writeAll(network.id, all);
  return record;
}

/**
 * Re-verify a stored link against the current chain state. Drops the record ONLY on positive
 * disproof — the chain showed a parseable domain owned by a DIFFERENT address. A name that is
 * temporarily unreadable (node down, answer collapsed to absent by the read layer) keeps the
 * last verified record: losing the badge is honest only when the chain says so, not when it
 * is silent. Every successful call still re-checks, so a real ownership change is caught on
 * the next readable read.
 */
export async function verifyPrimaryName({ address } = {}) {
  const network = await getActiveNetworkConfig();
  const target = address ?? (await accountService.getActiveAccount())?.address;
  if (!target) return null;
  const record = (await readAll(network.id))[target] ?? null;
  if (!record) return null;
  try {
    const result = await nameService.lookupName({ name: record.name, rootAddress: record.rootAddress });
    if (result?.leaf?.domain && result.leaf.domain.owner !== target) {
      const all = await readAll(network.id);
      if (all[target]) {
        delete all[target];
        await writeAll(network.id, all);
      }
      return null; // honestly gone
    }
  } catch {
    // chain unreadable: keep showing the stored record rather than flapping it away
  }
  return record;
}

/** Remove the active account's primary name on the active network. */
export async function unlinkPrimaryName({ address } = {}) {
  const network = await getActiveNetworkConfig();
  const target = address ?? (await accountService.getActiveAccount())?.address;
  if (!target) return { unlinked: false };
  const all = await readAll(network.id);
  const had = Object.prototype.hasOwnProperty.call(all, target);
  if (had) {
    delete all[target];
    await writeAll(network.id, all);
  }
  return { unlinked: had };
}
