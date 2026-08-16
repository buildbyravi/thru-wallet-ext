// Transaction and RPC query service in the background worker.

import * as vault from '../../lib/vault.js';
import * as thruClient from '../../lib/thru-client.js';
import { getActiveNetworkConfig } from './network-service.js';

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
  return {
    signature: result.signature,
    blockHeight: result.blockHeight,
  };
}

/**
 * Send a native THRU transfer from the active account.
 * @param {string} toAddress
 * @param {string|number|bigint} amountUnits
 */
export async function sendTransfer(toAddress, amountUnits) {
  const feePayer = await vault.getActiveAccount();
  const rawUnits = BigInt(amountUnits);
  const result = await thruClient.sendTransfer(feePayer, toAddress, rawUnits);
  return {
    signature: result.signature,
    blockHeight: result.blockHeight,
  };
}

/**
 * List recent transaction history for an address.
 * Ensures 100% JSON-safe serialization with no BigInt or non-serializable properties.
 * @param {string} address
 * @param {number} [pageSize=15]
 */
export async function listHistory(address, pageSize = 15) {
  const entries = await thruClient.listAccountHistory(address, pageSize);
  return entries.map((entry) => ({
    signature: entry.signature ? String(entry.signature) : null,
    slot: entry.slot != null ? String(entry.slot) : null,
    success: entry.success,
    programAddress: entry.programAddress ? String(entry.programAddress) : '',
    kind: entry.kind || 'other',
    amount: entry.amount != null ? String(entry.amount) : null,
    counterparty: entry.counterparty ? String(entry.counterparty) : null,
  }));
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
  return thruClient.createOnChainAccount(feePayer);
}
