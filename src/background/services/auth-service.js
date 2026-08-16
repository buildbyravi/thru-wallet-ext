// Unlock throttling, enforced in the background so the UI cannot bypass it.
//
// PBKDF2 at 600k iterations already makes each guess expensive, and an attacker with the
// encrypted blob can brute-force offline regardless. What this defends is the realistic
// case: someone with temporary access to an unlocked machine, or a script driving the
// popup. Backoff is persisted so it survives service-worker restarts.

const LOCKOUT_KEY = 'thru_unlock_lockout';

// Attempt N triggers a wait of DELAYS[N]. Beyond the table, the last value repeats.
const DELAYS_MS = [0, 0, 0, 5_000, 15_000, 30_000, 60_000, 120_000, 300_000];
const MAX_TRACKED_FAILURES = 50;

async function readState() {
  try {
    const res = await chrome.storage.local.get(LOCKOUT_KEY);
    const state = res?.[LOCKOUT_KEY];
    if (state && typeof state === 'object') {
      return {
        failedCount: Number(state.failedCount) || 0,
        lockedUntil: Number(state.lockedUntil) || 0,
      };
    }
  } catch {
    // storage unavailable — fail open rather than bricking unlock
  }
  return { failedCount: 0, lockedUntil: 0 };
}

async function writeState(state) {
  try {
    await chrome.storage.local.set({ [LOCKOUT_KEY]: state });
  } catch {
    // ignore
  }
}

function delayForAttempt(failedCount) {
  const index = Math.min(failedCount, DELAYS_MS.length - 1);
  return DELAYS_MS[index];
}

/**
 * Current lockout state plus how long the caller must wait.
 * @returns {Promise<{ failedCount: number, lockedUntil: number, retryInMs: number }>}
 */
export async function getLockoutState() {
  const { failedCount, lockedUntil } = await readState();
  const retryInMs = Math.max(0, lockedUntil - Date.now());
  return { failedCount, lockedUntil, retryInMs };
}

/**
 * Throws if a backoff window is currently open. Call before attempting an unlock.
 */
export async function assertUnlockAllowed() {
  const { retryInMs, failedCount } = await getLockoutState();
  if (retryInMs > 0) {
    const seconds = Math.ceil(retryInMs / 1000);
    const err = new Error(
      `Too many incorrect passwords. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`,
    );
    err.code = 'AUTH_LOCKED_OUT';
    err.retryInMs = retryInMs;
    err.failedCount = failedCount;
    throw err;
  }
}

/**
 * Record a failed unlock and open the next backoff window.
 * @returns {Promise<{ failedCount: number, retryInMs: number }>}
 */
export async function recordFailure() {
  const { failedCount } = await readState();
  const nextCount = Math.min(failedCount + 1, MAX_TRACKED_FAILURES);
  const wait = delayForAttempt(nextCount);
  const state = { failedCount: nextCount, lockedUntil: wait > 0 ? Date.now() + wait : 0 };
  await writeState(state);
  return { failedCount: nextCount, retryInMs: wait };
}

/**
 * Clear the counter after a successful unlock.
 */
export async function recordSuccess() {
  await writeState({ failedCount: 0, lockedUntil: 0 });
}

/**
 * Wipe throttling state. Called on wallet reset so a fresh vault starts clean.
 */
export async function clearLockout() {
  try {
    await chrome.storage.local.remove(LOCKOUT_KEY);
  } catch {
    // ignore
  }
}
