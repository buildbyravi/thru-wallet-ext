// Native Token Program deployment and tracking service in background worker.

import * as vault from '../../lib/vault.js';
import * as thruClient from '../../lib/thru-client.js';
import { getPreferences, setPreferences, setTokenHidden, assertWhitelisted } from './preferences-service.js';
import { getActiveNetworkConfig, getActiveNetworkId } from './network-service.js';
import * as pending from './pending-tx-service.js';
import * as balances from './balance-service.js';
import { formatTokenAmount } from '../../shared/format.js';
import { DEFAULT_NETWORK } from '../../lib/networks.js';
import { assertSendContext } from './send-context.js';

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
  // Imported mints were stored in global preferences without a network before this audit.
  // Do not copy ambiguous legacy records to every chain: they default to the original
  // Alphanet only; importing the same mint on another network creates a separate record.
  const imported = prefs.customTokens
    .filter((t) => (t.networkId || DEFAULT_NETWORK) === networkId)
    .map((t) => ({ ...normalizeToken(t, hidden), source: 'imported' }));
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
  const networkId = await getActiveNetworkId();
  const prefs = await getPreferences();
  const existing = prefs.customTokens.filter((t) =>
    t.mintAddress !== mint || (t.networkId || DEFAULT_NETWORK) !== networkId);
  const record = {
    mintAddress: mint,
    networkId,
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
 *   - a token account that does not exist reports amountUnits: null — a REAL zero,
 *     explicitly distinguished by tokenAccountExists: false;
 *   - a failed balance OR mint read reports error: true and amountUnits: null — a positive
 *     balance with unverified decimals must NOT be denominated with user-entered metadata;
 *   - positive balances use on-chain mint decimals and ticker. Zero needs no mint read.
 *
 * Four concurrent mints at most: one slow RPC no longer holds all later tokens hostage,
 * without opening an unbounded number of sockets for a long registry.
 *
 * @param {Object} args
 * @param {string} args.address owner whose balances to read (defaults to the active account)
 */
export async function getTokenBalances({ address } = {}) {
  const owner = address || (await vault.getActiveAccount())?.address;
  if (!owner) throw new Error('An address is required to read token balances.');
  const networkId = (await getActiveNetworkConfig()).id; // bind SDK before reading mints
  const registry = await listDeployedTokens();

  const { balances: results, anyError } = await readRegisteredTokenBalances(owner, registry);
  if (await getActiveNetworkId() !== networkId) {
    const error = new Error('The network changed while token balances were loading. Retry on the active network.');
    error.code = 'NETWORK_CHANGED';
    error.retryable = true;
    throw error;
  }
  return {
    supported: true,
    networkId,
    balances: results,
    reason: anyError
      ? 'One or more token balances or mint details could not be verified on the network; those are unknown, not zero.'
      : null,
  };
}

/**
 * Run the registry's live reads in stable list order with a concurrency cap. The optional
 * readers let service tests exercise actual failure and out-of-order paths without a public
 * RPC or a signing key; production always uses the official SDK-backed readers.
 * @internal
 */
export async function readRegisteredTokenBalances(owner, registry, {
  readBalance = thruClient.getTokenBalance,
  readMint = thruClient.readMintAccount,
} = {}) {
  const tokens = registry.filter((token) => token.mintAddress);
  const results = new Array(tokens.length);
  let next = 0;

  async function readOne(token) {
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
      const balance = await readBalance(owner, token.mintAddress);
      base.tokenAccount = balance.tokenAccount;
      base.tokenAccountExists = balance.exists;
      if (balance.exists) {
        const raw = balance.amount.toString();
        if (!/^(0|[1-9]\d*)$/.test(raw)) throw new Error('Invalid token balance.');
        if (raw !== '0') {
          // An imported token can claim ANY decimals or ticker. Displaying an unverified
          // registry denomination next to a send button can move 10^N times the intended
          // tokens. Fail closed rather than falling back when the mint read fails.
          const mint = await readMint(token.mintAddress);
          if (!mint?.exists || !Number.isInteger(mint.decimals)
            || mint.decimals < 0 || mint.decimals > 18) {
            throw new Error('Token mint denomination could not be verified.');
          }
          base.decimals = mint.decimals;
          if (mint.ticker) base.symbol = mint.ticker;
        }
        base.amountUnits = raw;
      }
    } catch {
      base.amountUnits = null;
      base.error = true;
    }
    return base;
  }

  const workers = Array.from({ length: Math.min(4, tokens.length) }, async () => {
    while (next < tokens.length) {
      const index = next;
      next += 1;
      results[index] = await readOne(tokens[index]);
    }
  });
  await Promise.all(workers);
  return { balances: results, anyError: results.some((row) => row.error) };
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
export async function transferToken({ mintAddress, toAddress, amountUnits }, expected = null) {
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
  const network = await getActiveNetworkConfig(); // bind client before any mint/transfer RPC
  await assertSendContext(expected, feePayer);
  if (feePayer.address === target) {
    throw new Error("That's the address you're sending from.");
  }

  const release = pending.beginTransfer({ networkId: network.id, from: feePayer.address,
    to: target, amountUnits: rawUnits.toString(), mint });
  try {
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

    // Mint reads are live RPCs. A different extension context may switch source or chain
    // while they are pending; checked sends must refuse that old review before signing.
    await assertSendContext(expected, await vault.getActiveAccount());
    const result = await thruClient.sendTokenTransfer({
      feePayer,
      mintAddress: mint,
      recipientAddress: target,
      amountUnits: rawUnits,
    });

    await pending.track({
      signature: result.signature,
      kind: 'token',
      from: feePayer.address,
      to: target,
      amountUnits: rawUnits.toString(),
      mint,
      displayAmount: `${formatTokenAmount(rawUnits, mintInfo.decimals)} ${symbol}`,
      networkId: network.id,
    });
    // The THRU balance paid the fee (twice, if the recipient token account was created).
    // The signature is already known. A fresh THRU balance is an advisory UI update,
    // never a prerequisite to returning the submission result to the caller.
    void (async () => {
      if (await getActiveNetworkId() === network.id) await balances.getBalances([feePayer.address]);
    })().catch(() => {});

    return {
      signature: result.signature || null,
      blockHeight: null,
      recipientTokenAccountCreated: Boolean(result.recipientTokenAccountCreated),
      initSignature: result.initSignature || null,
    };
  } finally {
    release();
  }
}

/** Contract v11: bind a token transfer to the source account and chain on Review. */
export function transferTokenChecked({ fromAddress, networkId, ...params } = {}) {
  return transferToken(params, { fromAddress, networkId });
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
  await getActiveNetworkConfig(); // a cold worker must not derive with the default chain's program
  return thruClient.deriveTokenAccountAddress(owner, mintAddress);
}

/**
 * Generate a fresh 64-character lowercase hex mint seed (32 bytes).
 */
export function generateMintSeed() {
  return thruClient.generateMintSeed();
}
