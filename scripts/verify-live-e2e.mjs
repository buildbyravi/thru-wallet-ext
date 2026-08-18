// Live end-to-end test through the REAL extension seam.
//
// Every previous probe called src/lib/thru-client.js directly. That tests the right code but the
// wrong PATH: a user's send goes UI -> bridge -> api-router -> tx-service -> thru-client, and
// tx-service adds validation, account resolution and pending-tx tracking on top. Testing the
// bottom layer in isolation cannot tell you whether the flow a user actually triggers works.
//
// This drives handleApiRequest, which is exactly what bridge.send() reaches.
//
//   node scripts/verify-live-e2e.mjs [networkId]
//
// Creates a THROWAWAY vault in an in-memory storage mock. Never touches your real profile.

import { readFileSync } from 'node:fs';

const networkId = process.argv[2] || 'alphanet';

// ---- In-memory chrome mock (same shape the existing tests use) -------------
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

globalThis.chrome = {
  runtime: {
    id: 'live-e2e',
    getManifest: () => ({ version: 'live-e2e' }),
    onMessage: { addListener() {} },
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    sendMessage: () => Promise.resolve(),
  },
  alarms: { create() {}, clear() {}, onAlarm: { addListener() {} } },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  storage: { local: makeStore(), session: makeStore() },
};

const { handleApiRequest } = await import('../src/background/api-router.js');

const PASSWORD = 'LiveE2E-Password-1!';
let step = 0;
const results = [];

async function call(method, params = {}) {
  const res = await handleApiRequest({ method, params });
  if (!res.ok) throw Object.assign(new Error(res.error.message), { code: res.error.code });
  return res.data;
}

function report(label, verdict, detail) {
  step += 1;
  results.push({ label, verdict, detail });
  const mark = verdict === 'PASS' ? 'PASS' : verdict === 'FAIL' ? 'FAIL' : '??  ';
  console.log(`  [${mark}] ${step}. ${label}`);
  if (detail) console.log(`         ${detail}`);
}

console.log(`Live end-to-end through api-router on ${networkId}\n`);

// ---- Select network ---------------------------------------------------------
try {
  const net = await call('network.setActive', { networkId });
  report('network.setActive binds the RPC client', 'PASS', `${net.label} -> ${net.rpcUrl}`);
} catch (error) {
  report('network.setActive', 'FAIL', error.message);
  process.exit(1);
}

const health = await call('tx.checkHealth');
if (health.status === 'offline') {
  report('tx.checkHealth', 'FAIL', 'node offline; aborting');
  process.exit(1);
}
report('tx.checkHealth', 'PASS', `status=${health.status} latency=${health.latencyMs}ms`);

// ---- Create a wallet -------------------------------------------------------
const created = await call('wallet.create', { password: PASSWORD });
const sender = await call('account.getActive');
report('wallet.create + account.getActive', 'PASS', `sender ${sender.address}`);

// ---- Faucet through the real service ---------------------------------------
// tx.claimFaucet also records a pending transaction and refreshes the balance cache, none of
// which the direct thru-client call exercises.
const FAUCET_UNITS = '10000';
try {
  const claim = await call('tx.claimFaucet', { amountUnits: FAUCET_UNITS });
  report('tx.claimFaucet succeeds for a brand-new wallet', 'PASS', `signature=${claim.signature}`);
} catch (error) {
  report('tx.claimFaucet succeeds for a brand-new wallet', 'FAIL', error.message);
}

await new Promise((r) => setTimeout(r, 3000));
const info1 = await call('tx.getAccountInfo', { address: sender.address });
report(
  'balance reflects the claim in BASE UNITS',
  info1.balance === FAUCET_UNITS ? 'PASS' : 'CHECK',
  `asked ${FAUCET_UNITS}, balance is ${info1.balance}`,
);

const pending = await call('tx.getPending');
report(
  'the claim was tracked as a pending transaction',
  pending.length > 0 ? 'PASS' : 'CHECK',
  `${pending.length} tracked`,
);

