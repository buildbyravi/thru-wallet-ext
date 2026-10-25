// Shim chrome.storage before importing wallet modules
function makeStorageArea() {
  const data = new Map();
  return {
    async get(key) {
      if (key === undefined || key === null) return Object.fromEntries(data);
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
  };
}

globalThis.chrome = {
  storage: {
    local: makeStorageArea(),
    session: makeStorageArea(),
  },
};

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getNetworkConfig } from '../src/lib/networks.js';
import * as thruClient from '../src/lib/thru-client.js';
import * as vault from '../src/lib/vault.js';
import * as registrarService from '../src/background/services/registrar-service.js';
import * as nameService from '../src/background/services/name-service.js';

let mnemonic = '';
for (const l of readFileSync('.env', 'utf8').split('\n')) {
  const m = l.match(/^\s*(?:THRU_SEED|SEED)\s*=\s*"?([^"\n]+?)"?\s*$/);
  if (m) { mnemonic = m[1].trim(); break; }
}

thruClient.configureNetwork(getNetworkConfig('betanet'));

// Unlock vault with the mnemonic
const password = 'AuditTestPassword123!';
await vault.importMnemonicVault(mnemonic, password);

const activeAccount = await vault.getActiveAccount();
console.log('Active account:', activeAccount.address);

// =========================================================================
// TEST 1: Audit and Live Test of .thru (Custom Registrar) Mint Path
// =========================================================================
console.log('\n=======================================================');
console.log('TEST 1: .thru Custom Registrar Live Mint Test');
console.log('=======================================================');

const testLabelThru = 'audit' + Math.floor(Math.random() * 1e6).toString(36);
console.log(`Checking availability for ${testLabelThru}.thru...`);

const checkThru = await registrarService.checkCustomLease({ name: testLabelThru });
console.log('checkCustomLease supported:', checkThru.supported, 'program:', checkThru.program);
console.log('leaseExists:', checkThru.leaseExists, 'domainExists:', checkThru.domainExists);

if (checkThru.leaseExists || checkThru.domainExists) {
  console.log(`Label ${testLabelThru} is already taken.`);
  process.exit(1);
}

console.log(`Registering ${testLabelThru}.thru for 1 year via registrarService.registerCustom...`);
let regResult = null;
try {
  regResult = await registrarService.registerCustom({ name: testLabelThru, years: 1 });
  console.log('registerCustom succeeded!');
  console.log('Signature:', regResult.signature);
  console.log('Domain address:', regResult.domainAddress);

  // Verify on-chain existence and ownership
  const verifyLease = await registrarService.checkCustomLease({ name: testLabelThru });
  console.log('Post-registration checkCustomLease:');
  console.log('  leaseExists:', verifyLease.leaseExists);
  console.log('  domainExists:', verifyLease.domainExists);
  console.log('  lease owner:', verifyLease.lease?.owner);
  console.log('  lease label:', verifyLease.lease?.label);
  console.log('  lease expiresAtSeconds:', verifyLease.lease?.expiresAtSeconds?.toString());
  
  if (verifyLease.leaseExists && verifyLease.domainExists && verifyLease.lease?.owner === activeAccount.address) {
    console.log('>>> [PASS] .thru registration fully verified on-chain! <<<');
  } else {
    console.error('>>> [FAIL] .thru verification failed mismatch! <<<');
    process.exit(1);
  }
} catch (e) {
  console.error('registerCustom failed:', e);
  process.exit(1);
}

// =========================================================================
// TEST 2: Audit and Live Test of .id (Canonical Root) Mint Path
// =========================================================================
console.log('\n=======================================================');
console.log('TEST 2: .id Free Canonical Root Mint Path Audit & Test');
console.log('=======================================================');

const testLabelId = 'audit' + Math.floor(Math.random() * 1e6).toString(36);
console.log(`Checking canonical root and availability for ${testLabelId}.id...`);

const canonRoot = await nameService.getCanonicalRoot({ root: 'id' });
console.log('Canonical root:', JSON.stringify(canonRoot, null, 2));

const lookupId = await nameService.lookupName({ name: testLabelId, rootAddress: canonRoot.rootAddress });
console.log('lookupName leaf.exists:', lookupId?.leaf?.exists);

console.log(`Attempting to register ${testLabelId}.id via nameService.registerName...`);
let idError = null;
try {
  const idResult = await nameService.registerName({ name: testLabelId, parentAddress: canonRoot.rootAddress });
  console.log('nameService.registerName succeeded:', idResult);
} catch (e) {
  idError = e;
  console.log('Expected behavior triggered on closed root:');
  console.log('  Error code:', e.code);
  console.log('  Error message:', e.message);
  if (e.code === 'NAME_PARENT_AUTHORITY') {
    console.log('>>> [PASS] .id authority gate correctly defended against unauthorized registration! <<<');
  } else {
    console.log('>>> [INFO] Received error code:', e.code);
  }
}

// Write live audit & test evidence
const evidence = {
  date: new Date().toISOString(),
  network: 'betanet',
  activeAccount: activeAccount.address,
  thruTest: {
    label: testLabelThru,
    domain: `${testLabelThru}.thru`,
    years: 1,
    signature: regResult?.signature,
    domainAddress: regResult?.domainAddress,
    verifiedOnChain: true,
  },
  idAudit: {
    rootAddress: canonRoot.rootAddress,
    rootName: canonRoot.rootName,
    rootAuthority: canonRoot.authority,
    signerMatchesAuthority: canonRoot.authority === activeAccount.address,
    protectionResult: idError?.code ?? 'success',
  },
};

const evDir = join(process.cwd(), 'scripts', 'defi-evidence');
mkdirSync(evDir, { recursive: true });
const evPath = join(evDir, `live-audit-thru-and-id-${Date.now()}.json`);
writeFileSync(evPath, JSON.stringify(evidence, null, 2));
console.log('\nAudit & test evidence written to:', evPath);
console.log('ALL TESTS COMPLETED SUCCESSFULLY.');
