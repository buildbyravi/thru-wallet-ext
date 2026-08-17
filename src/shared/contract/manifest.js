// The frozen API surface between the UI and the background service worker.
//
// THIS FILE IS THE CONTRACT. Rules:
//
//   1. APPEND-ONLY. Adding a method is always safe. Never rename a method, never change
//      an existing method's param names or return shape. To change behaviour, add a new
//      name (e.g. 'tx.send' -> 'tx.sendV2') and retire the old one only after zero
//      references remain in the UI.
//   2. Every method the UI calls must appear here, and every handler registered in
//      src/background/api-router.js must appear here. test-contract.mjs enforces both
//      directions, so a rename on either side fails CI instead of failing silently at
//      runtime.
//   3. This module must stay free of `chrome.*` and DOM access — it is imported by both
//      the background bundle and the UI bundles.
//
// `params` lists the accepted parameter names (documentation + shape drift detection).
// `returns` is a short prose description, not a validator.
// `auth` declares what the background requires before running the handler:
//   'none'     - callable while locked
//   'unlocked' - requires an unlocked session
//   'password' - requires the caller to pass the master password, re-verified server-side
// `since` is the contract version in which the method first appeared.

export const CONTRACT_VERSION = 4;

export const METHODS = {
  // ---- System ------------------------------------------------------------
  'system.bootstrap': {
    params: [],
    returns: 'Full initial state: { hasVault, unlocked, account, accounts, keyrings, network, networkHealth, autoLockMinutes, lockout }',
    auth: 'none',
    since: 1,
  },
  'system.setAutoLock': {
    params: ['minutes'],
    returns: '{ autoLockMinutes }',
    auth: 'unlocked',
    since: 1,
  },
  'system.getAutoLock': {
    params: [],
    returns: 'number of minutes (0 = never)',
    auth: 'none',
    since: 1,
  },
  'system.ping': {
    params: [],
    returns: '{ ok: true, contractVersion } — liveness probe, also stamps activity',
    auth: 'none',
    since: 3,
  },

  // ---- Wallet lifecycle --------------------------------------------------
  'wallet.hasVault': {
    params: [],
    returns: 'boolean',
    auth: 'none',
    since: 1,
  },
  'wallet.isUnlocked': {
    params: [],
    returns: 'boolean',
    auth: 'none',
    since: 1,
  },
  'wallet.create': {
    params: ['password'],
    returns: '{ mnemonic, address } — the ONLY time the mnemonic crosses the seam',
    auth: 'none',
    since: 1,
  },
  'wallet.importMnemonic': {
    params: ['mnemonic', 'password'],
    returns: 'void',
    auth: 'none',
    since: 1,
  },
  'wallet.importPrivateKey': {
    params: ['privateKeyHex', 'password'],
    returns: 'void',
    auth: 'none',
    since: 1,
  },
  'wallet.unlock': {
    params: ['password'],
    returns: 'void — throws with code AUTH_LOCKED_OUT while a backoff window is open',
    auth: 'none',
    since: 1,
  },
  'wallet.lock': {
    params: [],
    returns: 'void',
    auth: 'none',
    since: 1,
  },
  'wallet.reset': {
    params: [],
    returns: 'void — wipes every wallet key from this device',
    auth: 'none',
    since: 1,
  },
  'wallet.hasSeed': {
    params: [],
    returns: 'boolean — whether any seed keyring exists',
    auth: 'unlocked',
    since: 1,
  },
  'wallet.exportSecret': {
    params: ['ref', 'password'],
    returns: "{ kind: 'hd', mnemonic } | { kind: 'imported', privateKeyHex }",
    auth: 'password',
    since: 1,
  },
  'wallet.exportPrivateKey': {
    params: ['ref', 'password'],
    returns: "{ kind: 'privateKey', privateKeyHex, address, derivedFrom } — ONE account's key, "
      + 'including a seed-derived one. Discloses far less than exportSecret, which returns the '
      + 'whole phrase.',
    auth: 'password',
    since: 4,
  },
  'wallet.verifyPassword': {
    params: ['password'],
    returns: 'true, or throws — used to gate sensitive UI transitions',
    auth: 'password',
    since: 3,
  },
  'wallet.getLockoutState': {
    params: [],
    returns: '{ failedCount, lockedUntil, retryInMs }',
    auth: 'none',
    since: 3,
  },
  'wallet.removeLegacyBackup': {
    params: ['password'],
    returns: 'void — drops the V1 rollback blob after two successful V2 unlocks',
    auth: 'password',
    since: 3,
  },

  // ---- Keyrings (multi-seed) --------------------------------------------
  // The vault has supported these since V2; contract v3 is the first to expose them.
  'keyring.list': {
    params: [],
    returns: '[{ id, type, label, origin, accountCount, createdAt }]',
    auth: 'unlocked',
    since: 3,
  },
  'keyring.addSeed': {
    params: ['mnemonic', 'password', 'label'],
    returns: '{ id, type, label } — rejects a phrase already in the vault',
    auth: 'password',
    since: 3,
  },
  'keyring.createSeed': {
    params: ['password', 'label'],
    returns: '{ id, type, label, origin } — generates a NEW phrase in the background and '
      + 'registers it. The phrase is never returned; view it via wallet.exportSecret.',
    auth: 'password',
    since: 4,
  },
  'keyring.addPrivateKey': {
    params: ['privateKeyHex', 'password', 'label'],
    returns: '{ id, type, label } — rejects a key already in the vault',
    auth: 'password',
    since: 3,
  },
  'keyring.rename': {
    params: ['keyringId', 'label', 'password'],
    returns: 'void',
    auth: 'password',
    since: 3,
  },
  'keyring.remove': {
    params: ['keyringId', 'password'],
    returns: 'void — refuses to remove the last keyring; use wallet.reset',
    auth: 'password',
    since: 3,
  },
  'keyring.setBackedUp': {
    params: ['keyringId', 'backedUp'],
    returns: '{ id, backedUpAt } — records that the user confirmed writing the phrase down',
    auth: 'unlocked',
    since: 4,
  },

  // ---- Accounts ---------------------------------------------------------
  'account.getActive': {
    params: [],
    returns: '{ address, publicKey, label, ref, keyring } — never includes private key bytes',
    auth: 'unlocked',
    since: 1,
  },
  'account.getActiveRef': {
    params: [],
    returns: 'ref object or null',
    auth: 'none',
    since: 1,
  },
  'account.list': {
    params: ['includeHidden', 'withBalances'],
    returns: 'array of public accounts, pinned first then in stored order, hidden filtered out unless asked',
    auth: 'unlocked',
    since: 1,
  },
  'account.switch': {
    params: ['ref'],
    returns: 'the newly active public account',
    auth: 'unlocked',
    since: 1,
  },
  'account.addHd': {
    params: ['keyringId'],
    returns: 'the new public account (next BIP-44 index on that seed keyring)',
    auth: 'unlocked',
    since: 1,
  },
  'account.addImported': {
    params: ['privateKeyHex', 'password'],
    returns: 'the new public account. `password` became required in contract v3.',
    auth: 'password',
    since: 1,
  },
  'account.setLabel': {
    params: ['address', 'label'],
    returns: 'void — label is length- and charset-limited server-side',
    auth: 'unlocked',
    since: 1,
  },
  'account.getLabels': {
    params: [],
    returns: '{ [address]: label }',
    auth: 'none',
    since: 1,
  },
  'account.previewHd': {
    params: ['keyringId', 'start', 'count', 'withBalances'],
    returns: '[{ index, address, added, balance? }] — derives without persisting anything',
    auth: 'unlocked',
    since: 4,
  },
  'account.addHdBatch': {
    params: ['keyringId', 'indices'],
    returns: '{ keyringId, added } — one vault write for many indices',
    auth: 'unlocked',
    since: 4,
  },
  'account.removeHd': {
    params: ['ref'],
    returns: '{ keyringId, removedIndex } — refuses to remove a keyring\'s last account',
    auth: 'unlocked',
    since: 4,
  },
  'account.setHidden': {
    params: ['address', 'hidden'],
    returns: 'updated preferences — hides from switchers without deleting keys',
    auth: 'unlocked',
    since: 4,
  },
  'account.setPinned': {
    params: ['address', 'pinned'],
    returns: 'updated preferences',
    auth: 'unlocked',
    since: 4,
  },
  'account.setOrder': {
    params: ['addresses'],
    returns: 'updated preferences',
    auth: 'unlocked',
    since: 4,
  },

  // ---- Transactions and RPC --------------------------------------------
  'tx.getAccountInfo': {
    params: ['address'],
    returns: '{ exists, balance } — balance is a base-unit string, never a BigInt',
    auth: 'none',
    since: 1,
  },
  'tx.claimFaucet': {
    params: ['amountUnits'],
    returns: '{ signature, blockHeight }',
    auth: 'unlocked',
    since: 1,
  },
  'tx.send': {
    params: ['toAddress', 'amountUnits'],
    returns: '{ signature, blockHeight }',
    auth: 'unlocked',
    since: 1,
  },
  'tx.listHistory': {
    params: ['address', 'pageSize', 'limit', 'cursor'],
    returns: 'array (positional form) or { entries, nextCursor, hasMore } (options form)',
    auth: 'none',
    since: 1,
  },
  'tx.checkHealth': {
    params: [],
    returns: '{ status, latencyMs, ... }',
    auth: 'none',
    since: 1,
  },
  'tx.autoCreateAccount': {
    params: [],
    returns: 'result of the on-chain account creation',
    auth: 'unlocked',
    since: 1,
  },
  'tx.validateAddress': {
    params: ['address'],
    returns: '{ valid, isSelf, reason } — server-side address check',
    auth: 'none',
    since: 3,
  },
  'tx.getBalances': {
    params: ['addresses'],
    returns: '{ [address]: { balance, exists, fetchedAt, stale, error } } — concurrency-capped batch',
    auth: 'none',
    since: 4,
  },
  'tx.getCachedBalances': {
    params: ['addresses'],
    returns: 'same shape as tx.getBalances but performs NO network access — safe on the render path',
    auth: 'none',
    since: 4,
  },
  'tx.getTotalBalance': {
    params: ['addresses'],
    returns: '{ total, addressCount } — BigInt sum as a base-unit string',
    auth: 'none',
    since: 4,
  },
  'tx.getPending': {
    params: [],
    returns: '[{ signature, kind, from, to, amountUnits, status, submittedAt }]',
    auth: 'none',
    since: 4,
  },
  'tx.reconcilePending': {
    params: [],
    returns: '{ checked, settled } — settles only on positive chain evidence, never on a guess',
    auth: 'none',
    since: 4,
  },
  'tx.clearSettled': {
    params: [],
    returns: '{ remaining }',
    auth: 'none',
    since: 4,
  },
  'tx.estimateFee': {
    params: ['toAddress', 'amountUnits'],
    returns: '{ supported: false, feeUnits: null, reason } — UNVERIFIED on Thru, see docs/BACKEND_GAPS.md C2',
    auth: 'none',
    since: 4,
  },
  'tx.simulate': {
    params: ['toAddress', 'amountUnits'],
    returns: '{ supported: false, changes: null, reason } — UNVERIFIED on Thru, see docs/BACKEND_GAPS.md C3',
    auth: 'none',
    since: 4,
  },

  // ---- Tokens and launchpad --------------------------------------------
  'token.deploy': {
    params: ['mintSeed', 'name', 'symbol', 'decimals', 'description', 'imageUrl'],
    returns: 'deployment result including the mint address',
    auth: 'unlocked',
    since: 1,
  },
  'token.list': {
    params: [],
    returns: 'array of locally-recorded deployed token records',
    auth: 'none',
    since: 1,
  },
  'token.deriveAddress': {
    params: ['mintSeed'],
    returns: 'derived mint address string',
    auth: 'none',
    since: 1,
  },
  'token.generateSeed': {
    params: [],
    returns: '32-character alphanumeric mint seed',
    auth: 'none',
    since: 1,
  },
  'token.import': {
    params: ['mintAddress', 'symbol', 'name', 'decimals'],
    returns: 'the saved record — metadata only, does not prove the mint exists on-chain',
    auth: 'unlocked',
    since: 4,
  },
  'token.setVisibility': {
    params: ['mintAddress', 'hidden'],
    returns: '{ mintAddress, hidden }',
    auth: 'unlocked',
    since: 4,
  },
  'token.getBalances': {
    params: ['address'],
    returns: '{ supported: false, balances: null, reason } — UNVERIFIED on Thru, see docs/BACKEND_GAPS.md C1',
    auth: 'none',
    since: 4,
  },

  // ---- Preferences -----------------------------------------------------
  'settings.get': {
    params: [],
    returns: 'full preference record with defaults applied',
    auth: 'none',
    since: 4,
  },
  'settings.set': {
    params: ['patch'],
    returns: 'updated preference record — rejects unknown keys',
    auth: 'unlocked',
    since: 4,
  },

  // ---- Address book ----------------------------------------------------
  'contacts.list': {
    params: [],
    returns: '[{ address, label, createdAt }]',
    auth: 'none',
    since: 3,
  },
  'contacts.put': {
    params: ['address', 'label'],
    returns: 'the saved contact',
    auth: 'unlocked',
    since: 3,
  },
  'contacts.remove': {
    params: ['address'],
    returns: 'void',
    auth: 'unlocked',
    since: 3,
  },

  // ---- Network ---------------------------------------------------------
  'network.getActive': {
    params: [],
    returns: 'NetworkConfig',
    auth: 'none',
    since: 1,
  },
  'network.setActive': {
    params: ['networkId'],
    returns: 'the newly active NetworkConfig',
    auth: 'none',
    since: 1,
  },
  'network.list': {
    params: [],
    returns: 'array of NetworkConfig, each flagged { custom: boolean }',
    auth: 'none',
    since: 1,
  },
  'network.upsertCustom': {
    params: ['id', 'name', 'rpcUrl', 'explorerUrl', 'environment'],
    returns: 'the saved custom network — cannot shadow a built-in id',
    auth: 'unlocked',
    since: 4,
  },
  'network.removeCustom': {
    params: ['networkId'],
    returns: '{ removed } — switches to the default if it was active',
    auth: 'unlocked',
    since: 4,
  },
};

