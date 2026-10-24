#!/usr/bin/env node
// WHY THIS PROBE EXISTS (2026-10-09, owner observation + source comparison):
// The owner's ThruScan extension (0.4.5) registers fresh accounts and claims from the SAME
// chain fine, while our fresh-account claims fault (-765/-767 EXECUTE-class). src diff vs
// thruscan's extension/src/lib/chain.js (working, live-observed):
//
//   field          ours (thru-client.js)                 thruscan (working)
//   data @4        u16 vaultIdx, u16 recipientIdx        u32 2 (their vault index incl. program)
//   fee            0n always                             1n when balance>0 else 0n
//   stateUnits     1                                     1024 (ceiled at 8192)
//   computeUnits   sdk default                           300_000
//   memoryUnits    sdk default                           10_000
//   endpoint       IDENTICAL: our betanet preset IS rpc.betanet.thru.org — the gateway
//                  variable is eliminated; only in-transaction fields differ
//
// This probe runs a 5-cell GRID, self-signed from the host's pre-funded test seed
// (THRU_SEED, per verify-token-transfer.mjs), so the running chain itself names the field
// that matters. No src/ code is modified; src/lib/thru-client.js stays sacred — this is
// probe-side execution evidence, which decides what a future evidenced header change is.
//
// Cells:
//   A-control  our shape from seed index 0 (long-activated, funded) — expected PASS, proves soundness
//   A          our exact header+data from an epoch-fresh subject — expected to repro the fault
//   B          thruscan header, our byte layout, from the fresh subject
//   C          our header, thruscan byte layout ([u32 2 at offset 4]), from the fresh subject
//   B+C        full thruscan shape from the fresh subject — expected PASS if their path truly works
//
// Setup: seed index 0 funds seed index 1 (fresh) with a tiny native EOA send — the same send
// advances the P3 native-send leg as a recorded side observation. All signs are the subject's
// own key per the self-signing invariant; amounts are 1-unit claims to conserve the faucet pot.
//
//   THRU_SEED="..." node scripts/probe-claim-variants.mjs [betanet]
// Evidence: scripts/defi-evidence/2026-10-09-claim-variants.json

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { Signature, TransactionView } from '@thru/sdk';
import { MnemonicGenerator, ThruHDWallet } from '@thru/sdk/crypto';

function makeStore() {
  const m = new Map();
  return {
    async get(k) {
      if (k == null) return Object.fromEntries(m);
      if (Array.isArray(k)) {
        const o = {};
        for (const x of k) if (m.has(x)) o[x] = m.get(x);
        return o;
      }
      return m.has(k) ? { [k]: m.get(k) } : {};
    },
    async set(o) { for (const [a, b] of Object.entries(o)) m.set(a, b); },
    async remove(k) { for (const x of (Array.isArray(k) ? k : [k])) m.delete(x); },
  };
}
globalThis.chrome = { storage: { local: makeStore(), session: makeStore() } };

const networkId = process.argv[2] || 'betanet';
const { getNetworkConfig } = await import('../src/lib/networks.js');
const thruClient = await import('../src/lib/thru-client.js');
const config = getNetworkConfig(networkId);
if (!config) { console.error(`Unknown network '${networkId}'.`); process.exit(1); }
thruClient.configureNetwork(config);

const FAUCET_PROGRAM = config.faucetProgramId;
const FAUCET_VAULT = config.faucetStateAccount;
if (!FAUCET_PROGRAM || !FAUCET_VAULT) { console.error('network has no faucet config'); process.exit(1); }

function loadHostSeed() {
  if (typeof process.env.THRU_SEED === 'string' && process.env.THRU_SEED.trim()) return process.env.THRU_SEED.trim();
  try {
    const dotenv = new URL('../.env', import.meta.url);
    if (!existsSync(dotenv)) return null;
    for (const line of readFileSync(dotenv, 'utf8').split('\n')) {
      const m = line.match(/^\s*(?:THRU_SEED|SEED)\s*=\s*"?([^"\n]+?)"?\s*$/);
      if (m) return m[1].trim();
    }
  } catch { /* fall through */ }
  return null;
}
const mnemonic = loadHostSeed();
if (!mnemonic) { console.error('THRU_SEED (env or gitignored .env) is required for the funded self-signed grid.'); process.exit(1); }

const seedBytes = MnemonicGenerator.toSeed(mnemonic);
const sponsor = await ThruHDWallet.getAccount(seedBytes, 0); // 'sponsor' here just means the funded SELF-SIGNED source; no third party.
const subject = await ThruHDWallet.getAccount(seedBytes, 1);
const sponsorKp = { address: sponsor.address, publicKey: sponsor.publicKey, privateKey: sponsor.privateKey };
const subjectKp = { address: subject.address, publicKey: subject.publicKey, privateKey: subject.privateKey };
console.log(`funded source (index 0): ${sponsor.address}`);
console.log(`fresh subject (index 1): ${subject.address}  (seed value never logged)`);

