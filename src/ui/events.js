// Typed application event bus for decoupling screens and components.
//
// Screens emit domain events (e.g. 'account:switched', 'balance:updated')
// and other screens subscribe to them without knowing about each other.
// Every subscription returns an unsubscribe function — screen cleanup() must
// call these to prevent memory leaks.
//
// This is NOT a replacement for the store. The store holds state; the event
// bus signals that something happened. A screen that cares about account
// switches subscribes to 'account:switched' and reads the new account from
// the store — it doesn't receive the full account object through the event
// (though a small payload is allowed for convenience).

/**
 * @typedef {Object} EventBus
 * @property {function(string, *=): void} emit
 * @property {function(string, function): function} on
 * @property {function(string, function): void} off
 * @property {function(string): void} removeAll
 * @property {function(): void} destroy
 */

class EventBusImpl {
  constructor() {
    /** @type {Map<string, Set<function>>} */
    this._handlers = new Map();
  }

  /**
   * Subscribe to an event.
   * @param {string} event - Event name (e.g. 'account:switched')
   * @param {function(*): void} handler
   * @returns {function(): void} Unsubscribe function
   */
  on(event, handler) {
    if (typeof handler !== 'function') {
      throw new Error(`Event handler for '${event}' must be a function.`);
    }
    if (!this._handlers.has(event)) {
      this._handlers.set(event, new Set());
    }
    this._handlers.get(event).add(handler);

    // Return unsubscribe function
    return () => this.off(event, handler);
  }

  /**
   * Subscribe to an event, but fire only once then auto-unsubscribe.
   * @param {string} event
   * @param {function(*): void} handler
   * @returns {function(): void} Unsubscribe function (in case you want to cancel early)
   */
  once(event, handler) {
    const wrapper = (data) => {
      this.off(event, wrapper);
      handler(data);
    };
    return this.on(event, wrapper);
  }

  /**
   * Remove a specific handler from an event.
   * @param {string} event
   * @param {function} handler
   */
  off(event, handler) {
    const set = this._handlers.get(event);
    if (set) {
      set.delete(handler);
      if (set.size === 0) this._handlers.delete(event);
    }
  }

  /**
   * Remove all handlers for a specific event.
   * @param {string} event
   */
  removeAll(event) {
    this._handlers.delete(event);
  }

  /**
   * Emit an event with optional payload.
   * Handlers are called synchronously in registration order.
   * Errors in one handler do not prevent others from running.
   * @param {string} event
   * @param {*} [data]
   */
  emit(event, data) {
    const set = this._handlers.get(event);
    if (!set || set.size === 0) return;
    for (const handler of set) {
      try {
        handler(data);
      } catch (err) {
        console.error(`[EventBus] error in handler for '${event}':`, err);
      }
    }
  }

  /**
   * Remove all handlers for all events. Used on wallet reset or test teardown.
   */
  destroy() {
    this._handlers.clear();
  }
}

// ---- Event name constants ---------------------------------------------------
// Using constants prevents typo-based bugs and makes it easy to find all
// producers/consumers of each event via grep.

export const Events = Object.freeze({
  // Wallet lifecycle
  WALLET_CREATED: 'wallet:created',
  WALLET_IMPORTED: 'wallet:imported',
  WALLET_LOCKED: 'wallet:locked',
  WALLET_UNLOCKED: 'wallet:unlocked',
  WALLET_RESET: 'wallet:reset',

  // Account management
  ACCOUNT_CREATED: 'account:created',
  ACCOUNT_SWITCHED: 'account:switched',
  ACCOUNT_RENAMED: 'account:renamed',
  ACCOUNT_REMOVED: 'account:removed',
  ACCOUNT_IMPORTED: 'account:imported',

  // Balance & assets
  BALANCE_UPDATED: 'balance:updated',
  ASSETS_UPDATED: 'assets:updated',

  // Transactions
  TRANSACTION_CREATED: 'transaction:created',
  TRANSACTION_SUBMITTED: 'transaction:submitted',
  TRANSACTION_CONFIRMED: 'transaction:confirmed',
  TRANSACTION_FAILED: 'transaction:failed',

  // Network
  NETWORK_ONLINE: 'network:online',
  NETWORK_OFFLINE: 'network:offline',
  NETWORK_SWITCHED: 'network:switched',

  // Security
  SECURITY_TIMEOUT: 'security:timeout',

  // Navigation
  NAVIGATE: 'navigate',
  NAVIGATE_BACK: 'navigate:back',
});

/**
 * Singleton event bus instance used by the entire popup.
 * @type {EventBusImpl}
 */
export const events = new EventBusImpl();
