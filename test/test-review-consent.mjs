// The background consent gate: what a signature must prove before it can happen.
//
// `tx.confirmReview` returns the exact submit instructions and a one-time token. The router
// refuses every value-moving method that cannot present one for the same method, the same params,
// the same account and the same network. Before this existed, calling `tx.sendChecked` directly
// built, signed and broadcast with no review at all (2026-11-01 external audit, finding 1).
//
// This suite uses NO test helper for the negative cases: it imports the router fresh, stubs the
// chain at the client boundary, and calls the methods the way an attacker would. The positive
// controls exist so a vacuous "everything is refused" cannot pass — each one proves the same call
// reaches the handler once consent is present.
//
// What this does NOT prove: that a human saw a card. A caller able to call `tx.prepareReview` can
// call `tx.confirmReview` too. See the threat model in docs/STATUS_AND_ROADMAP.md.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let checks = 0;
function ok(label, cond = true, detail = '') {
  checks += 1;
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`  ok - ${label}`);
}

// ---- chrome stub (same shape the other router suites use) --------------------
const storage = new Map();
const session = new Map();
const store = (map) => ({
  get: async (keys) => {
    if (typeof keys === 'string') return { [keys]: map.get(keys) };
    if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, map.get(k)]));
    return Object.fromEntries(map.entries());
  },
  set: async (obj) => { for (const [k, v] of Object.entries(obj)) map.set(k, v); },
  remove: async (key) => { for (const k of [].concat(key)) map.delete(k); },
  clear: async () => map.clear(),
});
globalThis.chrome = {
  storage: { local: store(storage), session: store(session) },
  runtime: { sendMessage: () => Promise.resolve() },
};

const { handleApiRequest, isTransactionMethod } = await import('../src/background/api-router.js');
const { METHODS, ERROR_CODES } = await import('../src/shared/contract/manifest.js');
const { mintConsent, clearConsents, CONSENT_TTL_MS } = await import('../src/background/services/review/consent.js');
const thruClient = await import('../src/lib/thru-client.js');

// ---- the probe counters -----------------------------------------------------
// Every path to the chain goes through the shared SDK client, so counting there is the direct
// measure of "did this reach the network". fetch is counted too: anything that bypasses the
// client still has to make an HTTP call in a worker.
const client = thruClient.getClient();
const touched = { buildAndSign: 0, sendAndTrack: 0, accountsGet: 0, proofs: 0, fetch: 0 };
const realBuild = client.transactions.buildAndSign;
const realSend = client.transactions.sendAndTrack;
const realAccountsGet = client.accounts.get;
const realProofs = client.proofs.generate;
const realFetch = globalThis.fetch;
client.transactions.buildAndSign = (...args) => { touched.buildAndSign += 1; return realBuild.apply(client.transactions, args); };
client.transactions.sendAndTrack = (...args) => { touched.sendAndTrack += 1; return realSend.apply(client.transactions, args); };
client.accounts.get = (...args) => { touched.accountsGet += 1; return realAccountsGet.apply(client.accounts, args); };
client.proofs.generate = (...args) => { touched.proofs += 1; return realProofs.apply(client.proofs, args); };
globalThis.fetch = (...args) => { touched.fetch += 1; return realFetch(...args); };
const zeroTouches = () => Object.values(touched).every((n) => n === 0);
const resetTouches = () => { for (const key of Object.keys(touched)) touched[key] = 0; };

// ---- a real (offline) wallet ------------------------------------------------
const created = await handleApiRequest({ method: 'wallet.create', params: { password: 'Consent123!' } });
assert.equal(created.ok, true, created.error?.message);
const ME = created.data.address;
const OTHER = 'taEREREREREREREREREREREREREREREREREREREREREREg';
const MINT = 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKqq';
resetTouches();

