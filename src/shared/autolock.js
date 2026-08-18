// Auto-lock choices, shared by the background and the UI.
//
// These previously lived in src/background/services/system-service.js. The settings UI needs
// the same list, and the layering rules correctly forbid a UI file from importing a background
// service — so the list moves here rather than being duplicated. A duplicated list is how the
// settings screen ends up offering an option the background will not accept.
//
// No chrome.* and no DOM, so this stays importable from both sides.

/** Minutes of inactivity before the wallet locks. 0 means never. */
export const AUTO_LOCK_CHOICES = Object.freeze([0, 1, 5, 15, 30, 60, 240]);

export const DEFAULT_AUTOLOCK_MINUTES = 15;

/**
 * Human label for a choice.
 * @param {number} minutes
 */
export function autoLockLabel(minutes) {
  const n = Number(minutes);
  if (!n) return 'Never';
  if (n < 60) return `${n} min`;
  return `${n / 60} hr`;
}

/**
 * Clamp arbitrary input to a usable value. Anything unparseable falls back to the default
 * rather than to 0, because 0 means "never lock" and silently disabling auto-lock in response
 * to bad input would be a security regression.
 * @param {any} minutes
 */
export function normalizeAutoLockMinutes(minutes) {
  const parsed = parseInt(minutes, 10);
  if (Number.isNaN(parsed) || parsed < 0) return DEFAULT_AUTOLOCK_MINUTES;
  return parsed;
}
