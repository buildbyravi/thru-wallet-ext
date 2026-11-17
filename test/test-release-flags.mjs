#!/usr/bin/env node
// Release flags — what is actually ON in the build that ships.
//
// WHY THIS SUITE EXISTS
//
// A swap screen shipped and was withdrawn in a day; the dashboard layout was reverted twice. Both
// were "the flag was on" decisions made in a diff nobody read as a release decision. The flags
// file says a flag is a build-time constant with no runtime override, which makes it the one
// truthful answer to "what is enabled right now" — so this suite asks it, and requires the answer
// to be a decision rather than a leftover.
//
// The rule (AGENTS.md 25) is: build behind the flag, enable only on a recorded decision. This test
// cannot read the decision, so it pins the shipped state: every flag off. Turning one on is a
// deliberate edit of the assertion below, in the same commit as the DECISIONS.md entry — which is
// exactly the review the flag exists to force.
//
//   [0] every flag is a boolean (no truthy strings, no undefined that reads as off)
//   [1] every flag is OFF in the shipped build
//   [2] the control: the same assertion FIRES when a flag is on
//   [3] the flag set is not empty, and the DeFi master switch is one of them

import { FLAGS, isDefiFeatureEnabled } from '../src/shared/flags.js';

let checks = 0;
let failures = 0;
function ok(label, condition, detail = '') {
  checks += 1;
  if (!condition) failures += 1;
  console.log(`  ${condition ? 'ok' : 'FAIL'} - ${label}${detail ? ` (${detail})` : ''}`);
}
function section(title) { console.log(`\n${title}`); }

// ---------------------------------------------------------------------------------------------
section('[0] the flag table is well formed');
ok('there are flags', Object.keys(FLAGS).length > 0, `${Object.keys(FLAGS).length}`);
ok('every flag value is a boolean',
  Object.values(FLAGS).every((value) => typeof value === 'boolean'),
  Object.entries(FLAGS).filter(([, v]) => typeof v !== 'boolean').map(([k]) => k).join(',') || 'all boolean');
ok('the DeFi master switch exists', Object.hasOwn(FLAGS, 'DEFI'));

// ---------------------------------------------------------------------------------------------
section('[1] nothing is enabled in the shipped build');
const enabled = Object.entries(FLAGS).filter(([, value]) => value === true).map(([key]) => key);
ok('every flag is off', enabled.length === 0, enabled.join(',') || 'all off');
ok('isDefiFeatureEnabled() answers false for the gated features it knows',
  ['DEFI', 'DEFI_READ', 'DEFI_DEX', 'DEFI_INTENT']
    .every((feature) => isDefiFeatureEnabled(feature) === false));

// ---------------------------------------------------------------------------------------------
section('[2] control — the assertion can fail');
const saved = { ...FLAGS };
FLAGS.DEFI = true;
FLAGS.DEFI_DEX = true;
const withOn = Object.entries(FLAGS).filter(([, value]) => value === true).map(([key]) => key).sort();
ok('flags turned on are detected', withOn.length === 2 && withOn.join(',') === 'DEFI,DEFI_DEX',
  withOn.join(','));
// The master switch AND the feature flag are both required — proving the check above is testing
// the real gate rather than a single boolean.
FLAGS.DEFI_DEX = false;
ok('the master switch alone still reports the feature off', isDefiFeatureEnabled('DEFI_DEX') === false);
FLAGS.DEFI_DEX = true;
ok('both switches together report the feature enabled', isDefiFeatureEnabled('DEFI_DEX') === true);
Object.assign(FLAGS, saved);

// ---------------------------------------------------------------------------------------------
section('[3] turning one on requires this file to change');
// The assertion above is the gate. If this file is edited to expect an enabled flag, the diff is
// the decision record — and a reviewer sees it as one line in the release, not a config token.
ok('the shipped state is pinned here, not in storage or a query string',
  !Object.keys(FLAGS).some((key) => /storage|query|localStorage/i.test(key)));

console.log('');
if (failures) {
  console.error(`release-flag checks: ${checks - failures} passed, ${failures} failed.`);
  process.exit(1);
}
console.log(`All release-flag checks passed: ${checks}/${checks}.`);
process.exit(0);
