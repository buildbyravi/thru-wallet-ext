// Transaction and RPC query service in the background worker.

import * as vault from '../../lib/vault.js';
import * as thruClient from '../../lib/thru-client.js';
import { getActiveNetworkConfig } from './network-service.js';
import { assertWhitelisted } from './preferences-service.js';
import * as pending from './pending-tx-service.js';
import * as balances from './balance-service.js';

/**
 * Fetch on-chain balance and status for an address.
 * BigInt balance is converted to string for JSON serialization.
 * @param {string} address
 */
export async function getAccountInfo(address) {
  const info = await thruClient.getAccountInfo(address);
  return {
    exists: info.exists,
    balance: info.balance.toString(),
  };
}

/**
 * Normalize whatever thru-client returned into { signature, blockHeight }.
 *
 * thru-client's claimFaucet / sendTransfer / createOnChainAccount all return the signature as a
 * plain STRING, but this service read `result.signature` and `result.blockHeight` — so both were
 * always `undefined`. Two consequences, neither of which threw:
 *
 *   1. every tx.send / tx.claimFaucet response carried signature: undefined, so explorer links
 *      had nothing to link to;
 *   2. pending.track() bails on `if (!tx?.signature) return null`, so NOTHING was ever tracked.
 *      The pending-transaction feature, its badge and its dashboard banner were all inert.
 *
 * Found only by driving api-router end to end against a live node; calling thru-client directly
 * hides it, because the bug is in the layer between them. Accepts an object too, so a future
 * client that returns one keeps working.
 */
function normalizeTxResult(result) {
  if (typeof result === 'string') return { signature: result, blockHeight: null };
  if (result && typeof result === 'object') {
    return {
      signature: result.signature ?? null,
      blockHeight: result.blockHeight ?? null,
    };
  }
  return { signature: null, blockHeight: null };
}

/**
 * Perform a faucet claim for the active account.
 * @param {string|number|bigint} amountUnits
 */
export async function claimFaucet(amountUnits) {
  const feePayer = await vault.getActiveAccount();
  const rawUnits = BigInt(amountUnits);
  const result = normalizeTxResult(await thruClient.claimFaucet(feePayer, rawUnits));
  const network = await getActiveNetworkConfig();

  await pending.track({
    signature: result.signature,
    kind: 'faucet',
    from: feePayer.address,
    to: feePayer.address,
    amountUnits: rawUnits.toString(),
    networkId: network.id,
  });
  await balances.getBalances([feePayer.address]);

  return result;
}

/**
 * Send a native THRU transfer from the active account.
 *
 * Guards applied here rather than in the UI, so a frontend bug cannot bypass them:
 *   - amount must be a positive integer number of base units
 *   - recipient must be a well-formed Thru address
 *   - self-transfers are refused
 *   - the whitelist is enforced when the user has enabled it
 *   - an identical transfer within the last 15s is treated as a double-click
 *
 * @param {string} toAddress
 * @param {string|number|bigint} amountUnits
 */
export async function sendTransfer(toAddress, amountUnits) {
  const target = String(toAddress || '').trim();
  if (!thruClient.isValidThruAddress(target)) {
    throw new Error('That does not look like a valid Thru address.');
  }

  let rawUnits;
  try {
    rawUnits = BigInt(amountUnits);
  } catch {
    throw new Error('Amount must be a whole number of base units.');
  }
  if (rawUnits <= 0n) {
    throw new Error('Enter an amount greater than zero.');
  }

  const feePayer = await vault.getActiveAccount();
  if (feePayer.address === target) {
    throw new Error("That's the address you're sending from.");
  }

  await assertWhitelisted(target);

  if (await pending.isProbableDuplicate({
    from: feePayer.address,
    to: target,
    amountUnits: rawUnits.toString(),
  })) {
    const err = new Error('An identical transfer was just submitted. Check Activity before sending again.');
    err.code = 'DUPLICATE_SUBMISSION';
    throw err;
  }

  // VERIFIED ON ALPHANET 2026-08-18: the transfer program requires the RECIPIENT account to
  // already exist on-chain. Sending to a never-registered address reverts with vmError=-765,
  // which five different instruction layouts all produced identically — the byte layout was
  // never the problem. The sender cannot register someone else's account (createOnChainAccount
  // signs as the account being created), so this cannot be fixed transparently. It has to be
  // reported clearly instead of surfacing a raw VM error code.
  const recipientInfo = await thruClient.getAccountInfo(target);
  if (!recipientInfo.exists) {
    const err = new Error(
      'That address has never been used on this network, so it cannot receive a transfer yet. '
      + 'The recipient needs to activate it first.',
    );
    err.code = 'RECIPIENT_NOT_ACTIVATED';
    throw err;
  }

  const result = normalizeTxResult(await thruClient.sendTransfer(feePayer, target, rawUnits));
  const network = await getActiveNetworkConfig();

  await pending.track({
    signature: result.signature,
    kind: 'transfer',
    from: feePayer.address,
    to: target,
    amountUnits: rawUnits.toString(),
    networkId: network.id,
  });
  await balances.getBalances([feePayer.address]);

  return result;
}

/**
 * List recent transaction history for an address.
 *
 * Accepts either the original positional form (address, pageSize) or a cursor-based options
 * object, so infinite scroll works without changing the existing call sites.
 *
 * The underlying client has no server-side cursor, so paging is applied here over a single
 * fetch. That is honest for devnet-scale history and can be swapped for a real RPC cursor
 * later without changing this method's shape.
 *
 * @param {string} address
 * @param {number|{ limit?: number, cursor?: number }} [pageSizeOrOptions=15]
 */
