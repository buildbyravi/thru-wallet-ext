// Thin wrapper around @thru/sdk.
//
// NOTE: alphanet is pre-testnet, unaudited infrastructure. Expect instability, resets, and
// breaking SDK changes — this whole file may need updates as Thru moves toward testnet/mainnet.
//
// NETWORK BINDING: this module used to hardcode the alphanet RPC URL and memoize a single
// client at first use, while the program addresses were module constants duplicating the ones
// in src/lib/networks.js. That made network switching COSMETIC: selecting localnet changed the
// badge and scoped local storage, but every RPC call still went to alphanet, and a network with
// different program addresses could not have worked at all.
//
// The active network is now injected by the background via configureNetwork(). This module
// still does not import networks.js or any service — it holds whatever it was given and falls
// back to the alphanet defaults, so it stays independently testable.

import { createThruClient, Signature, Pubkey, PageRequest } from '@thru/sdk';
import { scopedKey } from '../shared/network-scope.js';

export const ALPHANET_RPC = 'https://rpc.alphanet.thru.org';

// Defaults, used until configureNetwork() is called. Kept so tests and any direct importer
// behave as before rather than failing on an unset network.
const DEFAULT_NETWORK = Object.freeze({
  id: 'alphanet',
  rpcUrl: ALPHANET_RPC,
  faucetProgramId: 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPr6',
  // 46 characters and SDK-parseable. networks.js previously declared a 43-character value here
  // that Pubkey.from() rejects; it was never caught because this module ignored that config.
  faucetStateAccount: 'taxoImN8fTEOxXYnvgC6JZ0lN0n0qvZERwz_vlOjX3MkIn',
  faucetMaxPerClaim: 10_000n,
  transferProgramId: 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  tokenProgramId: 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKqq',
});

let activeNetwork = DEFAULT_NETWORK;

/**
 * Point this module at a network.
 *
 * Idempotent, and only discards the memoized client when the RPC URL actually changes, so
 * calling it on every config read is cheap. Accepts `faucetMaxPerClaim` as a BigInt or a
 * string, because the UI-facing shape sends it as a string (JSON cannot carry BigInt).
 *
 * @param {Object} config a NetworkConfig from src/lib/networks.js
 */
export function configureNetwork(config) {
  if (!config?.rpcUrl) return activeNetwork;
  const next = {
    id: config.id || 'unknown',
    rpcUrl: config.rpcUrl,
    faucetProgramId: config.faucetProgramId ?? null,
    faucetStateAccount: config.faucetStateAccount ?? null,
    faucetMaxPerClaim: config.faucetMaxPerClaim == null
      ? null
      : BigInt(config.faucetMaxPerClaim),
    transferProgramId: config.transferProgramId || DEFAULT_NETWORK.transferProgramId,
    tokenProgramId: config.tokenProgramId || DEFAULT_NETWORK.tokenProgramId,
  };
  if (next.rpcUrl !== activeNetwork.rpcUrl) {
    // Drop the memoized client so the next call builds one against the new endpoint.
    client = undefined;
  }
  activeNetwork = next;
  return activeNetwork;
}

/** The network this module is currently pointed at. */
export function getConfiguredNetwork() {
  return activeNetwork;
}

