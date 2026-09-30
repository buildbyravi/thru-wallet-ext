// Toolbar icon follows wallet lock state — a Rabby-style lock badge on the action icon
// while the wallet is locked (vault present, no live session), the plain icon otherwise
// (unlocked, or still setting up with no vault yet).
//
// Chrome resets the action icon to the manifest default on every browser start, so the
// background re-applies the right variant at every worker start and on every lock-state
// change (emitLockStateChanged is the single funnel for those).

import { hasVault, isUnlocked } from '../../lib/vault.js';

const DEFAULT_PATHS = Object.freeze({
  16: 'icons/icon16.png',
  48: 'icons/icon48.png',
  128: 'icons/icon128.png',
});

/**
 * Point the toolbar icon at the right variant for the CURRENT state. Idempotent and
 * best-effort: the icon is decoration and must never throw into a lock transition.
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
