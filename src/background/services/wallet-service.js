// Wallet lifecycle and authentication service in the background worker.
// Directly interacts with vault.js.

import * as vault from '../../lib/vault.js';

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
 * @param {string} password
 */
export async function unlock(password) {
  return vault.unlock(password);
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
  return vault.resetWallet();
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
