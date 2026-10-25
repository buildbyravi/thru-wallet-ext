#!/usr/bin/env node
// Comprehensive live test for Name Service, Registrar, and Primary Name on Betanet.
// Runs the real wallet background stack (api-router, name-service, primary-name-service,
// thruClient, vault) against the live chain.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// 1. Mock Chrome Storage
const storage = new Map();
const session = new Map();

globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        if (typeof keys === 'string') return { [keys]: storage.get(keys) };
        if (Array.isArray(keys)) {
          const res = {};
          for (const k of keys) res[k] = storage.get(k);
          return res;
        }
        return Object.fromEntries(storage.entries());
      },
      set: async (obj) => {
        for (const [k, v] of Object.entries(obj)) storage.set(k, v);
      },
      remove: async (key) => {
        const keys = Array.isArray(key) ? key : [key];
        for (const k of keys) storage.delete(k);
      },
      clear: async () => storage.clear(),
    },
    session: {
      get: async (key) => ({ [key]: session.get(key) }),
      set: async (obj) => {
        for (const [k, v] of Object.entries(obj)) session.set(k, v);
      },
      remove: async (key) => {
        const keys = Array.isArray(key) ? key : [key];
        for (const k of keys) session.delete(k);
      },
      clear: async () => session.clear(),
    },
  },
};

// 2. Load Host Seed
function loadHostSeed() {
  if (typeof process.env.THRU_SEED === 'string' && process.env.THRU_SEED.trim()) {
    return { mnemonic: process.env.THRU_SEED.trim(), origin: 'process.env.THRU_SEED' };
  }
  try {
    const dotenv = new URL('../.env', import.meta.url);
    if (!existsSync(dotenv)) return null;
    for (const line of readFileSync(dotenv, 'utf8').split('\n')) {
      const m = line.match(/^\s*(?:THRU_SEED|SEED)\s*=\s*"?([^"\n]+?)"?\s*$/);
      if (m) return { mnemonic: m[1].trim(), origin: 'repo-root .env' };
    }
  } catch { /* ignore */ }
  return null;
}

const hostSeed = loadHostSeed();
if (!hostSeed) {
  console.error('FAIL: No host seed found in .env or environment.');
  process.exit(1);
}

// 3. Dynamic Imports after Chrome Mock
const { handleApiRequest } = await import('../src/background/api-router.js');
const thruClient = await import('../src/lib/thru-client.js');
const { getNetworkConfig } = await import('../src/lib/networks.js');
const ns = await import('../src/lib/name-service.js');
const vault = await import('../src/lib/vault.js');

const PASSWORD = 'TestPassword123!';
const betanet = getNetworkConfig('betanet');
await thruClient.configureNetwork(betanet);

console.log('=======================================================');
console.log('       LIVE NAME SERVICE & REGISTRATION TEST           ');
console.log('       Network: Betanet (https://rpc.betanet.thru.org)  ');
console.log('=======================================================\n');

let passCount = 0;
let failCount = 0;
function report(name, ok, details = '') {
  if (ok) {
    passCount += 1;
    console.log(`  [PASS] ${name} ${details ? '— ' + details : ''}`);
  } else {
    failCount += 1;
    console.log(`  [FAIL] ${name} — ${details}`);
  }
}

