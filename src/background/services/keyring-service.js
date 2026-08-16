// Keyring management service in the background worker.
//
// A keyring is one source of key material: a recovery phrase (which derives many HD
// accounts) or a single imported private key. This service exposes the multi-seed
// primitives that have existed in src/lib/vault.js since vault V2 but were unreachable
// from the UI until contract v3.
//
// Every mutating operation here requires the master password, verified inside vault.js
// against the encrypted blob — not against session state — so an unlocked session alone
// is never sufficient to add or remove key material.

import * as vault from '../../lib/vault.js';

/**
 * List every keyring with its account count and provenance.
 * Never returns mnemonics or private keys.
 */
export async function listKeyrings() {
  return vault.listKeyrings();
}

/**
 * Add an additional recovery phrase to the existing vault (multi-seed).
 * @param {string} mnemonic
 * @param {string} password
 * @param {string} [label]
 */
export async function addSeedKeyring(mnemonic, password, label = '') {
  return vault.addSeedKeyring(mnemonic, password, label);
}

/**
 * Add a standalone private key as its own keyring.
 * @param {string} privateKeyHex
 * @param {string} password
 * @param {string} [label]
 */
export async function addPrivateKeyKeyring(privateKeyHex, password, label = '') {
  return vault.addPrivateKeyKeyring(privateKeyHex, password, label);
}

/**
 * Rename a keyring. Label is sanitized and length-capped in the vault layer.
 * @param {string} keyringId
 * @param {string} label
 * @param {string} password
 */
export async function renameKeyring(keyringId, label, password) {
  return vault.renameKeyring(keyringId, label, password);
}

/**
 * Remove a keyring and every account derived from it. Refuses to remove the last
 * remaining keyring — that is what wallet.reset is for.
 * @param {string} keyringId
 * @param {string} password
 */
export async function removeKeyring(keyringId, password) {
  await vault.removeKeyring(keyringId, password);
  return { removed: keyringId };
}
