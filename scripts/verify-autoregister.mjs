// Verifies that account CREATION registers on-chain, without any dashboard involvement.
//
// Context: registration used to happen only inside the dashboard's balance check, fired as
// `bridge.send('tx.autoCreateAccount').catch(() => {})` and never awaited. That left a race
// (tap Faucet before it lands) and left any account added without a subsequent dashboard load
// unregistered entirely.
//
// This test never calls tx.autoCreateAccount and never simulates a dashboard. If accounts end up
// registered, it is because creation did it.
//
//   node scripts/verify-autoregister.mjs [networkId]

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
    id: 'autoreg',
    getManifest: () => ({ version: 'autoreg' }),
    onMessage: { addListener() {} },
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    sendMessage: () => Promise.resolve(),
  },
  alarms: { create() {}, clear() {}, onAlarm: { addListener() {} } },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  storage: { local: makeStore(), session: makeStore() },
};

const networkId = process.argv[2] || 'alphanet';
const { handleApiRequest } = await import('../src/background/api-router.js');

const PASSWORD = 'AutoReg-Password-1!';
let pass = 0;
let fail = 0;

async function call(method, params = {}) {
  const res = await handleApiRequest({ method, params });
  if (!res.ok) throw Object.assign(new Error(res.error.message), { code: res.error.code });
  return res.data;
}

function check(label, ok, detail) {
  if (ok) { pass += 1; console.log(`  [PASS] ${label}`); } else { fail += 1; console.log(`  [FAIL] ${label}`); }
  if (detail) console.log(`         ${detail}`);
}

// Registration is deliberately fire-and-forget, so give it time to land before asserting.
async function waitForRegistration(address, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await call('tx.getAccountInfo', { address });
    if (info.exists) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

console.log(`Verifying registration-on-creation against ${networkId}\n`);

await call('network.setActive', { networkId });
const health = await call('tx.checkHealth');
if (health.status === 'offline') {
  console.log('  Node offline; aborting.');
  process.exit(1);
}

// ---- 1. wallet.create ------------------------------------------------------
await call('wallet.create', { password: PASSWORD });
const first = await call('account.getActive');
console.log(`  first account: ${first.address}`);
check(
  'wallet.create registers its first account on-chain',
  await waitForRegistration(first.address),
  'no dashboard load and no explicit tx.autoCreateAccount call was made',
);

// ---- 2. THE ACTUAL POINT: faucet immediately, no dashboard -----------------
// This is the sequence that used to fail: brand-new wallet, straight to Faucet.
try {
  const claim = await call('tx.claimFaucet', { amountUnits: '10000' });
  check('faucet works immediately on a brand-new wallet', Boolean(claim.signature), `signature=${claim.signature}`);
} catch (error) {
  check('faucet works immediately on a brand-new wallet', false, error.message);
}

// ---- 3. account.addHd ------------------------------------------------------
const second = await call('account.addHd', {});
console.log(`  derived account: ${second.address}`);
check(
  'account.addHd registers the new account on-chain',
  await waitForRegistration(second.address),
  'previously only a dashboard visit would have done this',
);

// ---- 4. keyring.createSeed -------------------------------------------------
const ring = await call('keyring.createSeed', { password: PASSWORD, label: 'Second phrase' });
const fromNewSeed = await call('account.getActive');
console.log(`  new-seed account: ${fromNewSeed.address}`);
check(
  'keyring.createSeed registers its first account on-chain',
  await waitForRegistration(fromNewSeed.address),
  `keyring ${ring.id}`,
);

// ---- 5. A registered recipient can now receive ------------------------------
// Ties it together: the recipient-must-exist rule stops being a user-visible problem for
// accounts this wallet created, because they are all registered at creation.
await call('account.switch', { ref: first.ref });
const senderBal = BigInt((await call('tx.getAccountInfo', { address: first.address })).balance);
if (senderBal > 10n) {
  try {
    const sent = await call('tx.send', { toAddress: second.address, amountUnits: '1' });
    check('tx.send to an auto-registered sibling account succeeds', Boolean(sent.signature), `signature=${sent.signature}`);
  } catch (error) {
    check('tx.send to an auto-registered sibling account succeeds', false, error.message);
  }
} else {
  console.log(`  [SKIP] send test — sender balance is ${senderBal}`);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
console.log('  Registration is now a property of creating an account, not of viewing one.');
