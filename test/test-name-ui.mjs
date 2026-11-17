// Domain UI shared-value rules: exact asset decimals and provider validation.
import assert from 'node:assert/strict';
import { formatThru, formatTokenAmount } from '../src/shared/format.js';
import { availableThruProviders } from '../src/ui/app/routes/name-providers.js';
import * as registry from '../src/lib/registrar.js';
import * as custom from '../src/lib/custom-registrar.js';
import * as nameService from '../src/lib/name-service.js';
import { NATIVE_TOKEN } from '../src/shared/tokens.js';

let checks = 0;
function equal(actual, expected, label) {
  checks += 1;
  assert.equal(actual, expected, label);
}
function ok(condition, label) {
  checks += 1;
  assert.ok(condition, label);
}

// Native THRU configuration is pinned to 9 decimals by the shared formatter.
equal(NATIVE_TOKEN.decimals, 9, 'native asset configuration is the source of its 9-decimal scale');
equal(NATIVE_TOKEN.symbol, 'THRU', 'native ticker comes from shared asset configuration');
equal(formatThru(1_000n), '0.000001', '1,000 native base units retain all nonzero 9-decimal places');
equal(formatThru(1_000_000_000n), '1', 'one billion native base units format as 1 THRU');
equal(formatThru(0n), '0', 'zero native amount formats exactly');

// Registry tokens must use decimals read from the mint; boundary coverage includes the
// prompt's conditional 8-decimal example without assuming that THRU uses that scale.
equal(formatTokenAmount(1_000n, 8), '0.00001', '1,000 units at 8 decimals remain visible');
equal(formatTokenAmount(100_000_000n, 8), '1', '100 million units at 8 decimals format as one token');
equal(formatTokenAmount(1n, 18), '0.000000000000000001', '18-decimal dust never rounds to zero');
equal(formatTokenAmount(42n, 0), '42', 'zero-decimal assets remain integer amounts');

// Registration offers include only verified `.thru` registrar capabilities. A canonical
// `.id` root is intentionally not part of the mint-provider input or decision.
assert.deepEqual(availableThruProviders({
  registry: { supported: true, registry: { rootName: 'thru' } },
  custom: { supported: true, rootMatchesNameService: true, rootName: 'thru' },
}), ['custom', 'registry'], 'deployed custom `.thru` registrar is preferred over the paid fallback');
checks += 1;
assert.deepEqual(availableThruProviders({
  registry: { supported: true, registry: { rootName: 'id' } },
  custom: { supported: true, rootMatchesNameService: true, rootName: 'id' },
}), [], 'neither a paid nor custom `.id` root is offered for minting');
checks += 1;
assert.deepEqual(availableThruProviders({
  custom: { supported: true, rootMatchesNameService: false, rootName: 'thru' },
}), [], 'a custom registrar root mismatch is not offered');
checks += 1;

// The wallet uses the same backend validators at submission; pin the UI assumptions to them.
equal(registry.purchaseNameProblem('name_9-X'), null, 'paid registry accepts printable ASCII base labels');
ok(registry.purchaseNameProblem('has space') !== null, 'paid registry rejects whitespace');
ok(registry.purchaseNameProblem('name.thru') !== null, 'paid registry accepts a base label, not dotted input');
ok(registry.purchaseNameProblem('x'.repeat(65)) !== null, 'paid registry rejects labels over 64 bytes');
equal(custom.labelProblem('abc-9'), null, 'custom registrar accepts a lowercase 3–32 character label');
ok(custom.labelProblem('ABC') !== null, 'custom registrar rejects uppercase labels');
ok(custom.labelProblem('-abc') !== null, 'custom registrar rejects edge hyphens');
equal(nameService.nameProblem('alice-9'), null, 'name-service root accepts valid lowercase labels');
ok(nameService.nameProblem('ab') !== null, 'name-service root enforces its 3-character minimum');
ok(nameService.nameProblem('a..b') !== null, 'name-service root rejects empty labels');
equal(registry.yearsProblem(255), null, 'official registrar accepts the protocol maximum of 255 years');
equal(custom.yearsProblem(10), null, 'custom registrar accepts its configured 10-year maximum');
ok(custom.yearsProblem(11) !== null, 'custom registrar rejects durations over its configured maximum');

