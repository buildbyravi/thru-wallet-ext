import assert from 'node:assert/strict';

const data = new Map();
const controls = { readBarrier: null, writeBarrier: null, failRead: false, failWrite: false };
let reads = 0;
let writeAttempts = 0;
let writes = 0;
let groups = 0;

function barrier(matches = () => true) {
  let enter;
  let release;
  return {
    matches,
    entered: new Promise((resolve) => { enter = resolve; }),
    released: new Promise((resolve) => { release = resolve; }),
    enter: (snapshot) => enter(snapshot),
    release: () => release(),
  };
}

function resetPreferences(record = { version: 1, requirePasswordForSigning: false }) {
  data.set('thru_prefs', structuredClone(record));
  reads = writeAttempts = writes = 0;
  controls.readBarrier = controls.writeBarrier = null;
  controls.failRead = controls.failWrite = false;
}

async function test(name, run) {
  await run();
  groups += 1;
  console.log(`  ok - ${name}`);
}

globalThis.chrome = {
  storage: { local: {
    async get(key) {
      if (key === 'thru_prefs') {
        reads += 1;
        if (controls.failRead) {
          controls.failRead = false;
          throw new Error('Injected preference read failure.');
        }
      }
      // Chrome detaches stored values: sharing mock references can hide lost updates.
      const snapshot = structuredClone(key === null ? Object.fromEntries(data) : { [key]: data.get(key) });
      if (key === 'thru_prefs' && controls.readBarrier) {
        const gate = controls.readBarrier;
        controls.readBarrier = null;
        gate.enter(snapshot[key]);
        await gate.released;
      }
      return snapshot;
    },
    async set(values) {
      const snapshot = structuredClone(values);
      if (Object.hasOwn(snapshot, 'thru_prefs')) {
        writeAttempts += 1;
        const gate = controls.writeBarrier;
        if (gate?.matches(snapshot.thru_prefs)) {
          controls.writeBarrier = null;
          gate.enter(snapshot.thru_prefs);
          await gate.released;
        }
        if (controls.failWrite) {
          controls.failWrite = false;
          throw new Error('Injected preference write failure.');
        }
        writes += 1;
      }
      for (const [key, value] of Object.entries(snapshot)) data.set(key, value);
    },
    async remove(key) { for (const item of Array.isArray(key) ? key : [key]) data.delete(item); },
  } },
};

const preferences = await import('../src/background/services/preferences-service.js');
const contacts = await import('../src/background/services/contacts-service.js');

console.log('[storage migrations] real service exports with detached RAM storage and explicit barriers');

await test('v0 preferences migrate losslessly on the next mutation', async () => {
  resetPreferences({ fiatCurrency: 'INR', requirePasswordForSigning: false, extensionData: { kept: true } });
  const migratedPreferences = await preferences.getPreferences();
  assert.equal(migratedPreferences.version, 1);
  assert.equal(migratedPreferences.fiatCurrency, 'INR');
  assert.equal(migratedPreferences.requirePasswordForSigning, false);
  assert.equal(writes, 0, 'reading does not persist the migration');
  await preferences.setPreferences({ fiatCurrency: 'USD' });
  assert.equal(data.get('thru_prefs').version, 1, 'the next mutation persists the migrated version');
  assert.deepEqual(data.get('thru_prefs').extensionData, { kept: true });
});

await test('future and malformed schemas fail closed on every mutation surface', async () => {
  const future = { version: 99, requirePasswordForSigning: true };
  resetPreferences(future);
  await assert.rejects(preferences.getPreferences(), /newer than this wallet/i);
  let updaterCalls = 0;
  for (const mutation of [
    () => preferences.setPreferences({ theme: 'dark' }),
    () => preferences.setSecurityPreferences({ requirePasswordForSigning: false }),
    () => preferences.updatePreferences(() => { updaterCalls += 1; return { customTokens: [] }; }),
    () => preferences.setAccountHidden('a', true),
    () => preferences.setAccountPinned('a', true),
    () => preferences.setTokenHidden('mint', true),
    () => preferences.setAccountOrder(['a']),
  ]) await assert.rejects(mutation(), /newer than this wallet/i);
  assert.equal(updaterCalls, 0, 'a future record is rejected before invoking an updater');
  assert.equal(writeAttempts, 0);
  assert.deepEqual(data.get('thru_prefs'), future);
  for (const version of ['bad', -1, 1.5]) {
    resetPreferences({ version });
    await assert.rejects(preferences.getPreferences(), /malformed/i);
    await assert.rejects(preferences.setPreferences({ theme: 'dark' }), /malformed/i);
    assert.equal(writeAttempts, 0);
  }
  resetPreferences();
  await preferences.setPreferences({ theme: 'light' });
  assert.equal(data.get('thru_prefs').theme, 'light', 'schema rejection does not poison the queue');
});

