// Toolbar icon — one plain branded icon at every state.
//
// History: this used to swap between the plain icon and a red-lock-badge variant on lock
// state. The badge read as clutter at 16px and shipped three extra PNGs per size, so the
// local cleanup pass (2026-09-30) dropped the variants: the wallet's lock state lives in
// the popup itself, not the toolbar. syncActionIcon is kept (and re-run on lock-state
// changes) because Chrome resets the action icon to the manifest default on every browser
// start; the background re-asserts the plain icon at every worker start.

const DEFAULT_PATHS = Object.freeze({
  16: 'icons/icon16.png',
  48: 'icons/icon48.png',
  128: 'icons/icon128.png',
});

/**
 * Point the toolbar icon at the plain branded icon. Idempotent and best-effort: the icon
 * is decoration and must never throw into a lock transition.
 * @returns {Promise<void>}
 */
export async function syncActionIcon() {
  try {
    if (typeof chrome === 'undefined' || !chrome.action?.setIcon) return;
    await chrome.action.setIcon({ path: DEFAULT_PATHS });
  } catch {
    // safe fallback: the manifest default icon stays
  }
}
