#!/usr/bin/env node
// Deploy + initialize thru-custom-registrar (side-by-side name registrar) on a REAL
// chain. Runs on the OWNER HOST — the Arena sandbox network does not reach
// rpc.betanet.thru.org ("fetch failed" range-blocked since 2026-10; the name-service
// probe lived with the same constraint and ran on the owner's machine).
//
//   THRU_SEED="word1 … word12" node scripts/registrar/deploy-and-init.mjs \
//     --root thru --fee-3 100000 --fee-4 10000 --fee-5plus 1000 \
//     --fee-policy best-effort --treasury <ta…treasury address> \
//     --bin contracts/thru-custom-registrar/target/riscv64imac-unknown-none-elf/release/thru-custom-registrar.bin
//
// TIERED FEES (2026-10-30): the config carries three per-year prices — 3 chars, 4 chars,
// 5..=32 chars — plus a collection policy. Defaults are the Betanet intent
// (100000 / 10000 / 1000 base units = 0.0001 / 0.00001 / 0.000001 THRU). They must be
// monotone non-increasing; the script refuses a schedule where a shorter name costs less.
//
// `--fee-policy strict` makes a refused charge REVERT the registration. It is refused by this
// script unless `--collection-proven "<note>"` is passed, because the deployed program's charge
// has only ever failed (VM -10 AccountNotWritable, surfaced as 0xD20A). Measure with
// `--probe-collection` (records the treasury balance) before and after a real registration,
// then re-run with strict. `best-effort` keeps the old behaviour and must not be described to
// users as a charge.
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
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const toUrl = (p) => pathToFileURL(p).href;
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
// Tiered schedule (base units per YEAR). The Betanet intent from the 2026-10-30 release plan:
// 3 chars = 0.0001 THRU, 4 = 0.00001, 5+ = 0.000001. Mainnet sets its own numbers; nothing in
// the program or the wallet hardcodes these — they are config.
const FEE_3 = flags.has('fee-3') ? BigInt(flags.get('fee-3')) : 100_000n;
const FEE_4 = flags.has('fee-4') ? BigInt(flags.get('fee-4')) : 10_000n;
const FEE_5PLUS = flags.has('fee-5plus') ? BigInt(flags.get('fee-5plus')) : 1_000n;
// 0 = best effort (attempt the debit, ignore a refusal), 1 = strict (a refusal reverts).
// Default is best effort ON PURPOSE: the deployed program's charge was refused by the VM with
// -10 AccountNotWritable (0xD20A), so strict may make every registration revert. Run with
// --probe-collection first; only then pass --fee-policy strict.
const FEE_POLICY_FLAG = String(flags.get('fee-policy') ?? 'best-effort').toLowerCase();
const FEE_POLICY_STRICT = FEE_POLICY_FLAG === 'strict';
if (!['strict', 'best-effort', 'best_effort'].includes(FEE_POLICY_FLAG)) {
  console.error(`\nFATAL: --fee-policy must be strict or best-effort (got ${FEE_POLICY_FLAG})`);
  process.exit(1);
}
const PROBE_COLLECTION = flags.get('probe-collection') === 'true';
const COLLECTION_PROVEN = flags.has('collection-proven');
const COLLECTION_NOTE = flags.get('collection-proven') === 'true' ? '' : String(flags.get('collection-proven') ?? '');
const TREASURY = flags.get('treasury');
const BIN_PATH = flags.get('bin');
const SEED = flags.get('seed') ?? 'thru-custom-registrar:v1';
const HD_INDEX = Number(flags.get('hd-index') ?? 0);
const FUND_TARGET = BigInt(flags.get('fund') ?? '20000'); // base units before deploy
const SKIP_UPGRADE = flags.get('skip-upgrade') === 'true';

function die(msg) { console.error(`\nFATAL: ${msg}`); process.exit(1); }
function step(truth, label, detail = '') {
  console.log(`${truth ? ' ok' : 'FAIL'} - ${label}${detail ? ` — ${detail}` : ''}`);
  if (!truth) process.exit(1);
}