// Mount production behavior. Only native DOM primitives are supplemented locally.
const { installDom, ShimElement } = await import('./fixtures/dom-shim.mjs');
const doc = installDom();
let focused = null;
Object.defineProperty(doc, 'activeElement', { get: () => focused?.isConnected ? focused : doc.body });
ShimElement.prototype.focus = function () { focused = this; };
Object.defineProperty(Object.getPrototypeOf(ShimElement.prototype), 'isConnected', { configurable: true, get() {
  return this === doc.body || this === doc.documentElement || Boolean(this.parentNode?.isConnected);
} });
const setAttribute = ShimElement.prototype.setAttribute;
ShimElement.prototype.setAttribute = function (name, value) {
  setAttribute.call(this, name, value);
  if (name === 'disabled') this.disabled = true;
  if (name === 'readonly') this.readOnly = true;
};
ShimElement.prototype.removeAttribute = function (name) {
  this.attributes.delete(name);
  if (name === 'disabled') this.disabled = false;
  if (name === 'readonly') this.readOnly = false;
};
ShimElement.prototype.hasAttribute = function (name) { return this.attributes.has(name); };
ShimElement.prototype.click = function () {
  if (this.disabled) return;
  for (const listener of [...(this.listeners.get('click') || [])]) listener({ target: this, preventDefault() {} });
};
globalThis.requestAnimationFrame = (fn) => fn();
const check = (label, condition) => ok(condition, label);
const events = new Set();
const held = [];
const calls = [];
const owner = `ta${'A'.repeat(44)}`;
const target = `ta${'B'.repeat(44)}`;
const root = 'root-thru';
const domain = 'domain-account-not-a-resolved-address';
let state;
let hold = () => false;
function reset() {
  state = { account: owner, network: 'betanet', registry: false, customLease: true, registryLease: false,
    expiry: '1800000000', resolved: target, valid: true, isSelf: false, cached: false, broken: false };
  hold = () => false;
  calls.length = 0;
}
function answer(method, params) {
  const info = { supported: true, networkId: state.network, root, rootName: 'thru', rootMatchesNameService: true,
    fee3PerYear: '1000', fee4PerYear: '1000', fee5PlusPerYear: '1000', feePerYear: '1000', feeEnforced: true };
  if (method === 'account.getActive') return { address: state.account };
  if (method === 'network.getActive') return { id: state.network, label: state.network };
  if (method === 'name.getCustomRegistrar') return info;
  if (method === 'name.getRegistry') return state.registry
    ? { supported: true, registry: { rootRegistrar: root, rootName: 'thru', tokenMint: 'payment-mint', pricePerYear: '1000' }, rootDomain: { domain: { name: 'thru' } } }
    : { supported: false };
  if (method === 'name.getCachedDomains' || method === 'name.listDomains') return {
    networkId: state.network, accountAddress: state.account, items: [{ name: 'alice', rootName: 'thru',
      rootAddress: root, domainAddress: domain, status: 'owned', stale: method === 'name.getCachedDomains' }],
  };
  if (method === 'name.checkCustomLease') return { ...info, root: state.leaseRoot ?? root,
    name: params.name, domainAddress: state.leaseDomain ?? domain, domainExists: true,
    leaseExists: state.customLease, cached: state.cached, readError: state.broken ? 'unreadable' : null,
    lease: state.customLease ? { owner: state.leaseOwner ?? state.account, label: state.leaseLabel ?? params.name, resolver: 'stored-resolver-must-not-be-shown',
      expiresAtSeconds: state.expiry } : null };
  if (method === 'name.checkLease') return { supported: true, name: params.name, rootRegistrar: root,
    domainAddress: domain, domainExists: true, leaseExists: state.registryLease,
    lease: state.registryLease ? { owner: state.account, name: params.name, domainAccount: domain, endTime: state.expiry } : null };
  if (method === 'token.readMint') return { exists: true, decimals: 8, ticker: 'REG' };
  if (method === 'tx.validateAddress') return { valid: state.valid, isSelf: state.isSelf,
    resolvedName: params.address, resolvedAddress: state.resolved };
  if (method === 'tx.getCachedBalances') return { [state.account]: { balance: '1000000', exists: true, stale: true, fetchedAt: 1 } };
  if (method === 'tx.getBalance') return { balance: '1000000', exists: true,
    networkId: state.network, accountAddress: state.account, stale: false };
  if (method === 'name.getPaymentBalance') return { supported: false };
  throw new Error(`Missing name UI fixture: ${method}`);
}
globalThis.chrome = { runtime: { id: 'name-ui', lastError: null,
  onMessage: { addListener(fn) { events.add(fn); }, removeListener(fn) { events.delete(fn); } },
  sendMessage(message, callback) {
    calls.push(message);
    const reply = { ok: true, data: structuredClone(answer(message.method, message.params)) };
    if (hold(message.method, message.params)) held.push({ method: message.method, reply, callback });
    else queueMicrotask(() => callback(reply));
  },
} };
const { NameRoute } = await import('../src/ui/app/routes/name.js');
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); await new Promise(setImmediate); };
const button = (route, label) => route.el.querySelectorAll('button').find((b) => b.textContent.trim() === label);
const input = (route) => route.el.querySelector('input');
const release = () => { for (const item of held.splice(0)) item.callback(item.reply); };
function emit(event) { for (const listener of events) listener({ type: 'EVENT', event, data: {} }, { id: 'name-ui' }); }
async function mounted(run, setup = () => {}) {
  reset();
  setup();
  const route = NameRoute({ back() {} });
  doc.body.appendChild(route.el);
  try { await flush(); await run(route); }
  finally { route.destroy(); route.el.remove(); release(); await flush(); }
  check('production NameRoute tears down event handlers', events.size === 0);
}

