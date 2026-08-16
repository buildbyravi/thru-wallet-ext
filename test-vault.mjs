// Mock chrome.storage.local / .session with simple in-memory maps, matching the
// promise-based (no-callback) API shape MV3 extensions use.
function makeStorageArea() {
  const data = new Map();
  return {
    async get(key) {
      if (key === undefined || key === null) {
        return Object.fromEntries(data);
      }
      if (Array.isArray(key)) {
        const out = {};
        for (const k of key) if (data.has(k)) out[k] = data.get(k);
        return out;
      }
      return data.has(key) ? { [key]: data.get(key) } : {};
    },
    async set(obj) {
      for (const [k, v] of Object.entries(obj)) data.set(k, v);
    },
    async remove(key) {
      const keys = Array.isArray(key) ? key : [key];
      for (const k of keys) data.delete(k);
    },
    _dump: () => Object.fromEntries(data),
  };
}

globalThis.chrome = {
  storage: {
    local: makeStorageArea(),
    session: makeStorageArea(),
  },
};

const assert = (cond, msg) => {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
  console.log('  ok -', msg);
};

const vault = await import('./src/lib/vault.js');

console.log('\n[1] Create a seed-based wallet');
const mnemonic = await vault.createVault('correct horse battery staple');
assert(mnemonic.split(' ').length === 12, 'mnemonic has 12 words');
assert(await vault.hasVault(), 'hasVault() true after create');
assert(await vault.isUnlocked(), 'isUnlocked() true immediately after create (this was the reported bug)');

const acc0 = await vault.getActiveAccount();
console.log('    account 0 address:', acc0.address);
assert(acc0.address.startsWith('ta'), 'address has ta prefix');
assert(acc0.label === 'Account 1', 'label is Account 1');

console.log('\n[2] Add a second HD account and switch to it');
const ref1 = await vault.addHdAccount();
assert(ref1.kind === 'hd' && ref1.index === 1, 'second account is hd index 1');
const acc1 = await vault.getActiveAccount();
assert(acc1.address !== acc0.address, 'account 1 has a different address than account 0');
console.log('    account 1 address:', acc1.address);

let accounts = await vault.listAccounts();
assert(accounts.length === 2, 'listAccounts returns 2 accounts');

console.log('\n[3] Import an extra private key into the SAME vault');
const { keys } = await import('@thru/sdk');
const generated = await keys.generateKeyPair();
const importedHex = Buffer.from(generated.privateKey).toString('hex');
const refImported = await vault.addImportedKey(importedHex);
assert(refImported.kind === 'imported' && refImported.keyIndex === 0, 'imported key gets keyIndex 0');
const accImported = await vault.getActiveAccount();
assert(accImported.address === generated.address, 'resolved imported account address matches the generated one');
console.log('    imported account address:', accImported.address);

accounts = await vault.listAccounts();
assert(accounts.length === 3, 'listAccounts now returns 3 accounts (2 hd + 1 imported)');

console.log('\n[4] Switch back to account 0 and confirm it resolves correctly');
await vault.switchActiveAccount({ kind: 'hd', index: 0 });
const backTo0 = await vault.getActiveAccount();
assert(backTo0.address === acc0.address, 'switching back to hd/0 resolves the same address as before');

console.log('\n[5] Export: wrong password must fail, right password must reveal the mnemonic');
let threw = false;
try {
  await vault.exportAccountSecret({ kind: 'hd', index: 0 }, 'totally wrong password');
} catch {
  threw = true;
}
assert(threw, 'export with wrong password throws');
const exported = await vault.exportAccountSecret({ kind: 'hd', index: 0 }, 'correct horse battery staple');
assert(exported.mnemonic === mnemonic, 'export with correct password returns the original mnemonic');

console.log('\n[6] Export the imported key specifically (should be the private key, not the mnemonic)');
const exportedImported = await vault.exportAccountSecret({ kind: 'imported', keyIndex: 0 }, 'correct horse battery staple');
assert(exportedImported.privateKeyHex === importedHex, 'exported private key matches what was imported');

console.log('\n[7] Lock, confirm locked state blocks account resolution, then unlock and confirm data persisted');
await vault.lock();
assert(!(await vault.isUnlocked()), 'isUnlocked() false after lock()');
let lockedThrew = false;
try {
  await vault.getActiveAccount();
} catch {
  lockedThrew = true;
}
assert(lockedThrew, 'getActiveAccount() throws while locked');