const observation = { at: new Date().toISOString(), networkId, network_rpc: config.rpcUrl, cells: [] };

async function executionEvidence(address, signatureFmt) {
  try {
    const c = thruClient.getClient();
    try {
      const t = await c.transactions.get(signatureFmt, { transactionOptions: { view: TransactionView.FULL } });
      const ex = t?.executionResult;
      if (ex) return { via: 'get', vmError: ex.vmError ?? 0, userError: Number(ex.userErrorCode ?? 0n), consumedComputeUnits: ex.consumedComputeUnits ?? ex.computeUnitsConsumed ?? null, consumedMemoryUnits: ex.consumedMemoryUnits ?? null, consumedStateUnits: ex.consumedStateUnits ?? null };
    } catch { /* fall to history */ }
    const r = await c.transactions.listForAccount(address, { transactionOptions: { view: TransactionView.FULL } });
    const tx = [...(r.transactions ?? [])].reverse().find((t) => t.program?.toString?.() === FAUCET_PROGRAM);
    const ex = tx?.executionResult;
    if (ex) return { via: 'history', vmError: ex.vmError ?? 0, userError: Number(ex.userErrorCode ?? 0n), consumedComputeUnits: ex.consumedComputeUnits ?? ex.computeUnitsConsumed ?? null, consumedMemoryUnits: ex.consumedMemoryUnits ?? null, consumedStateUnits: ex.consumedStateUnits ?? null };
    return { via: 'none' };
  } catch (e) { return { via: 'error', detail: e.message.slice(0, 160) }; }
}

async function claimCell(name, payer, { data, header }) {
  const cell = { name, payerAddress: payer.address, header };
  try {
    const { rawTransaction, signature } = await thruClient.getClient().transactions.buildAndSign({
      feePayer: { publicKey: payer.publicKey, privateKey: payer.privateKey },
      program: FAUCET_PROGRAM,
      header,
      accounts: { readWrite: [FAUCET_VAULT] },
      instructionData: ({ getAccountIndex }) => data(getAccountIndex),
    });
    let sig = signature ? Signature.from(signature).toThruFmt() : null;
    try {
      let settled = false;
      for await (const update of thruClient.getClient().transactions.sendAndTrack(rawTransaction)) {
        if (update.signature?.value) sig = update.signature.value ? sig : sig;
        if (update.executionResult) {
          settled = true;
          cell.vmError = update.executionResult.vmError ?? 0;
          cell.userError = Number(update.executionResult.userErrorCode ?? 0n);
        }
      }
      if (!settled) cell.settled = false;
    } catch (e) {
      cell.sendError = e.message.slice(0, 240);
    }
    cell.signature = sig ?? null;
    // the chain's own record is the verdict — fetch the full execution
    await new Promise((r) => setTimeout(r, 2500));
    const ev = sig ? await executionEvidence(payer.address, sig) : { via: 'no-signature' };
    cell.execution = ev;
    cell.verdict = (ev.vmError ?? cell.vmError ?? -1) === 0 && (ev.userError ?? cell.userError ?? -1) === 0 ? 'PASS' : 'FAULT';
  } catch (e) {
    cell.verdict = 'ERROR';
    cell.error = e.message.slice(0, 240);
  }
  console.log(`  ${cell.verdict === 'PASS' ? '[PASS]' : '[FAULT]'} ${name}: vmError=${cell.execution?.vmError ?? cell.vmError ?? '?'} userError=${cell.execution?.userError ?? cell.userError ?? '?'} ${cell.error ?? ''}`.trim());
  observation.cells.push(cell);
  return cell;
}

// ---- Cell 0 precondition: fund the fresh subject from the funded source (native EOA send).
{
  const sub = await thruClient.getAccountInfo(subject.address);
  if (!sub.exists || sub.balance === 0n) {
    console.log('funding the fresh subject with 2 base THRU via the epoch-verified EOA send…');
    // the wallet's exact native-send route (live-verified 2026-09-26); nothing else can
    // create the subject without breaking the self-signing model.
    try {
      await thruClient.sendTransfer(sponsorKp, subject.address, 2n);
      observation.nativeSend = 'PASS — P3 native-send leg advanced as a side observation';
      console.log('  [PASS] EOA-funded the fresh subject (native-send leg → evidence)');
    } catch (e) {
      observation.nativeSend = `FAULT — ${e.message.slice(0, 200)}`;
      console.log(`  [FAULT] EOA send reverted: ${e.message.slice(0, 200)}`);
    }
    await new Promise((r) => setTimeout(r, 4000));
  } else {
    console.log('fresh subject already holds balance — no top-up needed');
  }
  const after = await thruClient.getAccountInfo(subject.address);
  observation.subjectState = { exists: after.exists, balance: after.balance.toString() };
}

