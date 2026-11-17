// Read-only compatibility adapter for the Thru rate-limit account format.
//
// @thru/programs@0.4.4 removed the rate-limit program client, bootstrap seed, and faucet
// policy exports. Betanet's deployed faucet policy is still part of this wallet's existing
// read-only limit display. This adapter retains only the wire-format reader and address
// derivations needed for that display; it does not build or submit rate-limit instructions.
//
// The 390-byte policy, 113-byte bucket, 309-byte config layouts and seed tags below are the
// published @thru/programs@0.4.2 ABI. Keep the fixtures/golden checks in test-faucet-limit.mjs
// synchronized with that published format. All package imports remain at this adapter boundary.

import { Pubkey, deriveProgramAddress } from '@thru/sdk';
import { hashBytes, pubkeyAddress, pubkeyBytes } from '@thru/sdk/programs/utils/helpers';
import { deriveManagedProgramAddresses } from '@thru/programs/manager';
import { BOOTSTRAP_PROGRAM_ADDRESSES } from './bootstrap-pins.js';

const U64_MAX = 1n << 64n;
const encoder = new TextEncoder();
const VERIFIED_POLICY_SEED_TAG = encoder.encode('tn_ratelimit_verified_policy_v1');
const BUCKET_SEED_TAG = encoder.encode('tn_ratelimit_bucket_v1');
const RATELIMIT_PROGRAM_SEED = 'thru-program:1697627';
const POLICY_CONFIG_OFFSET = 81;
const POLICY_CONFIG_SIZE = 309;
const POLICY_RULES_OFFSET = 197;
const POLICY_RULE_SIZE = 28;
const POLICY_CONSTRAINTS_OFFSET = 61;
const POLICY_CONSTRAINT_SIZE = 34;
const MAX_RULES = 4;
const MAX_CONSTRAINTS = 4;

/** @typedef {{ keyKind: number, clock: number, keyOffset: number, window: bigint, maxCalls: bigint, maxAmount: bigint }} RatelimitRuleConfig */
/** @typedef {{ policy: string, key: Uint8Array, ruleIdx: number, windowStart: bigint, calls: bigint, amount: bigint, totalCalls: bigint, totalAmount: bigint }} RatelimitBucketAccount */

export const RATELIMIT_PROGRAM_ADDRESS = deriveManagedProgramAddresses(RATELIMIT_PROGRAM_SEED)
  .programAccountAddress;

export const RATELIMIT_ERRORS = Object.freeze({
  INVALID_INSTRUCTION: 0x5201n,
  INVALID_ACCOUNT: 0x5202n,
  INVALID_CONFIG: 0x5203n,
  UNAUTHORIZED: 0x5204n,
  CREATE_FAILED: 0x5205n,
  WRITE_FAILED: 0x5206n,
  PAUSED: 0x5207n,
  TARGET_MISMATCH: 0x5208n,
  INSTRUCTION_REJECTED: 0x5209n,
  AMOUNT_PER_CALL_EXCEEDED: 0x520an,
  BUCKET_MISMATCH: 0x520bn,
  ATTESTER_REQUIRED: 0x520cn,
  CALL_LIMIT_EXCEEDED: 0x520dn,
  AMOUNT_LIMIT_EXCEEDED: 0x520en,
  TARGET_FAILED: 0x520fn,
  GATE_NOT_RATE_LIMITED: 0x52a1n,
});

export const RATELIMIT_POLICY_MAGIC = 0x7261746c706f6c31n;
export const RATELIMIT_BUCKET_MAGIC = 0x7261746c62636b31n;
export const RATELIMIT_POLICY_SIZE = 390;
export const RATELIMIT_BUCKET_SIZE = 113;
export const RATELIMIT_CONFIG_SIZE = POLICY_CONFIG_SIZE;
export const RATELIMIT_POLICY_FLAG_PAUSED = 0x01;
export const RATELIMIT_POLICY_FLAG_VERIFIED = 0x80;
export const RATELIMIT_KEY_GLOBAL = 0;
export const RATELIMIT_KEY_FEE_PAYER = 1;
export const RATELIMIT_KEY_INSTR_ACCOUNT = 2;
export const RATELIMIT_KEY_ATTESTED = 3;
export const RATELIMIT_CLOCK_SLOT = 0;
export const RATELIMIT_CLOCK_UNIX_SECONDS = 1;
export const RATELIMIT_GLOBAL_KEY = new Uint8Array(32);

