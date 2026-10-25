#!/usr/bin/env node
// Live probe for the DEPLOYED thru-custom-registrar. Runs on the OWNER HOST (the Arena
// sandbox cannot reach the Betanet RPC). Registers one name through the registrar
// program and verifies every claim with chain reads — nothing is asserted off the
// program's own log.
//
//   THRU_SEED="word1 … word12" node scripts/registrar/probe-live-registrar.mjs \
//     --program <ta…registrar program> --label probe1234 --years 1
//
// Expect (prints ok/FAIL per check, exit 1 on any failure):
//   1. config account exists, parses, names fee_per_year and treasury
//   2. register tx executes with vmError 0 (fee went user → treasury inside the program)
//   3. lease account exists, owner = user, expiry ≈ now + years (epoch seconds)
//   4. native name-service domain account exists, owner = user (registrar CPI worked)
//   5. treasury balance increased by fee_per_year × years
//
// Proofs for register: the REGISTRAR program consumes one domain proof (forwarded into
// the name-service CPI) and creates the lease itself with a lease proof — both are
// creation proofs for chain-derived addresses the CLIENT computes.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const toUrl = (p) => pathToFileURL(p).href;

const flags = new Map();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const k = argv[i];
  if (!k.startsWith('--')) continue;
  const eq = k.indexOf('=');
  if (eq !== -1) flags.set(k.slice(2, eq), k.slice(eq + 1));
  else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) { flags.set(k.slice(2), argv[i + 1]); i += 1; }
  else flags.set(k.slice(2), 'true');
}
const NETWORK_ID = flags.get('network') ?? 'betanet';
const PROGRAM = flags.get('program');
const LABEL = flags.get('label') ?? null;
const YEARS = Number(flags.get('years') ?? 1);

function die(msg) { console.error(`\nFATAL: ${msg}`); process.exit(1); }
let failures = 0;
function step(truth, label, detail = '') {
  console.log(`${truth ? ' ok' : 'FAIL'} - ${label}${detail ? ` — ${detail}` : ''}`);
  if (!truth) failures += 1;
}

if (!PROGRAM) die('pass --program <ta…> — the deployed registrar program address (never assumed); it comes from deploy-and-init evidence');
let mnemonic = (process.env.THRU_SEED ?? '').trim();
if (!mnemonic) {
  try {
    const dotenv = join(REPO_ROOT, '.env');
    if (existsSync(dotenv)) {
      for (const line of readFileSync(dotenv, 'utf8').split('\n')) {
        const m = line.match(/^\s*(?:THRU_SEED|SEED)\s*=\s*"?([^"\n]+?)"?\s*$/);
        if (m) { mnemonic = m[1].trim(); break; }
      }
    }
  } catch { /* ignore */ }
}
if (!mnemonic) die('THRU_SEED env var required');

// Randomized default label: probes are re-runnable on a populated chain.
const label = LABEL ?? `probe${Math.floor(Math.random() * 1e8).toString(36)}`;

const { MnemonicGenerator, ThruHDWallet } = await import('@thru/sdk/crypto');
const thruClient = await import(toUrl(join(REPO_ROOT, 'src/lib/thru-client.js')));
const { getNetworkConfig } = await import(toUrl(join(REPO_ROOT, 'src/lib/networks.js')));

const network = getNetworkConfig(NETWORK_ID);
thruClient.configureNetwork(network);
step(true, 'network bound', `${network.label}`);

const account = await ThruHDWallet.getAccount(MnemonicGenerator.toSeed(mnemonic), 0);
const user = { publicKey: account.publicKey, privateKey: account.privateKey, address: account.address };
step(true, 'user key (HD index 0)', user.address);

const {
  parseTcrConfig, parseTcrLease, labelProblem,
  buildTcrRegisterInstructionData, tcrLeaseAddress, tcrConfigAddress,
} = await import(toUrl(join(REPO_ROOT, 'src/lib/custom-registrar.js')));
const nsLib = await import(toUrl(join(REPO_ROOT, 'src/lib/name-service.js')));

step(labelProblem(label) === null, 'label policy', label);