// ---- The grid ----------------------------------------------------------------
const AMOUNT = 1n;
// recipient = the payer itself, which in thru-client's builder is account index 0 by
// construction (verified claim tsjbbZW9sT… 2026-09-26); the u16 pair is (vaultIdx, 0).
const ourData = (idx) => thruClient.encodeFaucetInstructionData(idx(FAUCET_VAULT), 0, AMOUNT);
const ourHeader = { fee: 0n, stateUnits: 1 };
const theirData = () => { const d = new Uint8Array(16); const dv = new DataView(d.buffer); dv.setUint32(0, 1, true); dv.setUint32(4, 2, true); dv.setBigUint64(8, AMOUNT, true); return d; };
const theirHeaderFor = async (payer) => ({ fee: (await thruClient.getAccountInfo(payer.address)).balance > 0n ? 1n : 0n, stateUnits: 1024, computeUnits: 300_000, memoryUnits: 10_000 });

console.log('\nclaim-variant grid (amount 1 unit each, all self-signed):');
await claimCell('A-control: our shape, long-activated index 0', sponsorKp, { data: ourData, header: ourHeader });
await claimCell('A: our exact shape, epoch-fresh subject', subjectKp, { data: ourData, header: ourHeader });
await claimCell('B: thruscan header + our layout, fresh subject', subjectKp, { data: ourData, header: await theirHeaderFor(subjectKp) });
await claimCell('C: our header + thruscan layout (u32=2), fresh subject', subjectKp, { data: theirData, header: ourHeader });
await claimCell('B+C: full thruscan shape, fresh subject', subjectKp, { data: theirData, header: await theirHeaderFor(subjectKp) });

// ----- Account-CREATE cells (isolate the SDK 0.4.1 default flip) -------------
// SDK evidence (2026-10-09, dual-install dist diff): accounts.create() baked
// {computeUnits: 1e4, memoryUnits: 1e4, stateUnits: 1} in 0.4.0 and
// {computeUnits: 0, memoryUnits: 0, stateUnits: 0} in 0.4.1. ThruScan's working
// extension is lockfile-pinned to 0.4.0. These two cells let the chain itself decide:
//   D1 = create with 0.4.1 defaults (expect the observed -767 → reproduces our 1.4.1 bug)
//   D2 = create with the 0.4.0-era units explicitly (expect PASS → the fix shape)
// Both sign brand-new THROWAWAY in-memory keys (not the seed's indices — the funded
// account must stay uncluttered; failed creates cost nothing, successful ones are
// abandoned, which is fine and honest).
async function createCell(name, header) {
  const fresh = await (await import('@thru/sdk')).keys.generateKeyPair();
  const cell = { name, address: fresh.address, header: header ?? 'sdk defaults' };
  try {
    const c = thruClient.getClient();
    const tx = header ? await c.accounts.create({ publicKey: fresh.address, header }) : await c.accounts.create({ publicKey: fresh.address });
    tx.chainId = await c.chain.getChainId();
    const sig = await tx.sign(fresh.privateKey);
    await c.transactions.send(tx.toWire());
    await new Promise((r) => setTimeout(r, 4000));
    const info = await thruClient.getAccountInfo(fresh.address);
    cell.existsAfter = info.exists;
    cell.verdict = info.exists ? 'PASS' : 'NO-ACCOUNT';
  } catch (e) {
    const info = await thruClient.getAccountInfo(fresh.address).catch(() => null);
    cell.verdict = 'FAULT';
    cell.error = e.message.slice(0, 240);
    cell.existsAnyway = Boolean(info?.exists);
  }
  console.log(`  ${cell.verdict === 'PASS' ? '[PASS]' : '[FAULT]'} ${name}: ${cell.error ?? `exists=${cell.existsAfter}`}${cell.existsAnyway ? ' (account landed via pre-exec creation despite fault)' : ''}`);
  observation.cells.push(cell);
}
await createCell('D1: accounts.create w/ 0.4.1 defaults (0/0/0 units)', null);
await createCell('D2: accounts.create w/ explicit 0.4.0-era units', { computeUnits: 10_000, memoryUnits: 10_000, stateUnits: 1 });

const JSON_SAFE = (k, v) => (typeof v === 'bigint' ? v.toString() : v);
writeFileSync(
  new URL('./defi-evidence/2026-10-09-claim-variants.json', import.meta.url),
  `${JSON.stringify({ [observation.at]: observation }, JSON_SAFE, 2)}\n`,
);
const pass = observation.cells.filter((c) => c.verdict === 'PASS').map((c) => c.name.split(':')[0]);
console.log(`\nRESULT claim-variants: PASS cells = [${pass.join(', ') || 'none'}] of ${observation.cells.length}`);