const type = (control, value) => {
  control.value = value;
  for (const listener of [...(control.listeners.get('input') || [])]) listener({ target: control });
};
const releaseMethod = (method) => {
  for (let i = held.length - 1; i >= 0; i--) {
    if (held[i].method === method) {
      const [item] = held.splice(i, 1);
      item.callback(item.reply);
    }
  }
};

for (const cacheFirst of [false, true]) await mounted(async (route) => {
  const field = input(route);
  check('initial form is editable with context reads held', field && !field.disabled && !field.readOnly);
  field.focus();
  type(field, ' ali');
  const retained = (stage, value) => {
    equal(input(route), field, `${stage}: input node identity is retained`);
    equal(field.value, value, `${stage}: typed value is retained verbatim`);
    equal(doc.activeElement, field, `${stage}: input focus is retained`);
  };
  releaseMethod('network.getActive'); await flush();
  retained('network reply', ' ali');
  type(field, ' alice ');
  releaseMethod('account.getActive'); await flush();
  retained('account reply', ' alice ');
  check('network label hydrates in place', route.el.textContent.includes('Network: betanet'));
  check('cache read is bound to hydrated context', calls.some((call) => call.method === 'name.getCachedDomains'
    && call.params.expectedNetworkId === 'betanet' && call.params.expectedAccountAddress === owner));
  if (cacheFirst) { releaseMethod('name.getCachedDomains'); await flush(); retained('early cache reply', ' alice '); }
  releaseMethod('name.getRegistry'); releaseMethod('name.getCustomRegistrar'); await flush();
  retained('provider replies', ' alice ');
  check('typed draft gets an owned-name quote after context hydration', calls.some((call) =>
    call.method === 'name.checkCustomLease' && call.params.name === 'alice')
    && button(route, 'Review renewal')?.disabled === false);
  if (!cacheFirst) { releaseMethod('name.getCachedDomains'); await flush(); retained('late cache reply', ' alice '); }
  check('cached tracked name hydrates owner actions', button(route, 'Imported')?.disabled === true);
}, () => {
  hold = (method) => ['network.getActive', 'account.getActive', 'name.getCachedDomains',
    'name.getRegistry', 'name.getCustomRegistrar'].includes(method);
});

