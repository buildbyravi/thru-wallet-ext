// Encrypted local wallet vault.
//
// Vault V2 keeps one password and one unlock session while separating every recovery phrase
// and imported private key into a named keyring. The public functions at the bottom retain
// compatibility with the original popup while exposing the safer keyring primitives used by
// the background API.

import { MnemonicGenerator, ThruHDWallet } from '@thru/crypto';
import { keys as sdkKeys, Pubkey } from '@thru/sdk';

const PBKDF2_ITERATIONS = 600_000;
const VAULT_KEY = 'vault';
const LEGACY_BACKUP_KEY = 'vault_legacy_backup_v1';
const SESSION_KEY = 'unlocked_session';
const ACTIVE_REF_KEY = 'active_account_ref';
const LABELS_KEY = 'thru_account_labels';
const VAULT_VERSION = 2;

function toB64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function fromB64(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const clean = String(hex || '').trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error('Expected a hex-encoded key.');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function parsePrivateKeyHex(hex) {
  const bytes = hexToBytes(hex);
  if (bytes.length !== 32) {
    throw new Error(`Expected a 32-byte private key as hex (64 hex characters) — got ${bytes.length} bytes.`);
  }
  return bytes;
}

function normalizeMnemonic(mnemonic) {
  const normalized = String(mnemonic || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!MnemonicGenerator.validate(normalized)) {
    throw new Error("That recovery phrase doesn't look valid — double-check the words and try again.");
  }
  return normalized;
}

function newId(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return `${prefix}_${bytesToHex(bytes)}`;
}

// `origin` records provenance so the UI can offer "back up your phrase" only where it is
// meaningful: 'generated' phrases were created by this wallet and have never been written
// down, 'imported' phrases arrived from elsewhere and are already backed up somewhere.
// 'unknown' is used for keyrings that predate this field.
function seedKeyring(mnemonic, label = 'Seed wallet', origin = 'generated') {
  return {
    id: newId('seed'),
    type: 'seed',
    label: label.trim() || 'Seed wallet',
    origin,
    mnemonic: normalizeMnemonic(mnemonic),
    hdAccountIndices: [0],
    createdAt: Date.now(),
  };
}

function privateKeyKeyring(privateKeyHex, label = 'Imported private key') {
  const hex = bytesToHex(parsePrivateKeyHex(privateKeyHex));
  return {
    id: newId('pk'),
    type: 'privateKey',
    label: label.trim() || 'Imported private key',
    origin: 'imported',
    privateKeyHex: hex,
    createdAt: Date.now(),
  };
}

// Backfills `origin` on vaults written before the field existed. Mutates in place and
// reports whether anything changed so the caller can decide to re-encrypt.
function backfillKeyringOrigin(vaultData) {
  let changed = false;
  for (const ring of vaultData.keyrings) {
    if (!ring.origin) {
      ring.origin = ring.type === 'privateKey' ? 'imported' : 'unknown';
      changed = true;
    }
  }
  return changed;
}

function isV2(vaultData) {
  return vaultData?.version === VAULT_VERSION && Array.isArray(vaultData.keyrings);
}

function defaultV2(keyrings, migration = null) {
  return { version: VAULT_VERSION, keyrings, migration };
}

function accountRef(keyringId, accountIndex = 0) {
  return { kind: 'keyring', keyringId, accountIndex };
}

function isLegacyRef(ref) {
  return ref?.kind === 'hd' || ref?.kind === 'imported';
}

function getKeyring(vaultData, keyringId) {
  const ring = vaultData.keyrings.find((item) => item.id === keyringId);
  if (!ring) throw new Error('Account source was not found in this wallet.');
  return ring;
}

async function deriveKeyBits(password, salt) {
  const baseKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey, 256,
  );
  return new Uint8Array(bits);
}

async function importAesKey(rawKeyBytes, usages) {
  return crypto.subtle.importKey('raw', rawKeyBytes, 'AES-GCM', false, usages);
}

async function encryptVaultData(vaultData, rawKeyBytes, salt) {
  const key = await importAesKey(rawKeyBytes, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(vaultData)),
  );
  return { salt: toB64(salt), iv: toB64(iv), ciphertext: toB64(new Uint8Array(ciphertext)) };
}

