// MV3 background service worker entry point for Thru Wallet.
// Handles inactivity-based auto-lock and dispatches UI RPC requests.

import { lock } from '../lib/vault.js';
import { handleApiRequest } from './api-router.js';
import { ensureAutoLockAlarm, shouldAutoLock, touchActivity } from './services/system-service.js';
import { emitLockStateChanged } from './services/event-service.js';

const AUTO_LOCK_ALARM = 'thru-auto-lock';

// The unlocked session contains decrypted recovery phrases and private keys. Chrome currently
// defaults storage.session to TRUSTED_CONTEXTS, but write that boundary down at worker startup so
// a future manifest/runtime change cannot silently broaden who can read it. The optional guard keeps
// Node-only service tests usable; Chrome MV3 always provides this method.
function restrictSessionStorage() {
  const setAccessLevel = chrome.storage?.session?.setAccessLevel;
  if (typeof setAccessLevel !== 'function') return;
  try {
    Promise.resolve(setAccessLevel.call(chrome.storage.session, { accessLevel: 'TRUSTED_CONTEXTS' }))
      .catch((error) => {
        console.warn('[background] could not set session storage access level:', error?.message || error);
      });
  } catch (error) {
    console.warn('[background] could not set session storage access level:', error?.message || error);
  }
}

restrictSessionStorage();

chrome.runtime.onInstalled.addListener(() => {
  ensureAutoLockAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  ensureAutoLockAlarm();
});

// The alarm is a heartbeat, not the lock timer itself. It wakes roughly every minute and
// locks only once the configured inactivity window has actually elapsed, so an active
// signing flow is never interrupted mid-way.
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== AUTO_LOCK_ALARM) return;
  try {
    if (await shouldAutoLock()) {
      await lock();
      emitLockStateChanged(false);
    }
  } catch {
    // never let a background throw kill the worker
  }
});

// Primary request-response message listener for the UI bridge.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Only accept messages originating from this extension's own pages.
  if (sender.id !== chrome.runtime.id) {
    return false;
  }

  handleApiRequest(request)
    .then((result) => {
      sendResponse(result);
    })
    .catch((err) => {
      sendResponse({
        ok: false,
        error: {
          code: 'UNEXPECTED_ERROR',
          message: err instanceof Error ? err.message : 'Internal service worker error.',
          retryable: false,
        },
      });
    });

  // Return true to indicate an asynchronous response.
  return true;
});

// A fresh worker with a live session should not be treated as idle since epoch.
touchActivity();
ensureAutoLockAlarm();
