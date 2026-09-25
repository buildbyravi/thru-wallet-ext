// Creation-bound and just-in-time account activation. Thru requires a recipient to exist
// on-chain before a native transfer can land. Registration signs a self-transaction from the
// account being activated; an arbitrary sender cannot register someone else's account.
// Activation NEVER invokes a faucet claim or a dummy/zero-value transfer; the adapter uses
// only the native account-creation program with fee 0n and nonce 0n.
//
// Only creation/addition and an explicit Send recipient selection trigger this service.
// There is deliberately NO minute-by-minute loop signing for every idle vault account.

import * as vault from '../../lib/vault.js';
import * as thruClient from '../../lib/thru-client.js';
import { getActiveNetworkConfig, getActiveNetworkId } from './network-service.js';

const MAX_RETRIES = 3; // one immediate attempt, then at most three bounded retries
const RETRY_BASE_MS = 500;

function registrationError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  return error;
}

async function assertContext(address, networkId) {
  if (!(await vault.isUnlocked())) {
    throw registrationError('WALLET_LOCKED', 'Unlock the wallet before activating an account.');
  }
  if ((await getActiveNetworkId()) !== networkId) {
    throw registrationError('NETWORK_CHANGED', 'The network changed while activating this account. Retry on the new network.');
  }
  // listAccounts resolves each vault ref to its OWN keypair. Pick the exact target address,
  // never the active account's keys (which may belong to a completely different signer).
  // A creation retry must not keep a removed/reset account's private key alive and sign with it
  // after the user has erased the vault. Derive the signer afresh and recheck just before signing.
  const account = (await vault.listAccounts()).find((a) => a.address === address);
  if (!account) {
    throw registrationError('NOT_OWNED_ACCOUNT', 'Only accounts in this wallet can be activated.');
  }
  return account;
}

/**
 * Activate exactly the requested owned address, not the active sending account. Never return
 * private keys across the router. Called by tx.registerAccount (auth: unlocked) and by the
 * creation-bound retry helper below. The SDK re-checks on-chain existence and deduplicates
 * concurrent attempts; its zero-declared-fee transaction is still a real signed broadcast.
 */
export async function registerOwnedAccount(address, expectedNetworkId = null) {
  const target = typeof address === 'string' ? address.trim() : '';
  if (!thruClient.isValidThruAddress(target)) {
    throw registrationError('INVALID_ADDRESS', 'Enter a valid Thru account address to activate.');
  }
  const network = await getActiveNetworkConfig(); // bind the RPC before looking up chain state
  if (expectedNetworkId && expectedNetworkId !== network.id) {
    throw registrationError('NETWORK_CHANGED', 'The network changed while activating this account.');
  }
  const account = await assertContext(target, network.id);
  const signature = await thruClient.createOnChainAccount(account, {
    beforeSign: async () => {
      if (!(await vault.isUnlocked())) {
        throw registrationError('WALLET_LOCKED', 'Unlock the wallet before activating an account.');
      }
      if ((await getActiveNetworkId()) !== network.id) {
        throw registrationError('NETWORK_CHANGED', 'The network changed while activating this account.');
      }
      // Re-derive ONLY the selected ref after the proof. Scanning every HD key twice can
      // hold a large wallet past the bridge timeout; a removed/swapped ref must still fail.
      const signer = await vault.resolveAccount(account.ref).catch(() => null);
      if (signer?.address !== target) {
        throw registrationError('NOT_OWNED_ACCOUNT', 'Only accounts in this wallet can be activated.');
      }
      if (!(await vault.isUnlocked())) {
        throw registrationError('WALLET_LOCKED', 'Unlock the wallet before activating an account.');
      }
    },
  });
  if ((await getActiveNetworkId()) !== network.id) {
    throw registrationError('NETWORK_CHANGED', 'The network changed while activating this account.');
  }
  return {
    address: target,
    networkId: network.id,
    exists: true,
    created: signature !== null,
    signature: signature ?? null,
  };
}

/** Resolve a newly persisted HD/keyring ref without depending on whichever account is active later. */
export function registerCreatedRef(ref, creationNetworkId) {
  return vault.resolveAccount(ref)
    .then((account) => registerCreatedAccount(account.address, creationNetworkId))
    .catch((error) => {
      console.warn('[registration] could not prepare new account:', error?.message || error);
    });
}

/**
 * Best-effort registration only for the account just created. Never hold up wallet creation
 * on an offline node. Retrying is bounded: 0.5s, 1s, 2s, then stop. The MV3 worker may be
 * suspended between attempts; Send's just-in-time path handles that without a signing alarm.
 * No account key is captured across the backoff, and retries stop on lock, reset or a network
 * switch. The promise is returned for tests; callers intentionally do not await it.
 */
export function registerCreatedAccount(address, creationNetworkId = null) {
  const hasExtensionRuntime = typeof chrome !== 'undefined'
    && typeof chrome.runtime?.getManifest === 'function'
    && typeof chrome.runtime?.onMessage?.addListener === 'function';
  if (!hasExtensionRuntime) return Promise.resolve(); // deterministic Node unit tests do not use live RPC

  return (async () => {
    // A network switch while HD derivation is in flight must not change which chain the
    // account-creation action authorized. If it moved, stop; Send can activate on demand.
    const networkId = creationNetworkId || await getActiveNetworkId();
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_MS * 2 ** (attempt - 1)));
      }
      try {
        await registerOwnedAccount(address, networkId);
        return;
      } catch (error) {
        // A failed proof/RPC may be transient. Ownership, lock, chain switch and an on-chain
        // revert are not; never replay a known permanent refusal just because a timer fired.
        if (['NOT_OWNED_ACCOUNT', 'WALLET_LOCKED', 'NETWORK_CHANGED', 'INVALID_ADDRESS'].includes(error?.code)
          || /reverted on-chain|vmError=/i.test(error?.message || '') || attempt === MAX_RETRIES) {
          console.warn(`[registration] activation deferred for ${address}:`, error?.message || error);
          return;
        }
      }
    }
  })().catch((error) => {
    console.warn(`[registration] activation deferred for ${address}:`, error?.message || error);
  });
}
