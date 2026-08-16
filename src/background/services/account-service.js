// Account management service running in the background worker.

import * as vault from '../../lib/vault.js';
import { getPreferences, applyAccountPreferences } from './preferences-service.js';
import { emitAccountsChanged } from './event-service.js';
import * as balances from './balance-service.js';

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
 *
 * Applies stored display preferences: pinned first, then explicit order, with hidden accounts
 * filtered out unless requested. Optionally attaches cached balances so a switcher can render
 * a balance per row without N round-trips.
 *
 * @param {{ includeHidden?: boolean, withBalances?: boolean }} [options]
 */
export async function listAccounts(options = {}) {
  const { includeHidden = false, withBalances = false } = options;
  const accounts = await vault.listAccounts();
  const prefs = await getPreferences();
  const ordered = applyAccountPreferences(accounts.map(toPublicAccount), prefs, { includeHidden });

  if (!withBalances) return ordered;

  const cached = await balances.getCachedBalances(ordered.map((a) => a.address));
  return ordered.map((acc) => ({
    ...acc,
    balance: cached[acc.address]?.balance ?? null,
    balanceStale: cached[acc.address]?.stale ?? true,
  }));
}

/**
 * Switch active account to a target reference.
 * @param {Object} ref
 */
export async function switchActiveAccount(ref) {
  await vault.switchActiveAccount(ref);
  const active = await vault.getActiveAccount();
  const publicAccount = toPublicAccount(active);
  emitAccountsChanged({ active: publicAccount });
  // Refresh in the background; the UI paints from cache immediately.
  balances.getBalances([publicAccount.address]).catch(() => {});
  return publicAccount;
}

/**
 * Derive the next HD account for a seed keyring.
 * @param {string|null} keyringId
 */
export async function addHdAccount(keyringId = null) {
  const account = await vault.addHdAccount(keyringId);
  const active = await vault.getActiveAccount();
  const publicAccount = toPublicAccount(active);
  emitAccountsChanged({ active: publicAccount, added: account });
  return publicAccount;
}

/**
 * Preview upcoming HD addresses without adding them, so the user can choose which to import.
 * @param {{ keyringId: string, start?: number, count?: number, withBalances?: boolean }} params
 */
export async function previewHdAccounts({ keyringId, start = 0, count = 5, withBalances = false }) {
  const preview = await vault.previewHdAccounts(keyringId, start, count);
  if (!withBalances) return preview;
  const fetched = await balances.getBalances(preview.map((p) => p.address), { emit: false });
  return preview.map((p) => ({
    ...p,
    balance: fetched[p.address]?.balance ?? null,
  }));
}

/**
 * Add several HD indices at once in a single vault write.
 * @param {{ keyringId: string, indices: number[] }} params
 */
export async function addHdAccounts({ keyringId, indices }) {
  const result = await vault.addHdAccounts(keyringId, indices);
  const active = await vault.getActiveAccount();
  emitAccountsChanged({ active: toPublicAccount(active), added: result.added });
  return result;
}

/**
 * Remove one derived HD account, leaving its keyring intact.
 * @param {{ ref: Object }} params
 */
export async function removeHdAccount({ ref }) {
  const result = await vault.removeHdAccount(ref);
  const active = await vault.getActiveAccount();
  emitAccountsChanged({ active: toPublicAccount(active), removed: result });
  return result;
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