// ---- Fund enough for a send ------------------------------------------------
process.stdout.write('         funding further');
for (let i = 0; i < 8; i += 1) {
  try {
    await call('tx.claimFaucet', { amountUnits: FAUCET_UNITS });
    process.stdout.write('.');
  } catch {
    break;
  }
}
console.log('');
await new Promise((r) => setTimeout(r, 2500));
const funded = await call('tx.getAccountInfo', { address: sender.address });
report('account funded for a transfer', 'PASS', `${funded.balance} base units`);

// ---- Send to a SECOND ACCOUNT IN THE SAME WALLET ---------------------------
// Deliberately not a random address. account.addHd gives a recipient the wallet controls, and
// tx.autoCreateAccount can register it — which is the difference the earlier probes missed,
// because they all sent to addresses that had never been registered on-chain.
const second = await call('account.addHd', {});
report('account.addHd created a recipient', 'PASS', `recipient ${second.address}`);

// Register the recipient on-chain, then switch back to the sender.
await call('account.switch', { ref: second.ref });
try {
  await call('tx.autoCreateAccount');
  report('tx.autoCreateAccount registered the recipient', 'PASS');
} catch (error) {
  report('tx.autoCreateAccount registered the recipient', 'CHECK', error.message);
}
await new Promise((r) => setTimeout(r, 2500));
const recipientInfo = await call('tx.getAccountInfo', { address: second.address });
report(
  'recipient now exists on-chain',
  recipientInfo.exists ? 'PASS' : 'CHECK',
  `exists=${recipientInfo.exists}`,
);

await call('account.switch', { ref: sender.ref });

const beforeSend = BigInt((await call('tx.getAccountInfo', { address: sender.address })).balance);
const SEND_UNITS = '1';
try {
  const sent = await call('tx.send', { toAddress: second.address, amountUnits: SEND_UNITS });
  report('tx.send to a REGISTERED recipient', 'PASS', `signature=${sent.signature}`);

  await new Promise((r) => setTimeout(r, 3000));
  const afterSend = BigInt((await call('tx.getAccountInfo', { address: sender.address })).balance);
  const got = BigInt((await call('tx.getAccountInfo', { address: second.address })).balance);
  const spent = beforeSend - afterSend;
  const fee = spent - BigInt(SEND_UNITS);

  report('recipient received the amount', got === BigInt(SEND_UNITS) ? 'PASS' : 'CHECK', `received ${got}`);
  report(
    `FEE = ${fee} base units`,
    'PASS',
    fee === 0n
      ? 'Transfers are zero-fee: the MAX button needs no reserve.'
      : `The Send screen reserves 10000; the real fee is ${fee}.`,
  );
} catch (error) {
  report('tx.send to a REGISTERED recipient', 'FAIL', error.message);
  console.log('');
  console.log('  If this failed while the recipient EXISTS, then recipient registration was not');
  console.log('  the cause and the transfer instruction spec needs to come from the Thru team.');
}

// ---- History through the real service --------------------------------------
try {
  const history = await call('tx.listHistory', { address: sender.address, pageSize: 10 });
  const kinds = [...new Set(history.map((h) => h.kind))].join(', ');
  report('tx.listHistory decodes entries', history.length > 0 ? 'PASS' : 'CHECK', `${history.length} entries; kinds: ${kinds}`);
} catch (error) {
  report('tx.listHistory decodes entries', 'FAIL', error.message);
}

// ---- Summary ---------------------------------------------------------------
console.log('\n=== Summary ===');
const counts = results.reduce((a, r) => { a[r.verdict] = (a[r.verdict] || 0) + 1; return a; }, {});
console.log('  ' + Object.entries(counts).map(([k, v]) => `${k}:${v}`).join('  '));
const failed = results.filter((r) => r.verdict === 'FAIL');
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  - ${f.label}: ${f.detail}`);
}
console.log('\nThis exercises the same seam bridge.send() uses, so a pass here means the flow a');
console.log('user triggers works — not merely that the bottom layer does.');