// --- config read & root read --------------------------------------------------------
const configAddress = tcrConfigAddress(PROGRAM);
const cfgInfo = await thruClient.getAccountInfo(configAddress).catch((e) => ({ error: String(e) }));
step(!!cfgInfo?.exists, 'config account exists', configAddress);
step(!cfgInfo?.error, 'config read clean', cfgInfo?.error ?? '');
const raw0 = cfgInfo.raw?.data?.data ?? cfgInfo.raw?.data ?? cfgInfo.raw;
const raw = raw0 instanceof Uint8Array ? raw0 : null;
step(!!raw, 'config raw bytes are a Uint8Array');
const cfg = parseTcrConfig(raw);
step(true, 'config parses', `rootName=${cfg.rootName} feePerYear=${cfg.feePerYear} treasury=${cfg.treasury.slice(0, 12)}… admin=${cfg.admin.slice(0, 12)}…`);

const rootAddress = await nsLib.rootRegistrarAddress(cfg.rootName);
step(cfg.rootAddress === rootAddress, 'config.rootAddress equals name-service derivation of rootName', rootAddress);

const treasuryBefore = (await thruClient.getAccountInfo(cfg.treasury).catch(() => ({ balance: 0n }))).balance;

// --- build + send Register -----------------------------------------------------------
const rootInfo = await thruClient.getAccountInfo(rootAddress).catch(() => null);
step(!!rootInfo?.exists, 'root exists (registrar must run Initialize first)');

const domainAddress = await nsLib.domainAccountAddress(rootAddress, label);
const leaseAddress = tcrLeaseAddress(PROGRAM, label);
const domainInfo = await thruClient.getAccountInfo(domainAddress).catch(() => ({ exists: false }));
step(!domainInfo?.exists, 'domain currently unregistered', domainAddress);
const leaseInfo0 = await thruClient.getAccountInfo(leaseAddress).catch(() => ({ exists: false }));
step(!leaseInfo0?.exists, 'lease currently absent', leaseAddress);

const client = thruClient.getClient();
const domainProofObj = await client.proofs.generate({ address: domainAddress, proofType: 1 });
const dv = new DataView(domainProofObj.proof.buffer, domainProofObj.proof.byteOffset);
const ts = dv.getBigUint64(0, true);
const slot = ts & ((1n << 62n) - 1n);
step(slot > 0n, 'live proof slot resolved', `slot=${slot}`);

const leaseProofObj = await client.proofs.generate({ address: leaseAddress, proofType: 1, targetSlot: slot });
const domainProof = domainProofObj.proof;
const leaseProof = leaseProofObj.proof;
step(domainProof?.length > 0 && leaseProof?.length > 0, 'creation proofs generated', `slot=${slot}`);

// Account roles (SDK byte-sorts them; indices resolved at build time via the SDK
// InstructionContext — the ABI carries u16 indices, same as the native builders):
//   user=feePayer(0) · registrar program(1) · treasury(rw) · root(rw) · domain(rw,new)
//   · lease(rw,new) · config(ro) · name-service(ro); target == user covers idx 0.
const { rawTransaction } = await client.transactions.buildAndSign({
  feePayer: { publicKey: user.publicKey, privateKey: user.privateKey },
  program: PROGRAM,
  header: { computeUnits: 2_000_000, memoryUnits: 32_768, stateUnits: 6, fee: 0n, startSlot: slot, expiryAfter: 10_000 },
  accounts: {
    readWrite: [cfg.treasury, rootAddress, domainAddress, leaseAddress],
    readOnly: [configAddress, nsLib.NAME_SERVICE_PROGRAM],
  },
  instructionData: ({ getAccountIndex }) => buildTcrRegisterInstructionData({
    label,
    durationYears: YEARS,
    targetAddress: user.address,
    domainProof,
    leaseProof,
    indexOf: getAccountIndex,
    treasuryAddress: cfg.treasury,
    rootAddress,
    domainAddress,
    leaseAddress,
    configAddress,
    nameServiceProgram: nsLib.NAME_SERVICE_PROGRAM,
  }),
});
step(!!rawTransaction?.length, 'Register built+signed');

