// Offline ratelimit-awareness tests — NO network. Budget fixtures are byte-exact account
// layouts taken from the pinned @thru/programs@0.4.2 dist struct views (offsets verified
// line-by-line against the generated classes; drift in the package would break these).
//
//   Policy (390 B): magic@0(u64le) admin@8(32) target@40(32) policy_id@72(u64le)
//                   state_flags@80(u8) config@81(309, encodeRatelimitConfig)
//   Bucket (113 B): magic@0(u64le) policy@8(32) key@40(32) rule_idx@72(u8)
//                   window_start@73(u64le) calls@81 amount@89 total_calls@97 total_amount@105
//
// The official ENCODER (encodeRatelimitConfig) builds config fixtures — fixtures are as
// close to first-party as this test suite can get.

import {
  RATELIMIT_PROGRAM_ADDRESS,
  RATELIMIT_ERRORS,
  RATELIMIT_KEY_GLOBAL,
  RATELIMIT_KEY_FEE_PAYER,
  RATELIMIT_KEY_INSTR_ACCOUNT,
  RATELIMIT_KEY_ATTESTED,
  RATELIMIT_CLOCK_UNIX_SECONDS,
  RATELIMIT_CLOCK_SLOT,
  RATELIMIT_POLICY_MAGIC,
  RATELIMIT_BUCKET_MAGIC,
  RATELIMIT_POLICY_SIZE,
  RATELIMIT_BUCKET_SIZE,
  RATELIMIT_GLOBAL_KEY,
  encodeRatelimitConfig,
} from '@thru/programs/ratelimit';
import {
  BOOTSTRAP_FAUCET_RATE_LIMIT_POLICY_ADDRESS,
  BOOTSTRAP_FAUCET_RATE_LIMIT_POLICY_ID,
  BOOTSTRAP_PROGRAM_ADDRESSES,
} from '@thru/programs/bootstrap-addresses';
import { Pubkey } from '@thru/sdk';

import * as rl from '../src/lib/ratelimit.js';

let failures = 0;
function ok(cond, label) {
  if (!cond) { failures += 1; console.error(`  FAIL ${label}`); }
  else console.log(`  ok   ${label}`);
}
function eq(a, b, label) {
  ok(a === b, `${label} (got ${String(a)}, want ${String(b)})`);
}

const NOW = 1_760_000_000n; // fixed wall clock for deterministic windows

function makePolicy({ admin, target, policyId = 0n, stateFlags = 0, rules, maxAmountPerCall = 0n }) {
  const config = encodeRatelimitConfig({
    selectorSz: 0,
    selectorOffset: 0,
    selectorValue: 0n,
    instrSzMin: 0,
    instrSzMax: 0xffff,
    amountSz: 8,
    amountOffset: 8,
    maxAmountPerCall,
    rules,
  });
  const out = new Uint8Array(RATELIMIT_POLICY_SIZE);
  const view = new DataView(out.buffer);
  view.setBigUint64(0, RATELIMIT_POLICY_MAGIC, true);
  out.set(admin, 8);
  out.set(target, 40);
  view.setBigUint64(72, policyId, true);
  view.setUint8(80, stateFlags);
  out.set(config, 81);
  return out;
}

function makeBucket({ policy, key, ruleIdx = 0, windowStart = 0n, calls = 0n, amount = 0n, totalCalls = 0n, totalAmount = 0n }) {
  const out = new Uint8Array(RATELIMIT_BUCKET_SIZE);
  const view = new DataView(out.buffer);
  view.setBigUint64(0, RATELIMIT_BUCKET_MAGIC, true);
  out.set(policy, 8);
  out.set(key, 40);
  view.setUint8(72, ruleIdx);
  view.setBigUint64(73, windowStart, true);
  view.setBigUint64(81, calls, true);
  view.setBigUint64(89, amount, true);
  view.setBigUint64(97, totalCalls, true);
  view.setBigUint64(105, totalAmount, true);
  return out;
}

const PAYER = Pubkey.from(BOOTSTRAP_FAUCET_RATE_LIMIT_POLICY_ADDRESS).toBytes().fill(7, 16); // any 32 B — content irrelevant, determinism matters
const POLICY_BYTES = Pubkey.from(rl.FAUCET_POLICY_ADDRESS).toBytes();
const TARGET_BYTES = Pubkey.from(BOOTSTRAP_PROGRAM_ADDRESSES.faucet).toBytes();