if (!ROOT_NAME) die('pass --root <root name> (e.g. --root thru)');
for (const [flag, value] of [['--fee-3', FEE_3], ['--fee-4', FEE_4], ['--fee-5plus', FEE_5PLUS]]) {
  if (value < 0n || value > 0xffffffffffffffffn) die(`${flag} must be a non-negative u64 of base units`);
}
// The schedule must be monotone non-increasing with length: a 4-character name cannot cost
// more than a 3-character one. A typo here would be a live, wrong price.
if (FEE_3 < FEE_4 || FEE_4 < FEE_5PLUS) {
  die(`tier schedule is not monotone: 3=${FEE_3} 4=${FEE_4} 5+=${FEE_5PLUS} (want 3 >= 4 >= 5+)`);
}
// A strict policy makes a refused charge revert, and the only observation we have is that the
// charge IS refused. Refuse to broadcast that configuration without a human attestation that a
// treasury delta was measured — checked HERE, before anything is signed.
if (FEE_POLICY_STRICT && !COLLECTION_PROVEN) {
  die('--fee-policy strict needs --collection-proven "<note>": a registration whose treasury '
    + 'balance delta you actually observed. Without it, an uncollectable fee would revert every '
    + 'registration (the deployed program already fails with 0xD20A/-10). Use best-effort until then.');
}
if (!TREASURY) die('pass --treasury <ta…> — the fee destination; we never invent one');
if (!BIN_PATH) die('pass --bin <compiled .bin> — see contracts/thru-custom-registrar/README.md');
if (!existsSync(resolve(BIN_PATH))) die(`compiled artifact not found: ${resolve(BIN_PATH)}`);
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
if (!mnemonic) die('THRU_SEED env var with the deployer mnemonic is required (never persisted)');
step(true, 'inputs', `network=${NETWORK_ID} root=${ROOT_NAME} tiers=${FEE_3}/${FEE_4}/${FEE_5PLUS} policy=${FEE_POLICY_STRICT ? 'strict' : 'best-effort'} treasury=${TREASURY.slice(0, 10)}… path=${BIN_PATH}`);
if (FEE_POLICY_STRICT) {
  console.log(`  info - strict enforcement attested: ${COLLECTION_NOTE || '(no note recorded)'}`);
}

// ---------- wallet plumbing --------------------------------------------------------------
const { MnemonicGenerator, ThruHDWallet } = await import('@thru/sdk/crypto');
const thruClient = await import(toUrl(join(REPO_ROOT, 'src/lib/thru-client.js')));
const { getNetworkConfig } = await import(toUrl(join(REPO_ROOT, 'src/lib/networks.js')));

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
const { deployProgram, upgradeProgram } = await import('@thru/programs/deploy');

const managed = deriveManagedProgramAddresses(SEED);
const registrarProgramAddress = managed.programAccountAddress;
step(true, 'registrar program address (seed-derived)', registrarProgramAddress);

const existing = await thruClient.getAccountInfo(registrarProgramAddress).catch(() => null);
if (existing?.exists) {
  if (SKIP_UPGRADE) {
    console.log(`  (program exists at ${registrarProgramAddress} — reusing existing bytecode because --skip-upgrade was passed)`);
  } else {
    console.log(`  (program exists at ${registrarProgramAddress} — upgrading bytecode with ${BIN_PATH}…)`);
    const result = await upgradeProgram({
      programAddress: registrarProgramAddress,
      seed: SEED,
      program: new Uint8Array(readFileSync(resolve(BIN_PATH))),
      signer: { address: deployer.address, privateKey: deployer.privateKey },
      client: thruClient.getClient(),
      onProgress: (ev) => console.log(`    [${ev.phase}] ${ev.status ?? ''} ${ev.message ?? ''}`.trim()),
    });
    step(!!result?.transactionSignature || !!result?.programAccountAddress, 'upgradeProgram finished', result?.transactionSignature ?? result?.programAccountAddress);
  }
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
  buildTcrInitializeInstructionData, buildTcrUpdateConfigInstructionData, tcrConfigAddress, TCR_CONFIG_SEED_LABEL,
} = await import(toUrl(join(REPO_ROOT, 'src/lib/custom-registrar.js')));
const nsLib = await import(toUrl(join(REPO_ROOT, 'src/lib/name-service.js')));

const configAddress = tcrConfigAddress(registrarProgramAddress);
const rootAddress = await nsLib.rootRegistrarAddress(ROOT_NAME);
step(true, 'config + root derived', `config=${configAddress.slice(0, 14)}… root=${rootAddress.slice(0, 14)}…`);

const client = thruClient.getClient();
const height = await client.blocks.getBlockHeight();
const slot = height.finalized;
step(slot > 0n, 'live finalized slot fetched', `slot=${slot}`);

const [configProofObj, rootProofObj] = await Promise.all([
  client.proofs.generate({ address: configAddress, proofType: 1, targetSlot: slot }),
  client.proofs.generate({ address: rootAddress, proofType: 1, targetSlot: slot }),
]);
const configProof = configProofObj.proof;
const rootProof = rootProofObj.proof;
step(configProof?.length > 0 && rootProof?.length > 0, 'creation proofs generated', `slot=${slot}`);

const configSeed = new Uint8Array(32);
configSeed.set(new TextEncoder().encode(TCR_CONFIG_SEED_LABEL));

