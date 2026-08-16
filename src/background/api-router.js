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
import * as txService from './services/tx-service.js';
import * as tokenService from './services/token-service.js';
import * as networkService from './services/network-service.js';
import * as contactsService from './services/contacts-service.js';
import * as systemService from './services/system-service.js';
import * as preferencesService from './services/preferences-service.js';
import * as balanceService from './services/balance-service.js';
import * as pendingTxService from './services/pending-tx-service.js';
import { isKnownMethod, getMethodSpec, CONTRACT_VERSION } from '../shared/contract/manifest.js';

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
      network,
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

  // ---- Wallet lifecycle --------------------------------------------------
  'wallet.hasVault': () => walletService.hasVault(),
  'wallet.isUnlocked': () => walletService.isUnlocked(),
  'wallet.create': ({ password }) => walletService.createVault(password),
  'wallet.importMnemonic': ({ mnemonic, password }) => walletService.importMnemonicVault(mnemonic, password),
  'wallet.importPrivateKey': ({ privateKeyHex, password }) => walletService.importPrivateKeyVault(privateKeyHex, password),
  'wallet.unlock': ({ password }) => walletService.unlock(password),
  'wallet.lock': () => walletService.lock(),
  'wallet.reset': () => walletService.resetWallet(),
  'wallet.hasSeed': () => walletService.hasSeed(),
  'wallet.exportSecret': ({ ref, password }) => walletService.exportSecret(ref, password),
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
  'tx.send': ({ toAddress, amountUnits }) => txService.sendTransfer(toAddress, amountUnits),
  'tx.listHistory': ({ address, pageSize, limit, cursor } = {}) => (
    limit !== undefined || cursor !== undefined
      ? txService.listHistory(address, { limit, cursor })
      : txService.listHistory(address, pageSize)
  ),
  'tx.checkHealth': () => txService.checkNetworkHealth(),
  'tx.autoCreateAccount': () => txService.autoCreateAccount(),
  'tx.validateAddress': ({ address }) => txService.validateAddress(address),
  'tx.getBalances': ({ addresses }) => balanceService.getBalances(addresses),
  'tx.getCachedBalances': ({ addresses }) => balanceService.getCachedBalances(addresses),
  'tx.getTotalBalance': ({ addresses }) => balanceService.getTotalBalance(addresses),
  'tx.getPending': () => pendingTxService.list(),
  'tx.reconcilePending': () => pendingTxService.reconcile(),
  'tx.clearSettled': () => pendingTxService.clearSettled(),
  'tx.estimateFee': ({ toAddress, amountUnits }) => txService.estimateFee({ toAddress, amountUnits }),
  'tx.simulate': ({ toAddress, amountUnits }) => txService.simulate({ toAddress, amountUnits }),

  // ---- Tokens and launchpad --------------------------------------------
  'token.deploy': (params) => tokenService.deployToken(params),
  'token.list': () => tokenService.listDeployedTokens(),
  'token.deriveAddress': ({ mintSeed }) => tokenService.deriveMintAddress(mintSeed),
  'token.generateSeed': () => tokenService.generateMintSeed(),
  'token.import': ({ mintAddress, symbol, name, decimals }) => tokenService.importToken({ mintAddress, symbol, name, decimals }),
  'token.setVisibility': ({ mintAddress, hidden }) => tokenService.setVisibility(mintAddress, hidden),
  'token.getBalances': ({ address }) => tokenService.getTokenBalances({ address }),

  // ---- Preferences -----------------------------------------------------
  'settings.get': () => preferencesService.getPreferences(),
  'settings.set': ({ patch }) => preferencesService.setPreferences(patch),

  // ---- Address book ----------------------------------------------------
  'contacts.list': () => contactsService.listContacts(),
  'contacts.put': ({ address, label }) => contactsService.putContact(address, label),
  'contacts.remove': ({ address }) => contactsService.removeContact(address),

  // ---- Network ---------------------------------------------------------
  'network.getActive': () => networkService.getActiveNetworkConfig(),
  'network.setActive': ({ networkId }) => networkService.setActiveNetwork(networkId),
  'network.list': () => networkService.getAvailableNetworks(),
  'network.upsertCustom': (params) => networkService.upsertCustomNetwork(params),
  'network.removeCustom': ({ networkId }) => networkService.removeCustomNetwork(networkId),
});

/** Method names the router actually implements. Used by test-contract.mjs. */
export function listHandlerNames() {
  return Object.keys(handlers);
}

function fail(code, message, retryable = false) {
  return { ok: false, error: { code, message, retryable } };
}

/**
 * Enforce the contract's declared auth level for a method.
 * @returns {Promise<null|{ ok: false, error: object }>} an error envelope, or null to proceed
 */
async function checkAuth(spec, params) {
  if (spec.auth === 'unlocked' || spec.auth === 'password') {
    const unlocked = await walletService.isUnlocked();
    if (!unlocked) {
      return fail('WALLET_LOCKED', 'Unlock your wallet to continue.');
    }
  }
  if (spec.auth === 'password') {
    const password = params?.password;
    if (typeof password !== 'string' || password.length === 0) {
      return fail('AUTH_REQUIRED', 'This action needs your password.');
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
  if (!Object.prototype.hasOwnProperty.call(handlers, method)) {
    // In the contract but not wired up. test-contract.mjs makes this unreachable in CI.
    return fail('UNKNOWN_METHOD', `Method '${method}' is declared but not implemented.`);
  }

  const spec = getMethodSpec(method);
  const authError = await checkAuth(spec, params);
  if (authError) return authError;

  try {
    const data = await handlers[method](params);
    // Stamp only after a successful call so a locked-out unlock attempt cannot be used to
    // keep a session alive indefinitely.
    await systemService.touchActivity();
    return { ok: true, data: data === undefined ? null : data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'Internal error.');
    const code = error?.code || 'METHOD_ERROR';
    return {
      ok: false,
      error: {
        code,
        message,
        retryable: /network|timeout|fetch|rate|unavailable/i.test(message),
      },
    };
  }
}