await test('sequential security and generic writes preserve the password-gated split', async () => {
  resetPreferences();
  const secured = await preferences.setSecurityPreferences({
    requirePasswordForSigning: true, enforceWhitelist: true, whitelist: ['recipient'], defiAlwaysRequirePassword: true,
  });
  assert.equal(secured.requirePasswordForSigning, true);
  const themed = await preferences.setPreferences({ theme: 'dark', sidePanelMode: true });
  assert.equal(themed.requirePasswordForSigning, true);
  assert.equal(themed.enforceWhitelist, true);
  assert.deepEqual(themed.whitelist, ['recipient']);
  assert.equal(themed.defiAlwaysRequirePassword, true);
  assert.equal(themed.theme, 'dark');
  await preferences.setSecurityPreferences({ requirePasswordForSigning: false });
  assert.equal(data.get('thru_prefs').requirePasswordForSigning, false);
  assert.equal(writes, 3, 'positive controls really commit');
});

await test('generic patches and functional updaters cannot write security, schema or unknown keys', async () => {
  resetPreferences({ version: 1, requirePasswordForSigning: true });
  for (const patch of [
    { requirePasswordForSigning: false }, { enforceWhitelist: false }, { whitelist: [] },
    { defiAlwaysRequirePassword: false }, { version: 1 }, { invented: true },
    { theme: 'dark', requirePasswordForSigning: false },
  ]) {
    await assert.rejects(preferences.setPreferences(patch), /Unknown preference key/i);
    await assert.rejects(preferences.updatePreferences(() => patch), /Unknown preference key/i);
  }
  await assert.rejects(preferences.setSecurityPreferences({ theme: 'dark' }), /Unsupported security preference key/i);
  assert.equal(writeAttempts, 0, 'forbidden partial patches do not attempt any write');
  assert.deepEqual(data.get('thru_prefs'), { version: 1, requirePasswordForSigning: true });
});

await test('a concurrent generic write cannot undo an acknowledged security write', async () => {
  resetPreferences();
  const gate = barrier((record) => record.theme === 'dark');
  controls.writeBarrier = gate;
  const security = preferences.setSecurityPreferences({ requirePasswordForSigning: true });
  const generic = preferences.setPreferences({ theme: 'dark' });
  const acknowledged = await security;
  const pendingGeneric = await gate.entered;
  const storedAtAcknowledgement = structuredClone(data.get('thru_prefs'));
  gate.release();
  await generic;
  assert.equal(acknowledged.requirePasswordForSigning, true);
  assert.equal(storedAtAcknowledgement.requirePasswordForSigning, true);
  assert.equal(pendingGeneric.requirePasswordForSigning, true, 'generic merge uses the committed security record');
  assert.equal(data.get('thru_prefs').requirePasswordForSigning, true);
  assert.equal(data.get('thru_prefs').theme, 'dark');
  assert.equal(writes, 2);
});

await test('later mutations do not read until the preceding queued write finishes', async () => {
  resetPreferences();
  const gate = barrier();
  controls.writeBarrier = gate;
  const generic = preferences.setPreferences({ theme: 'dark' });
  await gate.entered;
  const security = preferences.setSecurityPreferences({ requirePasswordForSigning: true });
  await Promise.resolve();
  const readsWhileBlocked = reads;
  gate.release();
  await Promise.all([generic, security]);
  assert.equal(readsWhileBlocked, 1, 'the second authoritative read stays behind the first commit');
  assert.equal(data.get('thru_prefs').theme, 'dark');
  assert.equal(data.get('thru_prefs').requirePasswordForSigning, true);
});

