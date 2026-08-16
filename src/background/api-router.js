// Central API router in the background service worker.
// Dispatches incoming RPC requests to domain services.

import * as walletService from './services/wallet-service.js';
import * as accountService from './services/account-service.js';
import * as txService from './services/tx-service.js';
import * as tokenService from './services/token-service.js';
import * as networkService from './services/network-service.js';
import * as systemService from './services/system-service.js';

const handlers = {
  // System
  'system.bootstrap': async () => {
    const hasVault = await walletService.hasVault();
    const unlocked = hasVault ? await walletService.isUnlocked() : false;
    let account = null;
    let accounts = [];
    if (unlocked) {
      try {
        account = await accountService.getActiveAccount();
        accounts = await accountService.listAccounts();
      } catch {
        // session might be empty or locked
      }
    }
    const network = await networkService.getActiveNetworkConfig();
    const networkHealth = await txService.checkNetworkHealth();
    const autoLockMinutes = await systemService.getAutoLockMinutes();
    return {
      hasVault,
      unlocked,
      account,
      accounts,
      network,
      networkHealth,
      autoLockMinutes,
    };
  },
  'system.setAutoLock': ({ minutes }) => systemService.setAutoLockMinutes(minutes),
  'system.getAutoLock': () => systemService.getAutoLockMinutes(),


  // Wallet Lifecycle
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

  // Account Management
  'account.getActive': () => accountService.getActiveAccount(),
  'account.getActiveRef': () => accountService.getActiveRef(),
  'account.list': () => accountService.listAccounts(),
  'account.switch': ({ ref }) => accountService.switchActiveAccount(ref),
  'account.addHd': ({ keyringId } = {}) => accountService.addHdAccount(keyringId),
  'account.addImported': ({ privateKeyHex }) => accountService.addImportedKey(privateKeyHex),
  'account.setLabel': ({ address, label }) => accountService.setAccountLabel(address, label),
  'account.getLabels': () => accountService.getAccountLabels(),

  // Transactions & RPC
  'tx.getAccountInfo': ({ address }) => txService.getAccountInfo(address),
  'tx.claimFaucet': ({ amountUnits }) => txService.claimFaucet(amountUnits),
  'tx.send': ({ toAddress, amountUnits }) => txService.sendTransfer(toAddress, amountUnits),
  'tx.listHistory': ({ address, pageSize } = {}) => txService.listHistory(address, pageSize),
  'tx.checkHealth': () => txService.checkNetworkHealth(),
  'tx.autoCreateAccount': () => txService.autoCreateAccount(),

  // Tokens & Launchpad
  'token.deploy': (params) => tokenService.deployToken(params),
  'token.list': () => tokenService.listDeployedTokens(),
  'token.deriveAddress': ({ mintSeed }) => tokenService.deriveMintAddress(mintSeed),
  'token.generateSeed': () => tokenService.generateMintSeed(),

  // Network Configuration
  'network.getActive': () => networkService.getActiveNetworkConfig(),
  'network.setActive': ({ networkId }) => networkService.setActiveNetwork(networkId),
  'network.list': () => networkService.getAvailableNetworks(),
};

/**
 * Handle an incoming API request from the UI bridge.
 * @param {Object} request - { id, method, params }
 * @returns {Promise<{ ok: boolean, data?: any, error?: { code: string, message: string, retryable: boolean } }>}
 */
export async function handleApiRequest(request) {
  if (!request || typeof request !== 'object') {
    return { ok: false, error: { code: 'INVALID_REQUEST', message: 'Request must be an object.', retryable: false } };
  }

  const { method, params = {} } = request;
  const handler = handlers[method];

  if (!handler) {
    return { ok: false, error: { code: 'UNKNOWN_METHOD', message: `Method '${method}' not supported.`, retryable: false } };
  }

  try {
    const data = await handler(params);
    return { ok: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'Internal error.');
    return {
      ok: false,
      error: {
        code: 'METHOD_ERROR',
        message,
        retryable: /network|timeout|fetch|rate/i.test(message),
      },
    };
  }
}