const NS_PROGRAM = nsLib.NAME_SERVICE_PROGRAM;
step(/^ta/.test(NS_PROGRAM), 'using pinned native name-service program', NS_PROGRAM);

const existingCfg = await thruClient.getAccountInfo(configAddress).catch(() => null);
let signature = null;
let streamResult = null;
let streamError = null;
// null, not 0: a skipped Initialize never ran the VM, and 0 is the VM's success code. The
// evidence file must not report an observation that was never made.
let vmError = null;
let initializeState = 'skipped';

if (existingCfg?.exists) {
  const { parseTcrConfig } = await import(toUrl(join(REPO_ROOT, 'src/lib/custom-registrar.js')));
  const raw = existingCfg.raw?.data?.data ?? existingCfg.raw?.data ?? existingCfg.raw;
  let currentCfg = null;
  try { currentCfg = parseTcrConfig(raw); } catch { /* ignore */ }
  const needsUpdate = !currentCfg
    || currentCfg.layout !== 2
    || currentCfg.fee3PerYear !== FEE_3
    || currentCfg.fee4PerYear !== FEE_4
    || currentCfg.fee5PlusPerYear !== FEE_5PLUS
    || (currentCfg.feePolicy === 1) !== FEE_POLICY_STRICT
    || (TREASURY && currentCfg.treasury !== TREASURY);

  if (!needsUpdate) {
    console.log('  (config account already exists and matches requested tiers — skipping UpdateConfig)');
  } else {
    console.log(`  (config account exists in layout ${currentCfg?.layout ?? 'unknown'} — sending UpdateConfig to set tiered schedule + resize)…`);
    const { rawTransaction } = await client.transactions.buildAndSign({
      feePayer: { publicKey: deployer.publicKey, privateKey: deployer.privateKey },
      program: registrarProgramAddress,
      header: { computeUnits: 2_000_000, memoryUnits: 32_768, stateUnits: 4, fee: 0n, startSlot: slot, expiryAfter: 10_000 },
      accounts: {
        readWrite: [configAddress],
        readOnly: [],
      },
      instructionData: ({ getAccountIndex }) => buildTcrUpdateConfigInstructionData({
        newFee3: FEE_3,
        newFee4: FEE_4,
        newFee5Plus: FEE_5PLUS,
        newFeePolicy: FEE_POLICY_STRICT ? 1 : 0,
        newTreasury: TREASURY,
        indexOf: getAccountIndex,
        configAddress,
      }),
    });
    step(!!rawTransaction?.length, 'UpdateConfig built+signed');

    for await (const update of client.transactions.sendAndTrack(rawTransaction)) {
      if (update?.signature?.value && !signature) {
        const { formatSignature } = await import(toUrl(join(REPO_ROOT, 'src/lib/registrar.js')));
        signature = formatSignature(update.signature.value);
      }
      if (update?.executionResult) streamResult = update.executionResult;
      if (update?.error) streamError = update.error;
    }
    step(!!signature && !streamError, 'UpdateConfig broadcast', signature ?? String(streamError ?? 'no signature'));
    initializeState = 'updated';
    vmError = Number(streamResult?.vmError ?? -1);
    step(vmError === 0, 'UpdateConfig executed (vmError 0)',
      streamResult ? `vmError=${streamResult.vmError} userErrorCode=${streamResult.userErrorCode ?? 0}` : 'stream ended without an execution result');
  }
} else {
  // Account lists per role (SDK byte-sorts them into the final table; the u16 indices
  // are resolved INSIDE the instructionData callback via the SDK's getAccountIndex —
  // Thru ABI convention, same as the first-party name-service/faucet builders).
  // Roles: admin=feePayer(0) · program(1) · config(rw,new) · root(rw,new) · name-service(ro)
  const { rawTransaction } = await client.transactions.buildAndSign({
    feePayer: { publicKey: deployer.publicKey, privateKey: deployer.privateKey },
    program: registrarProgramAddress,
    header: { computeUnits: 2_000_000, memoryUnits: 32_768, stateUnits: 4, fee: 0n, startSlot: slot, expiryAfter: 10_000 },
    accounts: {
      readWrite: [configAddress, rootAddress],
      readOnly: [NS_PROGRAM],
    },
    instructionData: ({ getAccountIndex }) => buildTcrInitializeInstructionData({
      fee3PerYear: FEE_3,
      fee4PerYear: FEE_4,
      fee5PlusPerYear: FEE_5PLUS,
      feePolicy: FEE_POLICY_STRICT ? 1 : 0,
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

  for await (const update of client.transactions.sendAndTrack(rawTransaction)) {
    if (update?.signature?.value && !signature) {
      const { formatSignature } = await import(toUrl(join(REPO_ROOT, 'src/lib/registrar.js')));
      signature = formatSignature(update.signature.value);
    }
    if (update?.executionResult) streamResult = update.executionResult;
    if (update?.error) streamError = update.error;
  }
  step(!!signature && !streamError, 'Initialize broadcast', signature ?? String(streamError ?? 'no signature'));
  initializeState = 'executed';
  vmError = Number(streamResult?.vmError ?? -1);
  step(vmError === 0, 'Initialize executed (vmError 0)',
    streamResult ? `vmError=${streamResult.vmError} userErrorCode=${streamResult.userErrorCode ?? 0}` : 'stream ended without an execution result (timeout) — check the explorer before re-running');
}

const cfgInfo = await thruClient.getAccountInfo(configAddress).catch(() => null);
const rootInfo = await thruClient.getAccountInfo(rootAddress).catch(() => null);
step(!!cfgInfo?.exists, 'config account exists on-chain');
step(!!rootInfo?.exists, 'root registrar account exists on-chain');

// Parse what got written — deployment is only real if the state decodes.
try {
  const { parseTcrConfig } = await import(toUrl(join(REPO_ROOT, 'src/lib/custom-registrar.js')));
  const raw = cfgInfo.raw?.data?.data ?? cfgInfo.raw?.data ?? cfgInfo.raw;
  const parsed = parseTcrConfig(raw);
  step(parsed.rootName === ROOT_NAME, 'config parses and names the root',
    JSON.stringify({
      rootName: parsed.rootName,
      layout: parsed.layout,
      tiers: [parsed.fee3PerYear, parsed.fee4PerYear, parsed.fee5PlusPerYear].map(String),
      policy: parsed.feePolicyName,
      treasury: parsed.treasury.slice(0, 12),
    }));
  // The deploy is only what the CHAIN says. Assert the values the run intended.
  step(parsed.layout === 2, 'config is layout 2 (tiered)', `layout=${parsed.layout}`);
  step(parsed.fee3PerYear === FEE_3 && parsed.fee4PerYear === FEE_4 && parsed.fee5PlusPerYear === FEE_5PLUS,
    'the on-chain tiers equal the requested schedule',
    `${parsed.fee3PerYear}/${parsed.fee4PerYear}/${parsed.fee5PlusPerYear} vs ${FEE_3}/${FEE_4}/${FEE_5PLUS}`);
  step((parsed.feePolicy === 1) === FEE_POLICY_STRICT, 'the on-chain policy equals the requested policy',
    parsed.feePolicyName);
} catch (e) {
  step(false, 'config parses', e?.message ?? String(e));
}

// ---------- 3. Collection evidence (the gate for --fee-policy strict) --------------------
// The program can ENFORCE its fee, but the deployed one never managed to collect it: the VM
// answered the transfer with -10 AccountNotWritable (0xD20A). Turning `strict` on before
// proving that a charge can land would make every registration revert, so:
//   * --probe-collection reads the treasury balance and records it (run it before and after a
//     real registration to get a delta — that is the measurement, not this script's opinion);
//   * --collection-proven "<note>" is an explicit human attestation that such a delta was
//     observed. It is recorded verbatim in the evidence file, attributed, and never inferred.
let collectionProbe = { measured: false };
if (PROBE_COLLECTION) {
  const treasuryInfo = await thruClient.getAccountInfo(TREASURY).catch(() => null);
  collectionProbe = {
    measured: Boolean(treasuryInfo?.exists),
    at: new Date().toISOString(),
    treasuryExists: Boolean(treasuryInfo?.exists),
    treasuryBalance: treasuryInfo?.balance != null ? String(treasuryInfo.balance) : null,
  };
  console.log(`  info - treasury ${TREASURY.slice(0, 12)}… exists=${collectionProbe.treasuryExists} balance=${collectionProbe.treasuryBalance ?? 'unreadable'}`);
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
  fee3PerYearBaseUnits: FEE_3.toString(),
  fee4PerYearBaseUnits: FEE_4.toString(),
  fee5PlusPerYearBaseUnits: FEE_5PLUS.toString(),
  feePolicy: FEE_POLICY_STRICT ? 'strict' : 'best-effort',
  collectionProbe,
  treasury: TREASURY,
  initializeSignature: signature,
  initializeState,
  vmError,
  executionResult: streamResult,
};
const evPath = join(EVIDENCE_DIR, `registrar-deploy-${NETWORK_ID}-${ROOT_NAME}-${Date.now()}.json`);
writeFileSync(evPath, JSON.stringify(evidence, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
console.log(`\nDONE. Evidence: ${evPath}`);
console.log('Next: scripts/registrar/probe-live-registrar.mjs — register a real name through the new registrar.');
