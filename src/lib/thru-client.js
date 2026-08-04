// Thin wrapper around @thru/sdk, pointed at Thru's alphanet.
//
// NOTE: alphanet is pre-testnet, unaudited infrastructure. Expect instability, resets, and
// breaking SDK changes — this whole file may need updates as Thru moves toward testnet/mainnet.

import { createThruClient, Signature, Pubkey, PageRequest } from '@thru/sdk';

export const ALPHANET_RPC = 'https://rpc.alphanet.thru.org';

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
    client = createThruClient({ baseUrl: ALPHANET_RPC });
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
export async function createOnChainAccount(feePayer) {
  const address = feePayer.address || Pubkey.from(feePayer.publicKey).toThruFmt();
  const already = await getAccountInfo(address);
  if (already.exists) return null; // already active on-chain

  const client = getClient();
  // Generate a "creating" state proof — proves to the network that this account doesn't exist yet
  const proofObj = await client.proofs.generate({ address, proofType: 1 });

  // v0.3.0 API: feePayerStateProof is top-level, header fields (nonce, startSlot, chainId) auto-fetched.
  // Signing uses domain-separated ed25519 ("tn_txn_sign_v1__" + SHA256) — this was the root cause of
  // all "invalid transaction signature" errors with v0.2.39 which used raw ed25519 signing.
  const { rawTransaction } = await client.transactions.buildAndSign({
    feePayer: { publicKey: feePayer.publicKey, privateKey: feePayer.privateKey },
    program: 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMD',
    header: { fee: 0n, nonce: 0n },
    feePayerStateProof: proofObj.proof
  });

  for await (const update of client.transactions.sendAndTrack(rawTransaction)) {
    if (update.executionResult) {
      if (update.executionResult.vmError === 0) {
        return update.signature?.value ? Signature.from(update.signature.value).toThruFmt() : undefined;
      }
      throw new Error(`Account creation reverted on-chain (vmError=${update.executionResult.vmError}).`);
    }
  }
  throw new Error('Account creation never returned an execution result (timed out?).');
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
export const FAUCET_PROGRAM_ID = 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPr6';
export const FAUCET_STATE_ACCOUNT = 'taxoImN8fTEOxXYnvgC6JZ0lN0n0qvZERwz_vlOjX3MkIn';
export const FAUCET_MAX_PER_CLAIM = 10_000n; // per the CLI's own cap
export const OFFICIAL_DEFAULT_FEE_PAYER_HEX = '61c9fb9128444fc3a93142797c3563bc9147f4589e6f7ab7157827cdb065673e';

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
 */
export async function claimFaucet(feePayer, amount) {
  const amountUnits = BigInt(amount);
  if (amountUnits <= 0n || amountUnits > FAUCET_MAX_PER_CLAIM) {
    throw new Error(`Amount must be a whole number between 1 and ${FAUCET_MAX_PER_CLAIM}.`);
  }

  const address = feePayer.address || Pubkey.from(feePayer.publicKey).toThruFmt();
  const info = await getAccountInfo(address);
  if (!info.exists) {
    throw new Error('Account must be initialized on-chain before claiming faucet tokens. Fund or activate this account first.');
  }

  // recipient = feePayer (claiming to own address), so it's already at index 0.
  // Only add non-feePayer accounts to readWrite to avoid duplicate rejection.
  const { rawTransaction } = await getClient().transactions.buildAndSign({
    feePayer: { publicKey: feePayer.publicKey, privateKey: feePayer.privateKey },
    program: FAUCET_PROGRAM_ID,
    header: { fee: 0n },
    accounts: { readWrite: [FAUCET_STATE_ACCOUNT] },
    instructionData: ({ getAccountIndex }) =>
      encodeFaucetInstructionData(getAccountIndex(FAUCET_STATE_ACCOUNT), getAccountIndex(address), amountUnits),
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
    program: TRANSFER_PROGRAM_ID,
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

  const canDecode = tx.instructionData?.length === 16 && (programAddress === TRANSFER_PROGRAM_ID || programAddress === FAUCET_PROGRAM_ID);
  if (!canDecode) return entry;

  const data = tx.instructionData;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tag = view.getUint32(0, true);

  if (programAddress === FAUCET_PROGRAM_ID && tag === 1) {
    const amount = view.getBigUint64(8, true);
    entry.kind = 'faucet';
    entry.amount = amount;
  } else if (programAddress === TRANSFER_PROGRAM_ID && tag === 1) {
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