await vault.unlock('correct horse battery staple');
assert(await vault.isUnlocked(), 'isUnlocked() true after unlock()');
const afterUnlock = await vault.listAccounts();
assert(afterUnlock.length === 3, 'all 3 accounts still present after lock/unlock cycle');
const activeAfterUnlock = await vault.getActiveAccount();
assert(activeAfterUnlock.address === acc0.address, 'active account pointer survived the lock/unlock cycle');

console.log('\n[8] A private-key-only vault cannot add HD accounts');
await chrome.storage.local.remove(['vault', 'active_account_ref']);
await chrome.storage.session.remove('unlocked_session');
const pkOnlyGenerated = await keys.generateKeyPair();
const pkOnlyHex = Buffer.from(pkOnlyGenerated.privateKey).toString('hex');
await vault.importPrivateKeyVault(pkOnlyHex, 'another password 123');
assert(!(await vault.hasSeed()), 'hasSeed() is false for a private-key-only vault');
let noSeedThrew = false;
try {
  await vault.addHdAccount();
} catch (err) {
  noSeedThrew = true;
  console.log('    correctly refused with:', err.message);
}
assert(noSeedThrew, 'addHdAccount() throws on a private-key-only vault');
console.log('\n[9] Custom account labels/nicknames persist and resolve correctly');
await vault.setAccountLabel(pkOnlyGenerated.address, 'Trading Bot Primary');
const labels = await vault.getAccountLabels();
assert(labels[pkOnlyGenerated.address] === 'Trading Bot Primary', 'setAccountLabel saved custom label');
const activeLabeled = await vault.getActiveAccount();
assert(activeLabeled.label === 'Trading Bot Primary', 'resolveAccount returned the custom nickname');
await vault.setAccountLabel(pkOnlyGenerated.address, ''); // clearing label
const labelsAfterClear = await vault.getAccountLabels();
assert(!labelsAfterClear[pkOnlyGenerated.address], 'clearing label removes entry');
const activeDefault = await vault.getActiveAccount();
assert(activeDefault.label === 'Imported 1', 'cleared label falls back to default name');

console.log('\n[10] Vault V2 keeps multiple seed and private-key keyrings isolated under one password');
await vault.resetWallet();
await vault.createVault('keyring migration password');
const { MnemonicGenerator } = await import('@thru/crypto');
const secondMnemonic = MnemonicGenerator.generate();
const addedSeed = await vault.addSeedKeyring(secondMnemonic, 'keyring migration password', 'Trading seed');
let keyrings = await vault.listKeyrings();
assert(keyrings.length === 2, 'two seed keyrings are listed');
assert(keyrings.some((ring) => ring.id === addedSeed.id && ring.label === 'Trading seed'), 'new seed keyring keeps its label');
const secondSeedAccount = await vault.getActiveAccount();
assert(secondSeedAccount.keyring.id === addedSeed.id, 'new seed keyring becomes active');
const derivedSecondSeedRef = await vault.addHdAccount(addedSeed.id);
const derivedSecondSeed = await vault.resolveAccount(derivedSecondSeedRef);
assert(derivedSecondSeed.address !== secondSeedAccount.address, 'each seed keyring derives its own account tree');
let duplicateSeedRejected = false;
try {
  await vault.addSeedKeyring(secondMnemonic, 'keyring migration password');
} catch {
  duplicateSeedRejected = true;
}
assert(duplicateSeedRejected, 'duplicate recovery phrase is rejected');

const secondPrivate = await keys.generateKeyPair();
const privateKeyring = await vault.addPrivateKeyKeyring(Buffer.from(secondPrivate.privateKey).toString('hex'), 'keyring migration password', 'Cold import');
keyrings = await vault.listKeyrings();
assert(keyrings.length === 3 && keyrings.some((ring) => ring.id === privateKeyring.id && ring.type === 'privateKey'), 'private key is a separate keyring');
const importedV2 = await vault.getActiveAccount();
assert(importedV2.address === secondPrivate.address, 'separate private-key keyring resolves its own address');
await vault.lock();
assert(!(await vault.isUnlocked()), 'locking clears every V2 keyring session');
await vault.unlock('keyring migration password');
assert((await vault.listKeyrings()).length === 3, 'all V2 keyrings survive lock and unlock');
await vault.setAccountLabelAuthenticated(secondPrivate.address, 'Cold import primary', 'keyring migration password');
assert((await vault.getActiveAccount()).label === 'Cold import primary', 'authenticated account rename persists');