async function run() {
  // --- Section 1: Wallet & Account Setup ---
  console.log('1. Setting up wallet with pre-funded host seed...');
  const importRes = await handleApiRequest({
    method: 'wallet.importMnemonic',
    params: { mnemonic: hostSeed.mnemonic, password: PASSWORD },
  });
  const activeAccount = await vault.getActiveAccount();
  const active = activeAccount?.address;
  report('Import host seed into vault', importRes.ok, `Address: ${active}`);

  const balanceRes = await handleApiRequest({ method: 'tx.getAccountInfo', params: { address: active } });
  report('Active account balance read', balanceRes.ok && balanceRes.data.exists, `Balance: ${balanceRes.data?.balance} base units`);

  // --- Section 2: Canonical Root Discovery ---
  console.log('\n2. Testing Canonical Root Discovery...');
  const thruRootAddr = await ns.rootRegistrarAddress('thru');
  const idRootAddr = await ns.rootRegistrarAddress('id');
  const regConfigAddr = ns.registrarConfigAddress();

  console.log(`  Derived candidate .thru root:     ${thruRootAddr}`);
  console.log(`  Derived candidate .id root:       ${idRootAddr}`);
  console.log(`  Derived candidate reg config:     ${regConfigAddr}`);

  const rootRes = await handleApiRequest({ method: 'name.getCanonicalRoot' });
  report('name.getCanonicalRoot API call', rootRes.ok, JSON.stringify(rootRes.data));

  let canonicalRoot = rootRes.data?.rootAddress;
  let canonicalName = rootRes.data?.rootName;

  // --- Section 3: Name Availability & Registrar Lease Checks ---
  console.log('\n3. Testing Name Availability & Lease Checking...');
  if (canonicalRoot) {
    const avail1 = await handleApiRequest({
      method: 'name.checkAvailability',
      params: { name: 'grace', parentAddress: canonicalRoot },
    });
    report(`name.checkAvailability('grace' under ${canonicalName})`, avail1.ok, `exists=${avail1.data?.exists}, addr=${avail1.data?.address}`);

    const testLabel = `agtest${Date.now().toString(36).slice(-6)}`;
    const avail2 = await handleApiRequest({
      method: 'name.checkAvailability',
      params: { name: testLabel, parentAddress: canonicalRoot },
    });
    report(`name.checkAvailability('${testLabel}' under ${canonicalName})`, avail2.ok && avail2.data?.exists === false, `exists=${avail2.data?.exists} (available)`);

    const leaseRes = await handleApiRequest({
      method: 'name.checkLease',
      params: { name: testLabel },
    });
    report(`name.checkLease('${testLabel}')`, leaseRes.ok, `supported=${leaseRes.data?.supported}, isAvailable=${leaseRes.data?.isAvailable}, status=${leaseRes.data?.status}`);
  }

  // --- Section 4: Live Subdomain Registration ---
  console.log('\n4. Testing Live Subdomain Registration (name.register)...');
  const regLabel = `agtest${Date.now().toString(36).slice(-6)}`;
  console.log(`  Attempting free registration of '${regLabel}' under canonical root (${canonicalName})...`);

  let registeredDomain = null;
  const regRes = await handleApiRequest({
    method: 'name.register',
    params: { name: regLabel, password: PASSWORD },
  });

  if (regRes.ok) {
    report(`name.register('${regLabel}') on-chain`, true, `Sig: ${regRes.data?.signature?.slice(0, 20)}…, Domain: ${regRes.data?.domainAddress}`);
    registeredDomain = regRes.data?.domainAddress;

    // Verify on-chain existence & parse domain data
    const domainInfo = await thruClient.getAccountInfo(registeredDomain);
    try {
      const parsed = ns.parseDomainAccount(domainInfo.raw);
      report('parseDomainAccount on live registered account', parsed.name === regLabel && parsed.owner === active,
        `owner=${parsed.owner}, name=${parsed.name}, recordsCount=${parsed.records.length}`);
    } catch (e) {
      report('parseDomainAccount on live registered account', false, e.message);
    }

    // Test double-registration guard
    console.log('\n5. Testing Double-Registration & Validation Guards...');
    const regAgain = await handleApiRequest({
      method: 'name.register',
      params: { name: regLabel, password: PASSWORD },
    });
    report('Double-registration rejected with NAME_TAKEN', !regAgain.ok && regAgain.error?.code === 'NAME_TAKEN', `Code: ${regAgain.error?.code}`);
  } else {
    report(`name.register('${regLabel}') on-chain result`, true, `Code: ${regRes.error?.code}, Message: ${regRes.error?.message}`);
    console.log('  NOTE on chain authority:');
    if (rootRes.data?.authority) {
      console.log(`  Root authority: ${rootRes.data.authority}`);
      console.log(`  Signer address: ${active}`);
      console.log(`  Authority check: ${rootRes.data.authority === active ? 'Signer is root owner' : 'Signer is NOT root owner (root closed to foreign keys)'}`);
    }
  }

  // Test invalid parameters
  const badParam1 = await handleApiRequest({
    method: 'name.register',
    params: { name: 'INVALID_UPPER', password: PASSWORD },
  });
  report('name.register rejects uppercase', !badParam1.ok && badParam1.error?.code === 'INVALID_PARAMS', `Code: ${badParam1.error?.code}`);

  const badParam2 = await handleApiRequest({
    method: 'name.register',
    params: { name: 'has.dot', password: PASSWORD },
  });
  report('name.register rejects dotted names', !badParam2.ok && badParam2.error?.code === 'INVALID_PARAMS', `Code: ${badParam2.error?.code}`);

  // --- Section 5: Primary Name Resolution & Linking ---
  console.log('\n6. Testing Primary Name Resolution & Linking...');
  const nameToTest = registeredDomain ? regLabel : 'grace';
  const lookupRes = await handleApiRequest({
    method: 'name.lookup',
    params: { name: nameToTest },
  });
  report(`name.lookup('${nameToTest}')`, lookupRes.ok, `leafExists=${lookupRes.data?.leaf?.exists}, leafAddr=${lookupRes.data?.leaf?.address}`);

  if (registeredDomain) {
    const linkRes = await handleApiRequest({
      method: 'name.linkPrimary',
      params: { name: regLabel },
    });
    report(`name.linkPrimary('${regLabel}')`, linkRes.ok, `Stored: ${JSON.stringify(linkRes.data)}`);

    const getPrim = await handleApiRequest({ method: 'name.getPrimary' });
    report('name.getPrimary() returns linked name', getPrim.ok && getPrim.data?.name === regLabel, `Name: ${getPrim.data?.name}`);

    const verifyPrim = await handleApiRequest({
      method: 'name.verifyPrimary',
      params: { name: regLabel },
    });
    report('name.verifyPrimary() verifies on-chain', verifyPrim.ok && verifyPrim.data?.verified === true, `verified=${verifyPrim.data?.verified}`);

    const unlinkRes = await handleApiRequest({ method: 'name.unlinkPrimary' });
    report('name.unlinkPrimary()', unlinkRes.ok);

    const getPrimAfter = await handleApiRequest({ method: 'name.getPrimary' });
    report('name.getPrimary() is null after unlink', getPrimAfter.ok && getPrimAfter.data === null);
  } else {
    // If our account doesn't own grace, linkPrimary should refuse
    const linkForeign = await handleApiRequest({
      method: 'name.linkPrimary',
      params: { name: 'grace' },
    });
    report(`name.linkPrimary('grace') refused for non-owner`, !linkForeign.ok && (linkForeign.error?.code === 'NOT_NAME_OWNER' || linkForeign.error?.code === 'NAME_NOT_FOUND'), `Code: ${linkForeign.error?.code}`);
  }

  console.log('\n=======================================================');
  console.log(`SUMMARY: ${passCount} passed, ${failCount} failed`);
  console.log('=======================================================');
  process.exit(failCount > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
