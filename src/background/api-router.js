// Central API router in the background service worker.
//
// Every UI request passes through here. The router does four things before a handler runs:
//
//   1. Validates the method against src/shared/contract/manifest.js. A method that is not
//      in the contract is rejected, which means the manifest is a real allowlist and not
//      just documentation.
//   2. Enforces the declared `auth` level, so a handler cannot accidentally be reachable
//      while locked or without a password.
//   3. Stamps activity for inactivity-based auto-lock.
//   4. Normalizes thrown errors into a stable { code, message, retryable } envelope.
//
// The method table is built with Object.create(null) and looked up with hasOwnProperty, so
// bridge.send('constructor') resolves to nothing instead of Object.prototype.constructor.

import * as walletService from './services/wallet-service.js';
import * as keyringService from './services/keyring-service.js';
import * as accountService from './services/account-service.js';
import * as registrationService from './services/registration-service.js';
import * as txService from './services/tx-service.js';
import * as tokenService from './services/token-service.js';
import * as networkService from './services/network-service.js';
import * as contactsService from './services/contacts-service.js';
import * as systemService from './services/system-service.js';
import * as preferencesService from './services/preferences-service.js';
import * as balanceService from './services/balance-service.js';
import * as pendingTxService from './services/pending-tx-service.js';
import * as historyService from './services/history-service.js';
import * as programService from './services/program-service.js';
import * as feedService from './services/feed-service.js';
import * as marketService from './services/market-service.js';
import * as riskService from './services/risk-service.js';
import * as intentService from './services/intent-service.js';
import * as nameService from './services/name-service.js';
import * as primaryNameService from './services/primary-name-service.js';
import * as desktopService from './services/desktop-service.js';
import { dexHandlers } from './features/dex/dex-handlers.js';
import { launchpadHandlers } from './features/launchpad/launchpad-handlers.js';
import { isKnownMethod, getMethodSpec, CONTRACT_VERSION } from '../shared/contract/manifest.js';
import { isDefiMethod, validateDefiParams } from '../shared/contract/defi-schema.js';
import { beginSigningOperation } from './services/signing-guard.js';

// Every operation in this set can build/sign/submit a transaction. The guard starts at the
// application boundary, before a handler reads the active account/network, and prevents a second
// extension page from rebinding the singleton Thru adapter until the operation settles.
// intent.submit is the ONLY DeFi method in this class (DEFI-03): prepares build transactions
// but never sign, so they stay ordinary unlocked calls.
const TRANSACTION_METHODS = new Set([
  'tx.claimFaucet', 'tx.sendChecked', 'tx.autoCreateAccount', 'tx.registerAccount',
  'token.deploy', 'token.transferChecked',
  'intent.submit',
]);

// Methods the UI polls on its own schedule (background sync of pending tx state). A call to
// one of these is NOT user activity and must not refresh the auto-lock idle stamp — see the
// stamp comment in handleApiRequest. The DeFi READ group is registered here too (S13): every
// read a DeFi screen would poll is a sync read, and none of them may keep a session alive.
const SYNC_READ_METHODS = new Set([
  'tx.getPending', 'tx.reconcilePending',
  'program.capabilities', 'program.list',
  'feed.status', 'feed.lookup',
  'market.assetGet', 'market.assetSearch', 'market.snapshot',
  'market.candles', 'market.trades', 'market.holders',
  'risk.assetAssess',
  'launchpad.list', 'launchpad.get', 'launchpad.templates', 'launchpad.listMine',
  'dex.listPools', 'dex.getPool', 'dex.positions',
  'intent.list', 'intent.get',
  'name.lookup', 'name.checkAvailability',
]);

