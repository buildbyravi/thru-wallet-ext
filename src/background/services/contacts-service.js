// Address book service in the background worker.
//
// Contacts are non-secret metadata, so they live in chrome.storage.local alongside account
// labels. Labels are sanitized here because they are fully user-controlled and get rendered
// in the recipient picker.
//
// Addresses are validated against the Thru address format before being stored, so a
// corrupt entry can never reach the send flow from the address book.

import { isValidThruAddress } from '../../lib/thru-client.js';
import { sanitizeLabel } from '../../lib/vault.js';

const CONTACTS_KEY = 'thru_contacts';
const MAX_CONTACTS = 200;

async function readAll() {
  try {
    const res = await chrome.storage.local.get(CONTACTS_KEY);
    const list = res?.[CONTACTS_KEY];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function writeAll(list) {
  await chrome.storage.local.set({ [CONTACTS_KEY]: list.slice(0, MAX_CONTACTS) });
}

/**
 * List saved contacts, most recently added first.
 * @returns {Promise<Array<{ address: string, label: string, createdAt: number }>>}
 */
export async function listContacts() {
  const list = await readAll();
  return list
    .filter((entry) => entry && typeof entry.address === 'string')
    .map((entry) => ({
      address: entry.address,
      label: sanitizeLabel(entry.label),
      createdAt: Number(entry.createdAt) || 0,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Insert or update a contact keyed by address.
 * @param {string} address
 * @param {string} label
 */
export async function putContact(address, label) {
  const addr = String(address || '').trim();
  if (!isValidThruAddress(addr)) {
    throw new Error('That is not a valid Thru address.');
  }
  const clean = sanitizeLabel(label);
  if (!clean) {
    throw new Error('A contact needs a name.');
  }
  const list = await readAll();
  const existing = list.findIndex((entry) => entry?.address === addr);
  const record = {
    address: addr,
    label: clean,
    createdAt: existing >= 0 ? Number(list[existing].createdAt) || Date.now() : Date.now(),
  };
  if (existing >= 0) list[existing] = record;
  else list.unshift(record);
  await writeAll(list);
  return record;
}

/**
 * Remove a contact by address.
 * @param {string} address
 */
export async function removeContact(address) {
  const addr = String(address || '').trim();
  const list = await readAll();
  await writeAll(list.filter((entry) => entry?.address !== addr));
  return { removed: addr };
}
