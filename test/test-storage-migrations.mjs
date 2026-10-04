import assert from 'node:assert/strict';

const data = new Map();
globalThis.chrome = {
  storage: { local: {
    async get(key) {
      if (key === null) return Object.fromEntries(data);
      return { [key]: data.get(key) };
    },
    async set(values) { for (const [key, value] of Object.entries(values)) data.set(key, value); },
    async remove(key) { for (const item of Array.isArray(key) ? key : [key]) data.delete(item); },
  } },
};

const preferences = await import('../src/background/services/preferences-service.js');
const contacts = await import('../src/background/services/contacts-service.js');

console.log('[storage migrations] preferences reject future schemas and migrate v0 explicitly');
data.set('thru_prefs', { fiatCurrency: 'INR', requirePasswordForSigning: false });
const migratedPreferences = await preferences.getPreferences();
assert.equal(migratedPreferences.version, 1);
assert.equal(migratedPreferences.fiatCurrency, 'INR');
assert.equal(migratedPreferences.requirePasswordForSigning, false);
await preferences.setPreferences({ fiatCurrency: 'USD' });
assert.equal(data.get('thru_prefs').version, 1, 'the next mutation persists the migrated version');
data.set('thru_prefs', { version: 99, requirePasswordForSigning: true });
await assert.rejects(preferences.getPreferences(), /newer than this wallet/i);
console.log('  ok - v0 is lossless and a future security schema fails closed');

console.log('[storage migrations] contacts migrate the legacy array to a versioned envelope');
const address = 'taEREREREREREREREREREREREREREREREREREREREREREg';
data.set('thru_contacts', [{ address, label: 'Legacy', createdAt: 1 }]);
assert.equal((await contacts.listContacts())[0].label, 'Legacy');
await contacts.putContact(address, 'Migrated');
assert.equal(data.get('thru_contacts').version, 1);
assert.equal(data.get('thru_contacts').records[0].label, 'Migrated');
data.set('thru_contacts', { version: 99, records: [] });
await assert.rejects(contacts.listContacts(), /newer than this wallet/i);
console.log('  ok - v0 remains readable, mutation writes v1, and future versions fail closed');