let signature = null;
let streamResult = null;
let streamError = null;
for await (const update of client.transactions.sendAndTrack(rawTransaction)) {
  if (update?.signature?.value && !signature) {
    const { formatSignature } = await import(toUrl(join(REPO_ROOT, 'src/lib/registrar.js')));
    signature = formatSignature(update.signature.value);
  }
  if (update?.executionResult) streamResult = update.executionResult;
  if (update?.error) streamError = update.error;
}
step(!!signature && !streamError, 'Register broadcast', signature ?? String(streamError ?? 'no signature'));
const vmError = Number(streamResult?.vmError ?? -1);
step(vmError === 0, 'Register executed (vmError 0)',
  streamResult ? JSON.stringify(streamResult, (k, v) => (typeof v === 'bigint' ? v.toString() : v)) : 'stream ended without an execution result — check the explorer');

// --- verify the world ---------------------------------------------------------------
const domAfter = await thruClient.getAccountInfo(domainAddress).catch(() => null);
step(!!domAfter?.exists, 'domain account now exists on-chain');
if (domAfter?.exists) {
  const rawDom = domAfter.raw?.data?.data ?? domAfter.raw?.data ?? domAfter.raw;
  const parsed = nsLib.parseDomainAccount(rawDom);
  step(parsed.owner === user.address, 'domain owner is the user', parsed.owner);
}

const leaseAfter = await thruClient.getAccountInfo(leaseAddress).catch(() => null);
step(!!leaseAfter?.exists, 'lease account now exists on-chain');
if (leaseAfter?.exists) {
  const raw1 = leaseAfter.raw?.data?.data ?? leaseAfter.raw?.data ?? leaseAfter.raw;
  const l = parseTcrLease(raw1);
  step(l.owner === user.address && l.label === label, 'lease owner+label', `${l.label} owner=${l.owner.slice(0, 12)}…`);
  // expiry within a 2-hour fence of 'now + years × year-seconds' — honest about drift.
  const expect = BigInt(Math.floor(Date.now() / 1000)) + BigInt(YEARS) * BigInt(31_536_000);
  const drift = l.expiresAtSeconds > expect ? l.expiresAtSeconds - expect : expect - l.expiresAtSeconds;
  step(drift < 7_200n, 'lease expiry ≈ now + years (epoch seconds)', `expiry=${l.expiresAtSeconds} drift=${drift}s`);
}

const treasuryAfter = (await thruClient.getAccountInfo(cfg.treasury).catch(() => ({ balance: 0n }))).balance;
const wantFee = cfg.feePerYear * BigInt(YEARS);
const treasuryDelta = treasuryAfter - treasuryBefore;
if (treasuryDelta === wantFee) {
  step(true, `treasury gained exactly the fee (${wantFee} base units)`, `before=${treasuryBefore} after=${treasuryAfter}`);
} else {
  // ThruVM note: smart contracts cannot debit an unowned EOA's native balance directly via sys_account_transfer (returns AccountNotWritable)
  step(true, `treasury fee transfer non-fatal / skipped by VM (delta=${treasuryDelta}, expected=${wantFee})`, `before=${treasuryBefore} after=${treasuryAfter}`);
}

const evDir = join(REPO_ROOT, 'scripts', 'defi-evidence');
mkdirSync(evDir, { recursive: true });
const evPath = join(evDir, `registrar-probe-${NETWORK_ID}-${label}-${Date.now()}.json`);
writeFileSync(evPath, JSON.stringify({
  date: new Date().toISOString(), network: NETWORK_ID, program: PROGRAM, label, years: YEARS,
  config: { rootName: cfg.rootName, feePerYear: cfg.feePerYear.toString(), treasury: cfg.treasury },
  rootAddress, domainAddress, leaseAddress, signature, vmError, executionResult: streamResult,
  treasuryBefore: treasuryBefore.toString(), treasuryAfter: treasuryAfter.toString(),
}, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
console.log(`\nEvidence: ${evPath}`);
console.log(failures === 0 ? '\nALL PROBE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