await test('simultaneous account and token membership toggles compute inside the transaction', async () => {
  for (const [field, toggle] of [
    ['hiddenAccounts', preferences.setAccountHidden],
    ['pinnedAccounts', preferences.setAccountPinned],
    ['hiddenTokens', preferences.setTokenHidden],
  ]) {
    resetPreferences({ version: 1, [field]: ['old', 'keep'] });
    await Promise.all([toggle('a', true), toggle('b', true), toggle('old', false)]);
    assert.deepEqual(data.get('thru_prefs')[field], ['keep', 'a', 'b'], field);
    assert.equal(writes, 3);
  }
});

await test('the generic functional updater merges token arrays against current queued state', async () => {
  resetPreferences({ version: 1, customTokens: [{ mintAddress: 'old' }], requirePasswordForSigning: false });
  const calls = [];
  await Promise.all([
    preferences.updatePreferences((current) => {
      calls.push(current.customTokens.map((token) => token.mintAddress));
      return { customTokens: [...current.customTokens, { mintAddress: 'a' }] };
    }),
    preferences.setSecurityPreferences({ requirePasswordForSigning: true }),
    preferences.updatePreferences((current) => {
      calls.push(current.customTokens.map((token) => token.mintAddress));
      return { customTokens: [...current.customTokens.filter((token) => token.mintAddress !== 'old'), { mintAddress: 'b' }] };
    }),
  ]);
  assert.deepEqual(calls, [['old'], ['old', 'a']]);
  assert.deepEqual(data.get('thru_prefs').customTokens, [{ mintAddress: 'a' }, { mintAddress: 'b' }]);
  assert.equal(data.get('thru_prefs').requirePasswordForSigning, true);
});

await test('read results, updater inputs, patch inputs and returned records are detached', async () => {
  resetPreferences({ version: 1, requirePasswordForSigning: true, customTokens: [{ mintAddress: 'a', name: 'Original' }] });
  const read = await preferences.getPreferences();
  read.customTokens[0].name = 'Changed read';
  read.hiddenAccounts.push('leaked default');
  assert.equal((await preferences.getPreferences()).customTokens[0].name, 'Original');
  assert.deepEqual((await preferences.getPreferences()).hiddenAccounts, []);
  let updaterInput;
  const updated = await preferences.updatePreferences((current) => {
    updaterInput = current;
    current.requirePasswordForSigning = false;
    current.customTokens[0].name = 'Changed updater input';
    return { theme: 'dark' };
  });
  updated.customTokens[0].name = 'Changed result';
  updaterInput.whitelist.push('leaked updater input');
  assert.equal(data.get('thru_prefs').requirePasswordForSigning, true);
  assert.equal(data.get('thru_prefs').customTokens[0].name, 'Original');
  assert.deepEqual(data.get('thru_prefs').whitelist, []);

  const gate = barrier();
  controls.readBarrier = gate;
  const first = preferences.setPreferences({ theme: 'light' });
  await gate.entered;
  const patch = { customTokens: [{ mintAddress: 'b', name: 'Captured' }] };
  const securityPatch = { requirePasswordForSigning: true, whitelist: ['captured recipient'] };
  const generic = preferences.setPreferences(patch);
  const security = preferences.setSecurityPreferences(securityPatch);
  patch.customTokens[0].name = 'Late caller mutation';
  securityPatch.requirePasswordForSigning = false;
  securityPatch.whitelist.push('late recipient');
  gate.release();
  const [, result] = await Promise.all([first, generic, security]);
  result.customTokens.push({ mintAddress: 'late result' });
  assert.deepEqual(data.get('thru_prefs').customTokens, [{ mintAddress: 'b', name: 'Captured' }]);
  assert.equal(data.get('thru_prefs').requirePasswordForSigning, true);
  assert.deepEqual(data.get('thru_prefs').whitelist, ['captured recipient']);
});

await test('validation and updater failures are zero-write and do not poison later queued writes', async () => {
  resetPreferences();
  for (const patch of [null, [], { theme: 'wrong' }, { hiddenTokens: 'wrong' }, { hideSmallBalances: 1 }, { defiSlippageBps: -1 }]) {
    await assert.rejects(preferences.setPreferences(patch));
  }
  for (const patch of [null, [], { requirePasswordForSigning: 'false' }, { whitelist: 'wrong' }]) {
    await assert.rejects(preferences.setSecurityPreferences(patch));
  }
  await assert.rejects(preferences.updatePreferences(null), /must be a function/i);
  await assert.rejects(preferences.updatePreferences(() => null), /patch must be an object/i);
  await assert.rejects(preferences.updatePreferences(() => Promise.resolve({ theme: 'dark' })), /patch must be an object/i);
  await assert.rejects(preferences.updatePreferences(() => { throw new Error('Updater failed.'); }), /Updater failed/i);
  assert.equal(writeAttempts, 0);
  const results = await Promise.allSettled([
    preferences.setPreferences({ theme: 'wrong' }),
    preferences.setPreferences({ theme: 'dark' }),
  ]);
  assert.deepEqual(results.map((result) => result.status), ['rejected', 'fulfilled']);
  assert.equal(data.get('thru_prefs').theme, 'dark');
  assert.equal(writes, 1);
});