/** Validate a Thru address using the SDK's own parsing + checksum logic, not a guessed regex. */
export function isValidThruAddress(address) {
  try {
    Pubkey.from(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lightweight RPC health check — times a single accounts.get() call against a known
 * address. Returns { status, latencyMs } without throwing. Called once on popup open
 * to drive the footer network indicator; deliberately not polled.
 */
export async function checkNetworkHealth() {
  const start = performance.now();
  try {
    // Use the zero address — always fast to look up, doesn't need to exist
    await getClient().accounts.get('taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    const latencyMs = Math.round(performance.now() - start);
    if (latencyMs < 500) return { status: 'healthy', latencyMs };
    return { status: 'slow', latencyMs };
  } catch {
    return { status: 'offline', latencyMs: null };
  }
}

// 1 THRU = 1e9 base units.
export const UNITS_PER_THRU = 1_000_000_000n;

/** Format raw base units as a human-scale THRU amount, trimming trailing zeros. */
export function formatThru(rawUnits) {
  const whole = rawUnits / UNITS_PER_THRU;
  const frac = rawUnits % UNITS_PER_THRU;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(9, '0').replace(/0+$/, '');
  return `${whole.toString()}.${fracStr}`;
}

/**
 * Parse a human-entered THRU amount (e.g. "1.5") into exact raw base units, for use anywhere
 * that's asking the person for an amount in THRU rather than raw units (currently: Send).
 * Deliberately does this with string splitting + BigInt, not parseFloat() * 1e9 — floating
 * point multiplication can misround certain decimal values, which is not a place to be
 * approximately right when the result is how much of someone's balance moves.
 */
export function parseThruAmount(input) {
  const trimmed = String(input).trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error('Enter a plain positive number, like 1.5 or 250.');
  }
  const [wholeStr, fracStr = ''] = trimmed.split('.');
  if (fracStr.length > 9) {
    throw new Error('THRU has at most 9 decimal places.');
  }
  const whole = BigInt(wholeStr || '0');
  const frac = BigInt(fracStr.padEnd(9, '0') || '0');
  const units = whole * UNITS_PER_THRU + frac;
  if (units <= 0n) {
    throw new Error('Enter an amount greater than zero.');
  }
  return units;
}

let client;
export function getClient() {
  if (!client) {
    client = createThruClient({ baseUrl: activeNetwork.rpcUrl });
  }
  return client;
}

/**
 * Fetch balance + basic info for an address.
 * `exists: false` means the key is valid but has no on-chain account yet — that's the normal
 * state for a freshly generated key, not an error.
 */
export async function getAccountInfo(address) {
  try {
    const account = await getClient().accounts.get(address);
    return { exists: true, balance: account.meta?.balance ?? 0n, raw: account };
  } catch (err) {
    return { exists: false, balance: 0n, error: err };
  }
}

/**
 * Create the on-chain account for a freshly generated key.
 *
 * This deliberately mirrors the plain `thru accounts create` CLI path — publicKey only, no
 * name or registrar involved. That's the path confirmed working right now; the named-account
 * flow in the wallet.thru.org preview app is the one currently failing (see our chat history —
 * every name failed there, while CLI-created accounts worked fine). Support for named accounts
 * can be added here later once that bug is fixed upstream.
 *
 * BUG FIX: @thru/sdk's own type signature is `createAccount(...): Promise<Transaction>` — it
 * only *builds* an unsigned transaction, it does not sign or submit it. The previous version
 * of this function returned that unsigned Transaction directly and stopped there, so clicking
 * "Create on-chain account" completed without error but never actually touched the chain —
 * which is exactly why the faucet/send precondition checks kept saying the account still
 * didn't exist afterward. Fixed by signing with the fee payer's own key and submitting via
 * sendAndTrack, the same pattern used by claimFaucet/sendTransfer below.
 */
const inFlightRegistrations = new Map();
const knownRegisteredAccounts = new Set();

/**
 * Create the on-chain account for a freshly generated key.
 *
 * Implements in-flight deduplication: if an account registration is already in progress
 * for an address, subsequent calls await the same promise instead of broadcasting multiple transactions.
 */
export async function createOnChainAccount(feePayer) {
  const address = feePayer.address || Pubkey.from(feePayer.publicKey).toThruFmt();
  if (knownRegisteredAccounts.has(address)) return null;

  // Return existing in-flight registration promise if one is already running
  if (inFlightRegistrations.has(address)) {
    return inFlightRegistrations.get(address);
  }

  const promise = (async () => {
    try {
      const already = await getAccountInfo(address);
      if (already.exists) {
        knownRegisteredAccounts.add(address);
        return null; // already active on-chain
      }

      const client = getClient();
      // Generate a "creating" state proof — proves to the network that this account doesn't exist yet
      const proofObj = await client.proofs.generate({ address, proofType: 1 });

      const { rawTransaction } = await client.transactions.buildAndSign({
        feePayer: { publicKey: feePayer.publicKey, privateKey: feePayer.privateKey },
        program: 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMD',
        header: { fee: 0n, nonce: 0n },
        feePayerStateProof: proofObj.proof
      });

      for await (const update of client.transactions.sendAndTrack(rawTransaction)) {
        if (update.executionResult) {
          if (update.executionResult.vmError === 0) {
            knownRegisteredAccounts.add(address);
            return update.signature?.value ? Signature.from(update.signature.value).toThruFmt() : undefined;
          }
          throw new Error(`Account creation reverted on-chain (vmError=${update.executionResult.vmError}).`);
        }
      }
      throw new Error('Account creation never returned an execution result (timed out?).');
    } finally {
      inFlightRegistrations.delete(address);
    }
  })();

  inFlightRegistrations.set(address, promise);
  return promise;
}

// ---- Faucet ----
//
// PROVENANCE: the program address, state account, and instruction layout below came from
// reverse-engineering real `thru faucet withdraw` transactions (submitting two claims of
// different amounts via the CLI and diffing the resulting instruction bytes) — not from
// Thru's own docs, and not independently re-confirmed against alphanet from this sandboxed
// environment (no network access to rpc.alphanet.thru.org from here). Treat the address and
// layout as "well-sourced, not independently verified" — if a claim fails outright with a
// low-level or format error, doubt these constants first, not the signing/submission code
// around them, since the account-index handling below IS independently verified: @thru/sdk's
// own InstructionContext JSDoc confirms account order is exactly
// [feePayer, program, ...readWriteAccounts, ...readOnlyAccounts] after sorting, which is why
// this uses buildInstructionData + getAccountIndex instead of hand-rolling that sort — it
// delegates the part that's easy to get subtly wrong to the SDK's own verified logic.
// These remain exported for tests and for callers that want the alphanet defaults, but the
// network calls below now read from the CONFIGURED network so a switch actually takes effect.
export const FAUCET_PROGRAM_ID = 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPr6';
export const FAUCET_STATE_ACCOUNT = 'taxoImN8fTEOxXYnvgC6JZ0lN0n0qvZERwz_vlOjX3MkIn';
export const FAUCET_MAX_PER_CLAIM = 10_000n; // per the CLI's own cap

/** Pure byte-layout encoder, kept separate from the network calls so it's directly testable. */
export function encodeFaucetInstructionData(stateIdx, recipientIdx, amountUnits) {
  const data = new Uint8Array(16);
  const view = new DataView(data.buffer);
  view.setUint32(0, 1, true); // tag 1: faucet withdraw
  view.setUint16(4, stateIdx, true);
  view.setUint16(6, recipientIdx, true);
  view.setBigUint64(8, BigInt(amountUnits), true);
  return data;
}

/**
 * Claim tokens from the alphanet faucet, submitted on-chain directly.
 *
 * Self-Signing: each wallet signs its OWN faucet transaction with fee: 0n, so no sponsor keys
 * or third-party fee payers are involved.
 *
 * CORRECTION (verified on alphanet 2026-08-18): this comment previously claimed a freshly
 * generated wallet with 0 balance "can claim directly without requiring prior funding". It
 * cannot — the node rejects the transaction with "[not_found] account not found" until the
 * fee payer exists on-chain. The account still needs no FUNDING, only registration, which is
 * what createOnChainAccount does and what the guard below now handles.
 */
export async function claimFaucet(feePayer, amount) {
  // Read from the configured network, not the module constants, so a network switch actually
  // reaches a different faucet.
  const net = activeNetwork;
  if (!net.faucetProgramId || !net.faucetStateAccount) {
    throw new Error(`The ${net.id} network has no faucet.`);
  }

  const amountUnits = BigInt(amount);
  const cap = net.faucetMaxPerClaim ?? FAUCET_MAX_PER_CLAIM;
  if (amountUnits <= 0n || amountUnits > cap) {
    throw new Error(`Amount must be a whole number between 1 and ${cap}.`);
  }

  const address = feePayer.address || Pubkey.from(feePayer.publicKey).toThruFmt();

  // The fee payer must already exist on-chain, or the node rejects the whole transaction with
  // "[not_found] account not found".
  //
  // VERIFIED ON ALPHANET 2026-08-18: a freshly generated address fails here, and succeeds
  // immediately after createOnChainAccount. sendTransfer has always done this; claimFaucet did
  // not, so the very first thing a new wallet might do — tap Faucet — was the one path that
  // failed. The comment above this function previously asserted the opposite ("even a freshly
  // generated wallet with 0 balance can claim directly"), which is why the gap was never
  // questioned.
  const info = await getAccountInfo(address);
  if (!info.exists) {
    await createOnChainAccount(feePayer);
  }

  // recipient = feePayer (claiming to own address), so it's already at index 0.
  // Only add non-feePayer accounts to readWrite to avoid duplicate rejection.
  const { rawTransaction } = await getClient().transactions.buildAndSign({
    feePayer: { publicKey: feePayer.publicKey, privateKey: feePayer.privateKey },
    program: net.faucetProgramId,
    header: { fee: 0n },
    accounts: { readWrite: [net.faucetStateAccount] },
    instructionData: ({ getAccountIndex }) =>
      encodeFaucetInstructionData(getAccountIndex(net.faucetStateAccount), getAccountIndex(address), amountUnits),
  });

  for await (const update of getClient().transactions.sendAndTrack(rawTransaction)) {
    if (update.executionResult) {
      if (update.executionResult.vmError === 0) {
        return update.signature?.value ? Signature.from(update.signature.value).toThruFmt() : undefined;
      }
      throw new Error(`Faucet claim reverted on-chain (vmError=${update.executionResult.vmError}).`);
    }
  }
  throw new Error('Faucet claim never returned an execution result (timed out?).');
}

// ---- Native transfer ----
//
// PROVENANCE: same situation as the faucet above — program address and instruction layout
// came from reverse-engineering a real `thru transfer` transaction (confirmed on-chain
// signature ts_ItJeT7...), not from Thru's own docs, not independently re-confirmed against
// alphanet from here. One extra check this time that increases my confidence in it: decoding
// both this address and the faucet's with Pubkey.from(...).toBytes() shows both are 32 zero
// bytes with a single marker byte in the last position (0x80 here, 0xfa for the faucet) — the
// same reserved-program pattern @thru/sdk's own accounts.create() uses internally (a
// zero-filled 32-byte address with byte 3 in the last position). That's an independent
// structural signal this is a real reserved system program, not a typo or a fabrication — but
// it's still not the same as watching a transfer succeed against live alphanet myself.
// Native transfer program address: EOA program (32 zero bytes)
export const TRANSFER_PROGRAM_ID = 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/** Pure byte-layout encoder for a native transfer instruction, kept directly testable. */
export function encodeTransferInstructionData(sourceIdx, destIdx, amountUnits) {
  const data = new Uint8Array(16);
  const view = new DataView(data.buffer);
  view.setUint32(0, 1, true); // tag 1: EOA_INSTRUCTION_TRANSFER
  view.setBigUint64(4, BigInt(amountUnits), true);
  view.setUint16(12, sourceIdx, true);
  view.setUint16(14, destIdx, true);
  return data;
}

/**
 * Send a native THRU transfer, submitted on-chain directly.
 *
 * Auto-creates the sender's account first if needed, same as claimFaucet above (account
 * creation is free). Unlike the faucet, a normal transfer is NOT assumed to be zero-fee (no
 * reverse-engineered evidence it is) — it uses whatever @thru/sdk's own default fee is unless
 * header.fee is overridden, so the sender still needs a balance covering amount + fee, which
 * a brand-new account won't have yet (auto-creating it doesn't fund it).
 */
export async function sendTransfer(feePayer, toAddress, amount) {
  const amountUnits = BigInt(amount);
  if (amountUnits <= 0n) {
    throw new Error('Amount must be a positive whole number of base units.');
  }

  let info = await getAccountInfo(feePayer.address);
  if (!info.exists) {
    await createOnChainAccount(feePayer);
    info = await getAccountInfo(feePayer.address); // re-check: a fresh account has zero balance
  }
  if (info.balance < amountUnits) {
    throw new Error(`Balance (${formatThru(info.balance)} THRU) is lower than the amount you're trying to send.`);
  }
  // feePayer.address is already at index 0 — only add distinct accounts to readWrite
  const readWrite = toAddress === feePayer.address ? [] : [toAddress];
  const { rawTransaction } = await getClient().transactions.buildAndSign({
    feePayer: { publicKey: feePayer.publicKey, privateKey: feePayer.privateKey },
    program: activeNetwork.transferProgramId,
    accounts: readWrite.length > 0 ? { readWrite } : undefined,
    instructionData: ({ getAccountIndex }) =>
      encodeTransferInstructionData(getAccountIndex(feePayer.address), getAccountIndex(toAddress), amountUnits),
  });

  for await (const update of getClient().transactions.sendAndTrack(rawTransaction)) {
    if (update.executionResult) {
      if (update.executionResult.vmError === 0) {
        return update.signature?.value ? Signature.from(update.signature.value).toThruFmt() : undefined;
      }
      throw new Error(`Transfer reverted on-chain (vmError=${update.executionResult.vmError}).`);
    }
  }
  throw new Error('Transfer never returned an execution result (timed out?).');
}

// ---- Explorer links ----
//
// scan.thru.org is confirmed real (fetched its homepage directly — "Thru Explorer - Block
// Explorer for Thru Network", tracking thru-alphanet). Its exact /tx/ and /address/ route
// pattern is NOT independently confirmed, though — the homepage had no live example links to
// check against (it showed "Network: alphanet \u25cf offline" with empty tables when checked,
// which is itself worth knowing separately from the URL-guessing question). /tx/{signature} and
// /address/{address} is the near-universal convention across block explorers generally
// (Etherscan, Solscan, Solana Explorer, Basescan all use exactly this), so that's the guess
// here. Worst case if it's wrong is a dead link — nothing signs or submits through these.
export const EXPLORER_BASE_URL = 'https://scan.thru.org';
export function explorerTxUrl(signature) {
  return `${EXPLORER_BASE_URL}/tx/${signature}`;
}
export function explorerAddressUrl(address) {
  return `${EXPLORER_BASE_URL}/address/${address}`;
}

// ---- Transaction history ----

/**
 * Decode one Transaction into a display-friendly entry. Kept separate from the network call
 * so it's directly testable against real Transaction instances (built via the SDK's own
 * constructor in tests, not a hand-rolled mock shape).
 *
 * Reconstructs the same [feePayer, program, ...readWriteAccounts, ...readOnlyAccounts]
 * ordering used when the transaction was built (see the faucet/transfer functions above) to
 * resolve the account indices baked into known instruction data back into real addresses.
 */
export function decodeHistoryEntry(tx, viewerAddress) {
  const signature = tx.getSignature()?.toThruFmt();
  const success = tx.executionResult ? tx.executionResult.vmError === 0 : null; // null = no result yet
  const programAddress = tx.program.toThruFmt();

  const entry = {
    signature,
    success,
    slot: tx.slot ?? null,
    kind: 'other',
    amount: null, // bigint | null
    counterparty: null, // address string | null
    programAddress,
  };

  // Decode against the CONFIGURED network's program ids. Using the module constants here would
  // silently fail to decode history on any network whose program addresses differ, leaving every
  // entry as "unknown" rather than as a transfer.
  const faucetProgram = activeNetwork.faucetProgramId;
  const transferProgram = activeNetwork.transferProgramId;

  const canDecode = tx.instructionData?.length === 16
    && (programAddress === transferProgram || programAddress === faucetProgram);
  if (!canDecode) return entry;

  const data = tx.instructionData;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tag = view.getUint32(0, true);

  if (programAddress === faucetProgram && tag === 1) {
    const amount = view.getBigUint64(8, true);
    entry.kind = 'faucet';
    entry.amount = amount;
  } else if (programAddress === transferProgram && tag === 1) {
    const amount = view.getBigUint64(4, true);
    const idxA = view.getUint16(12, true);
    const idxB = view.getUint16(14, true);
    const allAccounts = [tx.feePayer, tx.program, ...(tx.readWriteAccounts || []), ...(tx.readOnlyAccounts || [])];
    const addrA = allAccounts[idxA]?.toThruFmt();
    const addrB = allAccounts[idxB]?.toThruFmt();

    const isOutgoing = addrA === viewerAddress;
    entry.kind = isOutgoing ? 'sent' : 'received';
    entry.amount = amount;
    entry.counterparty = isOutgoing ? addrB : addrA;
  }
  return entry;
}

/** Recent transaction history for an address, decoded where it's a known transfer/faucet call. */
export async function listAccountHistory(address, pageSize = 15) {
  const page = new PageRequest({ pageSize });
  const { transactions } = await getClient().transactions.listForAccount(address, { page });
  return transactions.map((tx) => decodeHistoryEntry(tx, address));
}

// ---- Native Token Launchpad (v1.2) -----------------------------------------
// Native built-in Token Program address on ThruVM (similar to SPL Token Program)
export const TOKEN_PROGRAM_ID = 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKqq';
export const DEPLOYED_TOKENS_KEY = 'thru_deployed_tokens';

/** Generate a 32-character alphanumeric random seed for mint address derivation. */
export function generateMintSeed() {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const randBytes = new Uint8Array(32);
  crypto.getRandomValues(randBytes);
  let seed = '';
  for (let i = 0; i < 32; i++) {
    seed += alphabet[randBytes[i] % alphabet.length];
  }
  return seed;
}

/**
 * Derive the deterministic Token Mint address for a seed.
 *
 * BROKEN AND NOT SILENTLY GUESSED. Two separate problems, found by testing against a reference
 * dataset of 2008 generated wallets (\\wsl$\ubuntu\home\ravi\n-thru\wallets.json):
 *
 *   1. This called `client.proofs.deriveAddress`, which DOES NOT EXIST in @thru/sdk 0.3.4 —
 *      `proofs` exposes only `generate` and `getStateRoots`. The call threw TypeError, so token
 *      mint derivation has been failing outright, which is why `token.deriveAddress` and the
 *      launchpad's mint preview never worked. The namespace is `helpers`.
 *
 *   2. `helpers.deriveAddress(inputs[])` does run and return an address, but it does NOT
 *      reproduce the reference dataset's mint address from the same seed, so the correct input
 *      set is unknown. The dataset also uses 64-hex-character (32-byte) seeds while
 *      generateMintSeed() produces 32 alphanumeric characters — a different format entirely.
 *
 * Returning a plausible-but-wrong mint address is worse than failing: it would point a deploy or
 * a lookup at the wrong account. So this reports the gap instead of guessing, matching how
 * tx.estimateFee and token.getBalances handle unverified behaviour.
 *
 * TO FIX: get the mint-derivation spec (program id, seed encoding, and input order) from the
 * Thru team, then verify against the reference dataset before trusting it.
 */
export async function deriveTokenMintAddress(mintSeed) {
  const err = new Error(
    'Token mint derivation is not verified against Thru. The SDK method previously used '
    + '(proofs.deriveAddress) does not exist, and helpers.deriveAddress does not reproduce known '
    + 'reference addresses, so the correct derivation is unknown.',
  );
  err.code = 'DERIVATION_UNVERIFIED';
  err.seedLength = String(mintSeed ?? '').length;
  throw err;
}

/** Pure byte-layout encoder for INITIALIZE_MINT (Tag 0) instruction. */
export function encodeInitializeMintInstructionData(accountIdx, mintSeed, proofSizeBytes, authorityPubkeyBytes, decimals, proofBytes) {
  const seedBytes = new TextEncoder().encode(mintSeed);
  const totalLength = 4 + 2 + 32 + 4 + 32 + 1 + proofBytes.length;
  const payload = new Uint8Array(totalLength);
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

  // Tag 0: INITIALIZE_MINT
  view.setUint32(0, 0, true);
  // Account Index
  view.setUint16(4, accountIdx, true);
  // Seed (32 bytes)
  payload.set(seedBytes.subarray(0, 32), 6);
  // Proof size
  view.setUint32(38, proofSizeBytes, true);
  // Mint Authority Pubkey (32 bytes)
  payload.set(authorityPubkeyBytes.subarray(0, 32), 42);
  // Decimals (uint8)
  payload[74] = decimals;
  // Append raw proof bytes
  payload.set(proofBytes, 75);

  return payload;
}

/**
 * List tokens deployed by this wallet extension, for one network.
 *
 * A mint address only exists on the chain it was deployed to, so this store is namespaced by
 * network id. Without that, switching to mainnet would list devnet mints as if they were real.
 *
 * `networkId` is a parameter rather than a lookup because this module must not depend on a
 * background service. Callers (token-service.js) already know the active network.
 *
 * @param {string} networkId
 */
export async function getDeployedTokens(networkId) {
  const key = networkId ? scopedKey(DEPLOYED_TOKENS_KEY, networkId) : DEPLOYED_TOKENS_KEY;
  const stored = await chrome.storage.local.get(key);
  const tokens = stored?.[key];
  return Array.isArray(tokens) ? tokens : [];
}

/**
 * Save a deployed token record locally, for one network.
 * @param {Object} tokenInfo
 * @param {string} networkId
 */
export async function saveDeployedToken(tokenInfo, networkId) {
  const key = networkId ? scopedKey(DEPLOYED_TOKENS_KEY, networkId) : DEPLOYED_TOKENS_KEY;
  const tokens = await getDeployedTokens(networkId);
  tokens.unshift(tokenInfo);
  await chrome.storage.local.set({ [key]: tokens });
}

/**
 * Deploy a new Token Mint on Thru directly via the Native Token Program.
 *
 * Self-signed, zero contract compiler required, executes in ~1s on ThruVM.
 */
export async function deployTokenMint({
  feePayer,
  ticker,
  name,
  decimals = 6,
  initialSupply = 0,
  imageUri = '',
  description = '',
  mintSeed = generateMintSeed(),
  // The network the mint is being created on. Recorded so the local registry stays scoped:
  // a mint address only exists on the chain it was deployed to.
  networkId = null,
  onProgress = () => {},
}) {
  const client = getClient();
  const address = feePayer.address || Pubkey.from(feePayer.publicKey).toThruFmt();

  // 1. Ensure feePayer account exists on-chain
  onProgress({ step: 'checking_account', message: 'Checking wallet status…' });
  const payerInfo = await getAccountInfo(address);
  if (!payerInfo.exists) {
    onProgress({ step: 'creating_account', message: 'Registering account on-chain…' });
    await createOnChainAccount(feePayer);
  }

  // 2. Derive deterministic mint address
  onProgress({ step: 'deriving_mint', message: 'Deriving Token Mint address on ThruVM…' });
  const mintAddress = await deriveTokenMintAddress(mintSeed);

  // 3. Generate creating state proof for the mint account
  onProgress({ step: 'generating_proof', message: 'Generating cryptographic state proof…' });
  const proofObj = await client.proofs.generate({ address: mintAddress, proofType: 1 });

  // 4. Construct INITIALIZE_MINT instruction payload
  const authorityPubkeyBytes = Pubkey.from(feePayer.publicKey).toBytes();
  const instructionPayload = encodeInitializeMintInstructionData(
    2,
    mintSeed,
    proofObj.proof.length,
    authorityPubkeyBytes,
    decimals,
    proofObj.proof
  );

  // 5. Build, sign, and broadcast transaction
  onProgress({ step: 'submitting_tx', message: 'Broadcasting Token Deployment transaction…' });
  const { rawTransaction } = await client.transactions.buildAndSign({
    feePayer: { publicKey: feePayer.publicKey, privateKey: feePayer.privateKey },
    program: activeNetwork.tokenProgramId,
    accounts: { readWrite: [mintAddress] },
    instructionData: () => instructionPayload,
  });

  let signatureStr = '';
  for await (const update of client.transactions.sendAndTrack(rawTransaction)) {
    if (update.executionResult) {
      if (update.executionResult.vmError === 0) {
        signatureStr = update.signature?.value ? Signature.from(update.signature.value).toThruFmt() : '';
        break;
      }
      throw new Error(`Token deployment reverted on-chain (vmError=${update.executionResult.vmError}).`);
    }
  }

  const tokenRecord = {
    mintAddress,
    ticker: (ticker || '').toUpperCase().trim(),
    name: (name || ticker || '').trim(),
    decimals: Number(decimals),
    initialSupply: Number(initialSupply) || 0,
    imageUri: (imageUri || '').trim(),
    description: (description || '').trim(),
    creator: address,
    signature: signatureStr,
    createdAt: Date.now(),
  };

  await saveDeployedToken(tokenRecord, networkId);
  onProgress({ step: 'success', message: 'Token deployed successfully!', token: tokenRecord });
  return tokenRecord;
}