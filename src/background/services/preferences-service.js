// Preferences service — all non-secret, non-vault user state in one place.
//
// Before this existed, every new setting meant a new bespoke chrome.storage key (see
// thru_active_network, thru_system_autolock_minutes, thru_account_labels, thru_contacts,
// thru_recent_recipients). That pattern does not scale to a Rabby-class settings surface,
// so this module owns a single namespaced record with a schema version.
//
// Nothing secret is stored here. Key material never leaves vault.js.

const PREFS_KEY = 'thru_prefs';
const PREFS_VERSION = 1;

const DEFAULTS = {
  version: PREFS_VERSION,

  // Display
  fiatCurrency: 'USD',
  hideSmallBalances: false,
  smallBalanceThreshold: '0',

  // Account management (Rabby: address ordering, pinning, hiding)
  accountOrder: [],          // [address] — explicit sort order, unlisted accounts fall to the end
  pinnedAccounts: [],        // [address] — sorted above everything else
  hiddenAccounts: [],        // [address] — filtered out of switchers, never deleted

  // Send safety (Rabby: whitelist)
  enforceWhitelist: false,
  whitelist: [],             // [address] — when enforceWhitelist is on, sends must target one

  // Token registry visibility
  hiddenTokens: [],          // [mintAddress]
  customTokens: [],          // [{ mintAddress, symbol, name, decimals, addedAt }]

  // First-run / nagging state
  disclaimerAcknowledgedAt: null,
  backupReminderDismissedAt: null,
};

const ARRAY_FIELDS = new Set([
  'accountOrder', 'pinnedAccounts', 'hiddenAccounts',
  'whitelist', 'hiddenTokens', 'customTokens',
]);

async function readRaw() {
  try {
    const res = await chrome.storage.local.get(PREFS_KEY);
    const stored = res?.[PREFS_KEY];
    return stored && typeof stored === 'object' ? stored : {};
  } catch {
    return {};
  }
}

/**
 * Full preference record with defaults applied for any missing key.
 * Unknown stored keys are preserved so a downgrade does not silently drop data.
 */
export async function getPreferences() {
  const stored = await readRaw();
  const merged = { ...DEFAULTS, ...stored, version: PREFS_VERSION };
  for (const field of ARRAY_FIELDS) {
    if (!Array.isArray(merged[field])) merged[field] = [...DEFAULTS[field]];
  }
  return merged;
}

/**
 * Shallow-merge a patch. Only known keys are accepted, so a compromised UI cannot write
 * arbitrary storage through this method.
 * @param {Object} patch
 */
export async function setPreferences(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('Preferences patch must be an object.');
  }
  const current = await getPreferences();
  const next = { ...current };
  const rejected = [];

  for (const [key, value] of Object.entries(patch)) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key) || key === 'version') {
      rejected.push(key);
      continue;
    }
    if (ARRAY_FIELDS.has(key)) {
      if (!Array.isArray(value)) throw new Error(`'${key}' must be an array.`);
      next[key] = value;
    } else {
      next[key] = value;
    }
  }

  if (rejected.length) {
    throw new Error(`Unknown preference key(s): ${rejected.join(', ')}`);
  }

  next.version = PREFS_VERSION;
  await chrome.storage.local.set({ [PREFS_KEY]: next });
  return next;
}

/** Toggle membership of an address/id in one of the array fields. */
async function toggleMember(field, value, present) {
  const prefs = await getPreferences();
  const list = new Set(prefs[field]);
  if (present) list.add(value);
  else list.delete(value);
  return setPreferences({ [field]: [...list] });
}

export async function setAccountHidden(address, hidden) {
  if (!address) throw new Error('An address is required.');
  return toggleMember('hiddenAccounts', address, Boolean(hidden));
}

export async function setAccountPinned(address, pinned) {
  if (!address) throw new Error('An address is required.');
  return toggleMember('pinnedAccounts', address, Boolean(pinned));
}

export async function setAccountOrder(addresses) {
  if (!Array.isArray(addresses)) throw new Error('Order must be an array of addresses.');
  return setPreferences({ accountOrder: addresses.filter((a) => typeof a === 'string') });
}

export async function setTokenHidden(mintAddress, hidden) {
  if (!mintAddress) throw new Error('A mint address is required.');
  return toggleMember('hiddenTokens', mintAddress, Boolean(hidden));
}

/**
 * Sort and filter a list of public accounts by the stored preferences.
 * Pinned first, then explicit order, then everything else by original position.
 * Hidden accounts are dropped unless includeHidden is set.
 */
export function applyAccountPreferences(accounts, prefs, { includeHidden = false } = {}) {
  const pinned = new Set(prefs.pinnedAccounts);
  const hidden = new Set(prefs.hiddenAccounts);
  const orderIndex = new Map(prefs.accountOrder.map((addr, i) => [addr, i]));

  const visible = includeHidden
    ? accounts.slice()
    : accounts.filter((acc) => !hidden.has(acc.address));

  return visible
    .map((acc, i) => ({ acc, i }))
    .sort((a, b) => {
      const aPin = pinned.has(a.acc.address) ? 0 : 1;
      const bPin = pinned.has(b.acc.address) ? 0 : 1;
      if (aPin !== bPin) return aPin - bPin;

      const aOrder = orderIndex.has(a.acc.address) ? orderIndex.get(a.acc.address) : Infinity;
      const bOrder = orderIndex.has(b.acc.address) ? orderIndex.get(b.acc.address) : Infinity;
      if (aOrder !== bOrder) return aOrder - bOrder;

      return a.i - b.i;
    })
    .map(({ acc }) => ({
      ...acc,
      pinned: pinned.has(acc.address),
      hidden: hidden.has(acc.address),
    }));
}

/**
 * Throw if the whitelist is enforced and the target is not on it.
 * Called from tx.send so the rule cannot be bypassed by a UI bug.
 * @param {string} toAddress
 */
export async function assertWhitelisted(toAddress) {
  const prefs = await getPreferences();
  if (!prefs.enforceWhitelist) return;
  if (!prefs.whitelist.includes(toAddress)) {
    const err = new Error('That address is not on your whitelist. Add it in Settings first.');
    err.code = 'NOT_WHITELISTED';
    throw err;
  }
}