console.log('\n[11] Keyring provenance distinguishes generated from imported phrases');
await vault.resetWallet();
await vault.createVault('provenance password');
let provKeyrings = await vault.listKeyrings();
assert(provKeyrings[0].origin === 'generated', 'a phrase created by createVault is marked generated');
assert(provKeyrings[0].backedUpAt === null, 'a fresh keyring is not yet backed up');

const importedPhrase = MnemonicGenerator.generate();
const importedRing = await vault.addSeedKeyring(importedPhrase, 'provenance password', 'From elsewhere');
provKeyrings = await vault.listKeyrings();
const importedEntry = provKeyrings.find((r) => r.id === importedRing.id);
assert(importedEntry.origin === 'imported', 'a phrase added via addSeedKeyring is marked imported');

await vault.setKeyringBackedUp(importedRing.id, true);
provKeyrings = await vault.listKeyrings();
assert(
  typeof provKeyrings.find((r) => r.id === importedRing.id).backedUpAt === 'number',
  'setKeyringBackedUp records an acknowledgement timestamp',
);

let pkBackupRejected = false;
try {
  const throwaway = await keys.generateKeyPair();
  const pkRing = await vault.addPrivateKeyKeyring(Buffer.from(throwaway.privateKey).toString('hex'), 'provenance password');
  await vault.setKeyringBackedUp(pkRing.id, true);
} catch {
  pkBackupRejected = true;
}
assert(pkBackupRejected, 'a private-key keyring cannot be marked "phrase backed up"');

console.log('\n[12] HD preview derives addresses without persisting them');
await vault.resetWallet();
await vault.createVault('preview password');
const previewRingId = (await vault.listKeyrings())[0].id;
const preview = await vault.previewHdAccounts(previewRingId, 0, 5);
assert(preview.length === 5, 'previewHdAccounts returns the requested count');
assert(preview[0].added === true, 'index 0 is reported as already added');
assert(preview[3].added === false, 'an unadded index is reported as not added');
assert(new Set(preview.map((p) => p.address)).size === 5, 'every previewed address is distinct');
assert((await vault.listAccounts()).length === 1, 'previewing persisted nothing');

// The previewed address must be the same one actually derived when it is later added.
const previewedIndex3 = preview[3].address;
await vault.addHdAccounts(previewRingId, [3]);
const afterAdd = await vault.listAccounts();
assert(
  afterAdd.some((a) => a.address === previewedIndex3),
  'the address shown in the preview is the address actually added',
);

console.log('\n[13] Batch HD add and single HD account removal');
await vault.resetWallet();
await vault.createVault('batch password');
const batchRingId = (await vault.listKeyrings())[0].id;
const batchResult = await vault.addHdAccounts(batchRingId, [1, 2, 5, 5, 2]);
assert(batchResult.added.length === 3, 'duplicate indices in one batch are collapsed');
assert((await vault.listAccounts()).length === 4, 'batch add produced four accounts total');

const reAdd = await vault.addHdAccounts(batchRingId, [1]);
assert(reAdd.added.length === 0, 're-adding an existing index is a no-op');

const accountsBeforeRemoval = await vault.listAccounts();
const victim = accountsBeforeRemoval.find((a) => a.ref.index === 5);
await vault.removeHdAccount(victim.ref);
const accountsAfterRemoval = await vault.listAccounts();
assert(accountsAfterRemoval.length === 3, 'removeHdAccount removes exactly one account');
assert(!accountsAfterRemoval.some((a) => a.address === victim.address), 'the removed address is gone');

// Removing the active account must leave a valid active account behind, not a dangling ref.
const stillActive = await vault.getActiveAccount();
assert(Boolean(stillActive?.address), 'an active account still resolves after a removal');

