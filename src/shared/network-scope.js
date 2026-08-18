// Network-scoped storage keys.
//
// WHY THIS EXISTS
//
// Some stored data is only meaningful on one network and some is meaningful on all of them.
// Getting that split wrong is not a UI bug, it is a data-model bug that only shows up the first
// time someone switches network — at which point they see the previous network's pending
// transactions and a token list of mints that do not exist where they now are.
//
// The split, and the reasoning:
//
//   PER-NETWORK (scope the key)
//     balance cache        a balance on devnet says nothing about mainnet
//     pending transactions a signature exists on exactly one chain
//     token registry       a mint address on devnet does not exist on mainnet
//     deployed tokens      same
//
//   GLOBAL (do NOT scope the key)
//     vault / keys         the same key controls the same address on every Thru network.
//                          Scoping this would be catastrophic: switching network would appear
//                          to erase the wallet.
//     account labels       naming an address is a user preference about the address, not the chain
//     contacts             a Thru address is valid on every Thru network
//     auto-lock, prefs     device settings
//     unlock lockout       an attacker does not get fresh attempts by switching network
//
// The `GLOBAL_KEYS` set below is asserted in tests so a future key cannot be silently scoped
// or unscoped without someone deciding to.

/**
 * Namespace a storage key to a network.
 * @param {string} baseKey
 * @param {string} networkId
 */
export function scopedKey(baseKey, networkId) {
  if (!baseKey) throw new Error('scopedKey: a base key is required.');
  if (!networkId) throw new Error('scopedKey: a network id is required.');
  return `${baseKey}::${networkId}`;
}

/** Keys that must NEVER be network-scoped. Asserted in tests. */
export const GLOBAL_KEYS = Object.freeze([
  'vault',
  'vault_legacy_backup_v1',
  'unlocked_session',
  'active_account_ref',
  'thru_account_labels',
  'thru_contacts',
  'thru_prefs',
  'thru_system_autolock_minutes',
  'thru_unlock_lockout',
  'thru_active_network',
  'thru_custom_networks',
]);

/** Base keys that must ALWAYS be network-scoped. Asserted in tests. */
export const SCOPED_KEYS = Object.freeze([
  'thru_balance_cache',
  'thru_pending_txs',
  'thru_deployed_tokens',
]);

/**
 * True when a key looks network-scoped.
 * @param {string} key
 */
export function isScopedKey(key) {
  return typeof key === 'string' && key.includes('::');
}

/**
 * Strip the network suffix from a scoped key.
 * @param {string} key
 */
export function baseKeyOf(key) {
  const i = String(key).indexOf('::');
  return i === -1 ? key : String(key).slice(0, i);
}

/**
 * Extract the network id from a scoped key, or null.
 * @param {string} key
 */
export function networkOf(key) {
  const i = String(key).indexOf('::');
  return i === -1 ? null : String(key).slice(i + 2);
}
