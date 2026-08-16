// Account management service running in the background worker.

import * as vault from '../../lib/vault.js';

/**
 * Strips raw private key bytes before returning account metadata to the UI.
 */
function toPublicAccount(account) {
  if (!account) return null;
  return {
    address: account.address,
    publicKey: account.publicKey ? (typeof account.publicKey === 'string' ? account.publicKey : account.publicKey.toString()) : account.address,
    label: account.label,
    ref: account.ref,
    hdIndex: account.hdIndex ?? null,
    keyring: account.keyring ? {
      id: account.keyring.id,
      type: account.keyring.type,
      label: account.keyring.label,
      origin: account.keyring.origin || 'unknown',
    } : null,
  };
}

/**
 * Get the currently active account (public fields only).
 */
export async function getActiveAccount() {
  const account = await vault.getActiveAccount();
  return toPublicAccount(account);
}

/**
 * Get the active account reference.
 */
export async function getActiveRef() {
  return vault.getActiveRef();
}

/**
 * List all accounts across all keyrings (public fields only).
 */
export async function listAccounts() {
  const accounts = await vault.listAccounts();
  return accounts.map(toPublicAccount);
}

/**
 * Switch active account to a target reference.
 * @param {Object} ref
 */
export async function switchActiveAccount(ref) {
  await vault.switchActiveAccount(ref);
  const active = await vault.getActiveAccount();
  return toPublicAccount(active);
}

/**
 * Derive the next HD account for the primary seed keyring.
 * @param {string|null} keyringId
 */
export async function addHdAccount(keyringId = null) {
  const account = await vault.addHdAccount(keyringId);
  return toPublicAccount(account);
}

/**
 * Import a standalone private key into the active vault.
 *
 * Contract v3 routes this at the password-checked keyring primitive. The previous
 * implementation used vault.addImportedKey, which is documented in vault.js as the legacy
 * path that skips password verification — adding key material to a wallet is a sensitive
 * operation and must not be possible from an unlocked session alone.
 *
 * @param {string} privateKeyHex
 * @param {string} password
 * @param {string} [label]
 */
export async function addImportedKey(privateKeyHex, password, label = '') {
  await vault.addPrivateKeyKeyring(privateKeyHex, password, label);
  const active = await vault.getActiveAccount();
  return toPublicAccount(active);
}

/**
 * Set a custom nickname for an account address.
 * Returns the sanitized label actually stored, which may differ from the input.
 * @param {string} address
 * @param {string} label
 */
export async function setAccountLabel(address, label) {
  const stored = await vault.setAccountLabel(address, label);
  return { address, label: stored };
}

/**
 * Get all stored account nicknames.
 */
export async function getAccountLabels() {
  return vault.getAccountLabels();
}