console.log('[1] every value-moving method refuses a call with no consent, before anything runs');
{
  // Plausible params per method: the refusal precedes the handler, so what matters is that the
  // call is REFUSED rather than whether the params would have been accepted.
  const paramsFor = {
    'tx.claimFaucet': { amountUnits: '1000', fromAddress: ME, networkId: 'betanet' },
    'tx.sendChecked': { toAddress: OTHER, amountUnits: '1', fromAddress: ME, networkId: 'betanet' },
    'tx.autoCreateAccount': {},
    'tx.registerAccount': { address: ME },
    'token.deploy': { name: 'Test', symbol: 'TST', decimals: 6, supplyUnits: '1000' },
    'token.transferChecked': { mintAddress: MINT, toAddress: OTHER, amountUnits: '1', fromAddress: ME, networkId: 'betanet' },
    'name.register': { name: 'child', parentAddress: OTHER, expectedNetworkId: 'betanet', expectedAccountAddress: ME },
    'name.purchase': { name: 'alice', years: 1, expectedNetworkId: 'betanet', expectedAccountAddress: ME },
    'name.renewLease': { name: 'alice', years: 1 },
    'name.claimExpired': { name: 'alice', years: 1 },
    'name.setRecord': { name: 'alice', key: 'addr', value: OTHER },
    'intent.submit': { intentId: 'does-not-exist', bindingHash: 'nope' },
  };
  const exempt = new Set(['tx.registerAccount', 'intent.submit']);
  const methods = Object.keys(METHODS).filter(isTransactionMethod);
  ok('the probe covers every method the router classifies as value-moving',
    methods.length >= 12 && methods.every((m) => Object.hasOwn(paramsFor, m)),
    methods.join(', '));

  for (const method of methods) {
    if (exempt.has(method)) continue;
    const res = await handleApiRequest({ method, params: { ...paramsFor[method] } });
    ok(`${method} with valid params and no token is REVIEW_REQUIRED`,
      res.ok === false && res.error.code === 'REVIEW_REQUIRED', JSON.stringify(res).slice(0, 120));
    ok(`${method} never reaches the chain`,
      zeroTouches(), JSON.stringify(touched));
  }
  ok('REVIEW_REQUIRED is a declared contract code, and is not retryable',
    typeof ERROR_CODES.REVIEW_REQUIRED === 'string'
      && (await handleApiRequest({ method: 'tx.sendChecked', params: paramsFor['tx.sendChecked'] })).error.retryable === false);
}

console.log('[2] a token is spent once, bound to its method and to its params');
{
  // Deliberately context-free params: the handler refuses them locally ("requires a reviewed
  // context") without an RPC, which is how we can tell "the gate let it through" from "the gate
  // stopped it" without contacting anything.
  const params = { toAddress: OTHER, amountUnits: '1' };
  const token = await mintConsent({ method: 'tx.sendChecked', params, accountAddress: ME, networkId: 'betanet', reviewId: 'r1' });
  resetTouches();

  // Control: WITH the token the call gets past consent and reaches the handler, which refuses on
  // its own local rule. This is what makes [1] non-vacuous.
  const control = await handleApiRequest({ method: 'tx.sendChecked', params: { ...params, consentToken: token } });
  ok('control: the same call WITH a token reaches the handler',
    control.ok === false && control.error.code === 'INVALID_REQUEST', control.error?.code);
  ok('control: it still never reached the chain', zeroTouches(), JSON.stringify(touched));

  const reuse = await handleApiRequest({ method: 'tx.sendChecked', params: { ...params, consentToken: token } });
  ok('reusing the same token is refused', reuse.error?.code === 'REVIEW_REQUIRED', reuse.error?.code);
  ok('the reuse refusal says so, rather than blaming the transaction',
    /no longer valid/i.test(reuse.error?.message || ''), reuse.error?.message);

  const tokenA = await mintConsent({ method: 'tx.sendChecked', params, accountAddress: ME, networkId: 'betanet', reviewId: 'r2' });
  const crossMethod = await handleApiRequest({
    method: 'token.transferChecked',
    params: { ...params, mintAddress: MINT, consentToken: tokenA },
  });
  ok('a token minted for method A is refused for method B',
    crossMethod.error?.code === 'REVIEW_REQUIRED' && /different action/i.test(crossMethod.error?.message || ''),
    crossMethod.error?.message);

  const tokenB = await mintConsent({ method: 'tx.sendChecked', params, accountAddress: ME, networkId: 'betanet', reviewId: 'r3' });
  const changedAmount = await handleApiRequest({
    method: 'tx.sendChecked',
    params: { ...params, amountUnits: '2', consentToken: tokenB },
  });
  ok('changing the amount after confirm is refused',
    changedAmount.error?.code === 'REVIEW_REQUIRED' && /details changed/i.test(changedAmount.error?.message || ''),
    changedAmount.error?.message);

  const tokenC = await mintConsent({ method: 'tx.sendChecked', params, accountAddress: ME, networkId: 'betanet', reviewId: 'r4' });
  const changedRecipient = await handleApiRequest({
    method: 'tx.sendChecked',
    params: { ...params, toAddress: ME, consentToken: tokenC },
  });
  ok('changing the recipient after confirm is refused', changedRecipient.error?.code === 'REVIEW_REQUIRED');

  // Key order must not matter: the hash is canonical, so a reordered params object is the same
  // request. Getting this wrong would refuse a legitimate submission after a structured clone.
  const tokenD = await mintConsent({ method: 'tx.sendChecked', params, accountAddress: ME, networkId: 'betanet', reviewId: 'r5' });
  const reordered = { consentToken: tokenD, amountUnits: '1', toAddress: OTHER };
  const reorderedRes = await handleApiRequest({ method: 'tx.sendChecked', params: reordered });
  ok('control: reordering the same params is NOT treated as a change',
    reorderedRes.error?.code === 'INVALID_REQUEST', reorderedRes.error?.code);
}