for (const boundary of ['account', 'network']) await mounted(async (route) => {
  const oldField = input(route);
  type(oldField, 'alice');
  hold = (method) => method === 'network.getActive' || method === 'account.getActive';
  state[boundary] = boundary === 'account' ? target : 'next-network';
  emit(boundary === 'account' ? 'accountsChanged' : 'networkChanged');
  check(`${boundary} event immediately disconnects old input`, !oldField.isConnected);
  check(`${boundary} event paints a blank editable form before context replies`, input(route)?.value === ''
    && !input(route)?.disabled && !input(route)?.readOnly);
  const freshField = input(route);
  freshField.focus(); type(freshField, 'bob');
  hold = () => false; release(); await flush();
  equal(input(route), freshField, `${boundary} hydration keeps new-context input`);
  equal(doc.activeElement, freshField, `${boundary} hydration keeps new-context focus`);
  check(`${boundary} hydration checks only the new draft`, calls.some((call) =>
    call.method === 'name.checkCustomLease' && call.params.name === 'bob')
    && !calls.some((call) => call.method === 'name.checkCustomLease' && call.params.name === 'alice'));
});

await mounted(async (route) => {
  const field = input(route);
  field.focus(); type(field, 'alice');
  route.destroy();
  const callCount = calls.length;
  release(); await flush();
  check('destroyed route cannot hydrate from held initial context', calls.length === callCount
    && !field.isConnected && !input(route));
}, () => { hold = (method) => method === 'network.getActive' || method === 'account.getActive'; });

await mounted(async (route) => {
  check('Register is editable', input(route)?.readOnly !== true);
  check('empty production draft hides the tier pill', route.el.querySelector('.domain-tier-pill').classList.contains('hidden'));
  button(route, 'My Domains').click(); await flush();
  check('Points to uses validated resolved address, not PDA or stored resolver',
    route.el.querySelectorAll('.domain-meta-value').some((node) => node.getAttribute('title') === target)
    && !route.el.textContent.includes('stored-resolver'));
  check('Points to calls the full-name validator', calls.some((call) => call.method === 'tx.validateAddress'
    && call.params.address === 'alice.thru'));
  hold = (method) => method === 'name.getCustomRegistrar';
  button(route, 'Renew').click();
  check('Renew becomes read-only before provider replies', input(route)?.readOnly === true && input(route)?.value === 'alice');
  hold = () => false; release(); await flush();
  check('renewal uses one selected name and no guessed expiry projection',
    input(route)?.readOnly === true && !route.el.querySelector('.domain-expiry-preview'));
  button(route, 'Register').click(); await flush();
  check('already-active Register exits renewal directly', input(route)?.readOnly !== true && input(route)?.value === '');
  check('the route never signs or queues a multi-name operation', !calls.some((call) =>
    ['name.renew', 'name.register', 'name.claimExpired'].includes(call.method))
    && route.el.querySelectorAll('.name-queue-row').length === 0);
});

for (const boundary of ['account', 'network']) await mounted(async (route) => {
  button(route, 'My Domains').click(); await flush(); button(route, 'Renew').click(); await flush();
  state[boundary] = boundary === 'account' ? target : 'next-network';
  emit(boundary === 'account' ? 'accountsChanged' : 'networkChanged'); await flush();
  button(route, 'Register').click(); await flush();
  check(`${boundary} changes discard renewal and restore a blank editable draft`, input(route)?.readOnly !== true && input(route)?.value === '');
});

