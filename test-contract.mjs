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
// Run: node test-contract.mjs

import { readFileSync, readdirSync } from 'node:fs';

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

const { METHODS, CONTRACT_VERSION, isKnownMethod, ERROR_CODES } = await import('./src/shared/contract/manifest.js');
const { listHandlerNames, handleApiRequest } = await import('./src/background/api-router.js');

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

const VALID_AUTH = new Set(['none', 'unlocked', 'password']);
const malformed = [];
for (const [name, spec] of Object.entries(METHODS)) {
  if (!Array.isArray(spec.params)) malformed.push(`${name}: params must be an array`);
  if (typeof spec.returns !== 'string' || !spec.returns) malformed.push(`${name}: returns must be a non-empty string`);
  if (!VALID_AUTH.has(spec.auth)) malformed.push(`${name}: auth must be one of none|unlocked|password`);
  if (!Number.isInteger(spec.since) || spec.since < 1) malformed.push(`${name}: since must be a positive integer`);
  if (spec.since > CONTRACT_VERSION) malformed.push(`${name}: since (${spec.since}) exceeds CONTRACT_VERSION (${CONTRACT_VERSION})`);
}
ok('every method declares params, returns, auth and since', malformed.length === 0, malformed.join('\n         '));

const namePattern = /^[a-z]+\.[a-zA-Z]+$/;
const badNames = [...declared].filter((m) => !namePattern.test(m));
ok('method names are namespace.method', badNames.length === 0, badNames.join(', '));

section('Password-gated methods accept a password param');

const missingPasswordParam = Object.entries(METHODS)
  .filter(([, spec]) => spec.auth === 'password' && !spec.params.includes('password'))
  .map(([name]) => name);
ok(
  'every auth:password method declares a password param',
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
];
for (const name of MUST_REQUIRE_PASSWORD) {
  ok(`${name} requires a password`, METHODS[name]?.auth === 'password', `auth is '${METHODS[name]?.auth}'`);
}

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

for (const code of ['INVALID_REQUEST', 'UNKNOWN_METHOD', 'WALLET_LOCKED', 'AUTH_REQUIRED', 'AUTH_LOCKED_OUT']) {
  ok(`${code} is documented`, typeof ERROR_CODES[code] === 'string');
}

section('The UI only calls methods that exist');

// Scan UI source for bridge.send('...') literals and confirm each is declared. A typo or a
// stale call site fails here instead of at runtime in front of a user.
//
// The route directory is walked rather than listed, because a hand-maintained list silently
// stops covering new files — which is exactly how a phantom 'wallet.generateMnemonic' call
// reached a finished route before this walk existed.
function walkJs(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walkJs(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const UI_FILES = [
  'src/popup/popup.js',
  'src/desktop/desktop.js',
  'src/ui/bridge.js',
  ...walkJs('src/ui/app'),
  ...walkJs('src/ui/components'),
  ...walkJs('src/ui/domain'),
  ...walkJs('src/features'),
];

const called = new Set();
const callSites = new Map();
for (const file of UI_FILES) {
  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const re = /(?:bridge\.)?send\s*\(\s*['"]([a-z]+\.[a-zA-Z]+)['"]/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    called.add(m[1]);
    if (!callSites.has(m[1])) callSites.set(m[1], file);
  }
}
const phantom = [...called].filter((m) => !declared.has(m));
ok(
  `all ${called.size} bridge calls across ${UI_FILES.length} UI files are declared`,
  phantom.length === 0,
  phantom.length
    ? phantom.map((m) => `${m} (called from ${callSites.get(m)})`).join('\n         ')
    : '',
);

console.log(`\n${failures === 0 ? 'All' : ''} contract checks: ${checks - failures}/${checks} passed.`);
if (failures > 0) {
  console.error(`\n${failures} contract check(s) failed.`);
  process.exit(1);
}
console.log('Contract is consistent in both directions.');
