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

import { createThruClient, Signature, Pubkey, PageRequest, BlockView, keys as sdkKeys, EOA_PROGRAM_ID, TOKEN_PROGRAM_ADDRESS, NOOP_PROGRAM_ADDRESS, ROOT_MANAGER_PROGRAM_ADDRESS } from '@thru/sdk';
// Official program bindings. BUILD_SPEC Part IX: prefer @thru/sdk (including its crypto
// subpath) and @thru/programs over hand-written protocol code wherever the SDK provides it.
// These replace a hand-rolled derivation that called a non-existent SDK method.
import {
  deriveMintAddress as sdkDeriveMintAddress,
  deriveTokenAccountAddress as sdkDeriveTokenAccountAddress,
  bytesToHex as sdkBytesToHex,
  createTransferInstruction as sdkCreateTokenTransferInstruction,
  createInitializeAccountInstruction as sdkCreateInitializeAccountInstruction,
  createInitializeMintInstruction as sdkCreateInitializeMintInstruction,
  parseTokenAccountData as sdkParseTokenAccountData,
  parseMintAccountData as sdkParseMintAccountData,
  isAccountNotFoundError as sdkIsAccountNotFoundError,
} from '@thru/programs/token';
import { BOOTSTRAP_PROGRAM_ADDRESSES, BOOTSTRAP_FAUCET_VAULT_ADDRESS } from '@thru/programs/bootstrap-addresses';
import { scopedKey } from '../shared/network-scope.js';

export const ALPHANET_RPC = 'https://rpc.alphanet.thru.org';

// Canonical program addresses, taken from the 0.4.0 packages rather than hand-copied: the
// alphanet reset replaced the old reserved "marker byte" system table (zero-filled 32-byte
// addresses with byte 31 = 0x00 transfer / 0x03 account-create / 0xaa token / 0xfa faucet)
// with managed-genesis addresses, and the packages are where the next redeployment will land
// too. Everything network-shaped still flows through the CONFIGURED network below; these are
// only the alphanet defaults for tests and direct importers.
export const TRANSFER_PROGRAM_ID = EOA_PROGRAM_ID;
export const TOKEN_PROGRAM_ID = TOKEN_PROGRAM_ADDRESS;
export const FAUCET_PROGRAM_ID = BOOTSTRAP_PROGRAM_ADDRESSES.faucet;
export const FAUCET_STATE_ACCOUNT = BOOTSTRAP_FAUCET_VAULT_ADDRESS;
export const ACCOUNT_CREATE_PROGRAM_ID = NOOP_PROGRAM_ADDRESS;

// Defaults, used until configureNetwork() is called. Kept so tests and any direct importer
// behave as before rather than failing on an unset network.
const DEFAULT_NETWORK = Object.freeze({
  id: 'alphanet',
  rpcUrl: ALPHANET_RPC,
  faucetProgramId: FAUCET_PROGRAM_ID,
  faucetStateAccount: FAUCET_STATE_ACCOUNT,
  faucetMaxPerClaim: 10_000n,
  transferProgramId: TRANSFER_PROGRAM_ID,
  tokenProgramId: TOKEN_PROGRAM_ID,
  accountCreateProgramId: ACCOUNT_CREATE_PROGRAM_ID,
});

let activeNetwork = DEFAULT_NETWORK;

