// Native Token Program deployment and tracking service in background worker.

import * as vault from '../../lib/vault.js';
import * as thruClient from '../../lib/thru-client.js';
import { getPreferences, setPreferences, setTokenHidden, assertWhitelisted } from './preferences-service.js';
import { getActiveNetworkId } from './network-service.js';
import * as pending from './pending-tx-service.js';
import * as balances from './balance-service.js';
import { formatTokenAmount } from '../../shared/format.js';

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
  const networkId = await getActiveNetworkId();
  return thruClient.deployTokenMint({
    feePayer,
    // The mint is recorded against the network it was created on, so switching networks does
    // not list mints that do not exist there.
    networkId,
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
  const networkId = await getActiveNetworkId();
  const [raw, prefs] = await Promise.all([
    thruClient.getDeployedTokens(networkId),
    getPreferences(),
  ]);
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
 * Balances of tokens an address actually owns, for every mint in the local registry
 * (deployed on the active network + manually imported).
 *
 * Contract v8. This used to return `supported: false` (docs/BACKEND_GAPS.md C1): owned
 * balances need Token Program account reads, which the official @thru/programs/token bindings
 * now provide (`deriveTokenAccountAddress` + `parseTokenAccountData`).
 *
 * Honesty rules preserved from the stub era:
 *   - a token account that does not exist reports amountUnits: null — that is a REAL zero,
 *     carried explicitly via tokenAccountExists: false rather than as the number 0;
 *   - a balance whose read FAILED reports error: true and amountUnits: null — unknown is
 *     never shaped like zero;
 *   - decimals are read from the on-chain mint when there is a balance to display, falling
 *     back to the registry value only if the mint read fails.
 *
 * Reads are sequential and bounded by registry size (deployed + imported mints for the
 * active network), which is user-scale data, not chain enumeration.
 *
 * @param {Object} args
 * @param {string} args.address owner whose balances to read (defaults to the active account)
 */
export async function getTokenBalances({ address } = {}) {
  const owner = address || (await vault.getActiveAccount())?.address;
  if (!owner) throw new Error('An address is required to read token balances.');
  const networkId = await getActiveNetworkId();
  const registry = await listDeployedTokens();

  const results = [];
  let anyError = false;
  for (const token of registry) {
    if (!token.mintAddress) continue;
    const base = {
      mintAddress: token.mintAddress,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      imageUrl: token.imageUrl,
      hidden: token.hidden,
      source: token.source,
      tokenAccount: null,
      tokenAccountExists: null,
      amountUnits: null,
      error: false,
    };
    try {
      const balance = await thruClient.getTokenBalance(owner, token.mintAddress);
      base.tokenAccount = balance.tokenAccount;
      base.tokenAccountExists = balance.exists;
      if (balance.exists) {
        base.amountUnits = balance.amount.toString();
        // Decimals must be authoritative for display math, so prefer the on-chain mint over
        // whatever the local registry claims (an imported record can declare anything).
        try {
          const mint = await thruClient.readMintAccount(token.mintAddress);
          if (mint.exists) {
            base.decimals = mint.decimals;
            if (!base.symbol && mint.ticker) base.symbol = mint.ticker;
          }
        } catch {
          // Registry decimals stand; the balance is still real.
        }
      }
    } catch {
      // The read failed (RPC unreachable, malformed account). This token's balance is
      // UNKNOWN — recorded as an error, never as zero.
      anyError = true;
      base.error = true;
    }
    results.push(base);
  }

  return {
    supported: true,
    networkId,
    balances: results,
    reason: anyError
      ? 'One or more token balances could not be read from the network; those are shown as unknown, not as zero.'
      : null,
  };
}

/**
 * Send a token transfer from the active account (contract v8, auth: 'signing').
 *
 * The same guard discipline as tx-service.sendTransfer, applied to a mint-denominated amount:
 *   - mint and recipient must be well-formed Thru addresses
 *   - amount must be a positive integer number of base units (of the MINT, not of THRU)
 *   - self-transfers are refused
 *   - the whitelist is enforced when the user has enabled it
 *   - an identical transfer of the same mint within the last 15s is a double-click
 *   - the mint must exist on-chain on the active network
 * The chain-level guards (source token account exists, not frozen, balance covers amount)
 * live in thru-client.sendTokenTransfer, and the recipient's token account is initialized by
 * the sender when missing — a program-derived address needs no recipient signature.
 *
 * @param {Object} params
 * @param {string} params.mintAddress
 * @param {string} params.toAddress
 * @param {string|number|bigint} params.amountUnits raw units of the mint
 */
export async function transferToken({ mintAddress, toAddress, amountUnits }) {
  const mint = String(mintAddress || '').trim();
  if (!thruClient.isValidThruAddress(mint)) {
    throw new Error('That does not look like a valid token mint address.');
  }
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
    mint,
  })) {
    const err = new Error('An identical transfer was just submitted. Check Activity before sending again.');
    err.code = 'DUPLICATE_SUBMISSION';
    throw err;
  }

  // The mint must exist here, on the active network. Imported registry metadata is
  // user-typed and proves nothing; decimals and the display ticker come from the mint itself.
  const mintInfo = await thruClient.readMintAccount(mint);
  if (!mintInfo.exists) {
    const err = new Error('No token mint exists at that address on this network.');
    err.code = 'MINT_NOT_FOUND';
    throw err;
  }
  const symbol = mintInfo.ticker || 'tokens';

  const result = await thruClient.sendTokenTransfer({
    feePayer,
    mintAddress: mint,
    recipientAddress: target,
    amountUnits: rawUnits,
  });

  const networkId = await getActiveNetworkId();
  await pending.track({
    signature: result.signature,
    kind: 'token',
    from: feePayer.address,
    to: target,
    amountUnits: rawUnits.toString(),
    mint,
    displayAmount: `${formatTokenAmount(rawUnits, mintInfo.decimals)} ${symbol}`,
    networkId,
  });
  // The THRU balance paid the fee (twice, if the recipient token account was created).
  await balances.getBalances([feePayer.address]);

  return {
    signature: result.signature || null,
    blockHeight: null,
    recipientTokenAccountCreated: Boolean(result.recipientTokenAccountCreated),
    initSignature: result.initSignature || null,
  };
}

/**
 * Derive deterministic token mint address from a 32-character seed.
 * @param {string} mintSeed
 */
/**
 * Derive the deterministic mint address for a seed.
 *
 * Requires the mint authority, because derivation is over [authorityBytes, seedBytes] — a seed
 * alone cannot identify a mint. Defaults to the active account, which is who a deploy from this
 * wallet would actually make the authority.
 *
 * @param {string} mintSeed 64 hex characters
 * @param {string} [mintAuthorityAddress] defaults to the active account
 */
export async function deriveMintAddress(mintSeed, mintAuthorityAddress) {
  const authority = mintAuthorityAddress || (await vault.getActiveAccount())?.address;
  return thruClient.deriveTokenMintAddress(mintSeed, authority);
}

/**
 * Derive the token account address holding one owner's balance of one mint.
 *
 * Thru keeps a wallet account separate from its per-mint token accounts, so this is the address
 * a token balance actually lives at.
 */
export async function deriveTokenAccount(ownerAddress, mintAddress) {
  const owner = ownerAddress || (await vault.getActiveAccount())?.address;
  return thruClient.deriveTokenAccountAddress(owner, mintAddress);
}

/**
 * Generate a fresh 64-character lowercase hex mint seed (32 bytes).
 */
export function generateMintSeed() {
  return thruClient.generateMintSeed();
}
