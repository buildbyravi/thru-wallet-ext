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

console.log(`test-name-ui: ${checks} checks passed`);