// --- Pin re-exports mirror the package -------------------------------------------------
console.log('pins');
eq(rl.FAUCET_POLICY_ADDRESS, BOOTSTRAP_FAUCET_RATE_LIMIT_POLICY_ADDRESS, 'faucet policy address pin');
eq(rl.FAUCET_POLICY_ID, BOOTSTRAP_FAUCET_RATE_LIMIT_POLICY_ID, 'faucet policy id pin');
eq(typeof RATELIMIT_PROGRAM_ADDRESS, 'string', 'ratelimit program address exported');

// --- Policy parse -----------------------------------------------------------------------
console.log('policy parse');
const RULES = [
  { keyKind: RATELIMIT_KEY_FEE_PAYER, clock: RATELIMIT_CLOCK_UNIX_SECONDS, window: 600n, maxCalls: 3n, maxAmount: 30_000n },
  { keyKind: RATELIMIT_KEY_GLOBAL, clock: RATELIMIT_CLOCK_SLOT, window: 1500n, maxCalls: 0n, maxAmount: 0n },
];
const policyData = makePolicy({ admin: PAYER, target: TARGET_BYTES, rules: RULES, maxAmountPerCall: 10_000n });
const parsed = rl.parsePolicy(policyData);
ok(parsed && parsed.config.rules.length === 2, 'policy parses both rules');
eq(String(parsed.policyId), '0', 'policy id');
eq(String(parsed.config.maxAmountPerCall), '10000', 'maxAmountPerCall round-trips');
eq(rl.policyPaused(parsed), false, 'not paused');
const pausedData = makePolicy({ admin: PAYER, target: TARGET_BYTES, rules: RULES, stateFlags: 1 });
ok(rl.policyPaused(rl.parsePolicy(pausedData)) === true, 'paused flag read');
eq(rl.parsePolicy(new Uint8Array(10)), null, 'short data rejected');
const corrupt = policyData.slice(); corrupt[0] ^= 0xff;
eq(rl.parsePolicy(corrupt), null, 'bad magic rejected');

// --- Key derivation policy --------------------------------------------------------------
console.log('key derivation');
const gKey = rl.keyBytesForRule(RATELIMIT_KEY_GLOBAL, { feePayerAddress: 'taXXX' });
ok(gKey && gKey.length === 32 && gKey.every((b) => b === 0), 'global key is 32 zero bytes');
const fKey = rl.keyBytesForRule(RATELIMIT_KEY_FEE_PAYER, { feePayerAddress: rl.FAUCET_POLICY_ADDRESS });
ok(fKey && fKey.length === 32, 'fee-payer key derived from the payer address');
eq(rl.keyBytesForRule(RATELIMIT_KEY_INSTR_ACCOUNT, { feePayerAddress: rl.FAUCET_POLICY_ADDRESS }), null, 'instr-account keys are not derivable locally');
eq(rl.keyBytesForRule(RATELIMIT_KEY_ATTESTED, { feePayerAddress: rl.FAUCET_POLICY_ADDRESS }), null, 'attested keys are not derivable locally');
eq(rl.keyBytesForRule(RATELIMIT_KEY_FEE_PAYER, {}), null, 'fee-payer rule without an address stays unknown');
const bA = rl.bucketAddress(rl.FAUCET_POLICY_ADDRESS, 0, RATELIMIT_GLOBAL_KEY);
const bB = rl.bucketAddress(rl.FAUCET_POLICY_ADDRESS, 0, RATELIMIT_GLOBAL_KEY);
eq(bA, bB, 'bucket derivation deterministic');
ok(rl.bucketAddress(rl.FAUCET_POLICY_ADDRESS, 1, RATELIMIT_GLOBAL_KEY) !== bA, 'different rule index → different bucket');

