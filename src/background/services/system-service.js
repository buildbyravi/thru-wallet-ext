// System service running in the background service worker.
// Handles system preferences like auto-lock duration and chrome.alarms lifecycle.

const AUTO_LOCK_ALARM = 'thru-auto-lock';
const AUTO_LOCK_KEY = 'thru_system_autolock_minutes';
const DEFAULT_AUTOLOCK_MINUTES = 15;

/**
 * Get the configured auto-lock duration in minutes (0 = never).
 * @returns {Promise<number>}
 */
export async function getAutoLockMinutes() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const res = await chrome.storage.local.get(AUTO_LOCK_KEY);
      if (res && res[AUTO_LOCK_KEY] !== undefined) {
        return Number(res[AUTO_LOCK_KEY]);
      }
    }
  } catch {}
  return DEFAULT_AUTOLOCK_MINUTES;
}

/**
 * Set the auto-lock duration in minutes (0 = never) and update the background alarm.
 * @param {number} minutes
 * @returns {Promise<{ autoLockMinutes: number }>}
 */
export async function setAutoLockMinutes(minutes) {
  const parsed = parseInt(minutes, 10);
  const min = isNaN(parsed) || parsed < 0 ? DEFAULT_AUTOLOCK_MINUTES : parsed;

  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [AUTO_LOCK_KEY]: min });
    }
    if (typeof chrome !== 'undefined' && chrome.alarms) {
      chrome.alarms.clear(AUTO_LOCK_ALARM, () => {
        if (min > 0) {
          chrome.alarms.create(AUTO_LOCK_ALARM, { periodInMinutes: min });
        }
      });
    }
  } catch {}

  return { autoLockMinutes: min };
}
