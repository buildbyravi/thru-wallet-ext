// Read-only query-surface probe (verified-matrix track, Q9 + Q18). The pinned SDK exposes
// native query primitives (transactions.listForAccount / getStatus, events.list, node
// status) — which of them does the RUNNING chain actually serve? Historical evidence:
// 2026-09 wallet probes showed transactions-by-account UNSUPPORTED (vmError table), which is
// why dossier Q9 is stale and NO_INDEXER/unsupported rows hang on it. This probe replaces
// assumptions with per-primitive recorded answers. Pure query calls, NO signing, NO
// transactions, CSP-clean (the single pinned RPC origin). Never imported by the extension.
//
//   node scripts/probe-indexer.mjs --network betanet
//
// Each primitive prints `RESULT <label>: SUPPORTED|UNSUPPORTED|EMPTY_RESULT|<err>` —
// UNSUPPORTED and EMPTY_RESULT are ANSWERS, not failures. Only an unreadable transport is
// an exit-1 (BLOCKED_ENV) failure. Do not fabricate counts: cursors null out, raw JSON.
//
// Q9 mapping  : transactions.getStatus + listForAccount         ⇒ history substrate on-node?
// Q18 mapping : listForAccount(amm program) + events.list       ⇒ pool discovery substrate?

import { getNetworkConfig } from '../src/lib/networks.js';
import { configureNetwork, getClient } from '../src/lib/thru-client.js';
import { AMM_PROGRAM_ADDRESS } from '@thru/programs/amm';
import { keys as keyHelpers } from '@thru/sdk';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const networkId = flag('--network') || 'betanet';

const network = getNetworkConfig(networkId);
configureNetwork(network);
const client = getClient();

const JSON_SAFE = (k, v) => (typeof v === 'bigint' ? v.toString() : (v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v));
let sawTransportFailure = false;

function classifyError(err) {
  const m = err?.message ?? String(err);
  if (/unsupported|not supported|unimplemented/i.test(m)) return 'UNSUPPORTED';
  if (/fetch failed|unavailable|econnrefused|enotfound|etimedout/i.test(m)) return 'TRANSPORT';
  return m.slice(0, 120);
}

async function primitive(label, fn, summarize) {
  try {
    const out = await fn();
    console.log(`RESULT ${label}: SUPPORTED — ${summarize(out)}`);
    return { label, status: 'SUPPORTED', out };
  } catch (err) {
    const c = classifyError(err);
    if (c === 'TRANSPORT') {
      console.error(`RESULT ${label}: UNREACHABLE from this environment (${err?.message ?? err}). Record as BLOCKED — do not fabricate answers.`);
      sawTransportFailure = true;
      return { label, status: 'TRANSPORT' };
    }
    console.log(`RESULT ${label}: ${c.startsWith('UNSUPPORTED') ? 'UNSUPPORTED' : `ERROR (${c})`}`);
    return { label, status: c.startsWith('UNSUPPORTED') ? 'UNSUPPORTED' : 'ERROR', detail: c };
  }
}

console.log(`Query-surface probe on ${networkId} (${network.rpcUrl}) — read-only, no signing\n`);

// 0. Liveness facts (free).
await primitive('node.getStatus', () => client.node.getStatus(), (s) => JSON.stringify(s, JSON_SAFE));
await primitive('chain.getChainInfo', () => client.chain.getChainInfo(), (s) => JSON.stringify(s, JSON_SAFE));
// Chain-identity pinning (learned the hard way by the entire ecosystem, and independently
// observed diverging 2026-10-05→10-07: third-party verification read chainId 1 + slot ~2.9M
// on 10-05 while our battery read chainId 2 + finalized ~0.6M on 10-07 — see DECISIONS_G0):
// every live run pins these three numbers to the dated evidence so any drift is visible at
// the battery level instead of being discovered as an unexplained regression.
{
  try {
    const info = await client.chain.getChainInfo();
    const status = await client.node.getStatus().catch(() => null);
    const chainId = info?.chainId ?? info?.chain_id ?? null;
    const finalized = status?.finalizedSlot ?? status?.finalized ?? null;
    console.log(`RESULT chain-identity: chainId=${chainId} finalizedSlot=${finalized} rpc=${network.rpcUrl}`);
  } catch { /* the primitives above already recorded their own RESULT lines */ }
}
await primitive('version.get', () => client.version.get(), (s) => JSON.stringify(s, JSON_SAFE));

// 1. Q9 — native transaction history. Fresh throwaway key = a real address with zero history;
//    SUPPORTED-to-empty still proves the query path serves (EMPTY_RESULT is a positive answer).
const { address } = await keyHelpers.generateKeyPair();
const throwawayAddress = address.toString ? address.toString() : address; // SDK Pubkey → ta-address string (PubkeyInput)
await primitive(
  'transactions.listForAccount(fresh throwaway — no history)',
  () => client.transactions.listForAccount(throwawayAddress),
  (r) => r.transactions.length === 0
    ? '0 txns — EMPTY_RESULT (the query path serves; fresh account correctly has none)'
    : `${r.transactions.length} txns (page: ${JSON.stringify(r.page ?? null, JSON_SAFE)})`,
);

// 2. Q18 — amm program activity via native history (pool discovery substrate without an
//    external indexer: every init-pool/add/swap touches the program account).
await primitive(
  'transactions.listForAccount(amm program) [Q18]',
  () => client.transactions.listForAccount(AMM_PROGRAM_ADDRESS),
  (r) => `${r.transactions.length} txns touching taAMM…, hasNext=${!!(r.page && (r.page.nextPageToken ?? r.page.next))}`,
);

// 3. Q18 — raw event surface: are chain events queryable at all?
await primitive(
  'events.list unfiltered page(5) [Q18]',
  () => client.events.list(),
  (r) => `${r.events?.length ?? 0} events, hasNext=${!!(r.page && (r.page.nextPageToken ?? r.page.next))}${
    r.events?.length ? ` — first event types: ${r.events.slice(0, 5).map((e) => JSON.stringify(e, JSON_SAFE).slice(0, 80)).join(' | ')}` : ''}`,
);

// 4. Transaction-object availability by a fresh account's txn list is empty, so status-by-sig
//    needs a known signature. None is pinned in-repo (the 2026-09-26 claim sig is truncated in
//    comments only) — the owner may pass one for the definitive lookup.
const sig = flag('--tx-sig');
if (sig) {
  await primitive(
    'transactions.getStatus(--tx-sig) [Q9 lookup-by-sig]',
    () => client.transactions.getStatus(sig),
    (s) => JSON.stringify(s, JSON_SAFE),
  );
} else {
  console.log('RESULT transactions.getStatus: SKIPPED — pass --tx-sig <signature> for the definitive lookup test');
}

console.log('\nSemantics: SUPPORTED = the chain SERVES this query (empty result still counts where');
console.log('noted); UNSUPPORTED = node rejects the primitive native-unsupported; ERROR = answered');
console.log('unreadably; only UNREACHABLE is a BLOCKED_ENV (exit 1).');
process.exit(sawTransportFailure ? 1 : 0);
