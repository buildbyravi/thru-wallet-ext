// Wallet lifecycle and authentication service in the background worker.
// Directly interacts with vault.js.

import * as vault from '../../lib/vault.js';
import * as auth from './auth-service.js';

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
  const mnemonic = await vault.createVault(password);
  const active = await vault.getActiveAccount();
  return { mnemonic, address: active.address };
}

/**
 * Import an existing 12-word recovery phrase as the primary vault.
 * @param {string} mnemonic
 * @param {string} password
 * @returns {Promise<{ address: string }>}
 */
export async function importMnemonicVault(mnemonic, password) {
  return vault.importMnemonicVault(mnemonic, password);
}

/**
 * Import a standalone private key hex as the primary vault.
 * @param {string} privateKeyHex
 * @param {string} password
 * @returns {Promise<{ address: string }>}
 */
export async function importPrivateKeyVault(privateKeyHex, password) {
  return vault.importPrivateKeyVault(privateKeyHex, password);
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
 * @param {string} password
 */
export async function verifyPassword(password) {
  return vault.verifyMasterPassword(password);
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
 */
export async function lock() {
  return vault.lock();
}

/**
 * Wipe all wallet data from this device.
 */
export async function resetWallet() {
  await vault.resetWallet();
  await auth.clearLockout();
}

/**
 * Check if the vault contains an HD seed phrase.
 */
export async function hasSeed() {
  return vault.hasSeed();
}

/**
 * Re-authenticate with password and export the secret for a given account ref.
 * @param {Object} ref
 * @param {string} password
 */
export async function exportSecret(ref, password) {
  return vault.exportAccountSecret(ref, password);
}
