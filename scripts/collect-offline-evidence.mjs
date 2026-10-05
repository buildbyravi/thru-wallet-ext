#!/usr/bin/env node
// Collects OFFLINE Gate-0 evidence for the DeFi workstream (docs/defi/).
//
// What it records (all local, reproducible, NO network access):
//   - the exact @thru/* pins in package.json vs what npm actually installed (drift),
//     lockfile integrity presence, declared licenses, license-file presence, install scripts
//   - the pinned @thru/programs subpath surfaces (bootstrap-addresses with the declared
//     managed-program addresses, token, amm, multicall, oracle): export names only
//   - @thru/sdk root surface (export name list)
//   - contract facts from src/shared/contract/manifest.js (version, method count, events,
//     auth classes, presence of the existing methods the DeFi shared contract relies on)
//   - network facts from src/lib/networks.js (enabled set, fee provenance, RPC origin)
//
// What it does NOT do: contact any chain, docs site or registry. Package-surface facts are
// declarations, not live-network evidence; live rows of the Gate 0 dossier
// (docs/defi/G0_DOSSIER.md) require the scripts/verify-* / probe-* tools on a
// network-reachable machine.
//
// Usage:
//   node scripts/collect-offline-evidence.mjs                 # writes scripts/defi-evidence/<date>-package-surface.json
//   node scripts/collect-offline-evidence.mjs --check         # exit non-zero on pin drift / missing pieces
//   node scripts/collect-offline-evidence.mjs --date 2026-10-05 --out <path>

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'package.json'));

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
const CHECK = process.argv.includes('--check');
const DATE = argValue('--date') || new Date().toISOString().slice(0, 10);
const OUT = argValue('--out') || join(ROOT, 'scripts', 'defi-evidence', `${DATE}-package-surface.json`);
const THRU_PKGS = ['@thru/sdk', '@thru/programs'];
const PROGRAM_SUBPATHS = ['bootstrap-addresses', 'token', 'amm', 'multicall', 'oracle'];

// The existing methods the DeFi shared contract (docs/defi/G0_DOSSIER.md, S6) builds on.
// A missing entry here blocks M0 planning, so --check fails on it.
const SHARED_CONTRACT_RELIES_ON = [
  'tx.getBalances', 'tx.getCachedBalances', 'tx.getTotalBalance',
  'token.getBalances', 'token.readMint', 'token.deriveTokenAccount',
  'tx.getHistoryFeed', 'tx.getDetail', 'tx.getPending', 'tx.reconcilePending',
  'tx.checkDuplicate', 'tx.sendChecked', 'token.transferChecked', 'tx.registerAccount',
  'tx.checkHealth', 'tx.validateAddress',
  'settings.get', 'settings.set', 'settings.setSecurity',
  'network.getActive', 'system.ping',
  'tx.simulate', 'tx.estimateFee',
];

const failures = [];
const note = (ok, what) => { if (!ok) failures.push(what); };

const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));

function pkgMeta(name) {
  const dir = join(ROOT, 'node_modules', ...name.split('/'));
  const meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const licenseFiles = readdirSync(dir).filter((f) => /^licen[cs]e/i.test(f));
  const license = licenseFiles.length
    ? {
        present: true,
        file: licenseFiles[0],
        sha256: createHash('sha256').update(readFileSync(join(dir, licenseFiles[0]))).digest('hex'),
      }
    : { present: false };
  const pinned = (rootPkg.dependencies || {})[name] || (rootPkg.devDependencies || {})[name] || null;
  const lockEntry = (lock.packages || {})[`node_modules/${name}`] || null;
  // npm refuses non-semver ranges for registry deps; our house rule is exact pins, so equality is the gate.
  note(pinned === meta.version, `pin drift: ${name} pinned=${pinned} installed=${meta.version}`);
  note(lockEntry && lockEntry.version === meta.version && typeof lockEntry.integrity === 'string',
    `lockfile drift or missing integrity: ${name}`);
  note(!meta.scripts || Object.keys(meta.scripts).every((k) => !/^(preinstall|install|postinstall|prepare)$/.test(k)),
    `${name} declares install scripts (B13 forbids them)`);
  return {
    name,
    pinned,
    installedVersion: meta.version,
    declaredLicense: meta.license || null,
    licenseFile: license,
    exportKeys: Object.keys(meta.exports || {}),
    installScripts: meta.scripts || null,
  };
}

