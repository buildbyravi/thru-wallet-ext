// Wallet vault: supports a seed-derived tree of accounts (BIP-44 style, via @thru/crypto)
// PLUS independently imported private keys, all living in one encrypted vault, with an
// "active account" pointer you can switch between them.
//
// Storage:
//  - chrome.storage.local[VAULT_KEY]   = { salt, iv, ciphertext } — the encrypted vault blob.
//    Decrypts to: { mnemonic: string|null, hdAccountIndices: number[], importedKeys: string[] }
//    (importedKeys are 32-byte private keys, hex-encoded)
//  - chrome.storage.local[ACTIVE_REF_KEY] = { kind: 'hd', index } | { kind: 'imported', keyIndex }
//    Not secret (just a pointer to which account is active), so it can live outside the
//    encrypted blob and persist across restarts without needing the vault unlocked.
//  - chrome.storage.session[SESSION_KEY] = { vaultData, rawKeyB64 } — memory-only, wiped when
//    the browser closes. Caching the raw AES key here (alongside the vault data it decrypts)
//    lets routine actions like "add account" re-save without re-prompting for the password;
//    it adds no real exposure beyond what's already there, since the decrypted vault data
//    itself is already the more sensitive thing living in this same session store.

import { MnemonicGenerator, ThruHDWallet } from '@thru/crypto';
import { keys as sdkKeys, Pubkey } from '@thru/sdk';

const PBKDF2_ITERATIONS = 600_000; // OWASP's current floor for PBKDF2-HMAC-SHA256
const VAULT_KEY = 'vault';
const SESSION_KEY = 'unlocked_session';
const ACTIVE_REF_KEY = 'active_account_ref';

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
  const clean = hex.trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error('Expected a hex-encoded key.');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
function parsePrivateKeyHex(hex) {
  const bytes = hexToBytes(hex);
  if (bytes.length !== 32) {
    throw new Error(`Expected a 32-byte private key as hex (64 hex characters) — got ${bytes.length} bytes.`);
  }
  return bytes;
}

async function deriveKeyBits(password, salt) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    256,
  );
  return new Uint8Array(bits);
}
async function importAesKey(rawKeyBytes, usages) {
  return crypto.subtle.importKey('raw', rawKeyBytes, 'AES-GCM', false, usages);
}

async function encryptVaultData(vaultData, rawKeyBytes, salt) {
  const key = await importAesKey(rawKeyBytes, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12)); // fresh IV every time, never reused
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(vaultData)),
  );
  return { salt: toB64(salt), iv: toB64(iv), ciphertext: toB64(new Uint8Array(ciphertext)) };
}

async function decryptVaultData(stored, rawKeyBytes) {
  const key = await importAesKey(rawKeyBytes, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(stored.iv) },
    key,
    fromB64(stored.ciphertext),
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

/** Re-encrypt updated vault data using the cached key from this unlocked session. */
async function persistVaultUpdate(vaultData) {
  const { [SESSION_KEY]: session } = await chrome.storage.session.get(SESSION_KEY);
  if (!session) throw new Error('Wallet is locked.');
  const rawKeyBytes = fromB64(session.rawKeyB64);
  const { [VAULT_KEY]: existing } = await chrome.storage.local.get(VAULT_KEY);
  const salt = fromB64(existing.salt);
  const stored = await encryptVaultData(vaultData, rawKeyBytes, salt);
  await chrome.storage.local.set({ [VAULT_KEY]: stored });
  await chrome.storage.session.set({ [SESSION_KEY]: { vaultData, rawKeyB64: session.rawKeyB64 } });
}

async function getVaultData() {
  const { [SESSION_KEY]: session } = await chrome.storage.session.get(SESSION_KEY);
  if (!session) throw new Error('Wallet is locked.');
  return session.vaultData;
}

// ---- Onboarding ----

/** Create a brand-new seed-based wallet. Returns the mnemonic once, for a backup screen. */
export async function createVault(password) {
  const mnemonic = MnemonicGenerator.generate();
  const vaultData = { mnemonic, hdAccountIndices: [0], importedKeys: [] };
  await saveNewVault(vaultData, password);
  await setActiveRef({ kind: 'hd', index: 0 });
  return mnemonic;
}

/** Import an existing wallet from a recovery phrase. */
export async function importMnemonicVault(mnemonic, password) {
  const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!MnemonicGenerator.validate(normalized)) {
    throw new Error("That recovery phrase doesn't look valid — double-check the words and try again.");
  }
  const vaultData = { mnemonic: normalized, hdAccountIndices: [0], importedKeys: [] };
  await saveNewVault(vaultData, password);
  await setActiveRef({ kind: 'hd', index: 0 });
}

/** Import an existing wallet from a raw 32-byte private key (hex). No seed, so no "add account". */
export async function importPrivateKeyVault(privateKeyHex, password) {
  const privateKey = parsePrivateKeyHex(privateKeyHex);
  await sdkKeys.fromPrivateKey(privateKey); // sanity check it derives cleanly before we save anything
  const vaultData = { mnemonic: null, hdAccountIndices: [], importedKeys: [bytesToHex(privateKey)] };
  await saveNewVault(vaultData, password);
  await setActiveRef({ kind: 'imported', keyIndex: 0 });
}