const handlers = Object.assign(Object.create(null), {
  // ---- System ------------------------------------------------------------
  //
  // bootstrap must never block first paint on a live RPC. It returns vault/account state and
  // CACHED balances synchronously, kicks off health and balance refreshes without awaiting
  // them, and lets the UI correct itself when the balanceChanged event arrives. The previous
  // implementation awaited checkNetworkHealth(), so the popup could not render until the
  // network answered.
  'system.bootstrap': async () => {
    const hasVault = await walletService.hasVault();
    const unlocked = hasVault ? await walletService.isUnlocked() : false;
    let account = null;
    let accounts = [];
    let keyrings = [];
    if (unlocked) {
      try {
        account = await accountService.getActiveAccount();
        accounts = await accountService.listAccounts({ withBalances: true });
        keyrings = await keyringService.listKeyrings();
      } catch {
        // session might be empty or locked mid-flight
      }
    }
    const [network, autoLockMinutes, lockout, preferences, pending] = await Promise.all([
      networkService.getActiveNetworkConfig(),
      systemService.getAutoLockMinutes(),
      walletService.getLockoutState(),
      preferencesService.getPreferences(),
      pendingTxService.listPending(),
    ]);
    // Fire and forget: results arrive via balanceChanged / pendingTxChanged events.
    if (accounts.length) {
      balanceService.getBalances(accounts.map((a) => a.address)).catch(() => {});
    }
    if (pending.length) {
      pendingTxService.reconcile().catch(() => {});
    }

    return {
      contractVersion: CONTRACT_VERSION,
      hasVault,
      unlocked,
      account,
      accounts,
      keyrings,
      network: networkService.toPublicNetwork(network),
      autoLockMinutes,
      lockout,
      preferences,
      pending,
      // networkHealth is intentionally absent: call tx.checkHealth from the UI after paint.
    };
  },
  'system.setAutoLock': ({ minutes }) => systemService.setAutoLockMinutes(minutes),
  'system.getAutoLock': () => systemService.getAutoLockMinutes(),
  'system.ping': () => systemService.ping(),
  'system.diagnostics': () => systemService.diagnostics(),

  // ---- Wallet lifecycle --------------------------------------------------
  'wallet.hasVault': () => walletService.hasVault(),
  'wallet.isUnlocked': () => walletService.isUnlocked(),
  'wallet.create': ({ password }) => walletService.createVault(password),
  'wallet.importMnemonic': ({ mnemonic, password }) => walletService.importMnemonicVault(mnemonic, password),
  'wallet.importPrivateKey': ({ privateKeyHex, password }) => walletService.importPrivateKeyVault(privateKeyHex, password),
  'wallet.unlock': ({ password }) => walletService.unlock(password),
  'wallet.lock': () => walletService.lock(),
  'wallet.reset': ({ confirmation, password }) => walletService.resetWallet({ confirmation, password }),
  'wallet.hasSeed': () => walletService.hasSeed(),
  'wallet.exportSecret': ({ ref, password }) => walletService.exportSecret(ref, password),
  'wallet.exportPrivateKey': ({ ref, password }) => walletService.exportPrivateKey(ref, password),
  'wallet.verifyPassword': ({ password }) => walletService.verifyPassword(password),
  'wallet.getLockoutState': () => walletService.getLockoutState(),
  'wallet.removeLegacyBackup': ({ password }) => walletService.removeLegacyBackup(password),

  // ---- Keyrings (multi-seed) --------------------------------------------
  'keyring.list': () => keyringService.listKeyrings(),
  'keyring.addSeed': ({ mnemonic, password, label }) => keyringService.addSeedKeyring(mnemonic, password, label),
  'keyring.createSeed': ({ password, label }) => keyringService.createSeedKeyring(password, label),
  'keyring.addPrivateKey': ({ privateKeyHex, password, label }) => keyringService.addPrivateKeyKeyring(privateKeyHex, password, label),
  'keyring.rename': ({ keyringId, label, password }) => keyringService.renameKeyring(keyringId, label, password),
  'keyring.remove': ({ keyringId, password }) => keyringService.removeKeyring(keyringId, password),
  'keyring.setBackedUp': ({ keyringId, backedUp }) => keyringService.setBackedUp(keyringId, backedUp),

  // ---- Accounts ---------------------------------------------------------
  'account.getActive': () => accountService.getActiveAccount(),
  'account.getActiveRef': () => accountService.getActiveRef(),
  'account.list': ({ includeHidden, withBalances } = {}) => accountService.listAccounts({ includeHidden, withBalances }),
  'account.switch': ({ ref }) => accountService.switchActiveAccount(ref),
  'account.addHd': ({ keyringId } = {}) => accountService.addHdAccount(keyringId),
  'account.addImported': ({ privateKeyHex, password, label }) => accountService.addImportedKey(privateKeyHex, password, label),
  'account.setLabel': ({ address, label }) => accountService.setAccountLabel(address, label),
  'account.getLabels': () => accountService.getAccountLabels(),
  'account.previewHd': ({ keyringId, start, count, withBalances }) => accountService.previewHdAccounts({ keyringId, start, count, withBalances }),
  'account.addHdBatch': ({ keyringId, indices }) => accountService.addHdAccounts({ keyringId, indices }),
  'account.removeHd': ({ ref }) => accountService.removeHdAccount({ ref }),
  'account.setHidden': ({ address, hidden }) => preferencesService.setAccountHidden(address, hidden),
  'account.setPinned': ({ address, pinned }) => preferencesService.setAccountPinned(address, pinned),
  'account.setOrder': ({ addresses }) => preferencesService.setAccountOrder(addresses),

  // ---- Transactions and RPC --------------------------------------------
  'tx.getAccountInfo': ({ address }) => txService.getAccountInfo(address),
  'tx.claimFaucet': ({ amountUnits }) => txService.claimFaucet(amountUnits),
  // ---- Name service (v19). Reads are always-on; writes are gated in the service layer
  // (FLAGS.NAME_SERVICE + live-probe verification) and can only ever act under a parent the
  // signer owns — the self-signing invariant rules out sponsored/foreign-authority flows.
  'name.lookup': (params) => nameService.lookupName(params),
  'name.checkAvailability': (params) => nameService.checkAvailability(params),
  'name.initRoot': (params) => nameService.initRoot(params),
  'name.register': (params) => nameService.registerName(params),
  'name.setRecord': (params) => nameService.setRecord(params),
  // v21 primary-name UX slice: get re-verifies the stored record against the chain (one live
  // read per call; a broken ownership record is dropped honestly, an unreadable node keeps the
  // last verified record rather than flapping it).
  'name.getPrimary': () => primaryNameService.verifyPrimaryName({}),
  'name.linkPrimary': (params) => primaryNameService.linkPrimaryName(params),
  'name.unlinkPrimary': () => primaryNameService.unlinkPrimaryName({}),
  'tx.sendChecked': (params) => txService.sendTransferChecked(params),
  'tx.listHistory': ({ address, pageSize, limit, cursor } = {}) => (
    limit !== undefined || cursor !== undefined
      ? txService.listHistory(address, { limit, cursor })
      : txService.listHistory(address, pageSize)
  ),
  'tx.getDetail': ({ signature, address } = {}) => txService.getTransactionDetail(signature, address),
  'tx.checkHealth': () => txService.checkNetworkHealth(),
  'tx.autoCreateAccount': () => txService.autoCreateAccount(),
  'tx.registerAccount': ({ address }) => registrationService.registerOwnedAccount(address),
  'tx.validateAddress': ({ address }) => txService.validateAddress(address),
  'tx.getBalances': ({ addresses }) => balanceService.getBalances(addresses),
  'tx.getCachedBalances': ({ addresses }) => balanceService.getCachedBalances(addresses),
  'tx.getTotalBalance': ({ addresses }) => balanceService.getTotalBalance(addresses),
  'tx.getPending': () => pendingTxService.list(),
  'tx.getHistoryFeed': ({ address } = {}) => historyService.getHistoryFeed(address),
  'tx.getCachedHistory': ({ address } = {}) => historyService.getCachedHistory(address),
  'tx.reconcilePending': () => pendingTxService.reconcile(),
  'tx.clearSettled': () => pendingTxService.clearSettled(),
  'tx.estimateFee': ({ toAddress, amountUnits }) => txService.estimateFee({ toAddress, amountUnits }),
  'tx.simulate': ({ toAddress, amountUnits }) => txService.simulate({ toAddress, amountUnits }),
  'tx.checkDuplicate': (params) => txService.checkDuplicate(params),

  // ---- Tokens and launchpad --------------------------------------------
  'token.deploy': (params) => tokenService.deployToken(params),
  'token.list': () => tokenService.listDeployedTokens(),
  'token.deriveAddress': ({ mintSeed, mintAuthorityAddress }) => tokenService.deriveMintAddress(mintSeed, mintAuthorityAddress),
  'token.deriveTokenAccount': ({ ownerAddress, mintAddress }) => tokenService.deriveTokenAccount(ownerAddress, mintAddress),
  'token.generateSeed': () => tokenService.generateMintSeed(),
  'token.import': ({ mintAddress, symbol, name, decimals }) => tokenService.importToken({ mintAddress, symbol, name, decimals }),
  'token.readMint': ({ mintAddress }) => tokenService.readMint({ mintAddress }),
  'token.setVisibility': ({ mintAddress, hidden }) => tokenService.setVisibility(mintAddress, hidden),
  'token.getBalances': ({ address }) => tokenService.getTokenBalances({ address }),
  'token.transferChecked': (params) => tokenService.transferTokenChecked(params),

  // ---- Preferences -----------------------------------------------------
  'settings.get': () => preferencesService.getPreferences(),
  'settings.set': ({ patch }) => preferencesService.setPreferences(patch),
  'settings.setSecurity': ({ patch }) => preferencesService.setSecurityPreferences(patch),

  // ---- Address book ----------------------------------------------------
  'contacts.list': () => contactsService.listContacts(),
  'contacts.put': ({ address, label }) => contactsService.putContact(address, label),
  'contacts.remove': ({ address }) => contactsService.removeContact(address),

  // ---- Network ---------------------------------------------------------
  // toPublicNetwork strips BigInt fields, which JSON cannot serialize. Without it every
  // one of these fails at the message port with "Could not serialize message."
  'network.getActive': async () => networkService.toPublicNetwork(await networkService.getActiveNetworkConfig()),
  'network.setActive': async ({ networkId }) => networkService.toPublicNetwork(await networkService.setActiveNetwork(networkId)),
  'network.list': async () => (await networkService.getAvailableNetworks()).map(networkService.toPublicNetwork),
  'network.upsertCustom': (params) => networkService.upsertCustomNetwork(params),
  'network.removeCustom': ({ networkId }) => networkService.removeCustomNetwork(networkId),

  // ---- DeFi surface (contract v17/v18, M0 contract-first drop) ------------
  // Everything here answers from the evidence-pinned capability snapshot or refuses honestly:
  // { supported:false, reason } for capability-shaped reads, FEATURE_DISABLED for everything
  // else. There is no chain math, no cache, and no store behind this surface yet — that is
  // the point of M0. See src/shared/contract/defi-schema.js for gates and test/test-defi-m0.mjs
  // for the proof that every one of these refuses when it must.
  //
  // program.* / feed.* are the always-on discovery reads (callable while locked): the frontend
  // builds its unsupported-state screens from them.
  'program.capabilities': ({ networkId } = {}) => programService.getCapabilities({ networkId }),
  'program.list': ({ networkId } = {}) => programService.listPrograms({ networkId }),
  'feed.status': ({ networkId } = {}) => feedService.getFeedStatus({ networkId }),
  'feed.lookup': ({ ids } = {}) => feedService.lookupFeeds({ ids }),

  // Market + risk reads (capability-gated).
  'market.assetGet': ({ assetId } = {}) => marketService.getAsset({ assetId }),
  'market.assetSearch': ({ query, limit } = {}) => marketService.searchAssets({ query, limit }),
  'market.snapshot': ({ assetIds } = {}) => marketService.getSnapshots({ assetIds }),
  'market.candles': ({ assetId, poolId, interval, range } = {}) => marketService.getCandles({ assetId, poolId, interval, range }),
  'market.trades': ({ assetId, poolId, cursor, limit } = {}) => marketService.getTrades({ assetId, poolId, cursor, limit }),
  'market.holders': ({ assetId, cursor, limit } = {}) => marketService.getHolders({ assetId, cursor, limit }),
  'market.watchlistGet': () => marketService.watchlistGet(),
  'market.watchlistAdd': ({ assetId } = {}) => marketService.watchlistAdd({ assetId }),
  'market.watchlistRemove': ({ assetId } = {}) => marketService.watchlistRemove({ assetId }),
  'risk.assetAssess': ({ assetId } = {}) => riskService.assessAsset({ assetId }),

  // Intent pipeline (R reads / P lifecycle / X submit — submit is auth:'signing' above).
  'intent.list': ({ status } = {}) => intentService.listIntents({ status }),
  'intent.get': ({ intentId } = {}) => intentService.getIntent({ intentId }),
  'intent.prepareSend': (params = {}) => intentService.prepareSend(params),
  'intent.rePrepare': ({ intentId } = {}) => intentService.rePrepareIntent({ intentId }),
  'intent.resume': ({ intentId } = {}) => intentService.resumeIntent({ intentId }),
  'intent.discard': ({ intentId } = {}) => intentService.discardIntent({ intentId }),
  'intent.stopWaiting': ({ intentId } = {}) => intentService.stopWaitingIntent({ intentId }),
  'intent.submit': (params = {}) => intentService.submitIntent(params),

  // Desktop routing (local; no Desktop page exists in this build).
  'desktop.open': ({ page, args } = {}) => desktopService.openDesktop({ page, args }),

  // Feature modules keep their own handler maps (docs/MODULE_BOUNDARIES.md): this file stays
  // the one integration point and the feature directories never import each other.
  ...dexHandlers,
  ...launchpadHandlers,
});

