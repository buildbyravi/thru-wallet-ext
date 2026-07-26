// Thin wrapper around @thru/sdk, pointed at Thru's alphanet.
//
// NOTE: alphanet is pre-testnet, unaudited infrastructure. Expect instability, resets, and
// breaking SDK changes — this whole file may need updates as Thru moves toward testnet/mainnet.

import { createThruClient, Signature, Pubkey } from '@thru/sdk';

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
 */
export async function createOnChainAccount(feePayer) {
  // feePayer: { publicKey, privateKey } — the new account pays for its own creation,
  // matching CreateAccountOptions in @thru/sdk (publicKey + optional header overrides).
  return getClient().accounts.create({ publicKey: feePayer.publicKey });
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
export const FAUCET_MAX_PER_CLAIM = 10_000n; // per the CLI's own clap-level cap

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
 * Claim tokens from the alphanet faucet, submitted on-chain directly — no CLI required.
 *
 * Needs the account to already exist on-chain first (see createOnChainAccount above): the
 * SDK's buildAndSign auto-fills the transaction's nonce by reading the fee payer's current
 * on-chain account, which only exists once accounts.create() has run at least once. The
 * faucet transaction itself is zero-fee, so it doesn't need an existing balance — just an
 * existing account.
 */
export async function claimFaucet(feePayer, amount) {
  const amountUnits = BigInt(amount);
  if (amountUnits <= 0n || amountUnits > FAUCET_MAX_PER_CLAIM) {
    throw new Error(`Amount must be a whole number between 1 and ${FAUCET_MAX_PER_CLAIM}.`);
  }

  const info = await getAccountInfo(feePayer.address);
  if (!info.exists) {
    throw new Error('This account doesn\u2019t exist on-chain yet \u2014 create it first, then come back to claim.');
  }

  const recipient = feePayer.address;
  const { rawTransaction } = await getClient().transactions.buildAndSign({
    feePayer: { publicKey: feePayer.publicKey, privateKey: feePayer.privateKey },
    program: FAUCET_PROGRAM_ID,
    header: { fee: 0n },
    accounts: { readWriteAccounts: [FAUCET_STATE_ACCOUNT, recipient] },
    buildInstructionData: ({ getAccountIndex }) =>
      encodeFaucetInstructionData(getAccountIndex(FAUCET_STATE_ACCOUNT), getAccountIndex(recipient), amountUnits),
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

/** Same faucet claim, phrased as the CLI command, for anyone who'd rather run it themselves. */
export function faucetCliCommand(address, amount) {
  return `thru faucet withdraw ${address} ${amount}`;
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
export const TRANSFER_PROGRAM_ID = 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAICA';

/** Pure byte-layout encoder for a native transfer instruction, kept directly testable. */
export function encodeTransferInstructionData(sourceIdx, destIdx, amountUnits) {
  const data = new Uint8Array(16);
  const view = new DataView(data.buffer);
  view.setUint32(0, 0, true); // tag 0: transfer
  view.setUint16(4, sourceIdx, true);
  view.setUint16(6, destIdx, true);
  view.setBigUint64(8, BigInt(amountUnits), true);
  return data;
}

/**
 * Send a native THRU transfer, submitted on-chain directly.
 *
 * Same account-existence precondition as claimFaucet, and for the same reason: buildAndSign
 * needs to read the sender's current nonce, which needs the sender's account to already exist.
 * Unlike the faucet, a normal transfer is NOT zero-fee (no reverse-engineered evidence it is,
 * and there's no reason to assume so) — it uses whatever @thru/sdk's own default fee is unless
 * you override header.fee explicitly, so the sender needs a balance covering amount + fee.
 */
export async function sendTransfer(feePayer, toAddress, amount) {
  const amountUnits = BigInt(amount);
  if (amountUnits <= 0n) {
    throw new Error('Amount must be a positive whole number of base units.');
  }

  const info = await getAccountInfo(feePayer.address);
  if (!info.exists) {
    throw new Error('This account doesn\u2019t exist on-chain yet \u2014 create it first, then come back to send.');
  }
  if (info.balance < amountUnits) {
    throw new Error(`Balance (${formatThru(info.balance)} THRU) is lower than the amount you're trying to send.`);
  }

  const { rawTransaction } = await getClient().transactions.buildAndSign({
    feePayer: { publicKey: feePayer.publicKey, privateKey: feePayer.privateKey },
    program: TRANSFER_PROGRAM_ID,
    accounts: { readWriteAccounts: [feePayer.address, toAddress] },
    buildInstructionData: ({ getAccountIndex }) =>
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
  const idxA = view.getUint16(4, true);
  const idxB = view.getUint16(6, true);
  const amount = view.getBigUint64(8, true);
  const allAccounts = [tx.feePayer, tx.program, ...tx.readWriteAccounts, ...tx.readOnlyAccounts];
  const addrA = allAccounts[idxA]?.toThruFmt();
  const addrB = allAccounts[idxB]?.toThruFmt();

  if (programAddress === FAUCET_PROGRAM_ID && tag === 1) {
    entry.kind = 'faucet';
    entry.amount = amount;
  } else if (programAddress === TRANSFER_PROGRAM_ID && tag === 0) {
    const isOutgoing = addrA === viewerAddress;
    entry.kind = isOutgoing ? 'sent' : 'received';
    entry.amount = amount;
    entry.counterparty = isOutgoing ? addrB : addrA;
  }
  return entry;
}

/** Recent transaction history for an address, decoded where it's a known transfer/faucet call. */
export async function listAccountHistory(address, pageSize = 15) {
  const { transactions } = await getClient().transactions.listForAccount(address, { page: { pageSize } });
  return transactions.map((tx) => decodeHistoryEntry(tx, address));
}
