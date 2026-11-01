// Wallet lifecycle and authentication service in the background worker.
// Directly interacts with vault.js.

import * as vault from '../../lib/vault.js';
import * as auth from './auth-service.js';
import * as balances from './balance-service.js';
import * as pending from './pending-tx-service.js';
import { emitLockStateChanged } from './event-service.js';
import { registerCreatedAccount } from './registration-service.js';
import { getActiveNetworkId } from './network-service.js';
import * as reviewStore from './review/store.js';

/**
 * Check whether an encrypted vault exists on device.
 */
export async function hasVault() {
  return vault.hasVault();
}

/**
 * Check whether the wallet is currently unlocked.
 */
export async function isUnlocked() {
  return vault.isUnlocked();
}

/**
 * Create a new wallet with a master password.
 * @param {string} password
 * @returns {Promise<{ mnemonic: string, address: string }>}
 */
export async function createVault(password) {
  if (await vault.hasVault()) {
    const error = new Error('A wallet already exists on this device. Reset it first to replace it.');
    error.code = 'VAULT_EXISTS';
    throw error;
  }
  const networkId = await getActiveNetworkId();
  const mnemonic = await vault.createVault(password);
  const active = await vault.getActiveAccount();
  // Register the first account on-chain immediately. Without this it only happened as a side
  // effect of the dashboard's balance check, so a brand-new wallet that tapped Faucet first
  // failed with "[not_found] account not found". Not awaited: an offline node must not prevent
  // wallet creation, and claimFaucet still guards independently.
  void registerCreatedAccount(active.address, networkId);
  return { mnemonic, address: active.address };
}

/**
 * Import an existing 12-word recovery phrase as the primary vault.
 * @param {string} mnemonic
 * @param {string} password
 * @returns {Promise<{ address: string }>}
 */
export async function importMnemonicVault(mnemonic, password) {
  if (await vault.hasVault()) {
    const error = new Error('A wallet already exists on this device. Reset it first to replace it.');
    error.code = 'VAULT_EXISTS';
    throw error;
  }
  const networkId = await getActiveNetworkId();
  const result = await vault.importMnemonicVault(mnemonic, password);
  void registerCreatedAccount((await vault.getActiveAccount()).address, networkId);
  return result;
}

/**
 * Import a standalone private key hex as the primary vault.
 * @param {string} privateKeyHex
 * @param {string} password
 * @returns {Promise<{ address: string }>}
 */
export async function importPrivateKeyVault(privateKeyHex, password) {
  if (await vault.hasVault()) {
    const error = new Error('A wallet already exists on this device. Reset it first to replace it.');
    error.code = 'VAULT_EXISTS';
    throw error;
  }
  const networkId = await getActiveNetworkId();
  const result = await vault.importPrivateKeyVault(privateKeyHex, password);
  void registerCreatedAccount((await vault.getActiveAccount()).address, networkId);
  return result;
}

/**
 * Unlock the wallet with the master password.
 *
 * Throttling is enforced here rather than in the UI: a backoff window is checked before
 * the attempt, a failure advances the counter, and a success clears it. `vault.unlock`
 * throws 'Incorrect password.' on mismatch, which is what advances the counter — any
 * other error (missing vault, corrupt blob) is passed through untouched.
 *
 * @param {string} password
 */
export async function unlock(password) {
  await auth.assertUnlockAllowed();
  try {
    const result = await vault.unlock(password);
    await auth.recordSuccess();
    emitLockStateChanged(true);
    // Warm the balance cache and settle anything left in flight, without blocking the caller.
    vault.listAccounts()
      .then((accounts) => balances.getBalances(accounts.map((a) => a.address)))
      .catch(() => {});
    pending.reconcile().catch(() => {});
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/incorrect password/i.test(message)) {
      const { retryInMs } = await auth.recordFailure();
      if (retryInMs > 0) {
        const seconds = Math.ceil(retryInMs / 1000);
        const err = new Error(
          `Incorrect password. Too many attempts — try again in ${seconds} second${seconds === 1 ? '' : 's'}.`,
        );
        err.code = 'AUTH_LOCKED_OUT';
        throw err;
      }
    }
    throw error;
  }
}

/**
 * Re-verify the master password without changing lock state.
 * Throttled using the same exponential backoff lockout as unlock, preventing brute-force guesses.
 * @param {string} password
 */