function u64le(value) {
  if (typeof value !== 'bigint' || value < 0n || value >= U64_MAX) {
    throw new Error('value must be a u64');
  }
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

function addressFromBytes(bytes) {
  return pubkeyAddress(bytes);
}

function derivePolicyAddress(programAddress, targetAddress, policyId) {
  const seed = hashBytes(
    VERIFIED_POLICY_SEED_TAG,
    pubkeyBytes(targetAddress, 'target'),
    u64le(policyId),
  );
  return deriveProgramAddress({ programAddress, seed }).address;
}

export const BOOTSTRAP_FAUCET_RATE_LIMIT_POLICY_ID = 0n;
export const BOOTSTRAP_FAUCET_RATE_LIMIT_POLICY_ADDRESS = derivePolicyAddress(
  RATELIMIT_PROGRAM_ADDRESS,
  BOOTSTRAP_PROGRAM_ADDRESSES.faucet,
  BOOTSTRAP_FAUCET_RATE_LIMIT_POLICY_ID,
);

export {
  BOOTSTRAP_FAUCET_RATE_LIMIT_POLICY_ADDRESS as FAUCET_POLICY_ADDRESS,
  BOOTSTRAP_FAUCET_RATE_LIMIT_POLICY_ID as FAUCET_POLICY_ID,
};

export const KEY_KINDS = Object.freeze({
  [RATELIMIT_KEY_GLOBAL]: 'global',
  [RATELIMIT_KEY_FEE_PAYER]: 'fee-payer',
  [RATELIMIT_KEY_INSTR_ACCOUNT]: 'instruction-account',
  [RATELIMIT_KEY_ATTESTED]: 'attested',
});

export const CLOCK_KINDS = Object.freeze({
  [RATELIMIT_CLOCK_SLOT]: 'slots',
  [RATELIMIT_CLOCK_UNIX_SECONDS]: 'seconds',
});

function dataView(data) {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function parseConfig(data, view) {
  const base = POLICY_CONFIG_OFFSET;
  const ruleCount = Math.min(view.getUint8(base + 1), MAX_RULES);
  const constraintCount = Math.min(view.getUint8(base + 2), MAX_CONSTRAINTS);
  const constraints = [];
  for (let i = 0; i < constraintCount; i += 1) {
    const offset = base + POLICY_CONSTRAINTS_OFFSET + i * POLICY_CONSTRAINT_SIZE;
    constraints.push({
      idxOffset: view.getUint16(offset, true),
      expected: addressFromBytes(data.slice(offset + 2, offset + POLICY_CONSTRAINT_SIZE)),
    });
  }
  const rules = [];
  for (let i = 0; i < ruleCount; i += 1) {
    const offset = base + POLICY_RULES_OFFSET + i * POLICY_RULE_SIZE;
    rules.push({
      keyKind: view.getUint8(offset),
      clock: view.getUint8(offset + 1),
      keyOffset: view.getUint16(offset + 2, true),
      window: view.getBigUint64(offset + 4, true),
      maxCalls: view.getBigUint64(offset + 12, true),
      maxAmount: view.getBigUint64(offset + 20, true),
    });
  }
  return {
    flags: view.getUint8(base),
    selectorSz: view.getUint8(base + 3),
    selectorOffset: view.getUint16(base + 4, true),
    selectorValue: view.getBigUint64(base + 6, true),
    instrSzMin: view.getUint16(base + 14, true),
    instrSzMax: view.getUint16(base + 16, true),
    amountSz: view.getUint8(base + 18),
    amountOffset: view.getUint16(base + 19, true),
    maxAmountPerCall: view.getBigUint64(base + 21, true),
    // @thru/programs@0.4.2 exposes this field as raw Pubkey bytes (unlike constraints).
    attester: data.slice(base + 29, base + 61),
    constraints,
    rules,
  };
}

/** Parse a rate-limit policy account; null on absent, wrong-sized, or wrong-magic data. */
export function parseRatelimitPolicyAccount(data) {
  if (!(data instanceof Uint8Array) || data.length !== RATELIMIT_POLICY_SIZE) return null;
  const view = dataView(data);
  if (view.getBigUint64(0, true) !== RATELIMIT_POLICY_MAGIC) return null;
  return {
    admin: addressFromBytes(data.slice(8, 40)),
    target: addressFromBytes(data.slice(40, 72)),
    policyId: view.getBigUint64(72, true),
    stateFlags: view.getUint8(80),
    config: parseConfig(data, view),
    configBytes: data.slice(POLICY_CONFIG_OFFSET),
  };
}

/** Parse a rate-limit bucket account; null on absent, wrong-sized, or wrong-magic data. */
export function parseRatelimitBucketAccount(data) {
  if (!(data instanceof Uint8Array) || data.length !== RATELIMIT_BUCKET_SIZE) return null;
  const view = dataView(data);
  if (view.getBigUint64(0, true) !== RATELIMIT_BUCKET_MAGIC) return null;
  return {
    policy: addressFromBytes(data.slice(8, 40)),
    key: data.slice(40, 72),
    ruleIdx: view.getUint8(72),
    windowStart: view.getBigUint64(73, true),
    calls: view.getBigUint64(81, true),
    amount: view.getBigUint64(89, true),
    totalCalls: view.getBigUint64(97, true),
    totalAmount: view.getBigUint64(105, true),
  };
}

/** Parse a policy account; null on absent/unparsable data. */
export function parsePolicy(data) {
  return parseRatelimitPolicyAccount(data);
}

/** Parse a bucket account; null on absent/unparsable data. */
export function parseBucket(data) {
  return parseRatelimitBucketAccount(data);
}

/** True when the chain flag marks the policy paused. */
export function policyPaused(policyAccount) {
  return Boolean((policyAccount?.stateFlags ?? 0) & RATELIMIT_POLICY_FLAG_PAUSED);
}

/**
 * The bucket key bytes for a rule, or null when the wallet cannot derive the bucket key:
 * global and fee-payer keys are local; instruction-account and attested keys are not.
 */
export function keyBytesForRule(keyKind, { feePayerAddress } = {}) {
  if (keyKind === RATELIMIT_KEY_GLOBAL) return RATELIMIT_GLOBAL_KEY;
  if (keyKind === RATELIMIT_KEY_FEE_PAYER && feePayerAddress) {
    return Pubkey.from(feePayerAddress).toBytes();
  }
  return null;
}

/** True when this rule's bucket is derivable locally. */
export function ruleLocallyReadable(keyKind, opts = {}) {
  return keyBytesForRule(keyKind, opts) != null;
}

/** Derive a bucket address using the deployed Thru rate-limit seed format. */
export function bucketAddress(policyAddress, ruleIdx, keyBytes) {
  if (!Number.isInteger(ruleIdx) || ruleIdx < 0 || ruleIdx > 0xff) {
    throw new Error('ruleIdx must be a u8');
  }
  const seed = hashBytes(
    BUCKET_SEED_TAG,
    pubkeyBytes(policyAddress, 'policy'),
    Uint8Array.of(ruleIdx),
    pubkeyBytes(keyBytes, 'bucket key'),
  );
  return deriveProgramAddress({ programAddress: RATELIMIT_PROGRAM_ADDRESS, seed }).address;
}

/**
 * Turn one parsed rule + its (possibly absent) bucket into a usage summary.
 *
 * @param {RatelimitRuleConfig} rule
 * @param {RatelimitBucketAccount|null|undefined} bucket
 *   null = bucket account absent on-chain (proves zero usage); undefined = not fetched/
 *   not derivable locally.
 * @param {{ nowUnixSec: bigint }} now — wall clock, only meaningful for clock 'seconds'.
 * @returns summary with strings for every bigint, or null in the "cannot determine" fields.
 */
export function summarizeRule(rule, bucket, { nowUnixSec }) {
  const clockLabel = CLOCK_KINDS[rule.clock] ?? `clock-${rule.clock}`;
  const isUnix = rule.clock === RATELIMIT_CLOCK_UNIX_SECONDS;
  const maxCalls = BigInt(rule.maxCalls);
  const maxAmount = BigInt(rule.maxAmount);
  const window = BigInt(rule.window);
  let inCurrentWindow = null;
  let usedCalls = null;
  let usedAmount = null;
  let resetAtUnixSec = null;

  if (bucket === null) {
    usedCalls = 0n;
    usedAmount = 0n;
    inCurrentWindow = true;
  } else if (bucket && isUnix) {
    const end = BigInt(bucket.windowStart) + window;
    inCurrentWindow = end > nowUnixSec;
    if (inCurrentWindow) {
      usedCalls = BigInt(bucket.calls);
      usedAmount = BigInt(bucket.amount);
      resetAtUnixSec = end;
    } else {
      usedCalls = 0n;
      usedAmount = 0n;
    }
  }

  const remainingCalls = maxCalls > 0n && usedCalls != null ? maxCalls - usedCalls : null;
  const remainingAmount = maxAmount > 0n && usedAmount != null ? maxAmount - usedAmount : null;
  const exhausted = (remainingCalls !== null && remainingCalls <= 0n)
    || (remainingAmount !== null && remainingAmount <= 0n);

  return {
    keyKind: rule.keyKind,
    keyKindLabel: KEY_KINDS[rule.keyKind] ?? `key-kind-${rule.keyKind}`,
    clock: rule.clock,
    clockLabel,
    window: window.toString(),
    maxCalls: maxCalls.toString(),
    maxAmount: maxAmount.toString(),
    inCurrentWindow,
    usedCallsInWindow: usedCalls?.toString() ?? null,
    usedAmountInWindow: usedAmount?.toString() ?? null,
    remainingCalls: remainingCalls?.toString() ?? null,
    remainingAmount: remainingAmount?.toString() ?? null,
    exhausted,
    resetAtUnixSec: resetAtUnixSec?.toString() ?? null,
    bucket: bucket
      ? {
        windowStart: String(bucket.windowStart),
        calls: String(bucket.calls),
        amount: String(bucket.amount),
        totalCalls: String(bucket.totalCalls),
        totalAmount: String(bucket.totalAmount),
      }
      : null,
  };
}

/** Pick the most binding locally derivable capped rule, using only read values. */
export function pickBindingRule(summaries) {
  const candidates = (summaries || []).filter((r) => r && r.remainingCalls != null);
  if (!candidates.length) return null;
  const exhausted = candidates.find((r) => r.exhausted);
  if (exhausted) return exhausted;
  const withCap = candidates.filter((r) => r.maxCalls !== '0');
  if (!withCap.length) return null;
  return withCap.reduce((best, rule) => {
    const fraction = Number(BigInt(rule.remainingCalls)) / Number(BigInt(rule.maxCalls));
    const bestFraction = Number(BigInt(best.remainingCalls)) / Number(BigInt(best.maxCalls));
    return fraction < bestFraction ? rule : best;
  });
}

/** Classify only published rate-limit vmError codes; unknown failures stay generic. */
export function classifyFaucetError(message) {
  const match = /vmError=(\d+)/.exec(String(message ?? ''));
  if (!match) return null;
  const code = match[1];
  const byCode = {
    [String(RATELIMIT_ERRORS.CALL_LIMIT_EXCEEDED)]: {
      code, kind: 'calls', label: 'claim-count limit',
    },
    [String(RATELIMIT_ERRORS.AMOUNT_LIMIT_EXCEEDED)]: {
      code, kind: 'amount', label: 'claim-amount limit',
    },
    [String(RATELIMIT_ERRORS.AMOUNT_PER_CALL_EXCEEDED)]: {
      code, kind: 'per-call', label: 'per-claim amount cap',
    },
    [String(RATELIMIT_ERRORS.PAUSED)]: {
      code, kind: 'paused', label: 'paused faucet policy',
    },
  };
  return byCode[code] ?? null;
}
