// System service running in the background service worker.
// Handles system preferences, activity tracking, and chrome.alarms lifecycle.
//
// Auto-lock is INACTIVITY-based, not a fixed-period timer. Every API request stamps
// `lastActivityAt`; a short repeating alarm compares that stamp against the configured
// window and locks when it has elapsed. The previous implementation created an alarm with
// `periodInMinutes: N`, which fired every N minutes regardless of use — so it could
// interrupt an active signing flow while also failing to measure real idleness. The
// settings screen has always called this "Lock after inactivity"; now it is.

import { CONTRACT_VERSION } from '../../shared/contract/manifest.js';

const AUTO_LOCK_ALARM = 'thru-auto-lock';
const AUTO_LOCK_KEY = 'thru_system_autolock_minutes';
const LAST_ACTIVITY_KEY = 'thru_last_activity_at';
const DEFAULT_AUTOLOCK_MINUTES = 15;

// How often the alarm wakes to compare the activity stamp. Chrome clamps alarm periods to
// a 1-minute floor for unpacked/production extensions, so this is the practical minimum.
const CHECK_PERIOD_MINUTES = 1;

export const AUTO_LOCK_CHOICES = [0, 1, 5, 15, 30, 60, 240];

/**
 * Get the configured inactivity window in minutes (0 = never lock).
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
 * Ensure the inactivity-check alarm exists. Idempotent — safe to call on every unlock.
 */
export async function ensureAutoLockAlarm() {
  try {
    if (typeof chrome === 'undefined' || !chrome.alarms) return;
    const minutes = await getAutoLockMinutes();
    if (minutes > 0) {
      // create() replaces an existing alarm of the same name, so no clear() is needed.
      chrome.alarms.create(AUTO_LOCK_ALARM, { periodInMinutes: CHECK_PERIOD_MINUTES });
    } else {
      chrome.alarms.clear(AUTO_LOCK_ALARM);
    }
  } catch {}
}

/**
 * Set the inactivity window and refresh the alarm.
 * @param {number} minutes
 * @returns {Promise<{ autoLockMinutes: number }>}
 */
export async function setAutoLockMinutes(minutes) {
  const parsed = parseInt(minutes, 10);
  const min = Number.isNaN(parsed) || parsed < 0 ? DEFAULT_AUTOLOCK_MINUTES : parsed;

  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [AUTO_LOCK_KEY]: min });
    }
  } catch {}

  await touchActivity();
  await ensureAutoLockAlarm();

  return { autoLockMinutes: min };
}

/**
 * Record that the user did something. Called from the API router on every request.
 */
export async function touchActivity() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      await chrome.storage.session.set({ [LAST_ACTIVITY_KEY]: Date.now() });
    }
  } catch {}
}

/**
 * Read the last activity timestamp (0 when unknown).
 * @returns {Promise<number>}
 */
export async function getLastActivityAt() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      const res = await chrome.storage.session.get(LAST_ACTIVITY_KEY);
      return Number(res?.[LAST_ACTIVITY_KEY]) || 0;
    }
  } catch {}
  return 0;
}

/**
 * Whether the inactivity window has elapsed and the wallet should lock now.
 * @returns {Promise<boolean>}
 */
export async function shouldAutoLock() {
  const minutes = await getAutoLockMinutes();
  if (minutes <= 0) return false;
  const last = await getLastActivityAt();
  // No stamp means the session predates activity tracking (or the worker restarted with a
  // live session). Stamp it now rather than locking someone out mid-task.
  if (!last) {
    await touchActivity();
    return false;
  }
  return Date.now() - last >= minutes * 60_000;
}

/**
 * Liveness probe. Also stamps activity, so a UI heartbeat keeps the session alive.
 */
export async function ping() {
  return { ok: true, contractVersion: CONTRACT_VERSION };
}