export async function listHistory(address, pageSizeOrOptions = 15) {
  const options = typeof pageSizeOrOptions === 'object' && pageSizeOrOptions !== null
    ? pageSizeOrOptions
    : { limit: pageSizeOrOptions };

  const limit = Math.min(100, Math.max(1, Math.floor(Number(options.limit) || 15)));
  const cursor = Math.max(0, Math.floor(Number(options.cursor) || 0));

  // Over-fetch by the cursor so a page beyond the first still has rows to slice.
  const entries = await thruClient.listAccountHistory(address, limit + cursor);
  const serialized = entries.map((entry) => ({
    signature: entry.signature ? String(entry.signature) : null,
    slot: entry.slot != null ? String(entry.slot) : null,
    success: entry.success,
    programAddress: entry.programAddress ? String(entry.programAddress) : '',
    kind: entry.kind || 'other',
    amount: entry.amount != null ? String(entry.amount) : null,
    counterparty: entry.counterparty ? String(entry.counterparty) : null,
  }));

  const page = serialized.slice(cursor, cursor + limit);
  const nextCursor = serialized.length > cursor + limit ? cursor + limit : null;

  // Callers using the old positional form get a plain array, exactly as before.
  if (typeof pageSizeOrOptions !== 'object' || pageSizeOrOptions === null) {
    return page;
  }
  return { entries: page, nextCursor, hasMore: nextCursor !== null };
}

/**
 * Validate a recipient address server-side and report whether it is the active account.
 *
 * The UI does its own optimistic check for instant feedback, but the authoritative check
 * lives here so a UI bug can never let a malformed address reach transaction construction.
 *
 * @param {string} address
 * @returns {Promise<{ valid: boolean, isSelf: boolean, reason: string|null }>}
 */
export async function validateAddress(address) {
  const addr = String(address || '').trim();
  if (!addr) {
    return { valid: false, isSelf: false, reason: 'Enter a recipient address.' };
  }
  if (!thruClient.isValidThruAddress(addr)) {
    return { valid: false, isSelf: false, reason: 'That does not look like a valid Thru address.' };
  }
  let isSelf = false;
  try {
    const active = await vault.getActiveAccount();
    isSelf = active?.address === addr;
  } catch {
    // locked — self-check is unavailable but format validity still stands
  }
  return {
    valid: true,
    isSelf,
    reason: isSelf ? "That's the address you're sending from." : null,
  };
}

/**
 * Probe RPC network health and latency.
 */
export async function checkNetworkHealth() {
  return thruClient.checkNetworkHealth();
}

/**
 * Auto-create on-chain account for the active account if not yet registered.
 */
export async function autoCreateAccount() {
  const feePayer = await vault.getActiveAccount();
  const result = normalizeTxResult(await thruClient.createOnChainAccount(feePayer));
  await balances.getBalances([feePayer.address]);
  return result;
}

// ---- Capability stubs -----------------------------------------------------
//
// These exist so the UI can be built against a stable shape today and light up when the
// underlying Thru behaviour is verified. They return { supported: false } and NEVER a made-up
// number. A fabricated fee or simulated balance change in a wallet is worse than an empty
// state: the user acts on it.
//
// Each has a matching entry in docs/BACKEND_GAPS.md (Tier C) and docs/BUILD_SPEC.md Part X.

/**
 * Estimate the network fee for a transfer.
 *
 * Blocked on: whether Thru transfers carry a non-zero fee at all, and how it is computed. The
 * faucet instruction is known to be zero-fee; transfers are assumed not to be, but the amount
 * is unverified. The MAX button currently reserves a hardcoded 10_000 base units as a guess.
 */
/**
 * Estimate the network fee for a transfer, from the ACTIVE network's config.
 *
 * The fee is a per-network value, not a constant. It was measured on alphanet devnet, and the
 * transfer program and its fee schedule may both change at testnet — so a network whose fee has
 * not been measured reports `supported: false` rather than quoting a devnet number as if it
 * applied. A guessed fee on a live network is the most expensive kind of guess.
 *
 * `reserveUnits` is what MAX should hold back. It sits well above the observed fee because only
 * one amount and one transaction size were sampled, so whether the fee scales with either is
 * still unknown. The previous hardcoded 10_000 reserve was 10,000x the real fee, which on a
 * faucet-funded account (10,000 per claim) could reserve the whole balance.
 */
export async function estimateFee(/* { toAddress, amountUnits } */) {
  const network = await getActiveNetworkConfig();

  if (network.baseFeeUnits == null) {
    return {
      supported: false,
      networkId: network.id,
      feeUnits: null,
      reserveUnits: null,
      reason: `The transfer fee on ${network.label} has not been measured. It is deliberately not `
        + 'inherited from devnet, because the transfer program and its fee schedule may differ.',
    };
  }

  return {
    supported: true,
    networkId: network.id,
    source: network.environment === 'devnet' ? 'measured' : 'assumed',
    feeUnits: network.baseFeeUnits.toString(),
    reserveUnits: (network.feeReserveUnits ?? network.baseFeeUnits).toString(),
    reason: 'Observed on a live transfer between two registered accounts. Not a published spec, '
      + 'so the reserve is set above the observed value.',
  };
}

/**
 * Simulate a transaction and report predicted balance changes before signing.
 *
 * Blocked on: a simulate/dry-run RPC. Rabby's pre-sign card is its signature feature; ours shows
 * only what can be derived locally (amount, recipient, self-transfer detection).
 */
export async function simulate(/* { toAddress, amountUnits } */) {
  return {
    supported: false,
    changes: null,
    reason: 'Transaction simulation requires a dry-run RPC that has not been verified on Thru.',
  };
}
