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

console.log('\nAll vault.js integration checks passed.');