export async function verifyPassword(password) {
  await auth.assertUnlockAllowed();
  try {
    const result = await vault.verifyMasterPassword(password);
    await auth.recordSuccess();
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/incorrect password/i.test(message)) {
      const { retryInMs } = await auth.recordFailure();
      if (retryInMs > 0) {
        const seconds = Math.ceil(retryInMs / 1000);
        const err = new Error(
          `Incorrect password. Too many attempts — try again in ${seconds} second${seconds === 1 ? '' : 's'}.`,
        );
        err.code = 'AUTH_LOCKED_OUT';
        throw err;
      }
    }
    throw error;
  }
}

/**
 * Current unlock-throttling state, so the UI can show a countdown.
 */
export async function getLockoutState() {
  return auth.getLockoutState();
}

/**
 * Drop the V1 rollback backup after the migrated vault has unlocked successfully twice.
 * @param {string} password
 */
export async function removeLegacyBackup(password) {
  await vault.removeLegacyBackup(password);
  return { removed: true };
}

/**
 * Lock the wallet, destroying the session key in memory.
 *
 * Every lock path MUST come through here — the UI's `wallet.lock`, the auto-lock alarm, and
 * anything added later. A lock ends the session the user's approval was given in, so prepared
 * reviews are discarded with it (Hard rule 21). This used to live only in the router's
 * `wallet.lock` handler, which meant the auto-lock alarm locked the vault and left a 120-second
 * review sitting in storage for a wallet that had just been locked (2026-11-01 audit).
 *
 * A failure to clear must never block the lock itself: the vault lock is the security action, and
 * it has already happened. The outcome is returned so a caller/test can see it rather than assume.
 */
export async function lock() {
  await vault.lock();
  const reviews = await discardPreparedReviews();
  emitLockStateChanged(false);
  return reviews;
}

/**
 * Drop every prepared review. The store is a leaf (shared modules only), so importing it here
 * adds no service edge and cannot extend the known services cycle.
 */
async function discardPreparedReviews() {
  try {
    return await reviewStore.clearAll();
  } catch (error) {
    return { cleared: 0, error: String(error?.message ?? error) };
  }
}

/**
 * Wipe all wallet data from this device.
 *
 * Everything derived from the vault must go with it: throttling state, cached balances, and
 * tracked transactions. Leaving any of those behind would let a fresh wallet inherit the
 * previous one's balances or pending list.
 *
 * Uses the clear-ALL variants because per-network data is namespaced by network id. Clearing
 * only the active network would leave the previous wallet's balances and pending transactions
 * waiting on every other network the user had visited.
 */
export async function resetWallet({ confirmation, password } = {}) {
  if (String(confirmation || '').trim().toUpperCase() !== 'RESET') {
    const err = new Error('Type RESET to erase this wallet.');
    err.code = 'AUTH_REQUIRED';
    throw err;
  }

  if (await vault.isUnlocked()) {
    if (typeof password !== 'string' || password.length === 0) {
      const err = new Error('Erasing an unlocked wallet needs your password.');
      err.code = 'AUTH_REQUIRED';
      throw err;
    }
    try {
      await verifyPassword(password);
    } catch (error) {
      const err = new Error(error?.message || 'Incorrect password.');
      err.code = 'AUTH_REQUIRED';
      throw err;
    }
  }

  await vault.resetWallet();
  await auth.clearLockout();
  await balances.clearAllCaches();
  await pending.clearAll();

  // Clear all wallet-associated persistent storage so no contacts, labels, caches,
  // reviews, intents, or tracked domains survive into a new wallet.
  try {
    if (typeof chrome.storage?.local?.clear === 'function') {
      await chrome.storage.local.clear();
    } else {
      const all = await chrome.storage.local.get(null);
      await chrome.storage.local.remove(Object.keys(all || {}));
    }
    await chrome.storage.session.clear().catch(() => {});
  } catch {
    // ignore storage cleanup error
  }
  emitLockStateChanged(false);
}

/**
 * Check if the vault contains an HD seed phrase.
 */
export async function hasSeed() {
  return vault.hasSeed();
}

/**
 * Export the seed phrase or imported key backing an account.
 * @param {Object} ref
 * @param {string} password
 */
export async function exportSecret(ref, password) {
  return vault.exportAccountSecret(ref, password);
}

/**
 * Export ONE account's private key, including a seed-derived account.
 *
 * Kept separate from exportSecret because the two disclose very different amounts: a phrase
 * controls every address it can derive, a private key controls exactly one.
 *
 * @param {Object} ref
 * @param {string} password
 */
export async function exportPrivateKey(ref, password) {
  return vault.exportAccountPrivateKey(ref, password);
}
