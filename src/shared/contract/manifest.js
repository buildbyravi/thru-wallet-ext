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
//      Contract v14 is purely additive: `token.readMint` reads a mint account straight from
//      the chain so "Add custom token" can verify a pasted contract address and pre-fill the
//      chain's own symbol/decimals instead of trusting free-typed metadata (which made the
//      custom token unusable — send/receive burn real base units of the actual decimals).
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
// v12 appends a storage-only history read and an explicitly creation-bound / just-in-time
// registration method. tx.registerAccount is the deliberate exception to signing re-auth:
// it is unlocked-only, can sign ONLY for an owned address, declares fee 0, and must be called
// from account creation or after the user selects an unregistered own Send recipient. It is
// still a signed, on-chain transaction; no periodic signing loop is authorized.
//
// v13 modifies tx.claimFaucet (the first modified method since the v5 signing-auth break,
// same precedent: a behavior break gets a version, not silence). Auth drops from 'signing'
// to 'unlocked' and the vestigial password param leaves the declaration: claiming testnet
// faucet funds is an incoming-credit action, and demanding signing re-authentication for it
// bought nothing. Old callers that still SEND a password keep working — the param is
// ignored, not rejected.
//
// v15 appends tx.checkDuplicate to detect repeat transfers within 30s or while in flight,
// and supports optional allowDuplicate on send methods for user-confirmed repeat transfers.
//
// v16 retires the legacy tx.send and token.transfer mutation endpoints after every shipped UI
// caller migrated to their checked counterparts. Keeping callable methods that omit the reviewed
// source account/network created a weaker alternate signing path.
//
// v17 and v18 are the M0 contract-first DeFi drop (docs/defi/, docs/DECISIONS.md D-012).
// Nothing existing changed: both versions are pure appends behind build-time feature flags
// that are false in this build (src/shared/flags.js, DEFI-02: no URL or storage override).
//   v17 appends the READ + LOCAL surface (21 R + 8 L = 29 methods).
//   v18 appends the PREPARE + EXECUTE surface (13 P + 1 X = 14 methods).
// Of all DeFi methods, ONLY intent.submit carries auth:'signing' (DEFI-03); every other
// prepare is at most 'unlocked', and public discovery/quote reads are callable while locked so
// a locked wallet can render capability-honest DeFi screens. Unsupported capability states and
// gate-off outcomes are first-class wire values ({ supported:false, reason } or the declared
// FEATURE_DISABLED envelope) — never fake data. The machine-readable sibling schema lives in
// ./defi-schema.js and is kept coherent with this file by test/test-defi-m0.mjs.
export const CONTRACT_VERSION = 19;

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
  // ---- Name service (contract v19, 2026-10-08). Reads are always-on truth asks against
  // the system name program (self-derived accounts, official CLI-recovered layouts — provenance
  // in src/lib/name-service.js); writes are gated behind FLAGS.NAME_SERVICE (build-time false)
  // until the live probe verifies the recovered formats on the running chain, and can only
  // ever act under a parent the signer OWNS (self-signing invariant: no sponsors, ever).
  'name.lookup': {
    params: ['name', 'rootAddress', 'networkId'],
    returns: '{ chain: string[], leaf: { address, exists, domain? }, parsed reads live from the chain }',
    auth: 'none',
    since: 19,
  },
  'name.checkAvailability': {
    params: ['name', 'parentAddress', 'networkId'],
    returns: '{ address, exists } — derived domain address and whether it is taken',
    auth: 'none',
    since: 19,
  },
  'name.initRoot': {
    params: ['name', 'networkId'],
    returns: '{ signature, rootAddress } — new root owned by the signer (gate: NAME_SERVICE)',
    auth: 'unlocked',
    since: 19,
  },
  'name.register': {
    params: ['name', 'parentAddress', 'networkId'],
    returns: '{ signature, domainAddress } — register a name under a parent root/domain the signer OWNS (gate: NAME_SERVICE)',
    auth: 'unlocked',
    since: 19,
  },
  'name.setRecord': {
    params: ['name', 'rootAddress', 'key', 'value', 'networkId'],
    returns: '{ signature } — append a key/value record to a domain the signer owns (gate: NAME_SERVICE)',
    auth: 'unlocked',
    since: 19,
  },
  'tx.claimFaucet': {
    params: ['amountUnits'],
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
  'tx.getHistoryFeed': {
    params: ['address'],
    returns: '{ entries, nextCursor, synced } — cache-merged first page; synced=false when served from cache offline',
    auth: 'none',
    since: 9,
  },
  'tx.getCachedHistory': {
    params: ['address'],
    returns: '{ address, networkId, entries, nextCursor, updatedAt } — storage-only, per-network/address, no RPC',
    auth: 'none',
    since: 12,
  },
  'tx.registerAccount': {
    params: ['address'],
    returns: '{ address, networkId, exists, created, signature } — self-register this owned address only',
    auth: 'unlocked',
    since: 12,
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
    returns: '{ supported, networkId, source, feeUnits, reserveUnits, reason } — per-network config; unsupported (null fee) where unmeasured, see docs/BACKEND_GAPS.md C2',
    auth: 'none',
    since: 4,
  },
  'tx.simulate': {
    params: ['toAddress', 'amountUnits'],
    returns: '{ supported: false, changes: null, reason } — UNVERIFIED on Thru, see docs/BACKEND_GAPS.md C3',
    auth: 'none',
    since: 4,
  },
  'tx.checkDuplicate': {
    params: ['toAddress', 'amountUnits', 'mintAddress', 'fromAddress'],
    returns: '{ isDuplicate, isPending, elapsedMs, signature } — detects duplicate/repeated transfers within 30s or while in flight',
    auth: 'none',
    since: 15,
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
  'token.readMint': {
    params: ['mintAddress'],
    returns: '{ exists, decimals, ticker, creator, mintAuthority, freezeAuthority, hasFreezeAuthority, '
      + 'supply } — the chain\'s own view of a mint account (or exists:false). supply is a '
      + 'base-unit string or null (BigInt never crosses the message port). '
      + 'UIs call this before token.import so a pasted contract address is verified and the '
      + 'symbol/decimals are read from the chain, not typed in.',
    auth: 'none',
    since: 14,
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
    params: ['toAddress', 'amountUnits', 'fromAddress', 'networkId', 'password', 'allowDuplicate'],
    returns: '{ signature, blockHeight } — same transfer as tx.send; refuses with '
      + 'SEND_CONTEXT_CHANGED if the active account/network differs from Review',
    auth: 'signing',
    since: 11,
  },
  'token.transferChecked': {
    params: ['mintAddress', 'toAddress', 'amountUnits', 'fromAddress', 'networkId', 'password', 'allowDuplicate'],
    returns: '{ signature, blockHeight, recipientTokenAccountCreated, initSignature } — same '
      + 'token transfer as token.transfer; refuses with SEND_CONTEXT_CHANGED on a stale Review',
    auth: 'signing',
    since: 11,
  },

  // ---- Contract v17: DeFi READ surface (M0) — callable while locked -------
  // Every READ returns current truth or an explicit unsupported state, never fabricated data.
  // Discovery methods (program.*/feed.*) work in EVERY build so the frontend can render
  // capability-honest screens; capability-gated reads answer { supported:false, reason }.
  'program.capabilities': {
    params: ['networkId'],
    returns: '{ networkId, programFacts, methodCapabilities, featureCapabilities, limits } — '
      + 'program/capability facts (evidence-backed values or explicit nulls), never guesses',
    auth: 'none',
    since: 17,
  },
  'program.list': {
    params: ['networkId'],
    returns: '{ programs: [ProgramRecord] } — known programs incl. unverified registrations',
    auth: 'none',
    since: 17,
  },
  'feed.status': {
    params: ['networkId'],
    returns: '{ feeds: [FeedStatus] } — empty when no feed publisher is verified (never a fake feed)',
    auth: 'none',
    since: 17,
  },
  'feed.lookup': {
    params: ['ids'],
    returns: '{ feeds: { [feedId]: SignedFeedInfo|null } } — null means unknown, never guessed',
    auth: 'none',
    since: 17,
  },
  'market.assetGet': {
    params: ['assetId'],
    returns: 'AssetDetail for a stored asset id, or { supported:false, reason }',
    auth: 'none',
    since: 17,
  },
  'market.assetSearch': {
    params: ['query', 'limit'],
    returns: '{ hits: [MarketListRow] } — an empty hit list is honest, never padded with junk',
    auth: 'none',
    since: 17,
  },
  'market.snapshot': {
    params: ['assetIds'],
    returns: '{ snapshots: { [assetId]: Snapshot|null } } — best-available values or null, never fabricated',
    auth: 'none',
    since: 17,
  },
  'market.candles': {
    params: ['assetId', 'poolId', 'interval', 'range'],
    returns: 'CandleSet { interval, range, candles } or { supported:false, reason: NO_INDEXER… }',
    auth: 'none',
    since: 17,
  },
  'market.trades': {
    params: ['assetId', 'poolId', 'cursor', 'limit'],
    returns: 'Page<TradeEvent> or { supported:false, reason }',
    auth: 'none',
    since: 17,
  },
  'market.holders': {
    params: ['assetId', 'cursor', 'limit'],
    returns: 'Page<HolderRow> or { supported:false, reason }',
    auth: 'none',
    since: 17,
  },
  'risk.assetAssess': {
    params: ['assetId'],
    returns: 'RiskReport { facts, warnings, maxSeverity, listStatus, freshness } — facts only, '
      + 'warnings derived, no advice, no scores',
    auth: 'none',
    since: 17,
  },
  'launchpad.list': {
    params: ['networkId', 'sort', 'cursor', 'limit'],
    returns: 'Page<LaunchCard> { items, nextCursor, updatedAt, source } or { supported:false, reason }',
    auth: 'none',
    since: 17,
  },
  'launchpad.get': {
    params: ['launchId'],
    returns: 'LaunchDetail { header, assets, curve, pool, trades, distribution, links, yourActions, '
      + 'feedState } or { supported:false, reason }',
    auth: 'none',
    since: 17,
  },
  'launchpad.templates': {
    params: [],
    returns: '{ templates: [LaunchTemplate] } — the available launch models; empty until the mint '
      + 'path is verified (TOKEN_PATH_UNVERIFIED)',
    auth: 'none',
    since: 17,
  },
  'launchpad.listMine': {
    params: ['address'],
    returns: '{ launches: [LaunchCard] } — own launches discovered from chain, once verified',
    auth: 'unlocked',
    since: 17,
  },
  'launchpad.validateDraft': {
    params: ['networkId', 'draft'],
    returns: 'DraftValidation { identity, curve, strands, errors, warnings } — offline rules plus '
      + 'blocking capability strands (TOKEN_PATH_UNVERIFIED, …)',
    auth: 'none',
    since: 17,
  },
  'dex.listPools': {
    params: ['networkId', 'assetId', 'cursor', 'limit'],
    returns: 'Page<PoolSummary> or { supported:false, reason: PROGRAM_NOT_VERIFIED… }',
    auth: 'none',
    since: 17,
  },
  'dex.getPool': {
    params: ['poolId'],
    returns: 'PoolDetail { header, assets, reserves, fee, volume, apxe, positions, charts, risk, '
      + 'oracle, feedState } or { supported:false, reason }',
    auth: 'none',
    since: 17,
  },
  'dex.positions': {
    params: ['address', 'networkId'],
    returns: '{ positions: [DexPosition] } — own liquidity positions once pool reads are verified',
    auth: 'unlocked',
    since: 17,
  },
  'intent.list': {
    params: ['status'],
    returns: '{ intents: [Intent] } — lifecycle state from the single intent store',
    auth: 'unlocked',
    since: 17,
  },
  'intent.get': {
    params: ['intentId'],
    returns: 'Intent { intentId, kind, status, plan, fee, preparedAt, updatedAt, expiresAt, '
      + 'unsignedTxs, context, … }',
    auth: 'unlocked',
    since: 17,
  },

  // ---- Contract v17: DeFi LOCAL surface (M0) — non-secret, network-scoped -
  'launchpad.draftList': {
    params: [],
    returns: '{ drafts: [LaunchDraft] } — saved launch drafts',
    auth: 'unlocked',
    since: 17,
  },
  'launchpad.draftGet': {
    params: ['draftId'],
    returns: '{ draft: LaunchDraft } — one saved draft and its last validation state',
    auth: 'unlocked',
    since: 17,
  },
  'launchpad.draftSave': {
    params: ['draftId', 'draft'],
    returns: '{ draftId } — create or overwrite a saved draft',
    auth: 'unlocked',
    since: 17,
  },
  'launchpad.draftDelete': {
    params: ['draftId'],
    returns: '{ deleted } — permanently delete a draft',
    auth: 'unlocked',
    since: 17,
  },
  'market.watchlistGet': {
    params: [],
    returns: '{ items: [assetId] } — the watched-assets list',
    auth: 'unlocked',
    since: 17,
  },
  'market.watchlistAdd': {
    params: ['assetId'],
    returns: '{ items } — updated list; ALREADY_EXISTS on a duplicate add',
    auth: 'unlocked',
    since: 17,
  },
  'market.watchlistRemove': {
    params: ['assetId'],
    returns: '{ items } — updated list; a missing id is a no-op success, not an error',
    auth: 'unlocked',
    since: 17,
  },
  'desktop.open': {
    params: ['page', 'args'],
    returns: '{ enabled, reason?, page? } — open or answer whether a Desktop lane exists; '
      + '{ enabled:false, reason } while the Desktop surface is not part of this build',
    auth: 'none',
    since: 17,
  },

  // ---- Contract v18: DeFi PREPARE surface (M0) ----------------------------
  // PREPARE builds a Quote, a Review, or a prepared Intent. NOTHING in the P group signs or
  // submits. Gate-off/capability-off answers are { supported:false, reason } for quote-shaped
  // reads and the FEATURE_DISABLED envelope for everything else.
  'intent.prepareSend': {
    params: ['address', 'toAddress', 'amountUnits', 'clientRequestId'],
    returns: 'Review { reviewAscii, facts, model, policy, simulation, assetChanges, feePlan, '
      + 'bindingHash, clientRequestId, acknowledgements } — render-ready, no signing',
    auth: 'unlocked',
    since: 18,
  },
  'dex.quote': {
    params: ['address', 'poolId', 'inputAssetId', 'outputAssetId', 'inputAmountUnits', 'slippageBps'],
    returns: 'Quote { poolId, input, output, rate, priceImpactBps, feeTotal, quoteId, expiresAt } '
      + 'or { supported:false, reason: PROGRAM_NOT_VERIFIED… } — public read, callable while locked',
    auth: 'none',
    since: 18,
  },
  'dex.prepareSwap': {
    params: ['quoteId', 'clientRequestId'],
    returns: 'Prepared Intent { intentId, kind, status, plan, fee, preparedAt, expiresAt, '
      + 'unsignedTxs, context } — atomic-build requirement per Q1; QUOTE_EXPIRED past quote ttl',
    auth: 'unlocked',
    since: 18,
  },
  'dex.quoteLiquidity': {
    params: ['address', 'poolId', 'mode', 'amounts', 'slippageBps'],
    returns: 'PoolQuote { poolId, mode, sharesEst, minShares, details, quoteId, expiresAt } or '
      + '{ supported:false, reason } — exit-before-entry (DEFI R2) means remove quotes verify first',
    auth: 'none',
    since: 18,
  },
  'dex.prepareLiquidity': {
    params: ['quoteId', 'clientRequestId'],
    returns: 'Prepared Intent for add/remove liquidity; add-liquidity stays disabled until '
      + 'remove-liquidity is verified live (DEFI R2)',
    auth: 'unlocked',
    since: 18,
  },
  'launchpad.uploadImage': {
    params: ['address', 'networkId', 'payload'],
    returns: '{ status, url, sha256 } — status: ok|failed|pending; only a returned, pinned '
      + 'image is valid (UPLOAD_REJECTED on bad type/size)',
    auth: 'unlocked',
    since: 18,
  },
  'launchpad.prepareCreate': {
    params: ['address', 'networkId', 'draft', 'clientRequestId'],
    returns: 'Prepared Intent for a launch creation; launchModel drives atomicity '
      + '(none|pool|curve); mint-only is the first model built (DEFI B8)',
    auth: 'unlocked',
    since: 18,
  },
  'launchpad.prepareMigrate': {
    params: ['address', 'launchId', 'clientRequestId'],
    returns: 'Prepared Intent for a curve->pool migration, DESTINATION_POOL_PRE_EXISTING-aware',
    auth: 'unlocked',
    since: 18,
  },
  'launchpad.prepareClaim': {
    params: ['address', 'launchId', 'clientRequestId'],
    returns: 'Prepared Intent for claiming creator fees; NOTHING_TO_CLAIM when there is nothing',
    auth: 'unlocked',
    since: 18,
  },
  'intent.rePrepare': {
    params: ['intentId'],
    returns: 'Review — a fresh preparation of the same intent (new bindingHash and clientRequestId)',
    auth: 'unlocked',
    since: 18,
  },
  'intent.resume': {
    params: ['intentId'],
    returns: '{ intentId, status } — resume a prepared intent that still matches the current '
      + 'context; CONTEXT_CHANGED otherwise',
    auth: 'unlocked',
    since: 18,
  },
  'intent.discard': {
    params: ['intentId'],
    returns: '{ intentId, status } — discard a prepared or failed intent',
    auth: 'unlocked',
    since: 18,
  },
  'intent.stopWaiting': {
    params: ['intentId'],
    returns: '{ intentId, status } — stop waiting on a stuck intent; fails while tx are in flight '
      + '(NOT_READY)',
    auth: 'unlocked',
    since: 18,
  },

  // ---- Contract v18: DeFi EXECUTE surface (M0) -----------------------------
  // The ONLY DeFi signing method. Signing re-authentication follows the same policy as the
  // wallet-core signing methods (session-only default, password-gated opt-in).
  'intent.submit': {
    params: ['intentId', 'bindingHash', 'acknowledgements', 'password'],
    returns: 'SubmissionResult { submitId, state, waitingReason, signature } — bindingHash mismatch '
      + 'refuses with BINDING_MISMATCH; USER_REJECTED never resets state by mistake',
    auth: 'signing',
    since: 18,
  },
};

/** Push events the background may send to UI pages. */
export const EVENTS = {
  accountsChanged: 'Account list or active account changed',
  lockStateChanged: 'Wallet locked or unlocked',
  networkChanged: 'Active network changed',
  balanceChanged: 'A tracked balance was refreshed in the background',
  pendingTxChanged: 'A submitted transaction was tracked or settled',
  // DeFi surface (v17/v18). Emitted only when the respective feature exists; none fire at M0.
  intentChanged: 'An intent changed lifecycle state (prepared, waiting, settled, failed, expired, rejected)',
  capabilitiesChanged: 'The capability matrix changed (network switch, chain reset, registry or feed update)',
  feedChanged: 'A subscribed signed feed updated, went stale, or failed quorum',
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

  // ---- Contract v17/v18: DeFi surface (M0) ----------------------------------
  // Stable codes for the DeFi lifecycle. Every one is a first-class state the UI may branch
  // on; none silently maps to success.
  FEATURE_DISABLED: 'Feature is not part of this build (flag-gated off at build time).',
  UNSUPPORTED: 'Capability is unavailable; carries a structured reason on the entity.',
  INVALID_INPUT: 'Request parameters failed schema validation before any service ran.',
  ALREADY_EXISTS: 'A create would collide; idempotent retry returns the existing entity.',
  ACCOUNT_MISSING: 'Required account does not exist on-chain yet.',
  INSUFFICIENT_BALANCE: 'Available balance is below the required amount plus fees.',
  INSUFFICIENT_FEE_RESERVE: 'Fee reserve (rent/fees) is below protocol requirements.',
  USER_REJECTED: 'User rejected a review or stopped a flow. Never resets state by mistake.',
  CONTEXT_CHANGED: 'Active account/network/context changed since preparation.',
  QUOTE_EXPIRED: 'Quote TTL elapsed; re-quote before preparing or submitting.',
  BINDING_MISMATCH: 'Review bindingHash no longer matches current preparation.',
  INTENT_EXPIRED: 'Prepared intent expired; prepare fresh before resigning.',
  INTENT_LOCKED: 'A signer or cancellation is already in progress for this intent.',
  NONCE_CONFLICT: 'Nonce consumed by another in-flight transaction.',
  SIMULATION_FAILED: 'Simulation failed; submission is blocked by policy.',
  PROGRAM_ERROR: 'On-chain program returned a protocol error.',
  SLIPPAGE_EXCEEDED: 'Final bounds exceeded minReceived/slippage policy.',
  TX_DROPPED: 'Transaction never landed; safe to resume or reprepare with a fresh nonce.',
  TX_REPLACED: 'Transaction replaced by policy or another fee. Never abandoned silently.',
  NOT_READY: 'Requested action is invalid while the entity is in its current state.',
  NOT_AUTHORIZED: 'Signer is not authorized for this action (policy).',
  NOTHING_TO_CLAIM: 'Nothing is available to claim; never reports claimable garbage.',
  UPLOAD_REJECTED: 'Binary upload rejected: wrong type, oversize, or mismatched reference.',
  RATE_LIMITED: 'Caller exceeded a local rate or quota.',
  RPC_UNAVAILABLE: 'RPC is unreachable; the app remains offline-honest.',
  UPSTREAM_UNAVAILABLE: 'Required upstream (indexer/feed/oracle) is unavailable.',
  VERSION_MISMATCH: 'Capability matrix or registry is older than required (fail closed).',
  INTERNAL: 'Unexpected internal error; logged, never silently mapped to success.',
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
