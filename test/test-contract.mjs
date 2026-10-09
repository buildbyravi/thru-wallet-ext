// Contract test — asserts the UI/background seam agrees in BOTH directions.
//
// Direction 1: every handler wired in api-router.js is declared in the contract manifest.
//              Catches a backend method added without documenting it.
// Direction 2: every method declared in the manifest is actually wired in api-router.js.
//              Catches a rename or deletion that would make a UI call fail at runtime.
//
// This is the specific mechanism that turns "the backend never breaks because of the
// frontend" from a policy into a property. It is also what would have caught the live bug
// where token-service.js sent `symbol`/`imageUrl` while thru-client.js destructured
// `ticker`/`imageUri`.
//
// Run: node test/test-contract.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { transform } from 'esbuild';

// api-router.js imports service modules that touch `chrome`, so stub enough of the API to
// let the module graph load. No handler is invoked here; only the shape is inspected.
globalThis.chrome = {
  runtime: { id: 'test', onMessage: { addListener() {} }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
  alarms: { create() {}, clear() {}, onAlarm: { addListener() {} } },
  storage: {
    local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
  },
};

const { METHODS, CONTRACT_VERSION, EVENTS, isKnownMethod, ERROR_CODES } = await import('../src/shared/contract/manifest.js');
const { listHandlerNames, handleApiRequest } = await import('../src/background/api-router.js');

let failures = 0;
let checks = 0;

function ok(label, condition, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`  ok - ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL - ${label}${detail ? `\n         ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n[${title}]`);
}

const declared = new Set(Object.keys(METHODS));
const wired = new Set(listHandlerNames());

section('Contract versioning');
ok('contract v5 documents the signing-auth compatibility break', CONTRACT_VERSION >= 5);
ok('contract v6 documents destructive-settings hardening', CONTRACT_VERSION >= 6);
ok('contract v7 documents the custom-network quarantine break', CONTRACT_VERSION >= 7);
ok('contract v8 documents the token-transfer addition', CONTRACT_VERSION >= 8);
ok('contract v9 documents the history-feed cache addition', CONTRACT_VERSION >= 9);
ok('contract v10 documents the transaction-detail addition', CONTRACT_VERSION >= 10);
ok('contract v11 pins a reviewed send to a source account and network', CONTRACT_VERSION >= 11);
ok('contract v13 documents the faucet auth/param change', CONTRACT_VERSION >= 13);
ok('contract v14 documents the token.readMint addition', CONTRACT_VERSION >= 14);
ok('contract v15 documents the tx.checkDuplicate addition', CONTRACT_VERSION >= 15);

// Contract v10 invariants. tx.getDetail is a read, so it must NOT have acquired an auth
// gate it does not need — but more importantly its declared return shape must keep saying
// that the fee is a header DECLARATION. If someone renames it to `feeUnits` or drops the
// `feeCharged: false` marker, a future caller will present a declaration as a receipt.
{
  const detail = METHODS['tx.getDetail'];
  ok('tx.getDetail exists since v10 and is callable while locked, like every tx.* read',
    Boolean(detail) && detail.since === 10 && detail.auth === 'none',
    JSON.stringify(detail));
  ok('tx.getDetail declares signature and address params',
    ['signature', 'address'].every((p) => detail.params.includes(p)),
    (detail?.params || []).join(','));
  ok('tx.getDetail names the fee as DECLARED, never as an amount charged',
    /feeDeclaredUnits/.test(detail.returns)
      && /feeCharged: false/.test(detail.returns)
      && !/\bfeeUnits\b/.test(detail.returns),
    detail.returns);
  ok('tx.getDetail documents that unknown fields arrive as null rather than a guess',
    /null/.test(detail.returns) && /never a guess/i.test(detail.returns),
    detail.returns);
}

section('Contract v11 checked signing context');
for (const method of ['tx.sendChecked', 'token.transferChecked']) {
  const spec = METHODS[method];
  ok(`${method} remains signing-gated`, spec?.since === 11 && spec?.auth === 'signing');
  ok(`${method} requires reviewed account, network, destination, amount and password`,
    ['fromAddress', 'networkId', 'toAddress', 'amountUnits', 'password']
      .every((param) => spec?.params.includes(param)), JSON.stringify(spec?.params));
}

section('Contract v12 creation-bound registration and cache-first history');
ok('contract v16 documents the legacy signing-path retirement', CONTRACT_VERSION >= 16);
const register = METHODS['tx.registerAccount'];
ok('tx.registerAccount is unlocked-only, explicitly targets an address, and has no password field',
  register?.since === 12 && register?.auth === 'unlocked'
    && JSON.stringify(register?.params) === JSON.stringify(['address']));
const cachedHistory = METHODS['tx.getCachedHistory'];
ok('tx.getCachedHistory is a read-only, no-auth, address-scoped method',
  cachedHistory?.since === 12 && cachedHistory?.auth === 'none'
    && JSON.stringify(cachedHistory?.params) === JSON.stringify(['address']));
ok('legacy tx.autoCreateAccount remains signing-gated and unchanged',
  METHODS['tx.autoCreateAccount']?.auth === 'signing'
    && JSON.stringify(METHODS['tx.autoCreateAccount']?.params) === JSON.stringify(['password']));

section('Contract v14 chain-verified custom-token import');
const readMint = METHODS['token.readMint'];
ok('token.readMint is a read-only, no-auth, mint-scoped lookup',
  readMint?.since === 14 && readMint?.auth === 'none'
    && JSON.stringify(readMint?.params) === JSON.stringify(['mintAddress']));
ok('token.import stays unlocked-only and metadata-only',
  METHODS['token.import']?.auth === 'unlocked'
    && JSON.stringify(METHODS['token.import']?.params)
      === JSON.stringify(['mintAddress', 'symbol', 'name', 'decimals']));

section('Contract v15 duplicate detection and repeat-send confirmation');
const checkDup = METHODS['tx.checkDuplicate'];
ok('tx.checkDuplicate is a read-only, no-auth duplicate lookup',
  checkDup?.since === 15 && checkDup?.auth === 'none'
    && JSON.stringify(checkDup?.params) === JSON.stringify(['toAddress', 'amountUnits', 'mintAddress', 'fromAddress']));
ok('checked send methods declare optional allowDuplicate param',
  METHODS['tx.sendChecked']?.params.includes('allowDuplicate')
    && METHODS['token.transferChecked']?.params.includes('allowDuplicate'));

section('Contract v16 legacy signing-path retirement');
ok('unbound legacy mutation methods are no longer callable',
  !METHODS['tx.send'] && !METHODS['token.transfer']
    && !wired.has('tx.send') && !wired.has('token.transfer'));

section('Contract v17/v18 DeFi contract-first drop (M0)');

// v20 (2026-10-09, G2-S0): same method set — the v18 intent surface now has a real,
// flag-gated native-send implementation behind it (test/test-defi-intent.mjs proves both
// sides of the gate). A version bump, not a method change.
ok('the contract advances to v21 without reusing earlier numbers', CONTRACT_VERSION === 21);

const v17 = Object.entries(METHODS).filter(([, spec]) => spec.since === 17).map(([name]) => name);
const v18 = Object.entries(METHODS).filter(([, spec]) => spec.since === 18).map(([name]) => name);
ok('v17 appends exactly 29 READ+LOCAL methods', v17.length === 29, `got ${v17.length}`);
ok('v18 appends exactly 14 PREPARE+EXECUTE methods', v18.length === 14, `got ${v18.length}`);

// Name-service additions (v19, 2026-10-08): two always-honest reads and three gated writes.
const v19 = Object.entries(METHODS).filter(([, spec]) => spec.since === 19).map(([name]) => name);
ok('v19 appends exactly 5 name.* methods', v19.length === 5, `got ${v19.join(', ')}`);
ok('v21 appends exactly 3 primary-name methods, reads/lifecycle unlocked, nothing signing',
  ['name.getPrimary', 'name.linkPrimary', 'name.unlinkPrimary'].every((m) => METHODS[m]?.since === 21 && METHODS[m]?.auth === 'unlocked'));

ok('v19 reads are open while v19 writes require an unlocked wallet',
  ['name.lookup', 'name.checkAvailability'].every((m) => METHODS[m].auth === 'none')
  && ['name.initRoot', 'name.register', 'name.setRecord'].every((m) => METHODS[m].auth === 'unlocked'));
ok('the contract declares 132 methods in total (81 + 43 + 8 name.*)', Object.keys(METHODS).length === 132,
  `got ${Object.keys(METHODS).length}`);

// Auth discipline (DEFI-03): reads are call-time honest, prepares are unlocked-only, and
// exactly ONE DeFi method signs.
const defiMethods = [...v17, ...v18];
const defiSigning = defiMethods.filter((m) => METHODS[m].auth === 'signing');
ok('intent.submit is the ONLY DeFi method using signing auth',
  defiSigning.length === 1 && defiSigning[0] === 'intent.submit', defiSigning.join(', '));
ok('no DeFi method is directly password-gated (password flows only through signing auth)',
  defiMethods.every((m) => METHODS[m].auth !== 'password'));

// Discovery reads render the unsupported-state screens, so they must run while locked.
for (const name of ['program.capabilities', 'program.list', 'feed.status', 'feed.lookup']) {
  ok(`${name} is callable while locked`, METHODS[name]?.auth === 'none',
    `auth is '${METHODS[name]?.auth}'`);
}
// Public read-mostly pool/market surfaces also render locked, matching the wallet's tx reads.
for (const name of ['market.assetGet', 'market.snapshot', 'market.candles', 'market.trades',
  'market.holders', 'risk.assetAssess', 'launchpad.list', 'launchpad.get', 'dex.listPools',
  'dex.getPool', 'dex.quote', 'dex.quoteLiquidity', 'launchpad.validateDraft', 'desktop.open']) {
  ok(`${name} is a public read (auth none)`, METHODS[name]?.auth === 'none',
    `auth is '${METHODS[name]?.auth}'`);
}
// Wallet-scoped reads/writes sit behind the session, per S3 mutate-vs-read split.
for (const name of ['intent.list', 'intent.get', 'dex.positions', 'launchpad.listMine',
  'launchpad.draftList', 'launchpad.draftSave', 'market.watchlistGet', 'market.watchlistAdd',
  'intent.prepareSend', 'dex.prepareSwap', 'launchpad.prepareCreate']) {
  ok(`${name} is unlocked`, METHODS[name]?.auth === 'unlocked', `auth is '${METHODS[name]?.auth}'`);
}

// Events and error codes the DeFi lifecycle needs are declared and documented.
for (const eventName of ['intentChanged', 'capabilitiesChanged', 'feedChanged']) {
  ok(`${eventName} push event is declared`, typeof EVENTS[eventName] === 'string');
}
for (const code of ['FEATURE_DISABLED', 'UNSUPPORTED', 'INVALID_INPUT', 'ALREADY_EXISTS',
  'BINDING_MISMATCH', 'INTENT_EXPIRED', 'QUOTE_EXPIRED', 'NOTHING_TO_CLAIM',
  'UPLOAD_REJECTED', 'USER_REJECTED', 'VERSION_MISMATCH', 'INTERNAL']) {
  ok(`${code} is documented`, typeof ERROR_CODES[code] === 'string');
}

section('Contract and router agree in both directions');

const undeclared = [...wired].filter((m) => !declared.has(m));
ok(
  'every wired handler is declared in the manifest',
  undeclared.length === 0,
  undeclared.length ? `Wired but undeclared: ${undeclared.join(', ')}\n         Add them to src/shared/contract/manifest.js.` : '',
);

const unwired = [...declared].filter((m) => !wired.has(m));
ok(
  'every declared method is wired in the router',
  unwired.length === 0,
  unwired.length ? `Declared but unwired: ${unwired.join(', ')}\n         Implement them in src/background/api-router.js.` : '',
);

section('Manifest entries are well formed');

const VALID_AUTH = new Set(['none', 'unlocked', 'password', 'signing']);
const malformed = [];
for (const [name, spec] of Object.entries(METHODS)) {
  if (!Array.isArray(spec.params)) malformed.push(`${name}: params must be an array`);
  if (typeof spec.returns !== 'string' || !spec.returns) malformed.push(`${name}: returns must be a non-empty string`);
  if (!VALID_AUTH.has(spec.auth)) malformed.push(`${name}: auth must be one of none|unlocked|password|signing`);
  if (!Number.isInteger(spec.since) || spec.since < 1) malformed.push(`${name}: since must be a positive integer`);
  if (spec.since > CONTRACT_VERSION) malformed.push(`${name}: since (${spec.since}) exceeds CONTRACT_VERSION (${CONTRACT_VERSION})`);
}
ok('every method declares params, returns, auth and since', malformed.length === 0, malformed.join('\n         '));

const namePattern = /^[a-z]+\.[a-zA-Z]+$/;
const badNames = [...declared].filter((m) => !namePattern.test(m));
ok('method names are namespace.method', badNames.length === 0, badNames.join(', '));

section('Password-gated methods accept a password param');

const missingPasswordParam = Object.entries(METHODS)
  .filter(([, spec]) => (spec.auth === 'password' || spec.auth === 'signing') && !spec.params.includes('password'))
  .map(([name]) => name);
ok(
  'every password/signing method declares a password param',
  missingPasswordParam.length === 0,
  missingPasswordParam.join(', '),
);

section('Sensitive operations are password-gated, not merely unlock-gated');

// Adding or removing key material, and revealing a secret, must re-verify the password
// against the encrypted blob. An unlocked session alone must never be enough.
const MUST_REQUIRE_PASSWORD = [
  'wallet.exportSecret',
  'wallet.verifyPassword',
  'wallet.removeLegacyBackup',
  'keyring.addSeed',
  'keyring.addPrivateKey',
  'keyring.rename',
  'keyring.remove',
  'account.addImported',
  'system.setAutoLock',
];
for (const name of MUST_REQUIRE_PASSWORD) {
  ok(`${name} requires a password`, METHODS[name]?.auth === 'password', `auth is '${METHODS[name]?.auth}'`);
}
ok(
  'settings.setSecurity was introduced with contract v5',
  METHODS['settings.setSecurity']?.since === 5,
  `since is '${METHODS['settings.setSecurity']?.since}'`,
);
ok(
  'system.setAutoLock records authSince v6',
  METHODS['system.setAutoLock']?.authSince === 6,
  `authSince is '${METHODS['system.setAutoLock']?.authSince}'`,
);
ok(
  'wallet.reset records hardeningSince v6',
  METHODS['wallet.reset']?.hardeningSince === 6,
  `hardeningSince is '${METHODS['wallet.reset']?.hardeningSince}'`,
);
ok('wallet.reset requires explicit confirmation param', METHODS['wallet.reset']?.params.includes('confirmation'));
ok('wallet.reset can carry a password when unlocked', METHODS['wallet.reset']?.params.includes('password'));

// Signing has its own auth mode because the user may explicitly opt into password
// re-authentication in Settings. Session-only signing is the documented default.
const MUST_USE_SIGNING_AUTH = [
  'tx.sendChecked',
  'tx.autoCreateAccount',
  'token.deploy',
  'token.transferChecked',
];
for (const name of MUST_USE_SIGNING_AUTH) {
  ok(`${name} uses signing auth`, METHODS[name]?.auth === 'signing', `auth is '${METHODS[name]?.auth}'`);
  ok(`${name} can carry a signing password`, METHODS[name]?.params.includes('password'));
}
ok('tx.claimFaucet uses unlocked auth', METHODS['tx.claimFaucet']?.auth === 'unlocked');

section('Multi-seed keyring API is exposed');

// Regression guard for the original defect: vault.js implemented multi-seed from V2 while
// api-router.js had no keyring namespace at all, leaving the whole feature unreachable.
for (const name of ['keyring.list', 'keyring.addSeed', 'keyring.addPrivateKey', 'keyring.rename', 'keyring.remove']) {
  ok(`${name} is wired`, wired.has(name));
}

section('Router rejects unknown and malformed requests');

const proto = await handleApiRequest({ method: 'constructor', params: {} });
ok(
  'prototype-chain method name is rejected',
  proto.ok === false && proto.error.code === 'UNKNOWN_METHOD',
  `got ${JSON.stringify(proto)}`,
);

const nope = await handleApiRequest({ method: 'wallet.definitelyNotAMethod' });
ok('unknown method is rejected', nope.ok === false && nope.error.code === 'UNKNOWN_METHOD');

const notObject = await handleApiRequest('wallet.hasVault');
ok('non-object request is rejected', notObject.ok === false && notObject.error.code === 'INVALID_REQUEST');

const arrayParams = await handleApiRequest({ method: 'wallet.hasVault', params: [] });
ok('array params are rejected', arrayParams.ok === false && arrayParams.error.code === 'INVALID_REQUEST');

const nullReq = await handleApiRequest(null);
ok('null request is rejected', nullReq.ok === false && nullReq.error.code === 'INVALID_REQUEST');

ok('isKnownMethod agrees with the manifest', isKnownMethod('wallet.unlock') && !isKnownMethod('toString'));

section('Locked wallet blocks privileged methods');

// chrome.storage.session is stubbed empty, so isUnlocked() is false here.
const lockedList = await handleApiRequest({ method: 'account.list', params: {} });
ok(
  'account.list is refused while locked',
  lockedList.ok === false && lockedList.error.code === 'WALLET_LOCKED',
  `got ${JSON.stringify(lockedList)}`,
);

const lockedKeyrings = await handleApiRequest({ method: 'keyring.list', params: {} });
ok('keyring.list is refused while locked', lockedKeyrings.ok === false && lockedKeyrings.error.code === 'WALLET_LOCKED');

const noPassword = await handleApiRequest({ method: 'wallet.exportSecret', params: { ref: {} } });
ok(
  'exportSecret without a password is refused',
  noPassword.ok === false && ['WALLET_LOCKED', 'AUTH_REQUIRED'].includes(noPassword.error.code),
  `got ${JSON.stringify(noPassword)}`,
);

const openMethod = await handleApiRequest({ method: 'wallet.hasVault', params: {} });
ok('auth:none method runs while locked', openMethod.ok === true, `got ${JSON.stringify(openMethod)}`);

section('Error codes are stable');

for (const code of [
  'INVALID_REQUEST',
  'UNKNOWN_METHOD',
  'WALLET_LOCKED',
  'AUTH_REQUIRED',
  'AUTH_LOCKED_OUT',
  'CUSTOM_NETWORK_DISABLED',
  'SEND_CONTEXT_CHANGED',
]) {
  ok(`${code} is documented`, typeof ERROR_CODES[code] === 'string');
}

section('The UI only calls methods that exist');

// Scan UI source for bridge.send('...') literals and confirm each is declared. A typo or a
// stale call site fails here instead of at runtime in front of a user.
//
// Walk ALL of the existing UI/popup trees; stale, hand-maintained paths had left new
// components unchecked (and silently swallowed missing files).
function walkJs(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory() && entry.name !== 'vendor') walkJs(full, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const UI_FILES = [...walkJs('src/ui'), ...walkJs('src/popup')];
// Do not require a valid-looking namespace.method here: a typo like 'tx.send_cheked'
// would have been ignored by the old regex, even though bridge.send rejects it at runtime.
const literalCallRe = /\b(?:bridge\s*\.\s*)?send\s*\(\s*(['"])([^'"]*)\1/g;
async function withoutComments(source) {
  const result = await transform(source, {
    loader: 'js', target: 'esnext', supported: { 'template-literal': false }, logLevel: 'silent',
  });
  return result.code;
}
function literalMethods(source) {
  // Match against the transformed code, but accept a match only if it STARTS in code,
  // not inside an explanatory string such as "bridge.send('fake.method')". Keep the
  // original source for capturing the quoted method argument.
  const codeOnly = source.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
    (literal) => ' '.repeat(literal.length));
  return [...source.matchAll(literalCallRe)]
    .filter((match) => codeOnly[match.index] !== ' ')
    .map((match) => match[2]);
}
const probeCalls = literalMethods(await withoutComments([
  '// bridge.send("fake.comment")',
  'const note = "bridge.send(\'fake.string\')";',
  'bridge.send("tx.send_cheked");',
  'send("notAMethod");',
].join('\n')));
ok('the UI method scanner includes malformed literals but ignores comments and strings',
  JSON.stringify(probeCalls) === JSON.stringify(['tx.send_cheked', 'notAMethod']));

const called = new Set();
const callSites = new Map();
for (const file of UI_FILES) {
  const source = await withoutComments(readFileSync(file, 'utf8'));
  for (const method of literalMethods(source)) {
    called.add(method);
    if (!callSites.has(method)) callSites.set(method, file);
  }
}
const phantom = [...called].filter((m) => !declared.has(m));
ok(
  `all ${called.size} bridge calls across ${UI_FILES.length} UI files are declared`,
  UI_FILES.length > 0 && called.size > 0 && phantom.length === 0,
  phantom.length
    ? phantom.map((m) => `${m} (called from ${callSites.get(m)})`).join('\n         ')
    : `Found ${UI_FILES.length} UI files and ${called.size} literal bridge calls.`,
);

section('Every checked-in test runs in npm test');
const testFiles = readdirSync('test').filter((name) => /^test-.*\.mjs$/.test(name))
  .map((name) => `test/${name}`).sort();
const testScript = JSON.parse(readFileSync('package.json', 'utf8')).scripts.test;
const wiredTests = [...testScript.matchAll(/(?:^|&&)\s*node\s+(test\/test-[\w-]+\.mjs)(?=\s*(?:&&|$))/g)]
  .map((match) => match[1]);
const missingTests = testFiles.filter((file) => !wiredTests.includes(file));
const extraTests = wiredTests.filter((file) => !testFiles.includes(file));
const duplicateTests = wiredTests.filter((file, index) => wiredTests.indexOf(file) !== index);
ok('npm test includes every test/test-*.mjs exactly once and no deleted test',
  testFiles.length > 0 && missingTests.length === 0 && extraTests.length === 0
    && duplicateTests.length === 0,
  `Missing: ${missingTests.join(', ') || 'none'}; stale: ${extraTests.join(', ') || 'none'}; duplicate: ${duplicateTests.join(', ') || 'none'}`);

console.log(`\n${failures === 0 ? 'All' : ''} contract checks: ${checks - failures}/${checks} passed.`);
if (failures > 0) {
  console.error(`\n${failures} contract check(s) failed.`);
  process.exit(1);
}
console.log('Contract is consistent in both directions.');