console.log('[3] a password added at submit time does not invalidate the token');
{
  const params = { toAddress: OTHER, amountUnits: '1' };
  const token = await mintConsent({ method: 'tx.sendChecked', params, accountAddress: ME, networkId: 'betanet', reviewId: 'r6' });
  const res = await handleApiRequest({
    method: 'tx.sendChecked',
    params: { ...params, password: 'Consent123!', consentToken: token },
  });
  ok('the password is excluded from the approved params (it is added after review)',
    res.error?.code === 'INVALID_REQUEST', res.error?.code);
}

console.log('[4] lock, account switch and network switch kill live tokens');
{
  const params = { toAddress: OTHER, amountUnits: '1' };
  const firstRef = (await handleApiRequest({ method: 'account.getActive' })).data.ref;
  const beforeLock = await mintConsent({ method: 'tx.sendChecked', params, accountAddress: ME, networkId: 'betanet', reviewId: 'r7' });
  await handleApiRequest({ method: 'wallet.lock' });
  await handleApiRequest({ method: 'wallet.unlock', params: { password: 'Consent123!' } });
  const afterLock = await handleApiRequest({ method: 'tx.sendChecked', params: { ...params, consentToken: beforeLock } });
  ok('a token minted before a lock cannot be spent after unlock',
    afterLock.error?.code === 'REVIEW_REQUIRED', afterLock.error?.code);

  const beforeSwitch = await mintConsent({ method: 'tx.sendChecked', params, accountAddress: ME, networkId: 'betanet', reviewId: 'r8' });
  const second = await handleApiRequest({ method: 'account.addHd' });
  assert.equal(second.ok, true, second.error?.message);
  await handleApiRequest({ method: 'account.switch', params: { ref: second.data.ref } });
  const afterSwitch = await handleApiRequest({ method: 'tx.sendChecked', params: { ...params, consentToken: beforeSwitch } });
  ok('a token minted before an account switch cannot be spent after it',
    afterSwitch.error?.code === 'REVIEW_REQUIRED', afterSwitch.error?.code);
  await handleApiRequest({ method: 'account.switch', params: { ref: firstRef } });

  // Context is checked independently of clearing: a token minted for one account does not work
  // for another even if the clearing path was never reached.
  const otherAccount = await mintConsent({ method: 'tx.sendChecked', params, accountAddress: OTHER, networkId: 'betanet', reviewId: 'r9' });
  const wrongAccount = await handleApiRequest({ method: 'tx.sendChecked', params: { ...params, consentToken: otherAccount } });
  ok('a token bound to another account is refused on this one',
    wrongAccount.error?.code === 'REVIEW_REQUIRED' && /account or network changed/i.test(wrongAccount.error?.message || ''),
    wrongAccount.error?.message);

  ok('tokens are memory-only: nothing was written to chrome.storage for them',
    [...storage.keys()].every((key) => !/consent/i.test(key)), [...storage.keys()].join(','));
  ok('the token TTL is a minute, not a session', CONSENT_TTL_MS === 60_000, String(CONSENT_TTL_MS));
  clearConsents();
}

