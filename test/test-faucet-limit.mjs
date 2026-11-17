// Offline ratelimit-awareness tests — NO network. Fixtures exercise the deployed read-only
// wire format removed from @thru/programs in 0.4.4. Layout offsets are from the published
// 0.4.2 generated ABI and are deliberately asserted here rather than imported from a removed
// package subpath.
//
//   Policy (390 B): magic@0(u64le) admin@8(32) target@40(32) policy_id@72(u64le)
//                   state_flags@80(u8) config@81(309)
//   Config (309 B): flags@0, rule_count@1, constraint_count@2, selector fields@3..20,
//                   max_amount_per_call@21, attester@29(32), constraints@61, rules@197
//   Bucket (113 B): magic@0(u64le) policy@8(32) key@40(32) rule_idx@72(u8)
//                   window_start@73(u64le) calls@81 amount@89 total_calls@97 total_amount@105

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
  FAUCET_POLICY_ADDRESS,
  FAUCET_POLICY_ID,
} from '../src/lib/ratelimit.js';
import { BOOTSTRAP_PROGRAM_ADDRESSES } from '../src/lib/bootstrap-pins.js';
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

function makePolicy({
  admin, target, policyId = 0n, stateFlags = 0, rules, maxAmountPerCall = 0n,
  constraints = [], attester = new Uint8Array(32),
}) {
  const config = new Uint8Array(309);
  const configView = new DataView(config.buffer);
  configView.setUint8(1, rules.length);
  configView.setUint8(2, constraints.length);
  configView.setUint8(3, 0); // selectorSz
  configView.setUint16(4, 0, true); // selectorOffset
  configView.setBigUint64(6, 0n, true); // selectorValue
  configView.setUint16(14, 0, true); // instrSzMin
  configView.setUint16(16, 0xffff, true); // instrSzMax
  configView.setUint8(18, 8); // amountSz
  configView.setUint16(19, 8, true); // amountOffset
  configView.setBigUint64(21, maxAmountPerCall, true);
  config.set(attester, 29);
  for (let i = 0; i < constraints.length; i += 1) {
    const constraint = constraints[i];
    const offset = 61 + i * 34;
    configView.setUint16(offset, constraint.idxOffset, true);
    config.set(constraint.expected, offset + 2);
  }
  for (let i = 0; i < rules.length; i += 1) {
    const rule = rules[i];
    const offset = 197 + i * 28;
    configView.setUint8(offset, rule.keyKind);
    configView.setUint8(offset + 1, rule.clock);
    configView.setUint16(offset + 2, rule.keyOffset ?? 0, true);
    configView.setBigUint64(offset + 4, rule.window, true);
    configView.setBigUint64(offset + 12, rule.maxCalls, true);
    configView.setBigUint64(offset + 20, rule.maxAmount, true);
  }
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

const PAYER = Pubkey.from(FAUCET_POLICY_ADDRESS).toBytes().fill(7, 16); // any 32 B — content irrelevant, determinism matters
const POLICY_BYTES = Pubkey.from(FAUCET_POLICY_ADDRESS).toBytes();
const TARGET_BYTES = Pubkey.from(BOOTSTRAP_PROGRAM_ADDRESSES.faucet).toBytes();

// --- Historical deployed pins remain explicit after upstream removed this program --------
console.log('pins');
eq(FAUCET_POLICY_ADDRESS, 'taDrvTPLhMWuRsCyAAnyNm5pkkrlmegsHrwYsJQ1GoBvfd', 'faucet policy address matches published 0.4.2 pin');
eq(String(FAUCET_POLICY_ID), '0', 'faucet policy id');
eq(RATELIMIT_PROGRAM_ADDRESS, 'taRATE6MTrtFFKY10oyskMcvokJs53iD5nWE8ZyUuGknMA', 'ratelimit program address matches published 0.4.2 pin');

// --- Policy parse -----------------------------------------------------------------------
console.log('policy parse');
const RULES = [
  { keyKind: RATELIMIT_KEY_FEE_PAYER, clock: RATELIMIT_CLOCK_UNIX_SECONDS, window: 600n, maxCalls: 3n, maxAmount: 30_000n },
  { keyKind: RATELIMIT_KEY_GLOBAL, clock: RATELIMIT_CLOCK_SLOT, window: 1500n, maxCalls: 0n, maxAmount: 0n },
];
const attesterBytes = new Uint8Array(32).fill(5);
const constraintBytes = new Uint8Array(32).fill(9);
const policyData = makePolicy({
  admin: PAYER, target: TARGET_BYTES, rules: RULES, maxAmountPerCall: 10_000n,
  constraints: [{ idxOffset: 4, expected: constraintBytes }], attester: attesterBytes,
});
const parsed = rl.parsePolicy(policyData);
ok(parsed && parsed.config.rules.length === 2, 'policy parses both rules');
eq(parsed.admin, Pubkey.from(PAYER).toThruFmt(), 'policy admin parsed');
eq(parsed.target, Pubkey.from(TARGET_BYTES).toThruFmt(), 'policy target parsed');
eq(String(parsed.policyId), '0', 'policy id');
eq(String(parsed.config.maxAmountPerCall), '10000', 'maxAmountPerCall round-trips');
eq(parsed.configBytes.length, 309, 'raw config retains exact packed size');
eq(JSON.stringify([...parsed.config.attester]), JSON.stringify([...attesterBytes]), 'config attester parsed as raw bytes');
eq(parsed.config.constraints.length, 1, 'config constraint count parsed');
eq(parsed.config.constraints[0].idxOffset, 4, 'config constraint offset parsed');
eq(parsed.config.constraints[0].expected, Pubkey.from(constraintBytes).toThruFmt(), 'config constraint address parsed');
eq(String(parsed.config.rules[0].window), '600', 'first rule window parsed');
eq(String(parsed.config.rules[0].maxCalls), '3', 'first rule call cap parsed');
eq(String(parsed.config.rules[0].maxAmount), '30000', 'first rule amount cap parsed');
eq(parsed.config.rules[1].keyKind, RATELIMIT_KEY_GLOBAL, 'second rule kind parsed');
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
eq(bA, 'taqdwniPFoX59PG4skO1zBdEw2lxaYKA6oUWKBYwVaad5S', 'global bucket PDA matches the published 0.4.2 helper');
eq(
  rl.bucketAddress(rl.FAUCET_POLICY_ADDRESS, 1, fKey),
  'taNlkL7kOH-qYEszij2PcjLYdohRjhTsGRMD5qvxI0FpM2',
  'fee-payer bucket PDA matches the published 0.4.2 helper',
);
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
const parsedFull = rl.parseBucket(full);
eq(parsedFull.policy, FAUCET_POLICY_ADDRESS, 'bucket policy address parsed');
eq(parsedFull.ruleIdx, 0, 'bucket rule index parsed');
eq(String(parsedFull.windowStart), String(NOW - 100n), 'bucket window start parsed');
eq(String(parsedFull.totalCalls), '0', 'bucket cumulative counters parsed');
s = rl.summarizeRule(rule, parsedFull, { nowUnixSec: NOW });
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
const callsError = rl.classifyFaucetError(`Faucet claim reverted on-chain (vmError=${byErr('CALL_LIMIT_EXCEEDED')}).`);
eq(callsError?.kind, 'calls', '21005 → calls');
eq(callsError?.label, 'claim-count limit', 'call limit friendly label retained');
eq(callsError?.code, byErr('CALL_LIMIT_EXCEEDED'), 'classified vmError code retained');
eq(rl.classifyFaucetError(`Faucet claim reverted on-chain (vmError=${byErr('AMOUNT_LIMIT_EXCEEDED')}).`)?.kind, 'amount', '21006 → amount');
eq(rl.classifyFaucetError(`Faucet claim reverted on-chain (vmError=${byErr('AMOUNT_PER_CALL_EXCEEDED')}).`)?.kind, 'per-call', '21002 → per-call');
eq(rl.classifyFaucetError(`Faucet claim reverted on-chain (vmError=${byErr('PAUSED')}).`)?.kind, 'paused', '20999 → paused');
eq(rl.classifyFaucetError('Faucet claim reverted on-chain (vmError=1).'), null, 'unknown codes stay generic');
eq(rl.classifyFaucetError('The wallet service did not respond'), null, 'non-vm errors stay generic');
eq(rl.classifyFaucetError(undefined), null, 'missing message stays generic');

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nFaucet ratelimit tests passed');