// Chain-state caches. Token-account existence is a property of a CHAIN, not of this process:
// these must be emptied by configureNetwork whenever the chain identity changes, or a send on
// a fresh network could skip account initialization against an account that only exists on the
// old one and revert on-chain.
const inFlightTokenAccountInits = new Map();
const knownTokenAccounts = new Set();

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
    accountCreateProgramId: config.accountCreateProgramId || DEFAULT_NETWORK.accountCreateProgramId,
  };
  if (next.rpcUrl !== activeNetwork.rpcUrl) {
    // Drop the memoized client so the next call builds one against the new endpoint.
    client = undefined;
  }
  if (next.id !== activeNetwork.id || next.rpcUrl !== activeNetwork.rpcUrl) {
    // Chain identity changed: forget everything the previous chain said about token accounts.
    // Without this, a recipient token account that existed on the old network would be
    // skipped by initializeTokenAccount on the new one, and the transfer would revert.
    knownTokenAccounts.clear();
    inFlightTokenAccountInits.clear();
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
 * Lightweight RPC health check — times a single accounts.get() call against a genesis
 * address and returns { status, latencyMs } without throwing. Called once on popup open
 * to drive the footer network indicator; deliberately not polled.
 *
 * The probe address must survive chain resets. The old probe used the zero address, which
 * used to BE the EOA program account and simply answered; after the 0.4.0 reset the zero
 * account exists nowhere, so ACCOUNT_NOT_FOUND came back and every healthy node was
 * reported "offline". Two rules keep this honest: probe a genesis address that any
 * deployment of this chain family has (the immutable root Manager), and treat the SDK's
 * own ACCOUNT_NOT_FOUND as a SUCCESSFUL probe — the node answered, which is all a health
 * ping measures.
 */
export async function checkNetworkHealth() {
  const start = performance.now();
  try {
    await getClient().accounts.get(ROOT_MANAGER_PROGRAM_ADDRESS);
  } catch (err) {
    if (!sdkIsAccountNotFoundError(err)) {
      return { status: 'offline', latencyMs: null };
    }
  }
  const latencyMs = Math.round(performance.now() - start);
  if (latencyMs < 500) return { status: 'healthy', latencyMs };
  return { status: 'slow', latencyMs };
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
    if (account?.meta?.balance == null) {
      throw new Error('The node returned an account without a balance.');
    }
    return { exists: true, balance: BigInt(account.meta.balance), raw: account };
  } catch (err) {
    // Only the SDK's actual ACCOUNT_NOT_FOUND code proves an absent account. A timeout,
    // rate-limit or offline node cannot establish a zero balance or whether this account
    // is registered. Callers (including Send and the balance cache) must see the error.
    if (sdkIsAccountNotFoundError(err)) return { exists: false, balance: 0n };
    throw err;
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

function assertRegistrationNetwork(network) {
  if (activeNetwork.id === network.id && activeNetwork.rpcUrl === network.rpcUrl) return;
  const error = new Error('The network changed while registering this account. Check it on the new network.');
  error.code = 'NETWORK_CHANGED';
  error.retryable = true;
  throw error;
}

function registrationSignerMismatch() {
  const error = new Error('Registration requires the account being created to sign with its own keypair.');
  error.code = 'REGISTRATION_SIGNER_MISMATCH';
  error.retryable = false;
  return error;
}

function snapshotRegistrationSigner(account) {
  try {
    if (!(account.privateKey instanceof Uint8Array) || account.privateKey.length !== 32) {
      throw registrationSignerMismatch();
    }
    // Freeze the *choice* of signer while RPC proof generation is in flight. Even a caller
    // mutating the original account object or its byte arrays cannot substitute another key.
    return {
      publicKey: new Uint8Array(Pubkey.from(account.publicKey).toBytes()),
      privateKey: new Uint8Array(account.privateKey),
    };
  } catch {
    throw registrationSignerMismatch();
  }
}

async function assertSelfSignedRegistration(signer, address) {
  try {
    // Validate both halves of the pair. Comparing only account.address to publicKey still
    // permits accidentally using another wallet account's privateKey as fee payer.
    if (Pubkey.from(signer.publicKey).toThruFmt() !== address) throw registrationSignerMismatch();
    const derivedPublicKey = await sdkKeys.fromPrivateKey(signer.privateKey);
    if (Pubkey.from(derivedPublicKey).toThruFmt() !== address) throw registrationSignerMismatch();
  } catch {
    // Do not surface key material (or low-level crypto input details) through the API router.
    throw registrationSignerMismatch();
  }
}

/**
 * Create an owned on-chain account, or return null if it already exists. Only the background
 * passes keys here; UI callers must first be checked against the unlocked vault. The optional
 * beforeSign guard lets account-creation retries stop if the wallet locks or is reset while an
 * RPC proof is pending. It is deliberately checked after the proof, just before signing.
 *
 * A prior in-memory "registered" set skipped the RPC on future calls, even after a node reset
 * or a network change. The chain, not worker memory, is the authority. Deduplicate only active
 * attempts, scoped to the bound chain; never reuse a signature from a different network.
 */
export async function createOnChainAccount(feePayer, { beforeSign } = {}) {
  const address = feePayer.address || Pubkey.from(feePayer.publicKey).toThruFmt();
  const network = { id: activeNetwork.id, rpcUrl: activeNetwork.rpcUrl };
  const key = `${network.id}::${network.rpcUrl}::${address}`;
  if (inFlightRegistrations.has(key)) return inFlightRegistrations.get(key);

  const promise = (async () => {
    try {
      const client = getClient(); // capture the RPC binding before any asynchronous work
      const already = await getAccountInfo(address);
      assertRegistrationNetwork(network);
      if (already.exists) return null;

      // The ONLY registration fee payer is this new account itself. Reject mismatched address,
      // public key, or private key before requesting a proof or signing anything; no other
      // wallet account may sponsor this native self-creation transaction.
      const signer = snapshotRegistrationSigner(feePayer);
      await assertSelfSignedRegistration(signer, address);
      assertRegistrationNetwork(network);

      // Generate a "creating" state proof — proves to the network that this account doesn't exist yet.
      const proofObj = await client.proofs.generate({ address, proofType: 1 });
      assertRegistrationNetwork(network);
      if (beforeSign) await beforeSign();
      assertRegistrationNetwork(network);

      const { rawTransaction } = await client.transactions.buildAndSign({
        feePayer: signer,
        // Account creation is a fee-payer activation against the network's configured
        // account-creation program — the NOOP program on 0.4.0+ chains (the SDK's own
        // accounts.createAccount default). The pre-reset reserved program (marker byte 0x03)
        // is gone from the chain. stateUnits: 1 is explicit because the reset chain refuses
        // activation with vmError -497 (FEE_PAYER_ACTIVATION_REQUIRES_STATE_UNIT) otherwise.
        // Live-verified on the reset chain 2026-09-26 (registration ts2bMbIHRlcw…): the
        // built header carried exactly { fee: 0n, nonce: 0n, stateUnits: 1, chainId: 1 } —
        // chainId is fetched from the node at build time (it reports 1 today) rather than
        // pinned, so a future chain-id move cannot silently produce wrong-chain signatures;
        // startSlot and expiryAfter are fetched the same way.
        program: activeNetwork.accountCreateProgramId,
        header: { fee: 0n, nonce: 0n, stateUnits: 1 },
        feePayerStateProof: proofObj.proof,
      });
      assertRegistrationNetwork(network);

      for await (const update of client.transactions.sendAndTrack(rawTransaction)) {
        if (update.executionResult) {
          if (update.executionResult.vmError === 0) {
            assertRegistrationNetwork(network);
            return update.signature?.value ? Signature.from(update.signature.value).toThruFmt() : undefined;
          }
          throw new Error(`Account creation reverted on-chain (vmError=${update.executionResult.vmError}).`);
        }
      }
      throw new Error('Account creation never returned an execution result (timed out?).');
    } finally {
      inFlightRegistrations.delete(key);
    }
  })();

  inFlightRegistrations.set(key, promise);
  return promise;
}

// ---- Faucet ----
//
// PROVENANCE: the faucet PROGRAM ADDRESS and state account are now taken from the official
// 0.4.0 packages (see the constants at the top of this file): a managed faucet program with a
// vault PDA that plays the pre-reset "faucet state account" role. The pre-reset addresses were
// themselves reverse-engineered from real `thru faucet withdraw` transactions (submitting two
// claims of different amounts via the CLI and diffing the instruction bytes) and died with the
// fresh-network reset, along with the old reserved "marker byte" address scheme they came from.
//
// The INSTRUCTION LAYOUT below is the pre-reset reverse engineering and is now LIVE-VERIFIED
// against the reset chain (2026-09-26, claim tsjbbZW9sT… with this 16-byte layout against the
// vault PDA, 10,000 units credited; the vault holds ~99.9M units). The vault's role as the
// faucet's state account is confirmed by that claim, not assumed. The account-index handling
// is independently verified too: @thru/sdk's own InstructionContext JSDoc confirms account
// order is exactly [feePayer, program, ...readWriteAccounts, ...readOnlyAccounts] after
// sorting, which is why this uses buildInstructionData + getAccountIndex instead of
// hand-rolling that sort — it delegates the part that's easy to get subtly wrong to the SDK's
// own verified logic.
// The program/state constants remain exported for tests and for callers that want the alphanet
// defaults, but the network calls below read from the CONFIGURED network so a switch takes
// effect.
export const FAUCET_MAX_PER_CLAIM = 10_000n; // per the CLI's own cap — a full-cap claim of 10,000 succeeded on the reset chain (2026-09-26)

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
    // fee 0n is the sponsored-claim design (pre-reset and post). stateUnits: 1 is stated
    // explicitly — the claim writes vault state and this exact header was live-verified on
    // the reset chain (2026-09-26, claim tsjbbZW9sT…, 10,000 units credited). chainId,
    // nonce, startSlot and expiryAfter are fetched from the node inside buildAndSign.
    header: { fee: 0n, stateUnits: 1 },
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
// PROVENANCE: the instruction layout came from reverse-engineering a real `thru transfer`
// transaction (confirmed on-chain signature ts_ItJeT7...), and it is now LIVE-VERIFIED on the
// reset chain too (2026-09-26, transfer tsPbi9uzCb… with this 16-byte layout against the EOA
// program; fee measured at exactly 1 base unit). @thru/programs' eoa module emits
// byte-identical instructions (tag 1, u64 amount, u16 source, u16 destination) from the same
// buildAndSign path this wallet uses, and @thru/sdk's accounts.create() confirms the
// self-registration flow beside it. The PROGRAM ADDRESS is package-sourced at the top of this
// file — pre-reset it was the reserved zero address with a 0x80 marker byte, and the
// fresh-network reset replaced that whole scheme with managed-genesis addresses (the EOA
// program) while keeping the wire encoding identical.

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
    // No fee here on purpose: the SDK default is 1 base unit, re-measured on the reset
    // chain (2026-09-26, transfer tsPbi9uzCb…: 10000 − 1234 − 1 = 8765). stateUnits: 1 is
    // stated explicitly to match that live-tested wire shape; chainId, nonce, startSlot and
    // expiryAfter are fetched from the node inside buildAndSign.
    header: { stateUnits: 1 },
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
 * `canDecode` gates the Transfer-family labels; account registration is claimed by its
 * program id before that gate, and anything else stays an honest kind 'other' ("Unknown
 * transaction" in the UI).
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
  const tokenProgram = activeNetwork.tokenProgramId;
  const accountCreateProgram = activeNetwork.accountCreateProgramId;

  // Token program entries have their own wire format: a ONE-byte instruction tag (the ABI's
  // TokenInstruction discriminant), unlike the 4-byte tags of the faucet/transfer programs.
  // Measured from @thru/programs 0.3.16 output, not assumed symmetric with the native layout.
  if (programAddress === tokenProgram && tx.instructionData?.length >= 1) {
    const data = tx.instructionData;
    const viewOf = (offset) => new DataView(data.buffer, data.byteOffset + offset, data.byteLength - offset);
    const allAccounts = [tx.feePayer, tx.program, ...(tx.readWriteAccounts || []), ...(tx.readOnlyAccounts || [])];
    const addrAt = (idx) => allAccounts[idx]?.toThruFmt() || null;
    const tag = data[0];

    if (tag === 2 && data.length === 13) {
      // transfer: [tag u8][sourceIdx u16][destIdx u16][amount u64]
      const view = viewOf(1);
      entry.kind = 'token-transfer';
      entry.amount = view.getBigUint64(4, true);
      entry.tokenSource = addrAt(view.getUint16(0, true));
      entry.tokenDest = addrAt(view.getUint16(2, true));
    } else if (tag === 3 && data.length === 15) {
      // mint_to: [tag u8][mintIdx u16][destIdx u16][authorityIdx u16][amount u64]
      const view = viewOf(1);
      entry.kind = 'token-mint';
      entry.amount = view.getBigUint64(6, true);
      entry.tokenMint = addrAt(view.getUint16(0, true));
      entry.tokenDest = addrAt(view.getUint16(2, true));
    } else if (tag === 1 && data.length >= 39) {
      // initialize_account: [tag u8][tokenIdx u16][mintIdx u16][ownerIdx u16][seed 32][proof…]
      const view = viewOf(1);
      entry.kind = 'token-account-init';
      entry.tokenMint = addrAt(view.getUint16(2, true));
      entry.tokenDest = addrAt(view.getUint16(0, true)); // the token account being created
      entry.counterparty = addrAt(view.getUint16(4, true)); // its owner
      entry.amount = null;
    }
    return entry;
  }

  if (programAddress && programAddress === accountCreateProgram) {
    // The account-registration pre-image (derive_account + create_account) is NOT the
    // transfer shape — no 16-byte Transfer data — so it must be claimed BEFORE canDecode
    // or it lands on kind 'other'. It is the caller's own account being registered on
    // chain: no amount and no counterparty to show. Unknown programs stay 'other' below;
    // only this program id gets this label.
    entry.kind = 'registration';
    return entry;
  }

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

/**
 * ADDITIVE (P2 detail sheet): fetch ONE transaction by signature and report only what the
 * node actually returned. Nothing here is inferred, defaulted or carried over from a
 * neighbouring entry — every field is `null` when the wire did not carry it, and the caller
 * is expected to say "Not available" rather than fill the gap.
 *
 * This reuses decodeHistoryEntry (same Transaction class, same decoder) so the detail view
 * cannot disagree with the list view about kind/amount/counterparty. What it ADDS over a
 * list entry is exactly two things, both spiked in docs/archive/TX_DETAIL_SPIKE.md:
 *
 *   feeDeclaredUnits — `Transaction.fee`, the fee DECLARED IN THE TRANSACTION HEADER. It is
 *       deliberately NOT named `feeUnits`: Thru's TransactionExecutionResult carries no
 *       charged-fee field at all (verified against the generated protobuf field list), so
 *       "what this transaction cost" is not answerable from this RPC. Presenting a header
 *       declaration as the amount debited would be a fabrication of exactly the kind this
 *       codebase treats as a defect. The caller must label the provenance.
 *
 *   blockTimeMs — the containing BLOCK's time, fetched separately via blocks.get({slot}).
 *       Transactions carry no time field; BlockHeader.block_time is optional on the wire and
 *       @thru/sdk only populates Block.blockTimeNs when the node sent it. Absent stays null.
 *
 * Both lookups are best-effort and isolated: a failure of the block fetch must not lose the
 * transaction facts we already have, so it degrades to null rather than throwing.
 *
 * @param {string} signature
 * @param {string} viewerAddress — whose point of view decides sent/received
 * @returns {Promise<object>} decoded entry plus { feeDeclaredUnits, blockTimeMs, nonce } —
 *   BigInts stay BigInt here; the service layer serializes them for the wire.
 */
export async function getTransactionDetail(signature, viewerAddress) {
  const sig = String(signature || '').trim();
  if (!sig) throw new Error('A transaction signature is required.');

  const tx = await getClient().transactions.get(sig);
  const entry = decodeHistoryEntry(tx, viewerAddress);

  // Transaction.fee is always present on a decoded Transaction (fromProto defaults it to 0n),
  // so there is no "missing" case to distinguish — but 0n is a legitimate declared fee and
  // must not be coerced into "unknown".
  entry.feeDeclaredUnits = typeof tx.fee === 'bigint' ? tx.fee : null;
  entry.nonce = typeof tx.nonce === 'bigint' ? tx.nonce : null;

  // Wall-clock time lives on the block, not the transaction. One extra call, on demand only.
  entry.blockTimeMs = null;
  if (tx.slot != null) {
    try {
      const block = await getClient().blocks.get({ slot: tx.slot });
      // blockTimeNs is optional: absent on a node that did not send header.blockTime, and
      // 0n is what the SDK writes when a wire block had no time — both mean "unknown".
      if (typeof block?.blockTimeNs === 'bigint' && block.blockTimeNs > 0n) {
        entry.blockTimeMs = Number(block.blockTimeNs / 1_000_000n);
      }
    } catch {
      // A node that answers getTransaction but not getBlock still gives a useful sheet.
    }
  }

  return entry;
}

const blockTimeCache = new Map();
const inFlightBlockTimes = new Map();
const BLOCK_TIME_CACHE_LIMIT = 256;

/**
 * Fetch the block's actual wall-clock time in milliseconds. A slot belongs to a CHAIN, so
 * cache by network id + endpoint + slot (not just slot). Bind the client before the await:
 * a network switch during an RPC must not fetch/cache the other chain's block under this one.
 * Only successful, representable dates are cached; an offline or absent block is retryable.
 * @param {number|string|bigint} slot
 * @param {string} [expectedNetworkId] the feed's captured network, if called across awaits
 * @returns {Promise<number|null>}
 */
export async function getBlockTimeMs(slot, expectedNetworkId = activeNetwork.id) {
  if (slot == null || (typeof slot === 'string' && !slot.trim())) return null;
  const numSlot = Number(slot);
  if (!Number.isSafeInteger(numSlot) || numSlot < 0) return null;

  const network = activeNetwork;
  if (network.id !== expectedNetworkId) return null;
  const key = JSON.stringify([network.id, network.rpcUrl, numSlot]);
  if (blockTimeCache.has(key)) return blockTimeCache.get(key);
  if (inFlightBlockTimes.has(key)) return inFlightBlockTimes.get(key);

  const boundClient = getClient();
  const request = Promise.resolve().then(async () => {
    try {
      // The history list needs the header time, not each block's transaction body.
      const block = await boundClient.blocks.get({ slot: numSlot }, { view: BlockView.HEADER_ONLY });
      if (activeNetwork.id !== network.id || activeNetwork.rpcUrl !== network.rpcUrl) return null;
      // SDK Block.blockTimeNs is optional. 0n means that the node did not supply it.
      if (typeof block?.blockTimeNs !== 'bigint' || block.blockTimeNs <= 0n) return null;
      const ms = Number(block.blockTimeNs / 1_000_000n);
      if (!Number.isSafeInteger(ms) || ms <= 0 || !Number.isFinite(new Date(ms).getTime())) return null;
      blockTimeCache.set(key, ms);
      if (blockTimeCache.size > BLOCK_TIME_CACHE_LIMIT) {
        blockTimeCache.delete(blockTimeCache.keys().next().value);
      }
      return ms;
    } catch {
      // Node offline, slot unindexed, or block time omitted: leave the card's Block fallback.
      return null;
    }
  }).finally(() => { inFlightBlockTimes.delete(key); });
  inFlightBlockTimes.set(key, request);
  return request;
}

// ---- Native Token Launchpad (v1.2) -----------------------------------------
// Native built-in Token Program address on ThruVM (similar to SPL Token Program):
// package-sourced at the top of this file.
export const DEPLOYED_TOKENS_KEY = 'thru_deployed_tokens';

/**
 * Generate a mint seed: 32 random bytes as 64 hex characters.
 *
 * FIXED after reading the official binding. This produced 32 characters drawn from a base-62
 * alphabet, which is neither 32 bytes nor hex. @thru/programs/token deriveMintAddress does
 * `hexToBytes(seed)` and throws "Seed must be 32 bytes (64 hex characters)" on anything else, so
 * every seed this generated was invalid for real mint derivation.
 */
export function generateMintSeed() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return sdkBytesToHex(bytes);
}

/**
 * Derive the deterministic Token Mint address for a seed, via the official binding.
 *
 * HISTORY, because this was wrong in three separate ways:
 *
 *   1. It called `client.proofs.deriveAddress`, which does not exist in @thru/sdk 0.3.4 —
 *      `proofs` exposes only `generate` and `getStateRoots`. The call threw, so token mint
 *      derivation has never worked and `token.deriveAddress` always failed.
 *   2. The seed format was wrong. generateMintSeed produced 32 base-62 characters; the real
 *      derivation does hexToBytes(seed) and requires 32 bytes / 64 hex characters.
 *   3. The inputs were wrong. Derivation is over [mintAuthorityBytes, seedBytes], so it needs
 *      the CREATOR's address — a seed alone cannot identify a mint.
 *
 * Now delegated to @thru/programs/token, which is the authoritative implementation rather than
 * a guess. Note that a reference corpus of generated wallets did NOT reproduce these addresses;
 * its `tokenProgramId` field is not a mint derived this way, so it was not treated as an oracle.
 *
 * @param {string} mintSeed 64 hex characters
 * @param {string} mintAuthorityAddress the account that will own the mint
 * @returns {Promise<string>} the derived mint address
 */
export async function deriveTokenMintAddress(mintSeed, mintAuthorityAddress) {
  if (!mintAuthorityAddress) {
    throw new Error('Deriving a mint address needs the mint authority (creator) address.');
  }
  const result = await sdkDeriveMintAddress(
    getClient(),
    mintAuthorityAddress,
    mintSeed,
    activeNetwork.tokenProgramId,
  );
  return result?.address ?? String(result);
}

/**
 * Derive the token ACCOUNT address that holds one owner's balance of one mint.
 *
 * Thru separates a wallet account from its per-mint token accounts, so a token transfer needs
 * both sides to have an initialized token account. This is what makes reading an owned token
 * balance possible (docs/BACKEND_GAPS.md C1) and is the missing piece for token transfers.
 *
 * @param {string} ownerAddress
 * @param {string} mintAddress
 */
export async function deriveTokenAccountAddress(ownerAddress, mintAddress) {
  const result = await sdkDeriveTokenAccountAddress(
    getClient(),
    ownerAddress,
    mintAddress,
    activeNetwork.tokenProgramId,
  );
  return result?.address ?? String(result);
}

/**
 * Read a token account's on-chain state.
 *
 * Strict about failure kinds: a genuinely-absent account returns { exists: false }, but an
 * RPC failure THROWS rather than masquerading as a zero balance. A zero that is real and a
 * balance that is unknown are different things in a wallet — showing the wrong one is how
 * people think they received funds they never got (or vice versa).
 *
 * @param {string} tokenAccountAddress
 * @returns {Promise<{ exists: boolean, mint?: string, owner?: string, amount?: bigint, isFrozen?: boolean }>}
 */
export async function readTokenAccount(tokenAccountAddress) {
  let account;
  try {
    account = await getClient().accounts.get(tokenAccountAddress);
  } catch (err) {
    if (sdkIsAccountNotFoundError(err)) return { exists: false };
    throw err;
  }
  // Throws when the account exists but is not a token account — that is a programming error
  // (wrong address), not a "zero balance", and it must not be smoothed over.
  const info = sdkParseTokenAccountData(account);
  return {
    exists: true,
    mint: info.mint,
    owner: info.owner,
    amount: info.amount,
    isFrozen: info.isFrozen,
  };
}

/**
 * Read a token mint's on-chain metadata (decimals, supply, ticker, authorities).
 * Same absence-versus-failure discipline as readTokenAccount.
 *
 * @param {string} mintAddress
 */
export async function readMintAccount(mintAddress) {
  let account;
  try {
    account = await getClient().accounts.get(mintAddress);
  } catch (err) {
    if (sdkIsAccountNotFoundError(err)) return { exists: false };
    throw err;
  }
  const info = sdkParseMintAccountData(account);
  return {
    exists: true,
    decimals: info.decimals,
    supply: info.supply,
    ticker: info.ticker,
    creator: info.creator,
    mintAuthority: info.mintAuthority,
    freezeAuthority: info.freezeAuthority,
    hasFreezeAuthority: info.hasFreezeAuthority,
  };
}

/**
 * One owner's balance of one mint: derive the token account address, then read it.
 *
 * @returns {Promise<{ tokenAccount: string, exists: boolean, amount: bigint|null }>}
 *   amount is null only when the token account does not exist (which is EXACTLY zero — a
 *   provably-empty answer, not an unknown one).
 */
export async function getTokenBalance(ownerAddress, mintAddress) {
  const derived = await sdkDeriveTokenAccountAddress(
    getClient(),
    ownerAddress,
    mintAddress,
    activeNetwork.tokenProgramId,
  );
  const info = await readTokenAccount(derived.address);
  return {
    tokenAccount: derived.address,
    exists: info.exists,
    amount: info.exists ? info.amount : null,
  };
}

// ---- Token transfers ------------------------------------------------------
//
// Thru keeps a wallet account separate from its per-mint token accounts, so moving a token
// touches the SENDER's token account and the RECIPIENT's token account — never the wallet
// accounts directly. The recipient's token account is a program-derived address, which means
// the sender can initialize it in a preceding transaction without holding the recipient's key
// (unlike native transfers, where an unregistered recipient is a hard failure the sender can
// do nothing about).
//
// One OPEN CHAIN QUESTION remains (docs/BACKEND_GAPS.md): whether the recipient's WALLET
// account must already exist for their token account to initialize. initialize-account may
// only need the token account's own creation proof. scripts/verify-token-transfer.mjs probes
// exactly this against a live network; until it reports, the UI does not promise either way.

/**
 * Initialize one owner's token account for one mint, paid for by feePayer.
 * No-op (and no transaction) when the account already exists. Concurrent calls for the same
 * address share one in-flight transaction instead of racing two creations.
 *
 * @returns {Promise<{ tokenAccount: string, created: boolean, signature: string|null }>}
 */
export async function initializeTokenAccount(feePayer, ownerAddress, mintAddress) {
  const derived = await sdkDeriveTokenAccountAddress(
    getClient(),
    ownerAddress,
    mintAddress,
    activeNetwork.tokenProgramId,
  );
  const tokenAccountAddress = derived.address;
  if (knownTokenAccounts.has(tokenAccountAddress)) {
    return { tokenAccount: tokenAccountAddress, created: false, signature: null };
  }
  if (inFlightTokenAccountInits.has(tokenAccountAddress)) {
    return inFlightTokenAccountInits.get(tokenAccountAddress);
  }

  const promise = (async () => {
    try {
      const existing = await readTokenAccount(tokenAccountAddress);
      if (existing.exists) {
        knownTokenAccounts.add(tokenAccountAddress);
        return { tokenAccount: tokenAccountAddress, created: false, signature: null };
      }

      const proofObj = await getClient().proofs.generate({ address: tokenAccountAddress, proofType: 1 });
      const tokenAccountBytes = Pubkey.from(tokenAccountAddress).toBytes();
      const mintBytes = Pubkey.from(mintAddress).toBytes();
      const ownerBytes = Pubkey.from(ownerAddress).toBytes();

      // The instruction references the token account (writable), the mint (read-only) and the
      // owner (read-only). The fee payer is already at index 0, so the owner only needs an
      // explicit slot when it is someone else (initializing the RECIPIENT's account).
      const ownerIsPayer = ownerAddress === (feePayer.address || Pubkey.from(feePayer.publicKey).toThruFmt());
      const readOnly = ownerIsPayer ? [mintAddress] : [mintAddress, ownerAddress];

      const { rawTransaction } = await getClient().transactions.buildAndSign({
        feePayer: { publicKey: feePayer.publicKey, privateKey: feePayer.privateKey },
        program: activeNetwork.tokenProgramId,
        accounts: { readWrite: [tokenAccountAddress], readOnly },
        instructionData: sdkCreateInitializeAccountInstruction({
          tokenAccountBytes,
          mintAccountBytes: mintBytes,
          ownerAccountBytes: ownerBytes,
          // The default derivation seed, matching deriveTokenAccountAddress's default.
          seedBytes: new Uint8Array(32),
          stateProof: proofObj.proof,
        }),
      });

      for await (const update of getClient().transactions.sendAndTrack(rawTransaction)) {
        if (update.executionResult) {
          if (update.executionResult.vmError === 0) {
            knownTokenAccounts.add(tokenAccountAddress);
            const signature = update.signature?.value
              ? Signature.from(update.signature.value).toThruFmt()
              : null;
            return { tokenAccount: tokenAccountAddress, created: true, signature };
          }
          const err = new Error(
            `Token account initialization reverted on-chain (vmError=${update.executionResult.vmError}).`,
          );
          err.code = 'TOKEN_INIT_FAILED';
          throw err;
        }
      }
      throw new Error('Token account initialization never returned an execution result (timed out?).');
    } finally {
      inFlightTokenAccountInits.delete(tokenAccountAddress);
    }
  })();

  inFlightTokenAccountInits.set(tokenAccountAddress, promise);
  return promise;
}

/**
 * Send a token transfer: moves `amountUnits` of `mintAddress` from the fee payer's token
 * account to the recipient's token account, initializing the recipient's token account first
 * when it does not exist.
 *
 * Error codes thrown (stable, the UI may branch on them):
 *   TOKEN_ACCOUNT_MISSING  fee payer has no token account for this mint at all
 *   TOKEN_FROZEN           fee payer's token account is frozen
 *   TOKEN_BALANCE_TOO_LOW  source balance below the requested amount
 *   TOKEN_INIT_FAILED      recipient token account creation reverted on-chain
 *
 * @returns {Promise<{ signature: string|null, recipientTokenAccountCreated: boolean, initSignature: string|null }>}
 */
export async function sendTokenTransfer({ feePayer, mintAddress, recipientAddress, amountUnits }) {
  const amount = BigInt(amountUnits);
  if (amount <= 0n) {
    throw new Error('Amount must be a positive whole number of base units.');
  }

  const source = await sdkDeriveTokenAccountAddress(
    getClient(),
    feePayer.address,
    mintAddress,
    activeNetwork.tokenProgramId,
  );
  const sourceState = await readTokenAccount(source.address);
  if (!sourceState.exists) {
    const err = new Error('You have no token account for this mint, so there is no balance to send from.');
    err.code = 'TOKEN_ACCOUNT_MISSING';
    throw err;
  }
  if (sourceState.isFrozen) {
    const err = new Error('Your token account for this mint is frozen by its freeze authority.');
    err.code = 'TOKEN_FROZEN';
    throw err;
  }
  if (sourceState.amount < amount) {
    const err = new Error(
      'This token account holds less than the amount you are trying to send.'
        + ` Balance: ${sourceState.amount.toString()} base units.`,
    );
    err.code = 'TOKEN_BALANCE_TOO_LOW';
    throw err;
  }

  const dest = await sdkDeriveTokenAccountAddress(
    getClient(),
    recipientAddress,
    mintAddress,
    activeNetwork.tokenProgramId,
  );
  const destState = await readTokenAccount(dest.address);
  let recipientTokenAccountCreated = false;
  let initSignature = null;
  if (!destState.exists) {
    const init = await initializeTokenAccount(feePayer, recipientAddress, mintAddress);
    recipientTokenAccountCreated = init.created;
    initSignature = init.signature;
  }

  const sourceBytes = Pubkey.from(source.address).toBytes();
  const destBytes = Pubkey.from(dest.address).toBytes();

  const { rawTransaction } = await getClient().transactions.buildAndSign({
    feePayer: { publicKey: feePayer.publicKey, privateKey: feePayer.privateKey },
    program: activeNetwork.tokenProgramId,
    accounts: {
      readWrite: source.address === dest.address
        ? [source.address]
        : [source.address, dest.address],
    },
    instructionData: sdkCreateTokenTransferInstruction({
      sourceAccountBytes: sourceBytes,
      destinationAccountBytes: destBytes,
      amount,
    }),
  });

  for await (const update of getClient().transactions.sendAndTrack(rawTransaction)) {
    if (update.executionResult) {
      if (update.executionResult.vmError === 0) {
        return {
          signature: update.signature?.value ? Signature.from(update.signature.value).toThruFmt() : null,
          recipientTokenAccountCreated,
          initSignature,
        };
      }
      const err = new Error(`Token transfer reverted on-chain (vmError=${update.executionResult.vmError}).`);
      err.code = 'TOKEN_TRANSFER_FAILED';
      throw err;
    }
  }
  throw new Error('Token transfer never returned an execution result (timed out?).');
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

  // 2. Derive deterministic mint address. The authority is REQUIRED — derivation is over
  //    [authorityBytes, seedBytes]. deployTokenMint previously called this with only the seed,
  //    which threw on every deploy; the failure was invisible because no deploy UI survived
  //    the launchpad deletion and the path was never exercised end to end.
  onProgress({ step: 'deriving_mint', message: 'Deriving Token Mint address on ThruVM…' });
  const mintAddress = await deriveTokenMintAddress(mintSeed, address);

  // 3. Generate creating state proof for the mint account
  onProgress({ step: 'generating_proof', message: 'Generating cryptographic state proof…' });
  const proofObj = await client.proofs.generate({ address: mintAddress, proofType: 1 });

  // 4. Construct INITIALIZE_MINT via the official binding. The hand-rolled encoder this
  //    replaced cannot have been right against the real program: it had no ticker, no creator
  //    and no freeze-authority slot, all of which the on-chain TokenMintAccount layout carries
  //    and parseMintAccountData expects to read back.
  const authorityPubkeyBytes = Pubkey.from(feePayer.publicKey).toBytes();
  const instructionData = sdkCreateInitializeMintInstruction({
    mintAccountBytes: Pubkey.from(mintAddress).toBytes(),
    decimals: Number(decimals),
    mintAuthorityBytes: authorityPubkeyBytes,
    ticker: (ticker || '').toUpperCase().trim(),
    seedHex: mintSeed,
    stateProof: proofObj.proof,
  });

  // 5. Build, sign, and broadcast transaction
  onProgress({ step: 'submitting_tx', message: 'Broadcasting Token Deployment transaction…' });
  const { rawTransaction } = await client.transactions.buildAndSign({
    feePayer: { publicKey: feePayer.publicKey, privateKey: feePayer.privateKey },
    program: activeNetwork.tokenProgramId,
    accounts: { readWrite: [mintAddress] },
    instructionData,
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