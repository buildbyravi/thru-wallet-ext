// Minimal MV3 service worker. Its only job right now is auto-locking the wallet after a
// period of inactivity, by clearing the session-only decrypted mnemonic (see lib/vault.js).
// The encrypted vault in chrome.storage.local is never touched by this — locking just means
// the password is needed again before the extension can sign anything.

import { lock } from './lib/vault.js';

const AUTO_LOCK_ALARM = 'thru-auto-lock';
const AUTO_LOCK_MINUTES = 15;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(AUTO_LOCK_ALARM, { periodInMinutes: AUTO_LOCK_MINUTES });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_LOCK_ALARM) {
    lock();
  }
});