await mounted(async (route) => {
  state.expiry = '18446744073709551615';
  hold = (method) => method === 'name.checkCustomLease' || method === 'tx.validateAddress';
  button(route, 'My Domains').click(); await flush();
  check('lease and resolution replies are independently held', held.some((item) => item.method === 'name.checkCustomLease')
    && held.some((item) => item.method === 'tx.validateAddress'));
  state.expiry = '8640000000001'; state.resolved = owner; state.isSelf = true;
  hold = () => false; button(route, 'Refresh ownership').click(); await flush();
  release(); await flush();
  check('old lease and resolution generations cannot overwrite fresh facts',
    route.el.querySelectorAll('.domain-meta-value').some((node) => node.getAttribute('title') === owner)
    && !route.el.querySelectorAll('.domain-meta-value').some((node) => node.getAttribute('title') === target));
  check('old lease expiry cannot overwrite a fresh refresh', route.el.textContent.includes('8640000000001')
    && !route.el.textContent.includes('18446744073709551615'));
  check('valid self resolution is shown', state.isSelf && route.el.querySelectorAll('.domain-meta-value')
    .some((node) => node.getAttribute('title') === owner));
  state.valid = false; button(route, 'Refresh ownership').click(); await flush();
  check('unreadable resolution stays unknown',
    !route.el.querySelectorAll('.domain-meta-value').some((node) => node.getAttribute('title') === owner)
    && route.el.textContent.includes('Unknown'));
});

await mounted(async (route) => {
  button(route, 'My Domains').click(); await flush();
  for (const expiry of [null, 'invalid', '18446744073709551615', '8640000000001']) {
    state.expiry = expiry; button(route, 'Refresh ownership').click(); await flush();
    check(`unknown expiry ${expiry} never claims Active or a resulting date`,
      !route.el.textContent.includes('Active') && !route.el.textContent.includes('Valid through')
      && !route.el.textContent.includes('Invalid Date'));
  }
});

await mounted(async (route) => {
  button(route, 'My Domains').click(); await flush();
  for (const [field, value] of [['leaseRoot', 'wrong-root'], ['leaseDomain', 'wrong-domain'],
    ['leaseLabel', 'bob'], ['leaseOwner', target], ['leaseOwner', '']]) {
    state[field] = value; button(route, 'Refresh ownership').click(); await flush();
    check(`fresh mismatched ${field} cannot enable renewal`, button(route, 'Renew')?.disabled === true);
    delete state[field];
  }
});

await mounted(async (route) => {
  state.registry = true;
  button(route, 'My Domains').click(); await flush();
  check('dual providers select the unique custom lease', button(route, 'Renew')?.disabled === false);
  state.customLease = false; state.registryLease = true; button(route, 'Refresh ownership').click(); await flush();
  check('dual providers select the unique official lease', button(route, 'Renew')?.disabled === false);
  button(route, 'Renew').click(); await flush();
  check('official renewal remains pinned', route.el.textContent.includes('1–64 characters') && input(route)?.readOnly === true);
  button(route, 'My Domains').click(); await flush();
  state.customLease = true; button(route, 'Refresh ownership').click(); await flush();
  check('two eligible leases cannot enable Renew', button(route, 'Renew')?.disabled === true);
  state.registryLease = false; state.cached = true; button(route, 'Refresh ownership').click(); await flush();
  check('cached leases cannot enable Renew', button(route, 'Renew')?.disabled === true);
  state.cached = false; state.broken = true; button(route, 'Refresh ownership').click(); await flush();
  check('unreadable leases leave useful rows without renewal', button(route, 'Renew')?.disabled === true
    && route.el.textContent.includes('alice.thru') && route.el.textContent.includes('Points to'));
});

console.log(`test-name-ui: ${checks} checks passed`);
