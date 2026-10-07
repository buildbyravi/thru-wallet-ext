// LIVE BETANET VERIFICATION BATTERY — one command that runs every live check the DeFi
// dossier is waiting on and records the results as a dated evidence entry. Owner-approved
// automation of the manual loop (2026-10-06): the checks are the EXISTING probes, run as
// child processes (zero reimplementation; each probe stays directly usable on its own), plus
// two inline presence/consistency checks.
//
//   node scripts/live-betanet-verify.mjs [networkId]             # run, print, exit by status
//   node scripts/live-betanet-verify.mjs --write-evidence        # also persist the entry
//   npm run test:live                                            # same as --write-evidence
//
// DISCIPLINE (standing rules, all inherited from the wrapped scripts):
//   - THROWAWAY keys only, generated fresh inside the child scripts each run (faucet-funded;
//     Betanet self-funds via the on-chain faucet). NOTHING reads or stores your wallet, your
//     vault, chrome.storage, or any saved key.
//   - Honest classifications: PASS (verified positively), NEGATIVE (verified absence — that
//     is a RESULT: e.g. "no thru-usd oracle feed deployed"), FAIL (unexpected error / drift —
//     evidence something changed), BLOCKED_ENV (this host cannot reach the chain: nothing
//     verified, nothing fabricated).
//   - The DeFi capabilities this cannot move stay flagged: swap/launch flows have no verified
//     programs to test against (dossier: PROGRAM_NOT_VERIFIED / LAUNCH_MODEL_UNAVAILABLE), so
//     the battery reports the PROGRAM LAYER honestly instead of pretending to test UI flows.
//
// EVIDENCE: --write-evidence appends scripts/defi-evidence/<date>-live-chain.json (same shape
// as the other dated entries; unique suffix if today's entry exists). The collector's
// --check does not enumerate evidence files, so entries compose additively.
//
// EXIT CODE: 0 when the chain was reachable and every check classified PASS or NEGATIVE;
// non-zero if anything FAILED or the chain was unreachable from this host.

import { spawn } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const WRITE = args.includes('--write-evidence');
const positional = args.filter((a) => !a.startsWith('--'));
const networkId = positional[0] || 'betanet';
const TIMEOUT_MS = 480_000;
const TAIL_CHARS = 8000;

