// The frozen API surface between the UI and the background service worker.
//
// THIS FILE IS THE CONTRACT. Rules:
//
//   1. APPEND-ONLY. Adding a method is always safe. Never rename a method, never change
//      an existing method's param names or return shape. To change behaviour, add a new
//      name (e.g. 'tx.send' -> 'tx.sendV2') and retire the old one only after zero
//      references remain in the UI.
//
//      Contract v5 is the explicit security exception: existing signing methods keep their
//      names but now use auth:'signing'. This is an intentional compatibility break so older
//      callers cannot keep signing from an unlocked-only session by using legacy names.
//
//      Contract v6 is the destructive-settings hardening break: reset now requires an explicit
//      confirmation parameter and requires a password when the wallet is unlocked; auto-lock
//      changes now require password re-authentication.
//
//      Contract v7 is the custom-network security break: `network.setActive` now refuses every id
//      that is not an enabled built-in network. A saved custom id fails with
//      CUSTOM_NETWORK_DISABLED, while a stored custom, disabled, or unknown active id self-heals to
//      the default before the RPC client is bound. Custom records can still be stored, listed, and
//      removed for compatibility; they can no longer become active.
//
//      Contract v8 is purely additive (no existing method changed): `token.transfer` adds a
//      signing-gated token send, and `token.getBalances` now returns real owned balances for
//      registry mints instead of the capability stub (`docs/BACKEND_GAPS.md` C1 resolved) —
//      same method, same params, strictly richer `balances` payload.
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
//   'signing'  - requires unlocked; also requires and verifies password unless the user has
//                explicitly disabled signing re-authentication in Settings
// `since` is the contract version in which the method first appeared.

// v9 appends tx.getHistoryFeed (cache-merged first history page, offline-honest). Append-only:
// no existing method's name, params, or auth changed.
//
// v10 appends tx.getDetail (lazy per-signature detail for the P2 transaction sheet). Also
// append-only. It is a READ, callable while locked like every other tx.* query, and it adds
// no new secret to the seam. Its return shape follows the established capability convention:
// unknown fields arrive as null with the absence stated, never as a plausible-looking number.
// v11 adds checked send methods. A reviewed From/Network must be pinned at the backend, not
// trusted to a best-effort event between two extension pages. Existing send methods remain.
export const CONTRACT_VERSION = 11;

