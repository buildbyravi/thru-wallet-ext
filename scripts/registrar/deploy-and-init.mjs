#!/usr/bin/env node
// Deploy + initialize thru-custom-registrar (side-by-side name registrar) on a REAL
// chain. Runs on the OWNER HOST — the Arena sandbox network does not reach
// rpc.betanet.thru.org ("fetch failed" range-blocked since 2026-10; the name-service
// probe lived with the same constraint and ran on the owner's machine).
//
//   THRU_SEED="word1 … word12" node scripts/registrar/deploy-and-init.mjs \
//     --root thru --fee 1000 --treasury <ta…treasury address> \
//     --bin contracts/thru-custom-registrar/target/riscv64imac-unknown-none-elf/release/thru-custom-registrar.bin
//
// EXPERIMENTS/CONVENTIONS FOLLOWED (all in-repo or first-party):
//   * Live plumbing style: scripts/measure-fee.mjs (thru-client configureNetwork +
//     faucet funding + SDK keys). Mnemonic → keys: vault.js (MnemonicGenerator.toSeed +
//     ThruHDWallet.getAccount) — the deployer equals wallet "Account N" for
//     --hd-index N, so the owner can see the deployer/treasury in their own wallet.
//   * Deployment: pinned @thru/programs 0.4.2 `deploy.deployProgram` workflow
//     (uploader chunks + manager commit; address = deriveManagedProgramAddresses(seed)).
//   * Initialize: ONE transaction to the freshly deployed program; in-program CPI
//     creates the root AND names the program-owned config account as its authority
//     (see contracts/thru-custom-registrar/README.md "Why this design").
//
// HONESTY RULES: --treasury is required (we never invent a fee sink); --bin is
// required (we never deploy an imagined artifact); every step prints and returns
// non-zero on the first failure; evidence JSON is written per run.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EVIDENCE_DIR = join(REPO_ROOT, 'scripts', 'defi-evidence');

// ---------- argv parsing ----------------------------------------------------------------
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
const ROOT_NAME = flags.get('root');
const FEE_PER_YEAR = flags.has('fee') ? BigInt(flags.get('fee')) : null;
const TREASURY = flags.get('treasury');
const BIN_PATH = flags.get('bin');
const SEED = flags.get('seed') ?? 'thru-custom-registrar:v1';
const HD_INDEX = Number(flags.get('hd-index') ?? 0);
const FUND_TARGET = BigInt(flags.get('fund') ?? '20000'); // base units before deploy

function die(msg) { console.error(`\nFATAL: ${msg}`); process.exit(1); }
function step(truth, label, detail = '') {
  console.log(`${truth ? ' ok' : 'FAIL'} - ${label}${detail ? ` — ${detail}` : ''}`);
  if (!truth) process.exit(1);
}

if (!ROOT_NAME) die('pass --root <root name> (e.g. --root thru)');
if (FEE_PER_YEAR === null) die('pass --fee <base units per year> (Betanet intent: 1000)');
if (FEE_PER_YEAR < 0n) die('--fee must be non-negative base units');
if (!TREASURY) die('pass --treasury <ta…> — the fee destination; we never invent one');
if (!BIN_PATH) die('pass --bin <compiled .bin> — see contracts/thru-custom-registrar/README.md');
if (!existsSync(resolve(BIN_PATH))) die(`compiled artifact not found: ${resolve(BIN_PATH)}`);
const mnemonic = (process.env.THRU_SEED ?? '').trim();
if (!mnemonic) die('THRU_SEED env var with the deployer mnemonic is required (never persisted)');
step(true, 'inputs', `network=${NETWORK_ID} root=${ROOT_NAME} fee=${FEE_PER_YEAR} treasury=${TREASURY.slice(0, 10)}… path=${BIN_PATH}`);

// ---------- wallet plumbing --------------------------------------------------------------
const { MnemonicGenerator, ThruHDWallet } = await import('@thru/sdk/crypto');
const thruClient = await import(join(REPO_ROOT, 'src/lib/thru-client.js'));
const { getNetworkConfig } = await import(join(REPO_ROOT, 'src/lib/networks.js'));

