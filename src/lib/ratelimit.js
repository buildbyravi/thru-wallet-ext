// Ratelimit adapter — awareness layer for the faucet (and any future gated program).
//
// PROVENANCE & POLICY (every line below resolves through the PINNED first-party package,
// never memory or prose):
//   - All layouts, seeds, magics, key kinds, clock kinds and error codes come from
//     `@thru/programs@0.4.2` subpath `./ratelimit` (exports verified in the pinned
//     node_modules, 2026-10-24). We re-export and compose; we do not re-derive the
//     bytes ourselves.
//   - The faucet's policy pin ships in `@thru/programs/bootstrap-addresses`
//     (BOOTSTRAP_FAUCET_RATE_LIMIT_POLICY_{ADDRESS,ID}). It is re-exported through
//     ./bootstrap-pins.js like every other managed-genesis pin (D-016 layering rule:
//     first-party packages may only be imported inside src/lib adapters).
//
// WHAT THIS MODULE DOES NOT DO:
//   - It contains NO network I/O. Reading accounts is the services layer's job; this
//     module turns raw bytes and rule configs into truthful summaries.
//   - It never invents usage. A policy or bucket that is missing or unparsable yields
//     an explicit "unknown" / "not found" state — the caller renders that or stays
//     silent; it never shows a number it did not read.
//
// Chain facts that ground true statements we render:
//   - Bucket accounts are per (policy, ruleIdx, key). A MISSING bucket means the rule
//     has not charged that key in ANY recorded window — i.e. the current window usage
//     for that key is 0. That is provable from the model (buckets are created lazily
//     by CALL when first charged); we rely on it to say "0 of N used", never more.
//   - For UNIX_SECONDS-clocked rules we can evaluate "is this window current" against
//     the wall clock. For SLOT-clocked rules we cannot (no slot-height RPC is plumbed
//     through the wallet today), so current-window evaluation is reported as UNKNOWN
//     (null), and the raw counters are still shown.
//   - maxCalls / maxAmount of 0n means UNLIMITED for that rule (per the package's
//     RatelimitRuleConfig contract). We surface that as null ("no cap"), not as "0 left".

import { Pubkey } from '@thru/sdk';
import {
  RATELIMIT_PROGRAM_ADDRESS,
  RATELIMIT_ERRORS,
  RATELIMIT_KEY_GLOBAL,
  RATELIMIT_KEY_FEE_PAYER,
  RATELIMIT_KEY_INSTR_ACCOUNT,
  RATELIMIT_KEY_ATTESTED,
  RATELIMIT_CLOCK_UNIX_SECONDS,
  RATELIMIT_CLOCK_SLOT,
  RATELIMIT_POLICY_FLAG_PAUSED,
  RATELIMIT_GLOBAL_KEY,
  deriveRatelimitBucketAddress,
  parseRatelimitPolicyAccount,
  parseRatelimitBucketAccount,
} from '@thru/programs/ratelimit';
import {
  BOOTSTRAP_FAUCET_RATE_LIMIT_POLICY_ADDRESS,
  BOOTSTRAP_FAUCET_RATE_LIMIT_POLICY_ID,
} from './bootstrap-pins.js';

