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
 * Perform a faucet claim for the active account.
 * @param {string|number|bigint} amountUnits
 */
export async function claimFaucet(amountUnits) {
  const feePayer = await vault.getActiveAccount();
  const rawUnits = BigInt(amountUnits);
  const result = await thruClient.claimFaucet(feePayer, rawUnits);
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

  return {
    signature: result.signature,
    blockHeight: result.blockHeight,
  };
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

  const result = await thruClient.sendTransfer(feePayer, target, rawUnits);
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

  return {
    signature: result.signature,
    blockHeight: result.blockHeight,
  };
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
  const result = await thruClient.createOnChainAccount(feePayer);
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
export async function estimateFee(/* { toAddress, amountUnits } */) {
  return {
    supported: false,
    feeUnits: null,
    reason: 'Fee estimation is not verified against Thru yet. The Send screen reserves a fixed gas allowance instead.',
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