/** Push events the background may send to UI pages. */
export const EVENTS = {
  accountsChanged: 'Account list or active account changed',
  lockStateChanged: 'Wallet locked or unlocked',
  networkChanged: 'Active network changed',
  balanceChanged: 'A tracked balance was refreshed in the background',
  pendingTxChanged: 'A submitted transaction was tracked or settled',
};

/** Stable error codes. The UI may branch on these; messages are for humans only. */
export const ERROR_CODES = {
  INVALID_REQUEST: 'Malformed request envelope.',
  UNKNOWN_METHOD: 'Method is not in the contract.',
  METHOD_ERROR: 'Handler threw. Message is human-readable.',
  UNEXPECTED_ERROR: 'Service worker failure outside a handler.',
  WALLET_LOCKED: 'Requires an unlocked wallet.',
  AUTH_REQUIRED: 'Requires the master password.',
  AUTH_LOCKED_OUT: 'Too many failed attempts; retry later.',
};

/** @param {string} method */
export function isKnownMethod(method) {
  return Object.prototype.hasOwnProperty.call(METHODS, method);
}

/** @param {string} method */
export function getMethodSpec(method) {
  return isKnownMethod(method) ? METHODS[method] : null;
}

export function listMethodNames() {
  return Object.keys(METHODS);
}