export {
  RATELIMIT_PROGRAM_ADDRESS,
  RATELIMIT_ERRORS,
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

/** Parse a policy account; null on absent/unparsable data (package returns null there). */
export function parsePolicy(data) {
  if (!(data instanceof Uint8Array)) return null;
  return parseRatelimitPolicyAccount(data);
}

/** Parse a bucket account; null on absent/unparsable data. */
export function parseBucket(data) {
  if (!(data instanceof Uint8Array)) return null;
  return parseRatelimitBucketAccount(data);
}

/** True when the chain flag marks the policy paused. */
export function policyPaused(policyAccount) {
  return Boolean((policyAccount?.stateFlags ?? 0) & RATELIMIT_POLICY_FLAG_PAUSED);
}

/**
 * The bucket key bytes for a rule, or null when the wallet cannot derive the bucket
 * locally and MUST NOT fabricate usage for that rule:
 *   - keyKind 1 (FEE_PAYER): the claimer's own public key bytes — derivable.
 *   - keyKind 2 (INSTR_ACCOUNT): the key is an account REFERENCED INSIDE the forwarded
 *     instruction at keyOffset — our claim message only exists at build time and the
 *     faucet's claim format would need its indices; not derivable here today.
 *   - keyKind 3 (ATTESTED): the key depends on an external attester — not derivable.
 */
export function keyBytesForRule(keyKind, { feePayerAddress } = {}) {
  if (keyKind === RATELIMIT_KEY_GLOBAL) return RATELIMIT_GLOBAL_KEY;
  if (keyKind === RATELIMIT_KEY_FEE_PAYER && feePayerAddress) {
    return Pubkey.from(feePayerAddress).toBytes();
  }
  return null;
}

/** True when this rule's bucket is derivable locally (see keyBytesForRule). */
export function ruleLocallyReadable(keyKind, opts = {}) {
  return keyBytesForRule(keyKind, opts) != null;
}

/** Derive the bucket address for (policy, ruleIdx, keyBytes) via the pinned package. */
export function bucketAddress(policyAddress, ruleIdx, keyBytes) {
  return deriveRatelimitBucketAddress(RATELIMIT_PROGRAM_ADDRESS, policyAddress, ruleIdx, keyBytes)
    .address;
}

/**
 * Turn one parsed rule + its (possibly absent) bucket into a usage summary.
 *
 * @param {import('@thru/programs/ratelimit').RatelimitRuleConfig} rule
 * @param {import('@thru/programs/ratelimit').RatelimitBucketAccount|null|undefined} bucket
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
  let inCurrentWindow = null; // null = cannot tell (slot clock) or no bucket concept
  let usedCalls = null;
  let usedAmount = null;
  let resetAtUnixSec = null;

  if (bucket === null) {
    // No bucket account at all ⇒ the key has never been charged in any recorded window.
    usedCalls = 0n;
    usedAmount = 0n;
    inCurrentWindow = true;
  } else if (bucket) {
    const windowStart = BigInt(bucket.windowStart);
    if (isUnix) {
      const end = windowStart + window;
      inCurrentWindow = end > nowUnixSec;
      if (inCurrentWindow) {
        usedCalls = BigInt(bucket.calls);
        usedAmount = BigInt(bucket.amount);
        resetAtUnixSec = end;
      } else {
        // Window rolled: the program zeroes the counters when next charged, so from the
        // user's perspective the current window is fresh (0 used). windowStart stays in
        // the past; that fact is still reported raw in the bucket echo below.
        usedCalls = 0n;
        usedAmount = 0n;
      }
    }
    // SLOT clock: inCurrentWindow stays null → honest "unknown"; counters echoed raw only.
  }

  const remainingCalls = (maxCalls > 0n && usedCalls != null) ? maxCalls - usedCalls : null;
  const remainingAmount = (maxAmount > 0n && usedAmount != null) ? maxAmount - usedAmount : null;
  const exhausted = (remainingCalls !== null && remainingCalls <= 0n)
    || (remainingAmount !== null && remainingAmount <= 0n);

  return {
    keyKind: rule.keyKind,
    keyKindLabel: KEY_KINDS[rule.keyKind] ?? `key-kind-${rule.keyKind}`,
    clock: rule.clock,
    clockLabel,
    window: window.toString(),
    maxCalls: maxCalls.toString(),           // '0' ⇒ unlimited (per package contract)
    maxAmount: maxAmount.toString(),         // '0' ⇒ unlimited
    inCurrentWindow,                         // true | false | null (unknown)
    usedCallsInWindow: usedCalls?.toString() ?? null,
    usedAmountInWindow: usedAmount?.toString() ?? null,
    remainingCalls: remainingCalls?.toString() ?? null, // null = unlimited or unknown
    remainingAmount: remainingAmount?.toString() ?? null,
    exhausted,
    resetAtUnixSec: resetAtUnixSec?.toString() ?? null, // unix-clock, in-window only
    bucket: bucket
      ? {
        windowStart: String(bucket.windowStart),
        calls: String(bucket.calls),
        amount: String(bucket.amount),
        totalCalls: String(bucket.totalCalls),
        totalAmount: String(bucket.totalAmount),
      }
      : null, // null ⇒ absent ⇒ zero usage (bucket === null); undefined ⇒ not fetched
  };
}

/**
 * The binding rule = the derivable rule closest to its cap, chosen strictly on read
 * numbers (never fabricated). Prefers an exhausted rule; otherwise the lowest
 * remaining-calls fraction among rules with a calls cap, else lowest remaining-amount
 * fraction; null when nothing derivable has a cap.
 */
export function pickBindingRule(summaries) {
  const candidates = (summaries || []).filter((r) => r && r.remainingCalls != null);
  if (!candidates.length) return null;
  const exhausted = candidates.find((r) => r.exhausted);
  if (exhausted) return exhausted;
  const withCap = candidates.filter((r) => r.maxCalls !== '0');
  if (!withCap.length) return null;
  return withCap.reduce((best, r) => {
    const frac = Number(BigInt(r.remainingCalls)) / Number(BigInt(r.maxCalls));
    const bestFrac = Number(BigInt(best.remainingCalls)) / Number(BigInt(best.maxCalls));
    return frac < bestFrac ? r : best;
  });
}

/**
 * Classify the vmError inside a faucet claim failure message (thru-client throws
 * `Faucet claim reverted on-chain (vmError=N).`). Returns null when the message is NOT
 * a ratelimit failure — the caller must fall back to the generic error text.
 * Only the exact package error codes match; anything else stays unidentified.
 */
export function classifyFaucetError(message) {
  const m = /vmError=(\d+)/.exec(String(message ?? ''));
  if (!m) return null;
  const code = m[1];
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
