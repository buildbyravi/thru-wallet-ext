// Lightweight vanilla JS reactive pub/sub state store.
// Keeps UI synchronized across all components without external frameworks.
//
// Enhanced with selector subscriptions: store.select('key', callback) fires only
// when that specific key's value changes (shallow equality), avoiding unnecessary
// re-renders when unrelated state is updated.

export class Store {
  /**
   * @param {Object} initialState
   */
  constructor(initialState = {}) {
    this.state = initialState;
    /** @type {Set<function>} Global listeners that fire on every state change */
    this.listeners = new Set();
    /** @type {Map<string, Set<function>>} Key-specific listeners */
    this._selectors = new Map();
  }

  /**
   * Get current state snapshot.
   */
  getState() {
    return this.state;
  }

  /**
   * Get a single state value by key.
   * @param {string} key
   * @returns {*}
   */
  get(key) {
    return this.state[key];
  }

  /**
   * Update state with partial patch and notify subscribers.
   * Selector listeners only fire if their specific key actually changed.
   * @param {Object} partialState
   */
  setState(partialState) {
    const prev = this.state;
    this.state = { ...prev, ...partialState };

    // Notify key-specific selectors only for keys that changed
    const changedKeys = [];
    for (const key of Object.keys(partialState)) {
      if (prev[key] !== this.state[key]) {
        changedKeys.push(key);
        const selectorSet = this._selectors.get(key);
        if (selectorSet) {
          for (const fn of selectorSet) {
            try {
              fn(this.state[key], prev[key], this.state);
            } catch (err) {
              console.error(`Store selector error [${key}]:`, err);
            }
          }
        }
      }
    }

    // Notify global listeners (backward-compatible)
    if (changedKeys.length > 0) {
      this.notify();
    }
  }

  /**
   * Subscribe to ALL state updates (original API, fully backward-compatible).
   * @param {function(Object): void} listener
   * @returns {function(): void} unsubscribe function
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Subscribe to changes on a specific state key.
   * The callback only fires when that key's value changes (shallow !==).
   *
   * @param {string} key - State key to watch
   * @param {function(newValue, oldValue, fullState): void} callback
   * @returns {function(): void} unsubscribe function
   */
  select(key, callback) {
    if (!this._selectors.has(key)) {
      this._selectors.set(key, new Set());
    }
    this._selectors.get(key).add(callback);
    return () => {
      const set = this._selectors.get(key);
      if (set) {
        set.delete(callback);
        if (set.size === 0) this._selectors.delete(key);
      }
    };
  }

  /**
   * Notify all global listeners.
   */
  notify() {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (err) {
        console.error('Store listener error:', err);
      }
    }
  }
}

// Global UI state store
export const walletStore = new Store({
  // --- Wallet lifecycle ---
  hasVault: false,
  isUnlocked: false,

  // --- Active account ---
  activeAccount: null,
  activeRef: null,
  accounts: [],
  hasSeed: false,

  // --- Balance ---
  balance: '0',
  balanceRaw: '0',
  isLoadingBalance: false,

  // --- Network ---
  activeNetwork: { id: 'alphanet', label: 'Alphanet', explorerUrl: 'https://scan.thru.org' },
  networkHealth: { status: 'offline', latencyMs: null },

  // --- Assets ---
  tokens: [],

  // --- Activity ---
  history: [],
  isLoadingHistory: false,

  // --- Transaction in progress ---
  pendingTransaction: null,

  // --- Navigation ---
  currentScreen: null,

  // --- Settings ---
  settings: {
    autoLockMinutes: 15,
  },
});
