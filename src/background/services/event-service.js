// Background event emitter — pushes state changes to any open UI page.
//
// src/ui/bridge.js has exposed onEvent() since the first refactor, but the background never
// emitted anything, so every screen had to poll or go stale. That is the direct cause of the
// dashboard balance not refreshing after a faucet claim: screens/faucet.js emits a UI-local
// event into a handler set that is empty while faucet is mounted.
//
// Emission is best-effort by design. When no extension page is open, sendMessage rejects with
// "Could not establish connection" — that is normal and must never surface as an error or
// take down the service worker.

import { EVENTS } from '../../shared/contract/manifest.js';

/**
 * Push an event to all open extension pages.
 * @param {keyof typeof EVENTS} event
 * @param {any} [data]
 */
export function emit(event, data = null) {
  if (!Object.prototype.hasOwnProperty.call(EVENTS, event)) {
    // A typo here would silently do nothing at runtime, so fail loudly in development.
    throw new Error(`Unknown background event '${event}'. Declare it in shared/contract/manifest.js.`);
  }
  try {
    const result = chrome.runtime.sendMessage({ type: 'EVENT', event, data });
    // Chrome returns a promise in MV3; swallow "no receiver" rejections.
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch {
    // ignore
  }
}

export function emitAccountsChanged(data) {
  emit('accountsChanged', data);
}

export function emitLockStateChanged(unlocked) {
  emit('lockStateChanged', { unlocked });
}

export function emitNetworkChanged(network) {
  emit('networkChanged', network);
}

export function emitBalanceChanged(balances) {
  emit('balanceChanged', balances);
}