// ---- Lock / unlock ----

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
  await chrome.storage.session.set({ [SESSION_KEY]: { vaultData, rawKeyB64: toB64(rawKeyBytes) } });
  return vaultData;
}

export async function lock() {
  await chrome.storage.session.remove(SESSION_KEY);
}

export async function resetWallet() {
  await chrome.storage.session.remove(SESSION_KEY);
  await chrome.storage.local.remove([VAULT_KEY, ACTIVE_REF_KEY]);
}

export async function hasSeed() {
  const vaultData = await getVaultData();
  return Boolean(vaultData.mnemonic);
}

// ---- Active account pointer ----

export async function setActiveRef(ref) {
  await chrome.storage.local.set({ [ACTIVE_REF_KEY]: ref });
}
export async function getActiveRef() {
  const { [ACTIVE_REF_KEY]: ref } = await chrome.storage.local.get(ACTIVE_REF_KEY);
  return ref ?? null;
}
export async function switchActiveAccount(ref) {
  await setActiveRef(ref);
}

// ---- Resolving accounts ----

/** Resolve a ref into { address, publicKey, privateKey, label }. */
export async function resolveAccount(ref) {
  const vaultData = await getVaultData();
  if (ref.kind === 'hd') {
    if (!vaultData.mnemonic) throw new Error('This wallet has no recovery phrase to derive from.');
    const seed = MnemonicGenerator.toSeed(vaultData.mnemonic);
    const account = await ThruHDWallet.getAccount(seed, ref.index);
    return { ...account, ref, label: `Account ${ref.index + 1}` };
  }
  if (ref.kind === 'imported') {
    const hex = vaultData.importedKeys[ref.keyIndex];
    if (!hex) throw new Error('Imported key not found.');
    const privateKey = parsePrivateKeyHex(hex);
    const publicKey = await sdkKeys.fromPrivateKey(privateKey);
    const address = Pubkey.from(publicKey).toThruFmt();
    return { address, publicKey, privateKey, ref, label: `Imported ${ref.keyIndex + 1}` };
  }
  throw new Error('Unknown account reference.');
}

export async function getActiveAccount() {
  const ref = await getActiveRef();
  if (!ref) throw new Error('No active account set.');
  return resolveAccount(ref);
}

/** List every account in the current vault (for the account switcher), with addresses resolved. */
export async function listAccounts() {
  const vaultData = await getVaultData();
  const refs = [
    ...vaultData.hdAccountIndices.map((index) => ({ kind: 'hd', index })),
    ...vaultData.importedKeys.map((_, keyIndex) => ({ kind: 'imported', keyIndex })),
  ];
  return Promise.all(refs.map((ref) => resolveAccount(ref)));
}

// ---- Adding accounts to an existing vault ----

/** Derive and add the next account from the existing seed. Throws if this vault has no seed. */
export async function addHdAccount() {
  const vaultData = await getVaultData();
  if (!vaultData.mnemonic) {
    throw new Error('Adding an account needs a recovery-phrase wallet — this one was imported from a private key only.');
  }
  const nextIndex = vaultData.hdAccountIndices.length ? Math.max(...vaultData.hdAccountIndices) + 1 : 0;
  vaultData.hdAccountIndices.push(nextIndex);
  await persistVaultUpdate(vaultData);
  const ref = { kind: 'hd', index: nextIndex };
  await setActiveRef(ref);
  return ref;
}

/** Import an additional private key into the current vault, alongside whatever's already there. */
export async function addImportedKey(privateKeyHex) {
  const privateKey = parsePrivateKeyHex(privateKeyHex);
  await sdkKeys.fromPrivateKey(privateKey);
  const vaultData = await getVaultData();
  const hex = bytesToHex(privateKey);
  if (vaultData.importedKeys.includes(hex)) {
    throw new Error('That private key is already in this wallet.');
  }
  vaultData.importedKeys.push(hex);
  await persistVaultUpdate(vaultData);
  const ref = { kind: 'imported', keyIndex: vaultData.importedKeys.length - 1 };
  await setActiveRef(ref);
  return ref;
}

// ---- Export ----

/**
 * Reveal the secret behind an account ref. Always re-verifies the password against the
 * stored ciphertext directly — an already-unlocked session isn't treated as enough on its
 * own to reveal a mnemonic or private key.
 */
export async function exportAccountSecret(ref, password) {
  const { [VAULT_KEY]: stored } = await chrome.storage.local.get(VAULT_KEY);
  if (!stored) throw new Error('No wallet found.');
  const rawKeyBytes = await deriveKeyBits(password, fromB64(stored.salt));
  let vaultData;
  try {
    vaultData = await decryptVaultData(stored, rawKeyBytes);
  } catch {
    throw new Error('Incorrect password.');
  }
  if (ref.kind === 'hd') {
    return { kind: 'hd', mnemonic: vaultData.mnemonic };
  }
  if (ref.kind === 'imported') {
    return { kind: 'imported', privateKeyHex: vaultData.importedKeys[ref.keyIndex] };
  }
  throw new Error('Unknown account reference.');
}