async function subpathSurface(sub) {
  try {
    const mod = await import(`${THRU_PKGS[1]}/${sub}`);
    const names = Object.keys(mod).sort();
    const surface = { ok: true, exports: names };
    if (sub === 'bootstrap-addresses') {
      // Public managed-program constants: recorded verbatim as package-declared facts.
      surface.declaredConstants = {
        BOOTSTRAP_PROGRAM_ADDRESSES: mod.BOOTSTRAP_PROGRAM_ADDRESSES ?? null,
        BOOTSTRAP_STATE_ADDRESSES: mod.BOOTSTRAP_STATE_ADDRESSES ?? null,
        BOOTSTRAP_FAUCET_VAULT_ADDRESS: mod.BOOTSTRAP_FAUCET_VAULT_ADDRESS ?? null,
      };
    }
    return surface;
  } catch (err) {
    note(false, `failed to import @thru/programs/${sub}: ${err.message}`);
    return { ok: false, error: String(err.message || err) };
  }
}

const installed = {};
for (const name of THRU_PKGS) installed[name] = pkgMeta(name);

const programsSurfaces = {};
for (const sub of PROGRAM_SUBPATHS) programsSurfaces[sub] = await subpathSurface(sub);

let sdkSurface;
try {
  const sdk = await import(THRU_PKGS[0]);
  sdkSurface = { ok: true, exports: Object.keys(sdk).sort() };
} catch (err) {
  note(false, `failed to import @thru/sdk: ${err.message}`);
  sdkSurface = { ok: false, error: String(err.message || err) };
}

const manifest = await import(join(ROOT, 'src', 'shared', 'contract', 'manifest.js')).catch(() => null);
let contract = null;
if (manifest && manifest.METHODS) {
  const missing = SHARED_CONTRACT_RELIES_ON.filter((m) => !manifest.METHODS[m]);
  note(missing.length === 0, `manifest is missing shared-contract methods: ${missing.join(', ')}`);
  contract = {
    version: manifest.CONTRACT_VERSION,
    methodCount: Object.keys(manifest.METHODS).length,
    eventsMap: Object.keys(manifest.EVENTS || {}).sort(),
    authClasses: [...new Set(Object.values(manifest.METHODS).map((v) => v.auth))].sort(),
    sharedContractReliesOn: { present: SHARED_CONTRACT_RELIES_ON.filter((m) => manifest.METHODS[m]), missing },
  };
} else {
  note(false, 'could not import src/shared/contract/manifest.js');
}

let networks = null;
try {
  const nets = await import(join(ROOT, 'src', 'lib', 'networks.js'));
  const list = Object.values(nets.NETWORKS).map((n) => ({
    id: n.id,
    enabled: n.enabled === true,
    rpcOrigin: n.rpcUrl ? new URL(n.rpcUrl).origin : null,
    baseFeeUnits: n.baseFeeUnits === null || n.baseFeeUnits === undefined ? null : String(n.baseFeeUnits),
    feeSource: n.feeSource ?? null,
  }));
  networks = { defaultNetwork: nets.DEFAULT_NETWORK, list };
} catch (err) {
  note(false, `could not import src/lib/networks.js: ${err.message}`);
}

const evidence = {
  id: `${DATE}-package-surface`,
  kind: 'package-surface',
  network: null,
  dateUtc: DATE,
  tool: `scripts/collect-offline-evidence.mjs (node ${process.version})`,
  confidence: 'high for local reproducible facts (pins, package surfaces, repo identifiers). Package declarations are NOT live-network evidence and are NOT official-doc evidence.',
  installed,
  programsSurfaces,
  sdkSurface,
  contract,
  networks,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(evidence, null, 2) + '\n');
console.log(`wrote ${OUT}`);

if (CHECK) {
  if (failures.length) {
    for (const f of failures) console.error(`FAIL ${f}`);
    process.exit(2);
  }
  console.log('collect-offline-evidence --check PASS');
}
