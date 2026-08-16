// Native Token Program deployment and tracking service in background worker.

import * as vault from '../../lib/vault.js';
import * as thruClient from '../../lib/thru-client.js';

/**
 * Deploy a new native token mint on ThruVM using the active account.
 * @param {Object} params
 * @param {string} params.mintSeed
 * @param {string} params.name
 * @param {string} params.symbol
 * @param {number} params.decimals
 * @param {string} [params.description]
 * @param {string} [params.imageUrl]
 */
export async function deployToken(params) {
  const feePayer = await vault.getActiveAccount();
  return thruClient.deployTokenMint({
    feePayer,
    mintSeed: params.mintSeed,
    name: params.name,
    symbol: params.symbol,
    decimals: params.decimals,
    description: params.description,
    imageUrl: params.imageUrl,
  });
}

/**
 * Get all user-deployed tokens from storage.
 */
export async function listDeployedTokens() {
  return thruClient.getDeployedTokens();
}

/**
 * Derive deterministic token mint address from a 32-character seed.
 * @param {string} mintSeed
 */
export function deriveMintAddress(mintSeed) {
  return thruClient.deriveTokenMintAddress(mintSeed);
}

/**
 * Generate a fresh 32-character alphanumeric mint seed.
 */
export function generateMintSeed() {
  return thruClient.generateMintSeed();
}
