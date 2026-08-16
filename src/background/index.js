// MV3 background service worker entry point for Thru Wallet.
// Handles auto-lock alarms and dispatches UI RPC requests.

import { lock } from '../lib/vault.js';
import { handleApiRequest } from './api-router.js';
import { getAutoLockMinutes } from './services/system-service.js';

const AUTO_LOCK_ALARM = 'thru-auto-lock';

async function initAutoLockAlarm() {
  const min = await getAutoLockMinutes();
  if (min > 0) {
    chrome.alarms.create(AUTO_LOCK_ALARM, { periodInMinutes: min });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  initAutoLockAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  initAutoLockAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_LOCK_ALARM) {
    lock();
  }
});

// Primary request-response message listener for UI bridge
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Only accept messages originating from this extension's own pages
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

  // Return true to indicate asynchronous response
  return true;
});
