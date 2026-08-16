// Screen router with lifecycle management.
//
// Replaces the flat show() function with a proper navigation system that gives
// each screen a mount/cleanup lifecycle, maintains a history stack for back()
// navigation, and automatically clears sensitive fields on screen transitions.
//
// During migration, this coexists with the legacy show() mechanism. Screens can
// be registered incrementally — unregistered screen IDs fall through to the
// legacy DOM toggle so nothing breaks while we extract one screen at a time.

/**
 * @typedef {Object} ScreenModule
 * @property {function(HTMLElement, Object=): void|Promise<void>} mount
 *   Called when the screen becomes active. Receives the screen's container
 *   element and optional navigation params.
 * @property {function(): void} cleanup
 *   Called when the screen is navigated away from. Must remove event listeners,
 *   clear sensitive fields, and release resources.
 * @property {function(Object): void} [update]
 *   Optional. Called when state changes while the screen is active.
 */

// IDs of inputs that must be cleared on every navigation for security.
const SENSITIVE_FIELD_IDS = [
  'create-password',
  'create-password-confirm',
  'import-mnemonic',
  'import-privatekey',
  'import-password',
  'unlock-password',
  'add-key-input',
  'export-password',
];

export class Router {
  /** @param {Object} options */
  constructor({ containerSelector = '#app-root', onBeforeNavigate, onAfterNavigate } = {}) {
    /** @type {Map<string, ScreenModule>} */
    this._screens = new Map();

    /** @type {Array<{ id: string, params: Object }>} */
    this._history = [];

    /** @type {{ id: string, params: Object }|null} */
    this._current = null;

    /** @type {string|null} */
    this._containerSelector = containerSelector;

    /** @type {function|null} */
    this._onBeforeNavigate = onBeforeNavigate || null;

    /** @type {function|null} */
    this._onAfterNavigate = onAfterNavigate || null;

    /** @type {function|null} Legacy show() fallback — set during migration */
    this._legacyShow = null;

    /** @type {boolean} Navigation lock to prevent double-navigating */
    this._navigating = false;
  }

  /**
   * Register a screen module.
   * @param {string} id - Screen identifier (e.g. 'dashboard', 'send')
   * @param {ScreenModule} module - Screen module with mount/cleanup
   */
  register(id, module) {
    if (!module || typeof module.mount !== 'function' || typeof module.cleanup !== 'function') {
      throw new Error(`Screen '${id}' must export mount() and cleanup().`);
    }
    this._screens.set(id, module);
  }

  /**
   * Set the legacy show() function for screens not yet migrated to modules.
   * During migration, navigate() falls through to this for unregistered IDs.
   * @param {function(string): void} showFn
   */
  setLegacyFallback(showFn) {
    this._legacyShow = showFn;
  }

  /**
   * Navigate to a screen.
   * @param {string} id - Screen ID
   * @param {Object} [params={}] - Data passed to mount()
   * @param {Object} [options={}]
   * @param {boolean} [options.replace=false] - Replace current history entry instead of pushing
   */
  async navigate(id, params = {}, { replace = false } = {}) {
    if (this._navigating) return;
    this._navigating = true;

    try {
      // Before-navigate hook
      if (this._onBeforeNavigate) {
        this._onBeforeNavigate(id, params);
      }

      // Clear sensitive fields globally
      this._clearSensitiveFields();

      // Cleanup current screen
      if (this._current) {
        const currentModule = this._screens.get(this._current.id);
        if (currentModule) {
          try {
            currentModule.cleanup();
          } catch (err) {
            console.error(`[Router] cleanup error for '${this._current.id}':`, err);
          }
        }

        // Push to history (unless replacing or navigating back)
        if (!replace) {
          this._history.push(this._current);
        }
      }

      this._current = { id, params };

      // If screen is registered as a module, use its lifecycle
      const module = this._screens.get(id);
      if (module) {
        // Hide all legacy screen elements
        this._hideAllLegacyScreens();

        // Find or create the container for this screen
        const container = this._getContainer(id);
        if (container) {
          container.classList.remove('hidden');
          container.innerHTML = '';
          await module.mount(container, params);
        }
      } else if (this._legacyShow) {
        // Fallback: use the legacy show() for non-migrated screens
        this._legacyShow(id);
      }

      // After-navigate hook
      if (this._onAfterNavigate) {
        this._onAfterNavigate(id, params);
      }
    } finally {
      this._navigating = false;
    }
  }

  /**
   * Navigate back to the previous screen.
   * @returns {boolean} true if navigated, false if no history
   */
  async back() {
    if (this._history.length === 0) return false;
    const prev = this._history.pop();
    // Use replace to avoid re-pushing the screen we just popped from
    await this.navigate(prev.id, prev.params, { replace: true });
    return true;
  }

  /**
   * Get the ID of the currently active screen.
   * @returns {string|null}
   */
  getCurrentScreen() {
    return this._current?.id ?? null;
  }

  /**
   * Get navigation params for the current screen.
   * @returns {Object}
   */
  getCurrentParams() {
    return this._current?.params ?? {};
  }

  /**
   * Check if we can navigate back.
   * @returns {boolean}
   */
  canGoBack() {
    return this._history.length > 0;
  }

  /**
   * Clear navigation history (e.g. after wallet reset or lock).
   */
  clearHistory() {
    this._history = [];
  }

  /**
   * Update the current screen's state, if it supports it.
   * @param {Object} state
   */
  updateCurrentScreen(state) {
    if (!this._current) return;
    const module = this._screens.get(this._current.id);
    if (module && typeof module.update === 'function') {
      module.update(state);
    }
  }

  /**
   * Clear all sensitive input fields for security.
   * @private
   */
  _clearSensitiveFields() {
    for (const fieldId of SENSITIVE_FIELD_IDS) {
      const el = document.getElementById(fieldId);
      if (el) el.value = '';
    }
  }

  /**
   * Hide all legacy screen elements (elements with class 'screen').
   * @private
   */
  _hideAllLegacyScreens() {
    const allScreens = document.querySelectorAll('.screen');
    for (const el of allScreens) {
      el.classList.add('hidden');
    }
  }

  /**
   * Get or find the container element for a screen.
   * Falls back to the existing screen-{id} element if it exists.
   * @private
   * @param {string} id
   * @returns {HTMLElement|null}
   */
  _getContainer(id) {
    // First try the existing legacy container
    const legacy = document.getElementById(`screen-${id}`);
    if (legacy) return legacy;

    // If using a single root container
    if (this._containerSelector) {
      return document.querySelector(this._containerSelector);
    }
    return null;
  }
}

/**
 * Singleton router instance used by the entire popup.
 */
export const router = new Router();