/** Method names the router actually implements. Used by test-contract.mjs. */
export function listHandlerNames() {
  return Object.keys(handlers);
}

/** @param {string} method — true when the method is a signing-guard lifecycle transaction. */
export function isTransactionMethod(method) {
  return TRANSACTION_METHODS.has(method);
}

/** @param {string} method — true when the method is a registered sync/poll read (no activity stamp). */
export function isSyncReadMethod(method) {
  return SYNC_READ_METHODS.has(method);
}

/**
 * Find the first value in a response that the message port cannot carry.
 *
 * chrome.runtime.sendMessage serializes with JSON and reports ANY failure as the single
 * opaque string "Could not serialize message." with no indication of which method or which
 * field caused it. That message cost real debugging time twice, so the router now names the
 * offender itself.
 *
 * Returns a path description, or null when the value is safe.
 */
function findUnserializable(value, path = 'data', depth = 0) {
  if (depth > 12) return null;
  const t = typeof value;
  if (t === 'bigint') return `${path} is a BigInt (${value}n) — convert with .toString()`;
  if (t === 'function') return `${path} is a function`;
  if (t === 'symbol') return `${path} is a symbol`;
  if (value === null || t === 'undefined' || t !== 'object') return null;
  if (value instanceof Date) return null;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return `${path} is binary (${value.constructor?.name}) — send hex or base64 instead`;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findUnserializable(value[i], `${path}[${i}]`, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (value instanceof Map || value instanceof Set) {
    return `${path} is a ${value.constructor.name} — send a plain object or array`;
  }
  for (const [k, v] of Object.entries(value)) {
    const hit = findUnserializable(v, `${path}.${k}`, depth + 1);
    if (hit) return hit;
  }
  return null;
}

function fail(code, message, retryable = false) {
  return { ok: false, error: { code, message, retryable } };
}

/**
 * Enforce the contract's declared auth level for a method.
 * @returns {Promise<null|{ ok: false, error: object }>} an error envelope, or null to proceed
 */
async function verifyPasswordParam(params, message = 'This action needs your password.') {
  const password = params?.password;
  if (typeof password !== 'string' || password.length === 0) {
    return fail('AUTH_REQUIRED', message);
  }
  try {
    await walletService.verifyPassword(password);
  } catch (error) {
    return fail('AUTH_REQUIRED', error?.message || 'Incorrect password.');
  }
  return null;
}

async function checkAuth(spec, params, method) {
  if (spec.auth === 'unlocked' || spec.auth === 'password' || spec.auth === 'signing') {
    const unlocked = await walletService.isUnlocked();
    if (!unlocked) {
      return fail('WALLET_LOCKED', 'Unlock your wallet to continue.');
    }
  }
  if (spec.auth === 'password') {
    return verifyPasswordParam(params);
  }
  if (spec.auth === 'signing') {
    const prefs = await preferencesService.getPreferences();
    // defiAlwaysRequirePassword is the no-bypass DeFi re-auth switch: it can force password
    // verification for DeFi signing methods even when the wallet-wide signing opt-in is off.
    const defiForced = typeof method === 'string' && isDefiMethod(method)
      && prefs.defiAlwaysRequirePassword === true;
    if (prefs.requirePasswordForSigning !== false || defiForced) {
      return verifyPasswordParam(params, 'Signing needs your password.');
    }
  }
  return null;
}

/**
 * Handle an incoming API request from the UI bridge.
 * @param {Object} request - { id, method, params }
 * @returns {Promise<{ ok: boolean, data?: any, error?: { code: string, message: string, retryable: boolean } }>}
 */
export async function handleApiRequest(request) {
  if (!request || typeof request !== 'object') {
    return fail('INVALID_REQUEST', 'Request must be an object.');
  }

  const { method, params = {} } = request;

  if (typeof method !== 'string' || !isKnownMethod(method)) {
    return fail('UNKNOWN_METHOD', `Method '${method}' is not supported.`);
  }
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    return fail('INVALID_REQUEST', 'Params must be an object.');
  }
  if (isDefiMethod(method)) {
    // DeFi params are schema-validated at the seam, before auth runs and before any service is
    // touched (S3/B12): a malformed or mistyped request can never reach a service.
    const issues = validateDefiParams(method, params);
    if (issues.length) {
      return fail('INVALID_INPUT', issues.join(' '));
    }
  }
  if (!Object.prototype.hasOwnProperty.call(handlers, method)) {
    // In the contract but not wired up. test-contract.mjs makes this unreachable in CI.
    return fail('UNKNOWN_METHOD', `Method '${method}' is declared but not implemented.`);
  }

  const spec = getMethodSpec(method);
  const authError = await checkAuth(spec, params, method);
  if (authError) return authError;

  const releaseSigningOperation = TRANSACTION_METHODS.has(method) ? beginSigningOperation() : null;
  try {
    const data = await handlers[method](params);
    // Stamp only after a successful call so a locked-out unlock attempt cannot be used to
    // keep a session alive indefinitely. Background SYNC reads are exempt: the dashboard and
    // history screens poll these every second while a pending tx is on screen, and stamping
    // them would defeat auto-lock for as long as the wallet is merely open.
    if (!SYNC_READ_METHODS.has(method)) {
      await systemService.touchActivity();
    }

    const payload = data === undefined ? null : data;

    // Catch the unserializable BEFORE the port does, so the caller gets a message naming the
    // method and the field instead of Chrome's bare "Could not serialize message."
    try {
      JSON.stringify(payload);
    } catch {
      const offender = findUnserializable(payload) || 'an unknown value';
      console.error(`[api-router] ${method} returned an unserializable payload: ${offender}`);
      return fail(
        'UNSERIALIZABLE_RESPONSE',
        `${method} returned data that cannot cross the message port: ${offender}`,
      );
    }

    return { ok: true, data: payload };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'Internal error.');
    const code = error?.code || 'METHOD_ERROR';
    return {
      ok: false,
      error: {
        code,
        message,
        // Service errors may know that a failure is permanent. Honour that explicit signal before
        // falling back to the router's heuristic, which would otherwise misclassify every custom-
        // network refusal as transient merely because its message contains "network".
        retryable: typeof error?.retryable === 'boolean'
          ? error.retryable
          : /network|timeout|fetch|rate|unavailable/i.test(message),
      },
    };
  } finally {
    releaseSigningOperation?.();
  }
}