async function decryptVaultData(stored, rawKeyBytes) {
  const key = await importAesKey(rawKeyBytes, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(stored.iv) }, key, fromB64(stored.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

async function saveNewVault(vaultData, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const rawKeyBytes = await deriveKeyBits(password, salt);
  const stored = await encryptVaultData(vaultData, rawKeyBytes, salt);
  await chrome.storage.local.set({ [VAULT_KEY]: stored });
  await chrome.storage.session.set({ [SESSION_KEY]: { vaultData, rawKeyB64: toB64(rawKeyBytes) } });
}

async function persistVaultUpdate(vaultData) {
  const { [SESSION_KEY]: session } = await chrome.storage.session.get(SESSION_KEY);
  if (!session) throw new Error('Wallet is locked.');
  const { [VAULT_KEY]: existing } = await chrome.storage.local.get(VAULT_KEY);
  const stored = await encryptVaultData(vaultData, fromB64(session.rawKeyB64), fromB64(existing.salt));
  await chrome.storage.local.set({ [VAULT_KEY]: stored });
  await chrome.storage.session.set({ [SESSION_KEY]: { vaultData, rawKeyB64: session.rawKeyB64 } });
}

async function getVaultData() {
  const { [SESSION_KEY]: session } = await chrome.storage.session.get(SESSION_KEY);
  if (!session) throw new Error('Wallet is locked.');
  return session.vaultData;
}

function migrateLegacyVaultData(legacyData) {
  const keyrings = [];
  let legacySeedId = null;
  const importedIds = [];
  if (legacyData.mnemonic) {
    // A V1 vault did not record whether its phrase was generated here or imported.
    const ring = seedKeyring(legacyData.mnemonic, 'Seed wallet 1', 'unknown');
    ring.hdAccountIndices = [...new Set(legacyData.hdAccountIndices || [0])].sort((a, b) => a - b);
    if (!ring.hdAccountIndices.length) ring.hdAccountIndices = [0];
    legacySeedId = ring.id;
    keyrings.push(ring);
  }
  for (const [index, privateKeyHex] of (legacyData.importedKeys || []).entries()) {
    const ring = privateKeyKeyring(privateKeyHex, `Imported key ${index + 1}`);
    importedIds.push(ring.id);
    keyrings.push(ring);
  }
  if (!keyrings.length) throw new Error('The encrypted wallet does not contain an account source.');
  return { vaultData: defaultV2(keyrings, { fromVersion: 1, successfulUnlocks: 0 }), legacySeedId, importedIds };
}

function convertLegacyRef(ref, legacySeedId, importedIds, vaultData) {
  if (ref?.kind === 'hd' && legacySeedId) return accountRef(legacySeedId, ref.index || 0);
  if (ref?.kind === 'imported' && importedIds[ref.keyIndex] !== undefined) return accountRef(importedIds[ref.keyIndex]);
  const first = vaultData.keyrings[0];
  return accountRef(first.id, first.type === 'seed' ? first.hdAccountIndices[0] : 0);
}

function normalizeRef(ref, vaultData) {
  if (ref?.keyringId) return accountRef(ref.keyringId, ref.accountIndex ?? ref.index ?? 0);
  if (ref?.kind === 'keyring') return ref;
  if (!isLegacyRef(ref)) throw new Error('Unknown account reference.');
  const seed = vaultData.keyrings.find((ring) => ring.type === 'seed');
  const privateKeyRings = vaultData.keyrings.filter((ring) => ring.type === 'privateKey');
  if (ref.kind === 'hd' && seed) return accountRef(seed.id, ref.index || 0);
  if (ref.kind === 'imported' && privateKeyRings[ref.keyIndex]) return accountRef(privateKeyRings[ref.keyIndex].id);
  throw new Error('Account source was not found in this wallet.');
}

function externalRef(vaultData, normalized) {
  const ring = getKeyring(vaultData, normalized.keyringId);
  if (ring.type === 'seed') {
    return { kind: 'hd', keyringId: ring.id, index: normalized.accountIndex, accountIndex: normalized.accountIndex };
  }
  const keyIndex = vaultData.keyrings.filter((item) => item.type === 'privateKey').findIndex((item) => item.id === ring.id);
  return { kind: 'imported', keyringId: ring.id, keyIndex, accountIndex: 0 };
}

async function verifyPassword(password) {
  const { [VAULT_KEY]: stored } = await chrome.storage.local.get(VAULT_KEY);
  if (!stored) throw new Error('No wallet found.');
  const rawKeyBytes = await deriveKeyBits(password, fromB64(stored.salt));
  try {
    return await decryptVaultData(stored, rawKeyBytes);
  } catch {
    throw new Error('Incorrect password.');
  }
}

// ---- Labels ---------------------------------------------------------------

export async function getAccountLabels() {
  const { [LABELS_KEY]: labels } = await chrome.storage.local.get(LABELS_KEY);
  return labels ?? {};
}

export const MAX_LABEL_LENGTH = 32;

// Labels are rendered in the UI and are fully user-controlled, so the limit lives here in
// the background rather than relying on an HTML maxlength the caller can bypass. Control
// characters are stripped; angle brackets and quotes are removed so a label can never
// contribute to markup even if a future renderer regresses.
export function sanitizeLabel(label) {
  return String(label ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/[<>"'`\\]/g, '')
    .trim()
    .slice(0, MAX_LABEL_LENGTH);
}

export async function setAccountLabel(address, label) {
  const labels = await getAccountLabels();
  const trimmed = sanitizeLabel(label);
  if (trimmed) labels[address] = trimmed;
  else delete labels[address];
  await chrome.storage.local.set({ [LABELS_KEY]: labels });
  return trimmed;
}

export async function setAccountLabelAuthenticated(address, label, password) {
  await verifyPassword(password);
  await setAccountLabel(address, label);
}

// ---- Onboarding and lock state -------------------------------------------

export async function createVault(password) {
  const mnemonic = MnemonicGenerator.generate();
  const ring = seedKeyring(mnemonic, 'Seed wallet 1', 'generated');
  await saveNewVault(defaultV2([ring]), password);
  await setActiveRef(accountRef(ring.id, 0));
  return mnemonic;
}

export async function importMnemonicVault(mnemonic, password) {
  const ring = seedKeyring(mnemonic, 'Seed wallet 1', 'imported');
  await saveNewVault(defaultV2([ring]), password);
  await setActiveRef(accountRef(ring.id, 0));
}

export async function importPrivateKeyVault(privateKeyHex, password) {
  const ring = privateKeyKeyring(privateKeyHex, 'Imported key 1');
  await sdkKeys.fromPrivateKey(parsePrivateKeyHex(ring.privateKeyHex));
  await saveNewVault(defaultV2([ring]), password);
  await setActiveRef(accountRef(ring.id));
}

export async function hasVault() {
  const { [VAULT_KEY]: vault } = await chrome.storage.local.get(VAULT_KEY);
  return Boolean(vault);
}

export async function isUnlocked() {
  const { [SESSION_KEY]: session } = await chrome.storage.session.get(SESSION_KEY);
  return Boolean(session);
}

export async function unlock(password) {
  const { [VAULT_KEY]: stored } = await chrome.storage.local.get(VAULT_KEY);
  if (!stored) throw new Error('No wallet found on this device yet.');
  const rawKeyBytes = await deriveKeyBits(password, fromB64(stored.salt));
  let vaultData;
  try {
    vaultData = await decryptVaultData(stored, rawKeyBytes);
  } catch {
    throw new Error('Incorrect password.');
  }

  if (!isV2(vaultData)) {
    const legacy = vaultData;
    const { vaultData: migrated, legacySeedId, importedIds } = migrateLegacyVaultData(legacy);
    const { [ACTIVE_REF_KEY]: legacyRef, [LEGACY_BACKUP_KEY]: backup } = await chrome.storage.local.get([ACTIVE_REF_KEY, LEGACY_BACKUP_KEY]);
    if (!backup) await chrome.storage.local.set({ [LEGACY_BACKUP_KEY]: stored });
    vaultData = migrated;
    const activeRef = convertLegacyRef(legacyRef, legacySeedId, importedIds, vaultData);
    const replacement = await encryptVaultData(vaultData, rawKeyBytes, fromB64(stored.salt));
    await chrome.storage.local.set({ [VAULT_KEY]: replacement, [ACTIVE_REF_KEY]: activeRef });
  }

  if (vaultData.migration?.fromVersion === 1) {
    vaultData.migration.successfulUnlocks = Math.min(2, (vaultData.migration.successfulUnlocks || 0) + 1);
    const replacement = await encryptVaultData(vaultData, rawKeyBytes, fromB64(stored.salt));
    await chrome.storage.local.set({ [VAULT_KEY]: replacement });
  }

  // Backfill provenance on V2 vaults written before `origin` existed.
  if (backfillKeyringOrigin(vaultData)) {
    const replacement = await encryptVaultData(vaultData, rawKeyBytes, fromB64(stored.salt));
    await chrome.storage.local.set({ [VAULT_KEY]: replacement });
  }

  await chrome.storage.session.set({ [SESSION_KEY]: { vaultData, rawKeyB64: toB64(rawKeyBytes) } });
  return vaultData;
}

export async function lock() {
  await chrome.storage.session.remove(SESSION_KEY);
}

export async function resetWallet() {
  await chrome.storage.session.remove(SESSION_KEY);
  await chrome.storage.local.remove([VAULT_KEY, LEGACY_BACKUP_KEY, ACTIVE_REF_KEY, LABELS_KEY]);
}

export async function removeLegacyBackup(password) {
  const data = await verifyPassword(password);
  if (!isV2(data) || data.migration?.successfulUnlocks < 2) {
    throw new Error('Unlock the migrated wallet successfully twice before removing its rollback backup.');
  }
  await chrome.storage.local.remove(LEGACY_BACKUP_KEY);
}

// ---- Keyring management ---------------------------------------------------

export async function listKeyrings() {
  const vaultData = await getVaultData();
  return vaultData.keyrings.map((ring) => ({
    id: ring.id,
    type: ring.type,
    label: ring.label,
    origin: ring.origin || 'unknown',
    backedUpAt: ring.backedUpAt ?? null,
    accountCount: ring.type === 'seed' ? ring.hdAccountIndices.length : 1,
    hdIndices: ring.type === 'seed' ? [...ring.hdAccountIndices] : [],
    createdAt: ring.createdAt,
  }));
}

// Re-verifies the master password without changing lock state. Throws 'Incorrect password.'
// on mismatch. Used to gate sensitive UI transitions.
export async function verifyMasterPassword(password) {
  await verifyPassword(password);
  return true;
}

export async function addSeedKeyring(mnemonic, password, label = '') {
  await verifyPassword(password);
  const vaultData = await getVaultData();
  const normalized = normalizeMnemonic(mnemonic);
  if (vaultData.keyrings.some((ring) => ring.type === 'seed' && ring.mnemonic === normalized)) {
    throw new Error('That recovery phrase is already in this wallet.');
  }
  const ring = seedKeyring(
    normalized,
    label || `Seed wallet ${vaultData.keyrings.filter((item) => item.type === 'seed').length + 1}`,
    'imported',
  );
  vaultData.keyrings.push(ring);
  await persistVaultUpdate(vaultData);
  await setActiveRef(accountRef(ring.id));
  return { id: ring.id, type: ring.type, label: ring.label, origin: ring.origin };
}

/**
 * Generate a NEW recovery phrase and register it, in one operation.
 *
 * Deliberately not two steps. A "generate a mnemonic and hand it to the UI" method would
 * put a fresh secret across the UI boundary with nothing but an unlocked session behind it,
 * and the UI would then have to hold it while a second call stored it. Here the entropy
 * never leaves the background: the phrase is generated, encrypted and persisted before this
 * returns, and the caller gets only the keyring summary. The user sees the words afterwards
 * through exportAccountSecret, which re-verifies the password.
 *
 * @param {string} password
 * @param {string} [label]
 */
export async function createSeedKeyring(password, label = '') {
  await verifyPassword(password);
  const vaultData = await getVaultData();

  // Regenerate rather than fail on the astronomically unlikely duplicate.
  let mnemonic = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = normalizeMnemonic(MnemonicGenerator.generate());
    if (!vaultData.keyrings.some((ring) => ring.type === 'seed' && ring.mnemonic === candidate)) {
      mnemonic = candidate;
      break;
    }
  }
  if (!mnemonic) throw new Error('Could not generate a unique recovery phrase.');

  const ring = seedKeyring(
    mnemonic,
    label || `Seed wallet ${vaultData.keyrings.filter((item) => item.type === 'seed').length + 1}`,
    'generated',
  );
  vaultData.keyrings.push(ring);
  await persistVaultUpdate(vaultData);
  await setActiveRef(accountRef(ring.id));
  return { id: ring.id, type: ring.type, label: ring.label, origin: ring.origin };
}

export async function addPrivateKeyKeyring(privateKeyHex, password, label = '') {
  await verifyPassword(password);
  const vaultData = await getVaultData();
  const ring = privateKeyKeyring(privateKeyHex, label || `Imported key ${vaultData.keyrings.filter((item) => item.type === 'privateKey').length + 1}`);
  await sdkKeys.fromPrivateKey(parsePrivateKeyHex(ring.privateKeyHex));
  if (vaultData.keyrings.some((item) => item.type === 'privateKey' && item.privateKeyHex === ring.privateKeyHex)) {
    throw new Error('That private key is already in this wallet.');
  }
  vaultData.keyrings.push(ring);
  await persistVaultUpdate(vaultData);
  await setActiveRef(accountRef(ring.id));
  return { id: ring.id, type: ring.type, label: ring.label, origin: ring.origin };
}

export async function renameKeyring(keyringId, label, password) {
  await verifyPassword(password);
  const vaultData = await getVaultData();
  const ring = getKeyring(vaultData, keyringId);
  ring.label = sanitizeLabel(label) || (ring.type === 'seed' ? 'Seed wallet' : 'Imported private key');
  await persistVaultUpdate(vaultData);
  return { id: ring.id, label: ring.label };
}

export async function removeKeyring(keyringId, password) {
  await verifyPassword(password);
  const vaultData = await getVaultData();
  if (vaultData.keyrings.length <= 1) throw new Error('Use Reset wallet to remove the last account source.');
  const index = vaultData.keyrings.findIndex((ring) => ring.id === keyringId);
  if (index < 0) throw new Error('Account source was not found in this wallet.');
  vaultData.keyrings.splice(index, 1);
  await persistVaultUpdate(vaultData);
  const activeRef = await getActiveRef();
  if (activeRef?.keyringId === keyringId) {
    const first = vaultData.keyrings[0];
    await setActiveRef(accountRef(first.id, first.type === 'seed' ? first.hdAccountIndices[0] : 0));
  }
}

export async function hasSeed() {
  const vaultData = await getVaultData();
  return vaultData.keyrings.some((ring) => ring.type === 'seed');
}

/**
 * Mark a seed keyring as backed up (the user confirmed they wrote the phrase down).
 * Requires no password: this only records a UI acknowledgement, it reveals nothing.
 * @param {string} keyringId
 * @param {boolean} [backedUp=true]
 */
export async function setKeyringBackedUp(keyringId, backedUp = true) {
  const vaultData = await getVaultData();
  const ring = getKeyring(vaultData, keyringId);
  if (ring.type !== 'seed') throw new Error('Only recovery-phrase keyrings can be backed up.');
  ring.backedUpAt = backedUp ? Date.now() : null;
  await persistVaultUpdate(vaultData);
  return { id: ring.id, backedUpAt: ring.backedUpAt };
}

/**
 * Derive HD addresses WITHOUT persisting them, so the UI can show a range of upcoming
 * addresses and let the user choose which to add (Rabby's HD manager pattern).
 *
 * Reveals only public addresses. Nothing is written to the vault.
 *
 * @param {string} keyringId
 * @param {number} [start=0]
 * @param {number} [count=5]
 * @returns {Promise<Array<{ index: number, address: string, added: boolean }>>}
 */
export async function previewHdAccounts(keyringId, start = 0, count = 5) {
  const from = Math.max(0, Math.floor(Number(start) || 0));
  const howMany = Math.min(50, Math.max(1, Math.floor(Number(count) || 1)));
  const vaultData = await getVaultData();
  const ring = getKeyring(vaultData, keyringId);
  if (ring.type !== 'seed') throw new Error('Only recovery-phrase keyrings derive accounts.');

  const seed = MnemonicGenerator.toSeed(ring.mnemonic);
  const existing = new Set(ring.hdAccountIndices);
  const out = [];
  for (let index = from; index < from + howMany; index += 1) {
    const account = await ThruHDWallet.getAccount(seed, index);
    out.push({ index, address: account.address, added: existing.has(index) });
  }
  return out;
}

/**
 * Add several HD indices to a seed keyring in one vault write.
 *
 * Adding N accounts one at a time costs N full AES re-encrypt cycles; this does one.
 *
 * @param {string} keyringId
 * @param {number[]} indices
 */
export async function addHdAccounts(keyringId, indices) {
  const vaultData = await getVaultData();
  const ring = getKeyring(vaultData, keyringId);
  if (ring.type !== 'seed') throw new Error('Only recovery-phrase keyrings can derive more accounts.');

  const wanted = [...new Set((indices || []).map((n) => Math.floor(Number(n))))]
    .filter((n) => Number.isInteger(n) && n >= 0 && n < 100_000)
    .sort((a, b) => a - b);
  if (!wanted.length) throw new Error('Choose at least one account to add.');

  const added = wanted.filter((index) => !ring.hdAccountIndices.includes(index));
  if (!added.length) return { keyringId: ring.id, added: [] };

  ring.hdAccountIndices.push(...added);
  ring.hdAccountIndices.sort((a, b) => a - b);
  await persistVaultUpdate(vaultData);
  await setActiveRef(accountRef(ring.id, added[0]));
  return { keyringId: ring.id, added };
}

/**
 * Remove a single derived HD account, leaving its keyring in place.
 *
 * The vault previously only ever appended to hdAccountIndices, so the sole way to remove an
 * address was to delete the whole keyring. Refuses to remove the last account of a keyring
 * (remove the keyring instead) and refuses to leave the wallet with no accounts at all.
 *
 * @param {Object} ref
 */
export async function removeHdAccount(ref) {
  const vaultData = await getVaultData();
  const normalized = normalizeRef(ref, vaultData);
  const ring = getKeyring(vaultData, normalized.keyringId);
  if (ring.type !== 'seed') {
    throw new Error('Imported private keys are removed by removing their keyring.');
  }
  if (ring.hdAccountIndices.length <= 1) {
    throw new Error('This is the last account from this recovery phrase — remove the phrase instead.');
  }
  const position = ring.hdAccountIndices.indexOf(normalized.accountIndex);
  if (position < 0) throw new Error('Derived account was not found.');

  ring.hdAccountIndices.splice(position, 1);
  await persistVaultUpdate(vaultData);

  const activeRef = await getActiveRef();
  const removedWasActive = activeRef?.keyringId === ring.id
    && (activeRef.accountIndex ?? activeRef.index) === normalized.accountIndex;
  if (removedWasActive) {
    await setActiveRef(accountRef(ring.id, ring.hdAccountIndices[0]));
  }
  return { keyringId: ring.id, removedIndex: normalized.accountIndex };
}

// ---- Account selection and resolution ------------------------------------

export async function setActiveRef(ref) {
  await chrome.storage.local.set({ [ACTIVE_REF_KEY]: ref });
}

export async function getActiveRef() {
  const { [ACTIVE_REF_KEY]: ref } = await chrome.storage.local.get(ACTIVE_REF_KEY);
  return ref ?? null;
}

export async function switchActiveAccount(ref) {
  const vaultData = await getVaultData();
  const normalized = normalizeRef(ref, vaultData);
  await resolveAccount(normalized);
  await setActiveRef(normalized);
}

export async function resolveAccount(ref) {
  const vaultData = await getVaultData();
  const normalized = normalizeRef(ref, vaultData);
  const ring = getKeyring(vaultData, normalized.keyringId);
  const labels = await getAccountLabels();
  const keyringInfo = { id: ring.id, type: ring.type, label: ring.label, origin: ring.origin || 'unknown' };
  if (ring.type === 'seed') {
    if (!ring.hdAccountIndices.includes(normalized.accountIndex)) throw new Error('Derived account was not found.');
    const seed = MnemonicGenerator.toSeed(ring.mnemonic);
    const account = await ThruHDWallet.getAccount(seed, normalized.accountIndex);
    const label = labels[account.address] || `Account ${normalized.accountIndex + 1}`;
    return {
      ...account,
      ref: externalRef(vaultData, normalized),
      label,
      hdIndex: normalized.accountIndex,
      keyring: keyringInfo,
    };
  }
  if (normalized.accountIndex !== 0) throw new Error('Imported private keys have one account.');
  const privateKey = parsePrivateKeyHex(ring.privateKeyHex);
  const publicKey = await sdkKeys.fromPrivateKey(privateKey);
  const address = Pubkey.from(publicKey).toThruFmt();
  const importedIndex = vaultData.keyrings.filter((item) => item.type === 'privateKey').findIndex((item) => item.id === ring.id);
  const label = labels[address] || `Imported ${importedIndex + 1}`;
  return {
    address,
    publicKey,
    privateKey,
    ref: externalRef(vaultData, normalized),
    label,
    hdIndex: null,
    keyring: keyringInfo,
  };
}

export async function getActiveAccount() {
  const ref = await getActiveRef();
  if (!ref) throw new Error('No active account set.');
  return resolveAccount(ref);
}

export async function listAccounts() {
  const vaultData = await getVaultData();
  const refs = vaultData.keyrings.flatMap((ring) => (
    ring.type === 'seed'
      ? ring.hdAccountIndices.map((accountIndex) => accountRef(ring.id, accountIndex))
      : [accountRef(ring.id)]
  ));
  return Promise.all(refs.map((ref) => resolveAccount(ref)));
}

export async function addHdAccount(keyringId = null) {
  const vaultData = await getVaultData();
  const active = await getActiveRef();
  const targetId = keyringId || (active?.keyringId && getKeyring(vaultData, active.keyringId).type === 'seed'
    ? active.keyringId
    : vaultData.keyrings.find((ring) => ring.type === 'seed')?.id);
  if (!targetId) throw new Error('Adding an account needs a recovery-phrase keyring.');
  const ring = getKeyring(vaultData, targetId);
  if (ring.type !== 'seed') throw new Error('Only recovery-phrase keyrings can derive more accounts.');
  const nextIndex = ring.hdAccountIndices.length ? Math.max(...ring.hdAccountIndices) + 1 : 0;
  ring.hdAccountIndices.push(nextIndex);
  await persistVaultUpdate(vaultData);
  const ref = accountRef(ring.id, nextIndex);
  await setActiveRef(ref);
  return externalRef(vaultData, ref);
}

// Legacy popup compatibility: adds a private-key keyring without re-authentication. The
// background API exposes addPrivateKeyKeyring instead and always requires a password check.
export async function addImportedKey(privateKeyHex) {
  const vaultData = await getVaultData();
  const ring = privateKeyKeyring(privateKeyHex, `Imported key ${vaultData.keyrings.filter((item) => item.type === 'privateKey').length + 1}`);
  await sdkKeys.fromPrivateKey(parsePrivateKeyHex(ring.privateKeyHex));
  if (vaultData.keyrings.some((item) => item.type === 'privateKey' && item.privateKeyHex === ring.privateKeyHex)) {
    throw new Error('That private key is already in this wallet.');
  }
  vaultData.keyrings.push(ring);
  await persistVaultUpdate(vaultData);
  const ref = accountRef(ring.id);
  await setActiveRef(ref);
  return externalRef(vaultData, ref);
}

// ---- Export ---------------------------------------------------------------

export async function exportAccountSecret(ref, password) {
  const vaultData = await verifyPassword(password);
  if (!isV2(vaultData)) throw new Error('Wallet migration is required before exporting a secret.');
  const normalized = normalizeRef(ref, vaultData);
  const ring = getKeyring(vaultData, normalized.keyringId);
  if (ring.type === 'seed') return { kind: 'hd', mnemonic: ring.mnemonic, keyringId: ring.id };
  return { kind: 'imported', privateKeyHex: ring.privateKeyHex, keyringId: ring.id };
}

/**
 * Export the private key of ONE account, including a seed-derived one.
 *
 * Distinct from exportAccountSecret on purpose. For a seed account that returns the whole
 * recovery phrase, which controls every address the phrase can ever derive. A single
 * address's private key is a far smaller thing to hand over — it is what you give to a tool
 * that needs one account, and losing it does not lose the rest of the wallet.
 *
 * Presenting both as one "export" would be a security mistake: the user cannot choose the
 * lesser disclosure if the UI only offers the greater one.
 *
 * @param {Object} ref
 * @param {string} password
 * @returns {Promise<{ kind: 'privateKey', privateKeyHex: string, address: string, derivedFrom: string }>}
 */
export async function exportAccountPrivateKey(ref, password) {
  const vaultData = await verifyPassword(password);
  if (!isV2(vaultData)) throw new Error('Wallet migration is required before exporting a secret.');
  const normalized = normalizeRef(ref, vaultData);
  const ring = getKeyring(vaultData, normalized.keyringId);

  const account = await resolveAccount(normalized);
  if (!account?.privateKey) throw new Error('Could not derive a private key for that account.');

  return {
    kind: 'privateKey',
    privateKeyHex: bytesToHex(account.privateKey),
    address: account.address,
    // Tells the UI whether this key is one of many from a phrase, so it can warn accordingly.
    derivedFrom: ring.type === 'seed' ? 'seed' : 'import',
    keyringId: ring.id,
  };
}
