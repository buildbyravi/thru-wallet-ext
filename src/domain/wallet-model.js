// Domain abstraction for wallet hierarchy.
//
// Maps the existing Vault V2 keyring model into a UI-friendly wallet tree
// without modifying vault.js. The background service already exposes keyrings
// via 'account.list' and vault.listKeyrings() — this module takes that raw
// data and shapes it for the account switcher, account detail, and dashboard.
//
// Conceptual model:
//
//   Wallet Container
//   ├── Seed Wallet A   (keyring type='seed')
//   │   ├── HD Account 0
//   │   ├── HD Account 1
//   │   └── ...
//   ├── Seed Wallet B   (keyring type='seed')
//   │   └── HD Account 0
//   ├── Imported Key     (keyring type='privateKey')
//   └── Imported Key     (keyring type='privateKey')

/**
 * Wallet type constants — maps to keyring.type from vault V2.
 * @enum {string}
 */
export const WalletType = Object.freeze({
  SEED: 'seed',
  PRIVATE_KEY: 'privateKey',
  HARDWARE: 'hardware',    // Future
  WATCH_ONLY: 'watchOnly', // Future
});

/**
 * @typedef {Object} WalletGroup
 * @property {string}   id       - Keyring ID
 * @property {string}   type     - WalletType value
 * @property {string}   label    - User-facing wallet name
 * @property {number}   createdAt
 * @property {Array<PublicAccount>} accounts - Accounts in this wallet
 */

/**
 * @typedef {Object} PublicAccount
 * @property {string}      address
 * @property {string}      publicKey
 * @property {string}      label
 * @property {Object}      ref       - Account reference for switching
 * @property {Object|null} keyring   - { id, type, label }
 */

/**
 * Group a flat account list into wallet groups using keyring metadata.
 *
 * The background service returns accounts with `ref.kind` ('hd' or 'imported')
 * and `keyring.id` — this function groups by keyring ID, preserving the
 * wallet → accounts hierarchy the spec requires.
 *
 * @param {PublicAccount[]} accounts - From bridge.send('account.list')
 * @returns {{ seedWallets: WalletGroup[], importedKeys: WalletGroup[] }}
 */
export function groupAccountsByWallet(accounts) {
  const walletMap = new Map();
  const importedKeys = [];

  for (const account of accounts) {
    const keyring = account.keyring;
    if (!keyring) {
      // Fallback: accounts without keyring metadata go into imported
      importedKeys.push({
        id: account.ref?.keyringId || `unknown_${account.address}`,
        type: WalletType.PRIVATE_KEY,
        label: account.label || 'Unknown',
        createdAt: 0,
        accounts: [account],
      });
      continue;
    }

    if (keyring.type === WalletType.SEED) {
      if (!walletMap.has(keyring.id)) {
        walletMap.set(keyring.id, {
          id: keyring.id,
          type: WalletType.SEED,
          label: keyring.label || 'Seed Wallet',
          createdAt: 0,
          accounts: [],
        });
      }
      walletMap.get(keyring.id).accounts.push(account);
    } else if (keyring.type === WalletType.PRIVATE_KEY) {
      importedKeys.push({
        id: keyring.id,
        type: WalletType.PRIVATE_KEY,
        label: keyring.label || 'Imported Key',
        createdAt: 0,
        accounts: [account],
      });
    }
  }

  return {
    seedWallets: Array.from(walletMap.values()),
    importedKeys,
  };
}

/**
 * Get a display-friendly type badge for an account.
 * @param {PublicAccount} account
 * @returns {string}
 */
export function getAccountTypeBadge(account) {
  if (!account?.keyring) return 'Unknown';
  switch (account.keyring.type) {
    case WalletType.SEED: return 'HD';
    case WalletType.PRIVATE_KEY: return 'Imported';
    case WalletType.HARDWARE: return 'Hardware';
    case WalletType.WATCH_ONLY: return 'Watch';
    default: return 'Unknown';
  }
}

/**
 * Get the derivation path description for an HD account.
 * @param {PublicAccount} account
 * @returns {string|null}
 */
export function getDerivationPath(account) {
  if (account?.ref?.kind !== 'hd') return null;
  const index = account.ref.index ?? account.ref.accountIndex ?? 0;
  return `m/44'/9999'/0'/${index}`;
}

/**
 * Check if an account is from an HD seed wallet.
 * @param {PublicAccount} account
 * @returns {boolean}
 */
export function isSeedAccount(account) {
  return account?.keyring?.type === WalletType.SEED || account?.ref?.kind === 'hd';
}

/**
 * Check if an account is an imported private key.
 * @param {PublicAccount} account
 * @returns {boolean}
 */
export function isImportedAccount(account) {
  return account?.keyring?.type === WalletType.PRIVATE_KEY || account?.ref?.kind === 'imported';
}

/**
 * Count total accounts across all wallets.
 * @param {PublicAccount[]} accounts
 * @returns {{ total: number, seed: number, imported: number }}
 */
export function countAccounts(accounts) {
  let seed = 0;
  let imported = 0;
  for (const acc of accounts) {
    if (isSeedAccount(acc)) seed++;
    else imported++;
  }
  return { total: seed + imported, seed, imported };
}

/**
 * Filter accounts by search query (matches label or address).
 * @param {PublicAccount[]} accounts
 * @param {string} query
 * @returns {PublicAccount[]}
 */
export function filterAccounts(accounts, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return accounts;
  return accounts.filter(
    (acc) => acc.label.toLowerCase().includes(q) || acc.address.toLowerCase().includes(q),
  );
}