const network = getNetworkConfig(NETWORK_ID);
thruClient.configureNetwork(network);
step(true, 'network bound', `${network.label} @ ${network.rpcUrl ?? network.rpc ?? '(configured)'}`);

const seedBytes = MnemonicGenerator.toSeed(mnemonic);
const account = await ThruHDWallet.getAccount(seedBytes, HD_INDEX);
const deployer = { publicKey: account.publicKey, privateKey: account.privateKey, address: account.address };
step(true, 'deployer key', `${account.address} (HD index ${HD_INDEX})`);

// funding: we need deploy + init fees (fee headers are 0n but account creation and the
// uploader steps have their own network-side costs). Fund ONLY what's asked, honestly.
let info = await thruClient.getAccountInfo(deployer.address).catch(() => ({ exists: false, balance: 0n }));
if (BigInt(info.balance ?? 0n) < FUND_TARGET) {
  const cap = network.faucetMaxPerClaim ?? 10_000n;
  process.stdout.write(` funding ${deployer.address.slice(0, 12)}… to ${FUND_TARGET} base units via faucet (cap ${cap}/claim)`);
  let guard = 0;
  while (BigInt((await thruClient.getAccountInfo(deployer.address).catch(() => ({ balance: 0n }))).balance ?? 0n) < FUND_TARGET && guard < 40) {
    try { await thruClient.claimFaucet(deployer, cap); } catch (e) { console.log(`\n  faucet claim failed: ${e?.message ?? e}`); }
    guard += 1;
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log('');
}
info = await thruClient.getAccountInfo(deployer.address).catch(() => ({ exists: false, balance: 0n }));
step(BigInt(info.balance ?? 0n) >= 1n, 'deployer funded', `${info.balance} base units`);

// ---------- 1. deploy the program --------------------------------------------------------
const { deriveManagedProgramAddresses } = await import('@thru/programs/manager');
const { deployProgram } = await import('@thru/programs/deploy');

const managed = deriveManagedProgramAddresses(SEED);
const registrarProgramAddress = managed.programAccountAddress;
step(true, 'registrar program address (seed-derived)', registrarProgramAddress);

const existing = await thruClient.getAccountInfo(registrarProgramAddress).catch(() => null);
if (existing?.exists) {
  console.log(`  (something already exists at the derived program address — reusing it and skipping upload; verify before init claims)`);
} else {
  console.log('  uploading bytecode chunks + commit…');
  const result = await deployProgram({
    seed: SEED,
    program: new Uint8Array(readFileSync(resolve(BIN_PATH))),
    signer: { address: deployer.address, privateKey: deployer.privateKey },
    client: thruClient.getClient(),
    onProgress: (ev) => console.log(`    [${ev.phase}] ${ev.status ?? ''} ${ev.message ?? ''}`.trim()),
  });
  step(!!result?.programAccountAddress, 'deployProgram finished', result?.programAccountAddress);
  step(result.programAccountAddress === registrarProgramAddress, 'deployed address matches derivation');
}

// ---------- 2. Initialize (config create + init-root CPI inside the program) --------------
const {
  buildTcrInitializeInstructionData, tcrConfigAddress, TCR_CONFIG_SEED_LABEL,
} = await import(join(REPO_ROOT, 'src/lib/custom-registrar.js'));
const nsLib = await import(join(REPO_ROOT, 'src/lib/name-service.js'));

const configAddress = tcrConfigAddress(registrarProgramAddress);
const rootAddress = await nsLib.rootRegistrarAddress(ROOT_NAME);
step(true, 'config + root derived', `config=${configAddress.slice(0, 14)}… root=${rootAddress.slice(0, 14)}…`);

const client = thruClient.getClient();
const configProof = (await client.proofs.generate({ address: configAddress, proofType: 1 })).proof;
const rootProof = (await client.proofs.generate({ address: rootAddress, proofType: 1 })).proof;
step(configProof?.length > 0 && rootProof?.length > 0, 'creation proofs generated');

const configSeed = new Uint8Array(32);
configSeed.set(new TextEncoder().encode(TCR_CONFIG_SEED_LABEL));

const NS_PROGRAM = nsLib.NAME_SERVICE_PROGRAM;
ok('using pinned native name-service program', /^ta/.test(NS_PROGRAM), NS_PROGRAM);

// Account lists per role (SDK byte-sorts them into the final table; the u16 indices
// are resolved INSIDE the instructionData callback via the SDK's getAccountIndex —
// Thru ABI convention, same as the first-party name-service/faucet builders).
// Roles: admin=feePayer(0) · program(1) · config(rw,new) · root(rw,new) · name-service(ro)
const { rawTransaction } = await client.transactions.buildAndSign({
  feePayer: { publicKey: deployer.publicKey, privateKey: deployer.privateKey },
  program: registrarProgramAddress,
  header: { computeUnits: 2_000_000, memoryUnits: 32_768, stateUnits: 4, fee: 0n },
  accounts: {
    readWrite: [configAddress, rootAddress],
    readOnly: [NS_PROGRAM],
  },
  instructionData: ({ getAccountIndex }) => buildTcrInitializeInstructionData({
    feePerYear: FEE_PER_YEAR,
    treasury: TREASURY,
    rootName: ROOT_NAME,
    configSeed,
    configProof,
    rootProof,
    indexOf: getAccountIndex,
    configAddress,
    rootAddress,
    nameServiceProgram: NS_PROGRAM,
  }),
});
step(!!rawTransaction?.length, 'Initialize built+signed');

let signature = null;
let streamResult = null;
let streamError = null;
for await (const update of client.transactions.sendAndTrack(rawTransaction)) {
  if (update?.signature?.value && !signature) {
    const { formatSignature } = await import(join(REPO_ROOT, 'src/lib/registrar.js'));
    signature = formatSignature(update.signature.value);
  }
  if (update?.executionResult) streamResult = update.executionResult;
  if (update?.error) streamError = update.error;
}
step(!!signature && !streamError, 'Initialize broadcast', signature ?? String(streamError ?? 'no signature'));
const vmError = Number(streamResult?.vmError ?? -1);
step(vmError === 0, 'Initialize executed (vmError 0)',
  streamResult ? `vmError=${streamResult.vmError} userErrorCode=${streamResult.userErrorCode ?? 0}` : 'stream ended without an execution result (timeout) — check the explorer before re-running');

const cfgInfo = await thruClient.getAccountInfo(configAddress).catch(() => null);
const rootInfo = await thruClient.getAccountInfo(rootAddress).catch(() => null);
step(!!cfgInfo?.exists, 'config account exists on-chain');
step(!!rootInfo?.exists, 'root registrar account exists on-chain');

// Parse what got written — deployment is only real if the state decodes.
try {
  const { parseTcrConfig } = await import(join(REPO_ROOT, 'src/lib/custom-registrar.js'));
  const raw = cfgInfo.raw instanceof Uint8Array ? cfgInfo.raw : cfgInfo.raw?.data;
  const parsed = parseTcrConfig(raw);
  step(parsed.rootName === ROOT_NAME, 'config parses and names the root', JSON.stringify({ rootName: parsed.rootName, fee: parsed.feePerYear.toString(), treasury: parsed.treasury.slice(0, 12) }));
} catch (e) {
  step(false, 'config parses', e?.message ?? String(e));
}

mkdirSync(EVIDENCE_DIR, { recursive: true });
const evidence = {
  date: new Date().toISOString(),
  network: NETWORK_ID,
  seed: SEED,
  hdIndex: HD_INDEX,
  deployer: deployer.address,
  registrarProgramAddress,
  configAddress,
  rootAddress,
  rootName: ROOT_NAME,
  feePerYearBaseUnits: FEE_PER_YEAR.toString(),
  treasury: TREASURY,
  initializeSignature: signature,
  vmError,
  executionResult: streamResult,
};
const evPath = join(EVIDENCE_DIR, `registrar-deploy-${NETWORK_ID}-${ROOT_NAME}-${Date.now()}.json`);
writeFileSync(evPath, JSON.stringify(evidence, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
console.log(`\nDONE. Evidence: ${evPath}`);
console.log('Next: scripts/registrar/probe-live-registrar.mjs — register a real name through the new registrar.');
