// Security posture evaluation — pure. No DOM, no chrome.*, no bridge.
//
// The dashboard's Security tile used to show a "coming soon" banner. This module replaces
// that with REAL checks derived from state the backend already owns:
//
//   settings.get         -> requirePasswordForSigning, enforceWhitelist, whitelist
//   system.getAutoLock   -> minutes of inactivity before lock (0 = never)
//   keyring.list         -> type, origin ('generated' | 'imported'), backedUpAt
//
// Honesty rules (same spirit as the balance/token rules elsewhere in this wallet):
//   - a value that could not be loaded is 'unknown', never assumed good or bad;
//   - only 'ok' and 'warn' checks count toward the score — 'info' rows are context, not
//     a grade, so an optional feature can never make a wallet look "insecure";
//   - nothing here claims protocol behaviour the extension does not have: there is no dApp
//     provider yet, so the connections row says exactly that instead of inventing approvals.
//
// Kept in src/shared/ so the popup, the side panel and the tests all share one definition.

import { autoLockLabel } from './autolock.js';

export const CHECK_STATUS = Object.freeze({
  OK: 'ok',
  WARN: 'warn',
  INFO: 'info',
  UNKNOWN: 'unknown',
});

const SEED_TYPES = new Set(['seed', 'mnemonic', 'hd']);

/**
 * @param {Object} input
 *   prefs            result of settings.get, or null when it could not be read
 *   autoLockMinutes  result of system.getAutoLock, or null when unknown
 *   keyrings         result of keyring.list, or null when unknown
 *   networkLabel     display label of the active network (default 'Betanet')
 *   isTestNetwork    true for every network except mainnet (default true)
 * @returns {{ checks: Array, okCount: number, gradedCount: number, level: 'good'|'attention'|'unknown' }}
 */
export function evaluateSecurity({
  prefs = null,
  autoLockMinutes = null,
  keyrings = null,
  networkLabel = 'Betanet',
  isTestNetwork = true,
} = {}) {
  const checks = [];

  // ---- 1. Recovery phrase backup ------------------------------------------------------
  if (!Array.isArray(keyrings)) {
    checks.push({
      id: 'backup',
      status: CHECK_STATUS.UNKNOWN,
      title: 'Recovery phrase',
      detail: 'Could not read your keyrings. Try again.',
    });
  } else {
    const seeds = keyrings.filter((k) => SEED_TYPES.has(String(k?.type || '').toLowerCase()));
    const unbacked = seeds.filter((k) => k.origin === 'generated' && !k.backedUpAt);
    if (unbacked.length > 0) {
      const first = unbacked[0];
      checks.push({
        id: 'backup',
        status: CHECK_STATUS.WARN,
        title: 'Back up your recovery phrase',
        detail: unbacked.length === 1
          ? `“${first.label || 'Recovery phrase'}” is not backed up. If this device is lost, the funds are lost.`
          : `${unbacked.length} recovery phrases are not backed up.`,
        action: { label: 'Back up', route: `/keyring?id=${encodeURIComponent(first.id)}` },
      });
    } else if (seeds.length > 0) {
      checks.push({
        id: 'backup',
        status: CHECK_STATUS.OK,
        title: 'Recovery phrase backed up',
        detail: 'You confirmed writing your phrase down.',
      });
    } else {
      checks.push({
        id: 'backup',
        status: CHECK_STATUS.INFO,
        title: 'Imported keys only',
        detail: 'This wallet holds imported private keys. Keep the originals somewhere safe.',
      });
    }
  }

  // ---- 2. Auto-lock ------------------------------------------------------------------
  if (autoLockMinutes == null || Number.isNaN(Number(autoLockMinutes))) {
    checks.push({
      id: 'autolock',
      status: CHECK_STATUS.UNKNOWN,
      title: 'Auto-lock',
      detail: 'Could not read the auto-lock setting.',
    });
  } else if (Number(autoLockMinutes) === 0) {
    checks.push({
      id: 'autolock',
      status: CHECK_STATUS.WARN,
      title: 'Auto-lock is off',
      detail: 'The wallet stays unlocked until you lock it yourself.',
      action: { label: 'Change', route: '/settings' },
    });
  } else {
    checks.push({
      id: 'autolock',
      status: CHECK_STATUS.OK,
      title: 'Auto-lock on',
      detail: `Locks after ${autoLockLabel(autoLockMinutes)} of inactivity.`,
    });
  }

  // ---- 3. Password for signing ---------------------------------------------------------
  if (!prefs) {
    checks.push({
      id: 'signing',
      status: CHECK_STATUS.UNKNOWN,
      title: 'Signing protection',
      detail: 'Could not read your settings.',
    });
  } else if (prefs.requirePasswordForSigning === true) {
    checks.push({
      id: 'signing',
      status: CHECK_STATUS.OK,
      title: 'Password required to sign',
      detail: 'Every transaction asks for your password.',
    });
  } else {
    checks.push({
      id: 'signing',
      status: CHECK_STATUS.WARN,
      title: 'Signing stays unlocked',
      detail: 'While unlocked, transactions are signed without asking for your password again.',
      action: { label: 'Turn on', route: '/settings' },
    });
  }

  // ---- 4. Send whitelist (optional — never graded) --------------------------------------
  if (prefs) {
    const count = Array.isArray(prefs.whitelist) ? prefs.whitelist.length : 0;
    if (prefs.enforceWhitelist === true) {
      checks.push({
        id: 'whitelist',
        status: CHECK_STATUS.OK,
        title: 'Send whitelist on',
        detail: count === 1 ? 'Sends are limited to 1 saved address.' : `Sends are limited to ${count} saved addresses.`,
      });
    } else {
      checks.push({
        id: 'whitelist',
        status: CHECK_STATUS.INFO,
        title: 'Send whitelist off',
        detail: 'Optional: limit sends to addresses you saved.',
        action: { label: 'Set up', route: '/settings' },
      });
    }
  }

  // ---- 5. Network -----------------------------------------------------------------------
  if (isTestNetwork) {
    checks.push({
      id: 'network',
      status: CHECK_STATUS.INFO,
      title: `${networkLabel} is a test network`,
      detail: 'Use test funds only. This wallet has not completed a security review.',
    });
  }

  // ---- 6. Site connections --------------------------------------------------------------
  checks.push({
    id: 'connections',
    status: CHECK_STATUS.INFO,
    title: 'No site connections',
    detail: 'This wallet does not expose a provider to websites yet, so no site can request approvals.',
  });

  const graded = checks.filter((c) => c.status === CHECK_STATUS.OK || c.status === CHECK_STATUS.WARN);
  const okCount = graded.filter((c) => c.status === CHECK_STATUS.OK).length;
  const hasUnknown = checks.some((c) => c.status === CHECK_STATUS.UNKNOWN);
  let level = 'good';
  if (graded.some((c) => c.status === CHECK_STATUS.WARN)) level = 'attention';
  else if (hasUnknown && graded.length === 0) level = 'unknown';

  return { checks, okCount, gradedCount: graded.length, level };
}