await test('storage read and write failures preserve state and the queue recovers', async () => {
  for (const failure of ['failRead', 'failWrite']) {
    resetPreferences({ version: 1, requirePasswordForSigning: true, theme: 'system' });
    controls[failure] = true;
    const results = await Promise.allSettled([
      preferences.setPreferences({ theme: 'light' }),
      preferences.setPreferences({ theme: 'dark' }),
    ]);
    assert.deepEqual(results.map((result) => result.status), ['rejected', 'fulfilled']);
    assert.match(results[0].reason.message, /Injected preference (read|write) failure/i);
    assert.equal(data.get('thru_prefs').theme, 'dark');
    assert.equal(data.get('thru_prefs').requirePasswordForSigning, true, 'a failed read never authorizes a defaults overwrite');
    assert.equal(writes, 1);
    assert.equal(writeAttempts, failure === 'failRead' ? 1 : 2);
  }
});

await test('contacts keep the unchanged legacy-array migration and future rejection controls', async () => {
  const address = 'taEREREREREREREREREREREREREREREREREREREREREREg';
  data.set('thru_contacts', [{ address, label: 'Legacy', createdAt: 1 }]);
  assert.equal((await contacts.listContacts())[0].label, 'Legacy');
  await contacts.putContact(address, 'Migrated');
  assert.equal(data.get('thru_contacts').version, 1);
  assert.equal(data.get('thru_contacts').records[0].label, 'Migrated');
  data.set('thru_contacts', { version: 99, records: [] });
  await assert.rejects(contacts.listContacts(), /newer than this wallet/i);
});

await test('async and thenable updater results reject without writes or unhandled rejections', async () => {
  resetPreferences({ version: 1, requirePasswordForSigning: true });
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  const listenerCount = process.listenerCount('unhandledRejection');
  process.on('unhandledRejection', onUnhandled);
  try {
    for (const updater of [
      async () => { throw new Error('Rejected async updater.'); },
      async () => ({ theme: 'dark' }),
    ]) await assert.rejects(preferences.updatePreferences(updater), /patch must be an object/i);
    // A real event-loop turn lets Node report unhandled rejections; microtasks alone do not.
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, [], 'rejected async results must be handled even though async updaters are invalid');
    assert.equal(writeAttempts, 0);

    for (const updater of [
      () => ({ then(_resolve, reject) { reject(new Error('Rejected thenable updater.')); } }),
      () => ({ then(resolve) { resolve({ theme: 'dark' }); } }),
      () => ({ then() { throw new Error('Throwing thenable updater.'); } }),
    ]) await assert.rejects(preferences.updatePreferences(updater), /patch must be an object/i);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
    assert.equal(writeAttempts, 0, 'fulfilled and rejected async results never become patches');
    assert.deepEqual(data.get('thru_prefs'), { version: 1, requirePasswordForSigning: true });

    const results = await Promise.allSettled([
      preferences.updatePreferences(async () => { throw new Error('Queued async updater failed.'); }),
      preferences.updatePreferences(() => ({ theme: 'light' })),
    ]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(results.map((result) => result.status), ['rejected', 'fulfilled']);
    assert.match(results[0].reason.message, /patch must be an object/i);
    assert.deepEqual(unhandled, [], 'queue recovery does not leave the original async rejection unhandled');
    assert.equal(writeAttempts, 1);
    assert.equal(writes, 1);
    assert.equal(data.get('thru_prefs').theme, 'light');
    assert.equal(data.get('thru_prefs').requirePasswordForSigning, true);
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
  assert.equal(process.listenerCount('unhandledRejection'), listenerCount, 'the rejection observer is removed');
});

console.log(`[storage migrations] PASS ${groups}/${groups} test groups`);
