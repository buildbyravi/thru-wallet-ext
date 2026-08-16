// Domain abstraction for wallet assets (native, token, NFT).
//
// This module defines the uniform shape the UI uses to display balances, build
// send flows, and render asset lists. It does NOT import vault.js, thru-client.js,
// or any chrome.* API — it's a pure data-shaping layer.
//
// Phase 1: only the native THRU asset is real. Token/NFT factories are stubs
// that establish the interface so future token support slots in without rewriting
// dashboard or send screens.

/**
 * Asset type constants.
 * @enum {string}
 */
export const AssetType = Object.freeze({
  NATIVE: 'native',
  TOKEN: 'token',
  NFT: 'nft',
});

/**
 * @typedef {Object} Asset
 * @property {string}  id         - Unique identifier (e.g. 'native:thru', 'token:<mint>')
 * @property {string}  type       - One of AssetType
 * @property {string}  networkId  - Network this asset belongs to
 * @property {string|null} address - Mint/contract address (null for native)
 * @property {string}  symbol     - Display ticker
 * @property {string}  name       - Human-readable name
 * @property {number}  decimals   - Decimal places
 * @property {string|null} logo   - Optional logo URL or data-URI
 * @property {bigint}  balance    - Raw balance in smallest unit
 */

/**
 * Create a native THRU asset record.
 * @param {string}  networkId - Network identifier (e.g. 'alphanet')
 * @param {bigint}  balance   - Raw balance in base units
 * @returns {Asset}
 */
export function createNativeAsset(networkId, balance) {
  return {
    id: `native:thru:${networkId}`,
    type: AssetType.NATIVE,
    networkId,
    address: null,
    symbol: 'THRU',
    name: 'Thru',
    decimals: 9,
    logo: null,
    balance: BigInt(balance),
  };
}

/**
 * Create a token asset record.
 * Phase 1: interface only — real token balances require verified Token Program integration.
 * @param {Object} params
 * @param {string} params.networkId
 * @param {string} params.address    - Token mint address
 * @param {string} params.symbol
 * @param {string} params.name
 * @param {number} params.decimals
 * @param {bigint} params.balance
 * @param {string|null} [params.logo]
 * @returns {Asset}
 */
export function createTokenAsset({ networkId, address, symbol, name, decimals, balance, logo = null }) {
  return {
    id: `token:${address}:${networkId}`,
    type: AssetType.TOKEN,
    networkId,
    address,
    symbol,
    name,
    decimals,
    logo,
    balance: BigInt(balance),
  };
}

/**
 * Create an NFT asset record.
 * Phase 1: interface only — no NFT support exists on Thru yet.
 * @param {Object} params
 * @param {string} params.networkId
 * @param {string} params.address
 * @param {string} params.name
 * @param {string|null} [params.logo]
 * @returns {Asset}
 */
export function createNFTAsset({ networkId, address, name, logo = null }) {
  return {
    id: `nft:${address}:${networkId}`,
    type: AssetType.NFT,
    networkId,
    address,
    symbol: 'NFT',
    name,
    decimals: 0,
    logo,
    balance: 1n,
  };
}

/**
 * Check whether an asset is the native chain token.
 * @param {Asset} asset
 * @returns {boolean}
 */
export function isNativeAsset(asset) {
  return asset?.type === AssetType.NATIVE;
}

/**
 * Build a display-ready balance string for an asset.
 * Uses integer arithmetic only — no floating-point multiplication.
 * @param {Asset} asset
 * @returns {string}
 */
export function formatAssetBalance(asset) {
  const units = BigInt(asset.balance);
  const divisor = 10n ** BigInt(asset.decimals);
  const whole = units / divisor;
  const frac = units % divisor;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(asset.decimals, '0').replace(/0+$/, '');
  return `${whole}.${fracStr}`;
}