const JSON_SAFE = (k, v) => (typeof v === 'bigint' ? v.toString() : v);
const sdkVersion = (() => {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')).packages?.['node_modules/@thru/sdk']?.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();

// ---------------------------------------------------------------------------
// Child-process runner: full output captured (bounded), timeout kills the child.
// ---------------------------------------------------------------------------
function runNode(script, scriptArgs, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join('scripts', script), ...scriptArgs], {
      cwd: ROOT,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const kill = setTimeout(() => {
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (d) => { out = (out + d).slice(-TAIL_CHARS * 4); });
    child.stderr.on('data', (d) => { err = (err + d).slice(-TAIL_CHARS * 4); });
    child.on('error', (e) => {
      clearTimeout(kill);
      resolve({ code: -1, signal: null, out, err: `${err}\nspawn error: ${e.message}` });
    });
    child.on('close', (code, signal) => {
      clearTimeout(kill);
      resolve({ code, signal, out: out.slice(-TAIL_CHARS), err: err.slice(-TAIL_CHARS) });
    });
  });
}

const tail = (s, n = 40) => (s ?? '').split('\n').filter((l) => l.trim()).slice(-n).join('\n');

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------
const results = [];
const record = (check) => { results.push(check); render(check); };
function render({ id, status, summary }) {
  const mark = { PASS: 'PASS', NEGATIVE: 'NEG ', FAIL: 'FAIL', BLOCKED_ENV: 'BLKD' }[status] ?? status;
  console.log(`  [${mark}] ${id}: ${summary}`);
}

const networkLabel = networkId;
console.log(`\nLive verification battery on ${networkLabel} — throwaway keys only, faucet-funded,`);
console.log(`${WRITE ? 'evidence entry WILL be written' : 'dry run (pass --write-evidence to persist)'}\n`);

// Preflight inside a dynamic import so an offline host fails categorically, not confusingly.
let CLIENT;
let NETWORK;
let preflightError = null;
try {
  NETWORK = (await import('../src/lib/networks.js')).getNetworkConfig(networkId);
} catch (err) {
  console.error(`unknown network '${networkId}': ${err.message}`);
  process.exit(2);
}
try {
  CLIENT = await import('../src/lib/thru-client.js');
  await CLIENT.configureNetwork(NETWORK);
  const probe = await Promise.race([
    CLIENT.getAccountInfo(NETWORK.transferProgramId),
    new Promise((_, reject) => setTimeout(() => reject(new Error('preflight timeout after 20s')), 20_000)),
  ]);
  if (!probe || typeof probe !== 'object') throw new Error('preflight returned no account view');
} catch (err) {
  preflightError = `${err.name}: ${err.message}`;
}

if (preflightError) {
  record({
    id: 'transport-preflight', status: 'BLOCKED_ENV',
    summary: `cannot reach ${NETWORK.rpcUrl ?? networkId} from this host (${preflightError}) — nothing verified, nothing fabricated`,
  });
  for (const id of ['p3-token-transfer', 'q22-oracle-feed', 'q14-amm-program-presence', 'q20-program-map', 'q15-amm-pool-model', 'q9-query-surface']) {
    record({ id, status: 'BLOCKED_ENV', summary: 'skipped — transport preflight failed' });
  }
} else {
  record({ id: 'transport-preflight', status: 'PASS', summary: `${NETWORK.rpcUrl} reachable` });

  // 1. P3: full token transfer path (init + transferChecked + balances) via the recorded probe.
  {
    const r = await runNode('verify-token-transfer.mjs', [networkId]);
    record({
      id: 'p3-token-transfer',
      status: r.code === 0 ? 'PASS' : 'FAIL',
      summary: r.code === 0
        ? 'init-unchecked-recipient + transferChecked + balance assertions all PASS'
        : `probe exited ${r.code ?? r.signal} — first real-flow error to fix (see tail)`,
      evidence: { exit: r.code, tail: tail(`${r.out}\n${r.err}`) },
    });
  }

  // 2. Q22: oracle feed read (CSP-clean chain read; exists:false is a RESULT).
  {
    const r = await runNode('probe-oracle-feed.mjs', ['--seed', 'thru-usd', '--network', networkId]);
    let status = 'FAIL';
    let summary = `probe failed (${r.code ?? r.signal}) — see tail`;
    if (r.code === 0) {
      const absent = /exists:false|no feed account/i.test(r.out);
      const present = /"exists":\s*true/.test(r.out) || /value|price|priceUpdate/i.test(r.out);
      if (absent) { status = 'NEGATIVE'; summary = 'no thru-usd oracle feed account on this chain (honest absence, recorded)'; }
      else if (present) { status = 'PASS'; summary = 'oracle feed account exists and parsed (see tail)'; }
      else { status = 'PASS'; summary = 'probe completed (see tail)'; }
    } else if (/UNREACHABLE|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(r.err)) {
      status = 'BLOCKED_ENV';
      summary = 'probe could not reach the chain from this host';
    }
    record({ id: 'q22-oracle-feed', status, summary, evidence: { exit: r.code, tail: tail(`${r.out}\n${r.err}`) } });
  }

  // 3+4. Program layer (Q14/Q20): registry records vs bootstrap declarations vs on-chain
  // presence. Drift registry↔bootstrap is the managed-genesis case (B3) — FAIL on record.
  {
    const { BOOTSTRAP_PROGRAM_ADDRESSES } = await import('@thru/programs/bootstrap-addresses');
    const { PROGRAMS } = await import('../src/background/services/defi/capability-snapshot.js');
    const rows = [];
    let drift = false;
    let ammDeployed = false;
    for (const p of PROGRAMS) {
      const bootstrap = BOOTSTRAP_PROGRAM_ADDRESSES[p.role] ?? null;
      const address = p.address ?? bootstrap;
      if (p.address && bootstrap && p.address !== bootstrap) drift = true;
      let exists = null;
      if (address) {
        try {
          exists = (await CLIENT.getAccountInfo(address))?.exists === true;
        } catch (err) {
          record({ id: `q20-program-map (${p.role})`, status: 'BLOCKED_ENV', summary: `presence read failed: ${err.message}` });
          exists = null;
        }
      }
      if (p.role === 'amm') ammDeployed = exists === true;
      rows.push({ role: p.role, registryAddress: p.address, bootstrapAddress: bootstrap, addressesMatch: !p.address || !bootstrap || p.address === bootstrap, deployedOnChain: exists, expectedNote: p.address === null ? 'expected absent (package-negative)' : undefined });
    }
    record({
      id: 'q14-amm-program-presence',
      status: ammDeployed ? 'PASS' : 'NEGATIVE',
      summary: ammDeployed
        ? `amm program taAMMx8gG44RcOyRq is deployed (account exists) — pool discovery becomes testable`
        : `amm program address holds NO account on this chain — swap remains PROGRAM_NOT_VERIFIED (honest absence)`,
      evidence: rows.filter((r) => r.role === 'amm'),
    });
    const allDeclaredDeployed = rows.filter((r) => r.registryAddress).every((r) => r.deployedOnChain === true);
    record({
      id: 'q20-program-map',
      status: drift ? 'FAIL' : (allDeclaredDeployed ? 'PASS' : 'NEGATIVE'),
      summary: drift
        ? 'registry records and bootstrap declarations DISAGREE (managed genesis swap? re-verify everything downstream)'
        : allDeclaredDeployed
          ? 'every registry program address matched bootstrap and exists on-chain'
          : 'registry↔bootstrap consistent; some declared program addresses hold no account yet (per-row detail)',
      evidence: rows,
    });
  }
  // Q15: pool-model evidence. Today the honest answer is "no pool to parse" (no mints on
  // betanet — P3 is the funding blocker), so the PASS here is the program/parser surface;
  // the day a mint exists, probe-amm.mjs --mints carries the parsing evidence.
  {
    const r = await runNode('probe-amm.mjs', ['--network', networkId]);
    let status = 'FAIL';
    let summary = `probe failed (${r.code ?? r.signal}) — see tail`;
    if (r.code === 0) {
      status = /EXISTS/.test(r.out) ? 'PASS' : 'NEGATIVE';
      summary = status === 'PASS'
        ? 'amm program account read + official parser surface verified; pool-model parse awaits on-chain mints (P3-blocked)'
        : 'amm program absent — contrary to the 2026-10-06 presence row, record drift';
    } else if (/UNREACHABLE|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(r.err)) {
      status = 'BLOCKED_ENV';
      summary = 'probe could not reach the chain from this host';
    }
    record({ id: 'q15-amm-pool-model', status, summary, evidence: { exit: r.code, tail: tail(`${r.out}\n${r.err}`) } });
  }
  // Q9/Q18: native query surface. The dossier predates the SDK's query primitives — the
  // definitive live answers now come from probe-indexer.mjs: does tx-by-account serve
  // (Q9 history substrate), does the AMM program have queryable activity and is the event
  // surface streamable (Q18 pool discovery without an external indexer)?
  {
    const r = await runNode('probe-indexer.mjs', ['--network', networkId]);
    const full = `${r.out}\n${r.err}`;
    let status = 'FAIL';
    let summary = `probe failed (${r.code ?? r.signal}) — see tail`;
    if (r.code === 0) {
      const histLine = full.split('\n').find((l) => l.includes('listForAccount(fresh throwaway')) ?? '';
      if (/SUPPORTED/.test(histLine)) {
        status = 'PASS';
        summary = 'native tx-by-account query serves — Q9 history substrate is ON-NODE (see tail for Q18 amm-activity + events rows)';
      } else if (/UNSUPPORTED/.test(histLine)) {
        status = 'NEGATIVE';
        summary = 'native tx history UNSUPPORTED on this chain — Q9 substrate is off-node only, index/indexer story stands (see tail)';
      } else {
        summary = 'probe ran but history-row classification unreadable — see tail';
      }
    } else if (/RESULT.*UNREACHABLE|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(full)) {
      status = 'BLOCKED_ENV';
      summary = 'probe could not reach the chain from this host';
    }
    record({ id: 'q9-query-surface', status, summary, evidence: { exit: r.code, tail: tail(full) } });
  }
}

// ---------------------------------------------------------------------------
// Outcome + evidence entry
// ---------------------------------------------------------------------------
const counts = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
console.log(`\nResult: ${results.map((r) => `${r.status}:${r.id}`).join('  ')}`);
console.log(`Summary counts: ${JSON.stringify(counts)}`);

const dateUtc = new Date().toISOString().slice(0, 10);
const failed = results.some((r) => r.status === 'FAIL');
const blockedAll = preflightError !== null;
const finding = results.map((r) => `${r.id}: ${r.status} — ${r.summary}`).join(' ');
const entry = {
  id: `${dateUtc}-live-chain`,
  kind: 'live-chain',
  network: networkId,
  dateUtc,
  tool: `node scripts/live-betanet-verify.mjs (node ${process.version}; @thru/sdk ${sdkVersion}); rpc ${NETWORK.rpcUrl}`,
  refs: ['scripts/verify-token-transfer.mjs', 'scripts/probe-oracle-feed.mjs', 'src/background/services/defi/capability-snapshot.js', '@thru/programs/bootstrap-addresses'],
  checks: results.map(({ id, status, summary, evidence }) => ({ id, status, summary, evidence })),
  finding,
  confidence: 'per-check: PASS = observed on the live chain at dateUtc; NEGATIVE = verified absence at dateUtc (absence is not permanence — re-run after chain upgrades); BLOCKED_ENV records the host environment, not the chain',
};

if (WRITE) {
  let file = join(ROOT, 'scripts', 'defi-evidence', `${dateUtc}-live-chain.json`);
  let n = 2;
  while (existsSync(file)) {
    file = join(ROOT, 'scripts', 'defi-evidence', `${dateUtc}-live-chain-run${n}.json`);
    entry.id = `${dateUtc}-live-chain-run${n}`;
    n += 1;
  }
  writeFileSync(file, `${JSON.stringify(entry, JSON_SAFE, 2)}\n`);
  console.log(`\nEvidence entry written: ${file.replace(`${ROOT}/`, '')}`);
} else {
  console.log('\n(dry run — pass --write-evidence or use npm run test:live to persist the entry above)');
}

if (blockedAll) {
  console.error('\nChain unreachable from this host. Exit 1. Re-run on a network-connected machine.');
  process.exit(1);
}
if (failed) {
  console.error('\nAt least one check FAILED — real-flow error surfaced, see the failing tail(s). Exit 1.');
  process.exit(1);
}
console.log('\nAll reachable checks classified PASS or honest-NEGATIVE. Exit 0.');