console.log('[5] the exception list is explicit, declared, and nothing else is exempt');
{
  const routerSource = readFileSync(new URL('../src/background/api-router.js', import.meta.url), 'utf8');
  const block = routerSource.slice(routerSource.indexOf('const CONSENT_EXEMPT'), routerSource.indexOf('// Methods the UI polls'));
  const listed = [...block.matchAll(/\['([a-z]+\.[A-Za-z]+)',/g)].map((m) => m[1]);
  ok('exactly two methods are exempt, and each names its reason',
    listed.length === 2 && listed.join(',') === 'tx.registerAccount,intent.submit', listed.join(','));
  ok('every exemption is still a value-moving method in the router',
    listed.every((method) => isTransactionMethod(method)));
  ok('every exemption carries a written reason in the source', (block.match(/'.*'/gs)?.[0].length ?? 0) > 100);
  ok('the gate itself is one function, called from the request path',
    /async function requireConsent\(/.test(routerSource)
      && routerSource.indexOf('await requireConsent(method, params)') > 0);
  ok('a gate failure refuses instead of falling through',
    /catch \(error\) \{[\s\S]{0,220}return fail\('REVIEW_REQUIRED'/.test(routerSource));
  ok('the token is stripped before any handler sees it',
    /function stripConsentToken\(/.test(routerSource) && /handlers\[method\]\(handlerParams\)/.test(routerSource));

  // Minting is not reachable from the UI: no contract method may advertise it, and the only
  // production caller of mintConsent is confirmReview.
  const minting = Object.entries(METHODS).filter(([, spec]) => /consent/i.test(spec.returns || ''));
  ok('no bridge method returns or accepts a mintable consent token as a surface',
    minting.every(([name]) => name === 'tx.confirmReview'), minting.map(([name]) => name).join(','));
  const reviewSource = readFileSync(new URL('../src/background/services/review-service.js', import.meta.url), 'utf8');
  ok('confirmReview is the only production mint site',
    reviewSource.includes('mintConsent({') && !routerSource.includes('mintConsent('));
  // The comment may SAY chrome.storage (it explains the choice); the code must not use it.
  const consentSrc = readFileSync(new URL('../src/background/services/review/consent.js', import.meta.url), 'utf8');
  const consentCode = consentSrc.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
  ok('the consent module holds no storage dependency (memory only)',
    !/chrome\.storage/.test(consentCode));
  ok('control: the same scan finds chrome.storage in the review store, which does persist',
    /chrome\.storage/.test(readFileSync(new URL('../src/background/services/review/store.js', import.meta.url), 'utf8')));
}

console.log('[6] the UI forwards the token, and the real confirm path mints it');
{
  const confirmUi = readFileSync(new URL('../src/ui/domain/tx-review/confirm.js', import.meta.url), 'utf8');
  ok('confirm.js passes the token to the signing method', /consentToken/.test(confirmUi)
    && /\.\.\.submit\.params, consentToken/.test(confirmUi));
  ok('confirm.js refuses to submit without one', /if \(!consentToken\)/.test(confirmUi));
  const service = readFileSync(new URL('../src/background/services/review-service.js', import.meta.url), 'utf8');
  ok('the mint is bound to the reviewed account and network, not the current session',
    /accountAddress: record\.accountAddress/.test(service) && /networkId: record\.networkId/.test(service));
}

console.log(`\nreview-consent: ${checks} checks passed.`);
console.log('No network was contacted: every signing path was stubbed at the client boundary.');
