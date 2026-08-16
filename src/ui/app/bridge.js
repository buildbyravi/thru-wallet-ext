// The UI's only channel to the background service worker.
//
// Replaces src/ui/bridge.js with three additions:
//
//   1. The method name is checked against the frozen contract manifest BEFORE the message
//      is sent, so a typo or a stale call site throws immediately with a useful message
//      instead of round-tripping and coming back as a generic UNKNOWN_METHOD.
//   2. onEvent() actually gets used. The old bridge exposed it with zero callers, so the
//      background's push events had nowhere to arrive — which is why the dashboard balance
//      never refreshed after a faucet claim.
//   3. Incoming event messages are checked against the contract's EVENTS map and against
//      sender identity, which the old onEvent did not do.
//
// scripts/check-layering.mjs allows chrome.runtime.sendMessage only here and in the
// background's event service, so this stays the single auditable seam.

import { isKnownMethod, EVENTS, listMethodNames } from '../../shared/contract/manifest.js';

let nextId = 1;

/** Thrown when the UI asks for something the contract does not define. */
export class ContractError extends Error {
  constructor(method) {
    super(
      `bridge.send('${method}') is not in the contract. `
      + `Declare it in src/shared/contract/manifest.js and wire it in api-router.js.`,
    );
    this.name = 'ContractError';
    this.code = 'CONTRACT_VIOLATION';
    this.method = method;
  }
}

/**
 * Call a background method.
 * @param {string} method
 * @param {Object} [params]
 * @returns {Promise<any>} the handler's data
 */
export function send(method, params = {}) {
  if (!isKnownMethod(method)) {
    return Promise.reject(new ContractError(method));
  }

  const id = `ui_${nextId += 1}`;
  return new Promise((resolve, reject) => {
    let settled = false;

    // A service worker that was evicted mid-flight can drop the callback entirely, which
    // leaves a screen stuck on a spinner forever. A ceiling turns that into an error the
    // UI can actually show.
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const err = new Error('The wallet service did not respond. Try again.');
      err.code = 'SERVICE_TIMEOUT';
      err.retryable = true;
      reject(err);
    }, 30_000);

    try {
      chrome.runtime.sendMessage({ id, method, params }, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        if (chrome.runtime.lastError) {
          const err = new Error(chrome.runtime.lastError.message || 'Lost contact with the wallet service.');
          err.code = 'PORT_ERROR';
          err.retryable = true;
          return reject(err);
        }
        if (!response) {
          const err = new Error('No response from the wallet service.');
          err.code = 'NO_RESPONSE';
          err.retryable = true;
          return reject(err);
        }
        if (response.ok) return resolve(response.data);

        const err = new Error(response.error?.message || 'Wallet operation failed.');
        err.code = response.error?.code || 'UNKNOWN';
        err.retryable = Boolean(response.error?.retryable);
        return reject(err);
      });
    } catch (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
 * Subscribe to a background push event.
 * @param {keyof typeof EVENTS} eventName
 * @param {(data: any) => void} callback
 * @returns {() => void} unsubscribe
 */
export function onEvent(eventName, callback) {
  if (!Object.prototype.hasOwnProperty.call(EVENTS, eventName)) {
    throw new Error(
      `onEvent('${eventName}') is not a declared event. Known: ${Object.keys(EVENTS).join(', ')}`,
    );
  }

  const listener = (message, sender) => {
    // Only trust messages from this extension. The old bridge omitted this check while
    // the background side had it, so the trust boundary was asymmetric.
    if (sender?.id && sender.id !== chrome.runtime.id) return;
    if (message?.type !== 'EVENT' || message.event !== eventName) return;
    try {
      callback(message.data);
    } catch (error) {
      console.error(`[bridge] handler for '${eventName}' threw:`, error);
    }
  };

  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

/** Subscribe to several events at once; returns one unsubscribe for all of them. */
export function onEvents(map) {
  const offs = Object.entries(map).map(([event, cb]) => onEvent(event, cb));
  return () => offs.forEach((off) => off());
}

/** Full initial state in one round-trip. */
export function bootstrap() {
  return send('system.bootstrap');
}

/** Every method the contract defines — useful for diagnostics. */
export function knownMethods() {
  return listMethodNames();
}
