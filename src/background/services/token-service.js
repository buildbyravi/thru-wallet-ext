// Native Token Program deployment and tracking service in background worker.

import * as vault from '../../lib/vault.js';
import * as thruClient from '../../lib/thru-client.js';
import { getPreferences, setPreferences, setTokenHidden } from './preferences-service.js';

/**
 * Deploy a new native token mint on ThruVM using the active account.
 *
 * Note the field names below: thru-client.js's deployTokenMint reads `ticker` and `imageUri`,
 * not `symbol`/`imageUrl`. Sending the wrong names is why every previously-stored token record
 * has an empty ticker and no image. Both spellings are passed so old and new client versions
 * agree, and the stored record is normalized in listDeployedTokens().
 *
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
    ticker: params.symbol,
    decimals: params.decimals,
    description: params.description,
    imageUrl: params.imageUrl,
    imageUri: params.imageUrl,
  });
}

/**
 * Normalize a stored token record so the UI has one shape to render regardless of which
 * client version wrote it.
 */
function normalizeToken(raw, hidden) {
  const symbol = raw.symbol || raw.ticker || '';
  const imageUrl = raw.imageUrl || raw.imageUri || '';
  return {
    mintAddress: raw.mintAddress || raw.mint || '',
    name: raw.name || '',
    symbol,
    decimals: Number(raw.decimals) || 0,
    description: raw.description || '',
    // Only http(s) and inline images may ever reach an <img src>. A javascript: or unexpected
    // scheme is dropped here rather than relying on the renderer to filter it.
    imageUrl: /^(https:\/\/|http:\/\/|data:image\/)/i.test(imageUrl) ? imageUrl : '',
    initialSupply: raw.initialSupply != null ? String(raw.initialSupply) : null,
    deployedAt: Number(raw.deployedAt) || 0,
    hidden: hidden.has(raw.mintAddress || raw.mint || ''),
    source: 'deployed',
  };
}

/**
 * Get all user-deployed tokens from storage, plus any manually imported ones.
 * Hidden tokens are still returned, flagged, so a settings screen can unhide them.
 */
export async function listDeployedTokens() {
  const [raw, prefs] = await Promise.all([thruClient.getDeployedTokens(), getPreferences()]);
  const hidden = new Set(prefs.hiddenTokens);
  const deployed = (Array.isArray(raw) ? raw : []).map((t) => normalizeToken(t, hidden));
  const imported = prefs.customTokens.map((t) => ({
    ...normalizeToken(t, hidden),
    source: 'imported',
  }));
  const seen = new Set(deployed.map((t) => t.mintAddress));
  return [...deployed, ...imported.filter((t) => t.mintAddress && !seen.has(t.mintAddress))];
}

/**
 * Manually add a token to the local registry by mint address.
 * Records metadata only — it does not prove the mint exists on-chain.
 */
export async function importToken({ mintAddress, symbol, name, decimals }) {
  const mint = String(mintAddress || '').trim();
  if (!mint) throw new Error('A mint address is required.');
  const prefs = await getPreferences();
  const existing = prefs.customTokens.filter((t) => t.mintAddress !== mint);
  const record = {
    mintAddress: mint,
    symbol: String(symbol || '').trim().slice(0, 12),
    name: String(name || '').trim().slice(0, 48),
    decimals: Math.min(18, Math.max(0, Math.floor(Number(decimals) || 0))),
    addedAt: Date.now(),
  };
  await setPreferences({ customTokens: [record, ...existing] });
  return record;
}

/**
 * Show or hide a token in the asset list.
 */
export async function setVisibility(mintAddress, hidden) {
  await setTokenHidden(mintAddress, hidden);
  return { mintAddress, hidden: Boolean(hidden) };
}

/**
 * Balances of tokens the account actually owns.
 *
 * NOT IMPLEMENTED. token.list returns only tokens this wallet deployed — it is a launchpad
 * registry, not an asset list. Reading owned balances needs Token Program account-read
 * semantics that have not been verified against a live network, so this reports unsupported
 * rather than returning zeros that would look like real empty balances.
 */
export async function getTokenBalances(/* { address } */) {
  return {
    supported: false,
    balances: null,
    reason: 'Reading owned token balances needs Token Program account reads that are not verified on Thru yet.',
  };
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
