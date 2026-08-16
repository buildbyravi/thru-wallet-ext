// WalletBridge — the ONLY module in src/ui/ that talks to the background service worker.
// All vault, key, RPC, and storage operations go through this bridge.
// UI code calls: const result = await bridge.send('wallet.unlock', { password });

/** @type {number} */
let nextId = 1;

/**
 * Send a typed RPC request to the background service worker.
 * Returns the response data on success, throws on failure.
 *
 * @param {string} method  - Dotted method name (e.g. 'wallet.create', 'tx.send')
 * @param {Object} [params] - Method parameters
 * @returns {Promise<any>}  - Response data
 * @throws {Error}          - On background error or communication failure
 */
export function send(method, params = {}) {
  const id = `ui_${nextId++}`;
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { id, method, params },
      (response) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (!response) {
          return reject(new Error('No response from wallet service.'));
        }
        if (response.ok) {
          resolve(response.data);
        } else {
          const err = new Error(response.error?.message || 'Wallet operation failed.');
          err.code = response.error?.code || 'UNKNOWN';
          err.retryable = response.error?.retryable || false;
          reject(err);
        }
      }
    );
  });
}

/**
 * Listen for push events from the background service worker.
 * Returns an unsubscribe function.
 *
 * Events: 'accountsChanged', 'lockStateChanged', 'networkChanged'
 *
 * @param {string} eventName
 * @param {function} callback
 * @returns {function} unsubscribe
 */
export function onEvent(eventName, callback) {
  const listener = (message) => {
    if (message?.type === 'EVENT' && message.event === eventName) {
      callback(message.data);
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

/**
 * Bootstrap call — fetches the full initial state in one round-trip.
 * Use this when the popup or desktop tab first opens to hydrate the UI.
 *
 * @returns {Promise<{
 *   hasVault: boolean,
 *   unlocked: boolean,
 *   account: Object|null,
 *   accounts: Array,
 *   network: Object,
 *   networkHealth: Object
 * }>}
 */
export function bootstrap() {
  return send('system.bootstrap');
}