export const METHODS = {
  // ---- System ------------------------------------------------------------
  'system.bootstrap': {
    params: [],
    returns: 'Full initial state: { hasVault, unlocked, account, accounts, keyrings, network, networkHealth, autoLockMinutes, lockout }',
    auth: 'none',
    since: 1,
  },
  'system.setAutoLock': {
    params: ['minutes', 'password'],
    returns: '{ autoLockMinutes }',
    auth: 'password',
    since: 1,
    authSince: 6,
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
  'system.diagnostics': {
    params: [],
    returns: '{ sessionPresent, sessionKeys, autoLockMinutes, lastActivityAt, msSinceActivity, '
      + 'wouldAutoLock, alarm } — lock-state facts for debugging spurious locks. No secrets.',
    auth: 'none',
    since: 4,
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
    params: ['confirmation', 'password'],
    returns: 'void — wipes every wallet key from this device; requires confirmation always and password when unlocked',
    auth: 'none',
    since: 1,
    hardeningSince: 6,
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
    params: ['amountUnits', 'password'],
    returns: '{ signature, blockHeight }',
    auth: 'signing',
    since: 1,
    authSince: 5,
  },
  'tx.send': {
    params: ['toAddress', 'amountUnits', 'password'],
    returns: '{ signature, blockHeight }',
    auth: 'signing',
    since: 1,
    authSince: 5,
  },
  'tx.listHistory': {
    params: ['address', 'pageSize', 'limit', 'cursor'],
    returns: 'array (positional form) or { entries, nextCursor, hasMore } (options form)',
    auth: 'none',
    since: 1,
  },
  'tx.getHistoryFeed': {
    params: ['address'],
    returns: '{ entries, nextCursor, synced } — cache-merged first page; synced=false when served from cache offline',
    auth: 'none',
    since: 9,
  },
  'tx.getDetail': {
    params: ['signature', 'address'],
    returns: '{ supported, signature, slot, success, kind, amount, counterparty, programAddress, '
      + 'feeDeclaredUnits, feeCharged: false, nonce, blockTimeMs } — lazy per-signature detail for '
      + 'the transaction sheet. feeDeclaredUnits is the HEADER-DECLARED fee, not an amount debited '
      + '(Thru carries no charged-fee field); blockTimeMs is the containing block\'s time and is '
      + 'null when the node did not send one. Unknown => null, never a guess. See docs/archive/TX_DETAIL_SPIKE.md.',
    auth: 'none',
    since: 10,
  },
  'tx.checkHealth': {
    params: [],
    returns: '{ status, latencyMs, ... }',
    auth: 'none',
    since: 1,
  },
  'tx.autoCreateAccount': {
    params: ['password'],
    returns: 'result of the on-chain account creation',
    auth: 'signing',
    since: 1,
    authSince: 5,
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
    params: ['mintSeed', 'name', 'symbol', 'decimals', 'description', 'imageUrl', 'password'],
    returns: 'deployment result including the mint address',
    auth: 'signing',
    since: 1,
    authSince: 5,
  },
  'token.list': {
    params: [],
    returns: 'array of locally-recorded deployed token records',
    auth: 'none',
    since: 1,
  },
  'token.deriveAddress': {
    params: ['mintSeed', 'mintAuthorityAddress'],
    returns: 'derived mint address string. mintSeed must be 64 hex characters (32 bytes); the '
      + 'authority defaults to the active account because derivation is over '
      + '[authorityBytes, seedBytes].',
    auth: 'none',
    since: 1,
  },
  'token.deriveTokenAccount': {
    params: ['ownerAddress', 'mintAddress'],
    returns: 'address of the token account holding that owner\'s balance of that mint. Thru keeps '
      + 'wallet accounts separate from per-mint token accounts.',
    auth: 'none',
    since: 4,
  },
  'token.generateSeed': {
    params: [],
    returns: '64-character lowercase hex mint seed (32 bytes)',
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
    returns: '{ supported, networkId, balances: [{ mintAddress, symbol, name, decimals, imageUrl, hidden, '
      + 'source, tokenAccount, tokenAccountExists, amountUnits, error }], reason } — since contract v8 '
      + 'these are REAL owned balances for registry mints (official Token Program reads). '
      + 'amountUnits is a base-unit string or null; null with tokenAccountExists:false is a proven '
      + 'zero, null with error:true is an unknown (including unverified mint decimals). Before v8 '
      + 'this returned { supported: false }. '
      + 'See docs/BACKEND_GAPS.md C1.',
    auth: 'none',
    since: 4,
  },
  'token.transfer': {
    params: ['mintAddress', 'toAddress', 'amountUnits', 'password'],
    returns: '{ signature, blockHeight, recipientTokenAccountCreated, initSignature } — sends raw '
      + 'units of the MINT (never THRU) from the active account\'s token account, initializing '
      + 'the recipient\'s token account first when missing. Errors carry stable codes: '
      + 'MINT_NOT_FOUND, TOKEN_ACCOUNT_MISSING, TOKEN_FROZEN, TOKEN_BALANCE_TOO_LOW, '
      + 'TOKEN_INIT_FAILED, DUPLICATE_SUBMISSION.',
    auth: 'signing',
    since: 8,
    authSince: 8,
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
    returns: 'updated preference record — rejects unknown and security-sensitive keys',
    auth: 'unlocked',
    since: 4,
  },
  'settings.setSecurity': {
    params: ['patch', 'password'],
    returns: 'updated preference record for security-sensitive settings; password-gated',
    auth: 'password',
    since: 5,
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
    // Contract v7: enabled built-in ids only. A saved custom id fails permanently with
    // CUSTOM_NETWORK_DISABLED; a declared-but-disabled or unknown id fails as unknown.
    returns: 'the newly active NetworkConfig (enabled built-in networks only since v7)',
    auth: 'none',
    since: 1,
  },
  'network.list': {
    params: [],
    returns: 'array of NetworkConfig, each flagged { custom: boolean, selectable: boolean }; '
      + 'a non-selectable entry carries unselectableReason',
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
    // Since v7 a custom record can never be active, so removal has nothing to switch away from.
    returns: '{ removed }',
    auth: 'unlocked',
    since: 4,
  },
  // ---- Contract v11: additive reviewed-context signing -----------------
  'tx.sendChecked': {
    params: ['toAddress', 'amountUnits', 'fromAddress', 'networkId', 'password'],
    returns: '{ signature, blockHeight } — same transfer as tx.send; refuses with '
      + 'SEND_CONTEXT_CHANGED if the active account/network differs from Review',
    auth: 'signing',
    since: 11,
  },
  'token.transferChecked': {
    params: ['mintAddress', 'toAddress', 'amountUnits', 'fromAddress', 'networkId', 'password'],
    returns: '{ signature, blockHeight, recipientTokenAccountCreated, initSignature } — same '
      + 'token transfer as token.transfer; refuses with SEND_CONTEXT_CHANGED on a stale Review',
    auth: 'signing',
    since: 11,
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
  // Contract v7. Permanent policy refusal from network.setActive for a saved custom id.
  CUSTOM_NETWORK_DISABLED: 'Custom networks cannot be activated; choose a built-in network.',
  SEND_CONTEXT_CHANGED: 'Sending account or network no longer matches the reviewed transfer.',
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