let lastAccountProtected = false;
await vault.resetWallet();
await vault.createVault('last account password');
try {
  const soloRef = (await vault.getActiveAccount()).ref;
  await vault.removeHdAccount(soloRef);
} catch {
  lastAccountProtected = true;
}
assert(lastAccountProtected, "a keyring's last remaining account cannot be removed");

console.log('\n[14] Labels are sanitized in the background, not just by the UI');
await vault.resetWallet();
await vault.createVault('sanitize password');
const sanitizeAddr = (await vault.getActiveAccount()).address;

const stored = await vault.setAccountLabel(sanitizeAddr, '  Trading  ');
assert(stored === 'Trading', 'surrounding whitespace is trimmed');

await vault.setAccountLabel(sanitizeAddr, '"><iframe src=//evil.co>');
const escapedLabel = (await vault.getActiveAccount()).label;
assert(
  !/[<>"']/.test(escapedLabel),
  `markup characters are stripped from labels (got ${JSON.stringify(escapedLabel)})`,
);

await vault.setAccountLabel(sanitizeAddr, 'x'.repeat(200));
assert(
  (await vault.getActiveAccount()).label.length === vault.MAX_LABEL_LENGTH,
  `an over-long label is capped at ${vault.MAX_LABEL_LENGTH} characters`,
);

console.log('\n[15] createSeedKeyring generates a new phrase without exposing it');
await vault.resetWallet();
await vault.createVault('multiseed password');
const firstRing = (await vault.listKeyrings())[0];

const generatedRing = await vault.createSeedKeyring('multiseed password', 'Second phrase');
assert(generatedRing.origin === 'generated', 'a phrase created here is marked generated');
assert(generatedRing.label === 'Second phrase', 'the supplied label is kept');
assert(
  !('mnemonic' in generatedRing) && !('privateKeyHex' in generatedRing),
  'createSeedKeyring returns NO secret material — the phrase never crosses the seam',
);

let multiRings = await vault.listKeyrings();
assert(multiRings.length === 2, 'the wallet now holds two recovery phrases');
assert(multiRings.find((r) => r.id === generatedRing.id).backedUpAt === null, 'a generated phrase starts un-backed-up');

// The two phrases must be genuinely independent key trees.
const firstAccounts = (await vault.listAccounts()).filter((a) => a.ref.keyringId === firstRing.id);
const secondAccounts = (await vault.listAccounts()).filter((a) => a.ref.keyringId === generatedRing.id);
assert(firstAccounts.length >= 1 && secondAccounts.length >= 1, 'both phrases have at least one account');
assert(
  firstAccounts[0].address !== secondAccounts[0].address,
  'the two phrases derive different addresses',
);

// The phrase is retrievable only through the password-gated export path.
const exportedSecond = await vault.exportAccountSecret(secondAccounts[0].ref, 'multiseed password');
assert(exportedSecond.kind === 'hd' && exportedSecond.mnemonic.split(' ').length === 12,
  'the generated phrase is retrievable via password-gated export');
assert(exportedSecond.mnemonic !== (await vault.exportAccountSecret(firstAccounts[0].ref, 'multiseed password')).mnemonic,
  'each keyring exports its own distinct phrase');

let wrongPwRejected = false;
try {
  await vault.createSeedKeyring('not the password', 'nope');
} catch {
  wrongPwRejected = true;
}
assert(wrongPwRejected, 'createSeedKeyring refuses a wrong password');
assert((await vault.listKeyrings()).length === 2, 'a refused attempt adds no keyring');

console.log('\n[16] Removing a keyring takes its accounts and leaves the rest intact');
const beforeRemoval = (await vault.listAccounts()).length;
await vault.removeKeyring(generatedRing.id, 'multiseed password');
multiRings = await vault.listKeyrings();
assert(multiRings.length === 1 && multiRings[0].id === firstRing.id, 'only the targeted keyring was removed');
assert((await vault.listAccounts()).length < beforeRemoval, 'its derived accounts went with it');
assert(Boolean((await vault.getActiveAccount())?.address), 'an active account still resolves after removal');

let lastKeyringProtected = false;
try {
  await vault.removeKeyring(firstRing.id, 'multiseed password');
} catch {
  lastKeyringProtected = true;
}
assert(lastKeyringProtected, 'the last remaining keyring cannot be removed');

console.log('\nAll vault.js integration checks passed.');