// --- Summary semantics ------------------------------------------------------------------
console.log('summarizeRule');
const rule = RULES[0];
// bucket ABSENT ⇒ provably zero usage
let s = rl.summarizeRule(rule, null, { nowUnixSec: NOW });
eq(s.usedCallsInWindow, '0', 'missing bucket ⇒ 0 used');
eq(s.remainingCalls, '3', 'missing bucket ⇒ full allowance');
eq(s.exhausted, false, 'missing bucket ⇒ not exhausted');
// full window ⇒ exhausted with a reset time
const full = makeBucket({ policy: POLICY_BYTES, key: fKey, windowStart: NOW - 100n, calls: 3n, amount: 30_000n });
s = rl.summarizeRule(rule, rl.parseBucket(full), { nowUnixSec: NOW });
eq(s.remainingCalls, '0', 'full window ⇒ 0 left');
eq(s.exhausted, true, 'full window ⇒ exhausted');
eq(s.resetAtUnixSec, (NOW - 100n + 600n).toString(), 'reset = windowStart + window');
// rolled window ⇒ fresh
const rolled = makeBucket({ policy: POLICY_BYTES, key: fKey, windowStart: NOW - 700n, calls: 3n });
s = rl.summarizeRule(rule, rl.parseBucket(rolled), { nowUnixSec: NOW });
eq(s.inCurrentWindow, false, 'rolled window detected');
eq(s.usedCallsInWindow, '0', 'rolled window ⇒ current window fresh');
eq(s.exhausted, false, 'rolled window ⇒ not exhausted');
eq(s.resetAtUnixSec, null, 'no future reset to show for a rolled window');
// partial window
const half = makeBucket({ policy: POLICY_BYTES, key: fKey, windowStart: NOW - 30n, calls: 1n, amount: 10_000n });
s = rl.summarizeRule(rule, rl.parseBucket(half), { nowUnixSec: NOW });
eq(s.remainingCalls, '2', 'partial window ⇒ remaining computed');
// slot clock ⇒ honest unknowns
const slotRule = RULES[1];
const slotBucket = makeBucket({ policy: POLICY_BYTES, key: RATELIMIT_GLOBAL_KEY, windowStart: 12345n, calls: 9n });
s = rl.summarizeRule(slotRule, rl.parseBucket(slotBucket), { nowUnixSec: NOW });
eq(s.inCurrentWindow, null, 'slot-clocked window currency is unknown');
eq(s.usedCallsInWindow, null, 'no current-window usage claim for slot clocks');
eq(s.remainingCalls, null, 'unlimited maxCalls ⇒ remaining null');
eq(s.bucket.calls, '9', 'raw counter still echoed for slot clocks');
eq(s.exhausted, false, 'unlimited rule never exhausts');
// no amount cap
s = rl.summarizeRule({ ...rule, maxAmount: 0n }, null, { nowUnixSec: NOW });
eq(s.remainingAmount, null, 'maxAmount 0 ⇒ unlimited ⇒ null');

// --- Binding rule pick -------------------------------------------------------------------
console.log('pickBindingRule');
const exhaustedS = rl.summarizeRule(rule, rl.parseBucket(full), { nowUnixSec: NOW });
const partialS = rl.summarizeRule(rule, rl.parseBucket(half), { nowUnixSec: NOW });
eq(rl.pickBindingRule([partialS, exhaustedS]), exhaustedS, 'exhausted rule binds');
eq(rl.pickBindingRule([partialS]), partialS, 'single capped rule binds');
eq(rl.pickBindingRule([]), null, 'no rules ⇒ null');
const uncapped = rl.summarizeRule(slotRule, null, { nowUnixSec: NOW });
eq(rl.pickBindingRule([uncapped]), null, 'uncapped only ⇒ null');

// --- Error classification ----------------------------------------------------------------
console.log('classifyFaucetError');
const byErr = (c) => String(RATELIMIT_ERRORS[c]);
ok(rl.classifyFaucetError(`Faucet claim reverted on-chain (vmError=${byErr('CALL_LIMIT_EXCEEDED')}).`)?.kind === 'calls', '21005 → calls');
ok(rl.classifyFaucetError(`Faucet claim reverted on-chain (vmError=${byErr('AMOUNT_LIMIT_EXCEEDED')}).`)?.kind === 'amount', '21006 → amount');
ok(rl.classifyFaucetError(`Faucet claim reverted on-chain (vmError=${byErr('AMOUNT_PER_CALL_EXCEEDED')}).`)?.kind === 'per-call', '21002 → per-call');
ok(rl.classifyFaucetError(`Faucet claim reverted on-chain (vmError=${byErr('PAUSED')}).`)?.kind === 'paused', '20999 → paused');
eq(rl.classifyFaucetError('Faucet claim reverted on-chain (vmError=1).'), null, 'unknown codes stay generic');
eq(rl.classifyFaucetError('The wallet service did not respond'), null, 'non-vm errors stay generic');
eq(rl.classifyFaucetError(undefined), null, 'missing message stays generic');

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nFaucet ratelimit tests passed');
