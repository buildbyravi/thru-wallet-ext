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
import {
  AUTO_LOCK_CHOICES,
  DEFAULT_AUTOLOCK_MINUTES,
  normalizeAutoLockMinutes,
} from '../../shared/autolock.js';

const AUTO_LOCK_ALARM = 'thru-auto-lock';
const AUTO_LOCK_KEY = 'thru_system_autolock_minutes';
const LAST_ACTIVITY_KEY = 'thru_last_activity_at';

// How often the alarm wakes to compare the activity stamp. Chrome clamps alarm periods to
// a 1-minute floor for unpacked/production extensions, so this is the practical minimum.
const CHECK_PERIOD_MINUTES = 1;

// Re-exported so existing importers keep working; the list itself now lives in
// src/shared/autolock.js so the settings UI can use the same one instead of duplicating it.
export { AUTO_LOCK_CHOICES };

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
      //
      // delayInMinutes is explicit. With periodInMinutes alone, the timing of the FIRST fire is
      // ambiguous across Chromium builds, and a heartbeat that fires the instant a worker starts
      // is exactly the shape that produces a spurious lock right after unlocking.
      chrome.alarms.create(AUTO_LOCK_ALARM, {
        delayInMinutes: CHECK_PERIOD_MINUTES,
        periodInMinutes: CHECK_PERIOD_MINUTES,
      });
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
  const min = normalizeAutoLockMinutes(minutes);

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

/**
 * Report everything that decides lock state, for diagnosing spurious locks.
 *
 * Exists because a lock-on-refresh was reported and the cause is not inferable from code alone:
 * the session lives in chrome.storage.session, which survives a page reload but not an extension
 * reload, and auto-lock depends on a timestamp in that same store. This returns the actual values
 * so the answer comes from data rather than speculation.
 *
 * Contains no secret material — only presence flags, timestamps and counts.
 */
export async function diagnostics() {
  const now = Date.now();

  let sessionPresent = false;
  let sessionKeys = [];
  try {
    const all = await chrome.storage.session.get(null);
    sessionKeys = Object.keys(all || {});
    sessionPresent = sessionKeys.includes('unlocked_session');
  } catch (error) {
    sessionKeys = [`<error: ${error?.message}>`];
  }

  const minutes = await getAutoLockMinutes();
  const lastActivityAt = await getLastActivityAt();
  const msSinceActivity = lastActivityAt ? now - lastActivityAt : null;

  let alarm = null;
  try {
    const found = await chrome.alarms.get(AUTO_LOCK_ALARM);
    alarm = found
      ? { name: found.name, periodInMinutes: found.periodInMinutes, scheduledInMs: found.scheduledTime - now }
      : null;
  } catch {
    alarm = '<alarms unavailable>';
  }

  return {
    now,
    // Does the decrypted session exist at all? If this is false after a refresh, the session
    // store was cleared rather than auto-lock having fired.
    sessionPresent,
    sessionKeys,
    autoLockMinutes: minutes,
    lastActivityAt,
    msSinceActivity,
    // Would the next alarm tick lock the wallet right now, and why.
    wouldAutoLock: minutes > 0 && Boolean(lastActivityAt) && msSinceActivity >= minutes * 60_000,
    autoLockWindowMs: minutes > 0 ? minutes * 60_000 : null,
    alarm,
  };
}
