import {
  encodeFaucetInstructionData,
  encodeTransferInstructionData,
  decodeHistoryEntry,
  formatThru,
  parseThruAmount,
  isValidThruAddress,
  UNITS_PER_THRU,
  FAUCET_PROGRAM_ID,
  TRANSFER_PROGRAM_ID,
} from './src/lib/thru-client.js';
import { Transaction, keys, Signature } from '@thru/sdk';

const assert = (cond, msg) => {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
  console.log('  ok -', msg);
};

function decode(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    tag: view.getUint32(0, true),
    stateIdx: view.getUint16(4, true),
    recipientIdx: view.getUint16(6, true),
    amount: view.getBigUint64(8, true),
  };
}

console.log('\n[1] Faucet instruction encoding round-trips correctly');
const encoded = encodeFaucetInstructionData(0, 1, 1000n);
assert(encoded.length === 16, 'instruction data is exactly 16 bytes');
const decoded = decode(encoded);
assert(decoded.tag === 1, 'tag is 1 (faucet withdraw)');
assert(decoded.stateIdx === 0, 'stateIdx round-trips');
assert(decoded.recipientIdx === 1, 'recipientIdx round-trips');
assert(decoded.amount === 1000n, 'amount round-trips as a bigint');

console.log('\n[2] Only the amount bytes differ between two claims of different sizes (matches the diffing approach used to reverse-engineer this layout)');
const claim10 = encodeFaucetInstructionData(0, 1, 10n);
const claim50 = encodeFaucetInstructionData(0, 1, 50n);
let diffOffsets = [];
for (let i = 0; i < 16; i++) if (claim10[i] !== claim50[i]) diffOffsets.push(i);
assert(diffOffsets.every((o) => o >= 8 && o < 16), `all differing bytes are within the amount field (offsets 8-15): got ${diffOffsets}`);
assert(diffOffsets.length > 0, 'the two claims actually do differ somewhere');

console.log('\n[3] Indices and amount accept the full documented ranges without corrupting each other');
const maxIdx = encodeFaucetInstructionData(65535, 65534, 10000n);
const maxDecoded = decode(maxIdx);
assert(maxDecoded.stateIdx === 65535, 'max uint16 stateIdx encodes correctly');
assert(maxDecoded.recipientIdx === 65534, 'max uint16 recipientIdx encodes correctly');
assert(maxDecoded.amount === 10000n, 'amount at the documented 10,000 cap encodes correctly');
assert(maxDecoded.tag === 1, "high account indices don't bleed into the tag field");

console.log('\n[4] formatThru converts base units to human-scale THRU correctly');
assert(formatThru(0n) === '0', 'zero formats as "0"');
assert(formatThru(UNITS_PER_THRU) === '1', 'exactly 1e9 units formats as "1", no trailing decimal');
assert(formatThru(1_500_000_000n) === '1.5', '1.5e9 units formats as "1.5"');
assert(formatThru(1n) === '0.000000001', 'the smallest unit formats with full precision');
assert(formatThru(123_456_789_000n) === '123.456789', 'trailing zeros in the fractional part are trimmed');

console.log('\n[5] Transfer instruction encoding uses tag 1 (EOA transfer) and matches verified layout');
const transferEncoded = encodeTransferInstructionData(0, 2, 500n);
const transferView = new DataView(transferEncoded.buffer);
assert(transferView.getUint32(0, true) === 1, 'transfer tag is 1');
assert(transferView.getBigUint64(4, true) === 500n, 'transfer amount is at offset 4');
assert(transferView.getUint16(12, true) === 0, 'source account index is at offset 12');
assert(transferView.getUint16(14, true) === 2, 'dest account index is at offset 14');
assert(transferEncoded.length === 16, 'transfer instruction data is also exactly 16 bytes');

console.log('\n[6] decodeHistoryEntry resolves a real transfer Transaction back into sender/recipient/amount');
const alice = await keys.generateKeyPair();
const bob = await keys.generateKeyPair();

// Don't assume which order the constructor stores readWriteAccounts in (sorted or as-given) --
// determine it empirically from a real instance, the same way decodeHistoryEntry has to, since
// production code (sendTransfer/claimFaucet) never hardcodes this either; it always asks the
// SDK's own getAccountIndex.
function accountIndex(tx, address) {
  const all = [tx.feePayer, tx.program, ...tx.readWriteAccounts, ...tx.readOnlyAccounts];
  return all.findIndex((p) => p.toThruFmt() === address);
}
const probe = new Transaction({
  feePayer: alice.publicKey,
  program: TRANSFER_PROGRAM_ID,
  header: { fee: 1n, nonce: 0n, startSlot: 0n },
  accounts: { readWriteAccounts: [alice.publicKey, bob.publicKey] },
});
const aliceIdx = accountIndex(probe, alice.address);
const bobIdx = accountIndex(probe, bob.address);
assert(aliceIdx >= 0 && bobIdx >= 0 && aliceIdx !== bobIdx, 'both accounts resolve to distinct indices in the real account ordering');

const transferTx = new Transaction({
  feePayer: alice.publicKey,
  program: TRANSFER_PROGRAM_ID,
  header: { fee: 1n, nonce: 0n, startSlot: 0n },
  accounts: { readWriteAccounts: [alice.publicKey, bob.publicKey] },
  instructionData: encodeTransferInstructionData(aliceIdx, bobIdx, 250n),
});
transferTx.setSignature(Signature.from(new Uint8Array(64)));
transferTx.executionResult = { vmError: 0 };
const decodedFromAlice = decodeHistoryEntry(transferTx, alice.address);
assert(decodedFromAlice.kind === 'sent', 'from the sender\'s point of view, kind is "sent"');
assert(decodedFromAlice.amount === 250n, 'decoded amount matches what was encoded');
assert(decodedFromAlice.counterparty === bob.address, 'counterparty resolves to the actual recipient address, not a raw index');
assert(decodedFromAlice.success === true, 'vmError 0 decodes as success');

const decodedFromBob = decodeHistoryEntry(transferTx, bob.address);
assert(decodedFromBob.kind === 'received', 'the same transaction, viewed by the recipient, decodes as "received"');
assert(decodedFromBob.counterparty === alice.address, "recipient's view resolves the counterparty back to the sender");

console.log('\n[7] decodeHistoryEntry marks a reverted transaction as unsuccessful, and leaves unrelated programs undecoded');
const revertedTx = new Transaction({
  feePayer: alice.publicKey,
  program: TRANSFER_PROGRAM_ID,
  header: { fee: 1n, nonce: 1n, startSlot: 0n },
  accounts: { readWriteAccounts: [alice.publicKey, bob.publicKey] },
  instructionData: encodeTransferInstructionData(aliceIdx, bobIdx, 999n),
});
revertedTx.executionResult = { vmError: 42 };
assert(decodeHistoryEntry(revertedTx, alice.address).success === false, 'non-zero vmError decodes as success: false');

const otherProgramTx = new Transaction({
  feePayer: alice.publicKey,
  program: bob.publicKey, // some unrelated program, not transfer or faucet
  header: { fee: 1n, nonce: 2n, startSlot: 0n },
  instructionData: new Uint8Array(16),
});
const decodedOther = decodeHistoryEntry(otherProgramTx, alice.address);
assert(decodedOther.kind === 'other', "a call to a program that isn't the known transfer/faucet address stays undecoded");
assert(decodedOther.amount === null, 'no amount is inferred for an unrelated program');

console.log('\n[8] parseThruAmount converts human THRU amounts to exact raw units without floating-point rounding errors');
assert(parseThruAmount('1') === UNITS_PER_THRU, '"1" parses to exactly 1e9 units');
assert(parseThruAmount('1.5') === 1_500_000_000n, '"1.5" parses to 1,500,000,000 units');
assert(parseThruAmount('0.000000001') === 1n, 'the smallest representable amount parses to exactly 1 unit');
assert(parseThruAmount(formatThru(123_456_789_123n)) === 123_456_789_123n, 'formatThru -> parseThruAmount round-trips exactly for an arbitrary amount');
// 0.1 + 0.2 = 0.30000000000000004 in IEEE754 double math -- the classic floating-point trap
// this function is deliberately avoiding by never multiplying a float by 1e9.
assert(parseThruAmount('0.29') === 290_000_000n, 'string-based parsing gets 0.29 exactly right regardless of what float multiplication would do');
let rejected = false;
try {
  parseThruAmount('12.3456789012'); // 10 decimal places, one more than THRU supports
} catch {
  rejected = true;
}
assert(rejected, 'more than 9 decimal places is rejected rather than silently truncated');

console.log('\n[9] isValidThruAddress uses the SDK\'s real parser, catching a bad checksum rather than just checking length/prefix');
const realAddr = (await keys.generateKeyPair()).address;
assert(isValidThruAddress(realAddr) === true, 'a real generated address validates');
assert(isValidThruAddress('not-an-address') === false, 'obvious garbage is rejected');
assert(isValidThruAddress('') === false, 'empty string is rejected');
const tamperedAddr = realAddr.slice(0, -1) + (realAddr.at(-1) === 'a' ? 'b' : 'a');
assert(isValidThruAddress(tamperedAddr) === false, 'flipping the last character breaks the checksum and is correctly rejected');

console.log('\n[10] Mint seed generator follows the SDK contract, and mint/token-account derivation matches golden vectors');
import {
  generateMintSeed,
  deriveTokenMintAddress,
  deriveTokenAccountAddress,
  TOKEN_PROGRAM_ID,
} from './src/lib/thru-client.js';
import { Pubkey } from '@thru/sdk';

  const mockSeed = generateMintSeed();
  // This previously asserted 32 characters, which ENCODED THE BUG: generateMintSeed produced 32
  // base-62 characters, while @thru/programs/token deriveMintAddress does hexToBytes(seed) and
  // throws "Seed must be 32 bytes (64 hex characters)". The test was protecting the wrong
  // behaviour, so a real mint seed was never generated. Corrected to the SDK's actual contract.
  assert(mockSeed.length === 64, 'generateMintSeed produces 64 characters (32 bytes)');
  assert(/^[0-9a-f]{64}$/.test(mockSeed), 'generateMintSeed produces lowercase hex, as hexToBytes requires');
  assert(generateMintSeed() !== mockSeed, 'generateMintSeed is random, not fixed');

// The hand-rolled INITIALIZE_MINT encoder that used to live here was deleted with contract v8:
// it predated the official @thru/programs/token binding and its layout cannot have matched the
// real program (no ticker slot, no creator, no freeze authority, all of which the on-chain
// TokenMintAccount layout carries). deployTokenMint now delegates to
// createInitializeMintInstruction. What THE WALLET still owns is derivation plumbing, so that
// is what gets pinned to golden vectors — the same discipline test-derivation applies to keys.
{
  // 32 bytes of 0x11, from Pubkey(new Uint8Array(32).fill(17)) — fixed, not generated.
  const GOLDEN_AUTHORITY = 'taEREREREREREREREREREREREREREREREREREREREREREg';
  const GOLDEN_SEED = 'abababababababababababababababababababababababababababababababab';
  const GOLDEN_MINT = 'tawqbPfCF69Kyo2hdPTIfoz5Safk--tIB3g2q0Z9dZFUBR';
  const GOLDEN_TOKEN_ACCOUNT = 'taz4AOOlJBtn8IzaX97sKpL9_leQlC0HHg6EuAnw6U3cmh';

  // Sanity: the fixture authority really is the 0x11-filled key, so the vectors below can
  // never silently flip to "whatever the generator produced this run".
  assert(
    Pubkey.from(GOLDEN_AUTHORITY).toBytes().every((b) => b === 17),
    'golden authority is the fixed 0x11-filled key',
  );

  const mint = await deriveTokenMintAddress(GOLDEN_SEED, GOLDEN_AUTHORITY);
  assert(mint === GOLDEN_MINT, `mint derivation is stable: ${mint}`);

  const tokenAccount = await deriveTokenAccountAddress(GOLDEN_AUTHORITY, GOLDEN_MINT);
  assert(tokenAccount === GOLDEN_TOKEN_ACCOUNT, `token account derivation is stable: ${tokenAccount}`);

  let noAuthorityThrew = false;
  try { await deriveTokenMintAddress(GOLDEN_SEED); } catch { noAuthorityThrew = true; }
  assert(noAuthorityThrew, 'mint derivation refuses to proceed without the mint authority');
}

console.log('\n[11] Every program address in every network config is SDK-parseable');
// networks.js shipped a faucetStateAccount that was 43 characters and REJECTED by Pubkey.from.
// It went unnoticed because thru-client.js carried its own valid copy and ignored the config
// entirely — so the bad value was only reachable once program ids started coming from the
// network config. Validating every address in every declared network closes that off.
{
  const { listAllNetworks } = await import('./src/lib/networks.js');
  const { Pubkey } = await import('@thru/sdk');

  const ADDRESS_FIELDS = ['faucetProgramId', 'faucetStateAccount', 'transferProgramId', 'tokenProgramId'];
  const all = listAllNetworks();
  let checked = 0;

  for (const network of all) {
    for (const field of ADDRESS_FIELDS) {
      const value = network[field];
      // null is legitimate: a network without a faucet declares neither faucet field.
      if (value == null) continue;
      let valid = true;
      try {
        Pubkey.from(value);
      } catch {
        valid = false;
      }
      assert(valid, `${network.id}.${field} is a valid Thru address (len=${String(value).length})`);
      checked += 1;
    }

    // A faucet needs BOTH fields or neither; one alone would fail at call time.
    assert(
      Boolean(network.faucetProgramId) === Boolean(network.faucetStateAccount),
      `${network.id} declares both faucet fields or neither`,
    );
    assert(
      /^https?:\/\/\S+$/.test(String(network.rpcUrl || '')),
      `${network.id}.rpcUrl is a valid http(s) URL`,
    );
  }
  assert(checked > 0, `validated ${checked} program addresses across ${all.length} networks`);
}

console.log('\n[12] configureNetwork actually rebinds the client');
// The regression this guards: thru-client memoized one client against a hardcoded alphanet URL,
// so switching network changed the badge and the scoped storage while every RPC call still went
// to alphanet. Network switching was cosmetic.
{
  const client = await import('./src/lib/thru-client.js');
  const { getNetworkConfig } = await import('./src/lib/networks.js');

  assert(
    client.getConfiguredNetwork().rpcUrl === client.ALPHANET_RPC,
    'defaults to alphanet before any configuration',
  );

  const local = getNetworkConfig('localnet');
  const bound = client.configureNetwork(local);
  assert(bound.rpcUrl === local.rpcUrl, 'configureNetwork adopts the new RPC URL');
  assert(client.getConfiguredNetwork().id === 'localnet', 'the configured network is reported back');
  assert(
    client.getConfiguredNetwork().transferProgramId === local.transferProgramId,
    'program addresses come from the configured network',
  );

  // The UI-facing shape sends faucetMaxPerClaim as a string, since JSON cannot carry BigInt.
  const fromWire = client.configureNetwork({ ...local, faucetMaxPerClaim: '5000' });
  assert(fromWire.faucetMaxPerClaim === 5000n, 'a string cap is widened back to BigInt');

  // Restore, so anything importing later sees the default.
  client.configureNetwork(getNetworkConfig('alphanet'));
  assert(client.getConfiguredNetwork().id === 'alphanet', 'rebinding back to alphanet works');
}

console.log('\n[13] Token transfer wire format: ONE-byte tag, golden bytes pinned against the official binding');
// The token program's ABI uses a uint8 instruction discriminant, NOT the 4-byte tag of the
// faucet/transfer encoders — discovered by measuring @thru/programs 0.3.16 output, not assumed
// symmetric with the native layout. These goldens fail loudly if an SDK upgrade ever drifts
// the wire format decodeHistoryEntry (next section) depends on.
{
  const { createTransferInstruction, buildTokenInstructionBytes, MintToInstructionBuilder, bytesToHex } = await import('@thru/programs/token');

  const transferBytes = await createTransferInstruction({
    sourceAccountBytes: new Uint8Array(32).fill(1),
    destinationAccountBytes: new Uint8Array(32).fill(2),
    amount: 123456789n,
  })({
    getAccountIndex(bytes) {
      if (bytes[0] === 1) return 5;
      if (bytes[0] === 2) return 7;
      throw new Error('unknown account in test context');
    },
  });
  assert(transferBytes.length === 13, 'token transfer instruction is exactly 13 bytes');
  assert(
    bytesToHex(transferBytes) === '020500070015cd5b0700000000',
    'transfer golden: [tag 02][src 05 00][dst 07 00][amount u64 LE = 123456789]',
    bytesToHex(transferBytes),
  );

  const mintToBytes = buildTokenInstructionBytes('mint_to',
    new MintToInstructionBuilder()
      .set_mint_account_index(2).set_dest_account_index(3).set_authority_account_index(0)
      .set_amount(5000000n)
      .build());
  assert(mintToBytes.length === 15, 'mint_to instruction is exactly 15 bytes');
  assert(
    bytesToHex(mintToBytes) === '03020003000000404b4c0000000000',
    'mint_to golden: [tag 03][mint 02 00][dst 03 00][auth 00 00][amount u64 LE = 5000000]',
    bytesToHex(mintToBytes),
  );
}

console.log('\n[14] decodeHistoryEntry resolves token-program entries: transfer, mint_to, and account init');
{
  const { createTransferInstruction } = await import('@thru/programs/token');

  // -- transfer: two program-derived token accounts, decoded back to addresses + amount --
  const srcToken = await keys.generateKeyPair();
  const dstToken = await keys.generateKeyPair();
  const tokenTx = new Transaction({
    feePayer: alice.publicKey,
    program: TOKEN_PROGRAM_ID,
    header: { fee: 1n, nonce: 7n, startSlot: 0n },
    accounts: { readWriteAccounts: [srcToken.publicKey, dstToken.publicKey] },
  });
  const srcIdx = accountIndex(tokenTx, srcToken.address);
  const dstIdx = accountIndex(tokenTx, dstToken.address);
  assert(srcIdx >= 0 && dstIdx >= 0 && srcIdx !== dstIdx, 'token accounts resolve to distinct indices');
  tokenTx.instructionData = await createTransferInstruction({
    sourceAccountBytes: Pubkey.from(srcToken.publicKey).toBytes(),
    destinationAccountBytes: Pubkey.from(dstToken.publicKey).toBytes(),
    amount: 123456789n,
  })({
    getAccountIndex(bytes) {
      const hex = Array.from(bytes.slice(0, 4)).join(',');
      if (hex === Array.from(Pubkey.from(srcToken.publicKey).toBytes().slice(0, 4)).join(',')) return srcIdx;
      if (hex === Array.from(Pubkey.from(dstToken.publicKey).toBytes().slice(0, 4)).join(',')) return dstIdx;
      throw new Error('unknown account in token transfer context');
    },
  });
  const tokenDecoded = decodeHistoryEntry(tokenTx, alice.address);
  assert(tokenDecoded.kind === 'token-transfer', 'a token-program tag-2 entry decodes as token-transfer');
  assert(tokenDecoded.amount === 123456789n, 'token transfer amount round-trips');
  assert(tokenDecoded.tokenSource === srcToken.address, 'source token account resolves to its address');
  assert(tokenDecoded.tokenDest === dstToken.address, 'destination token account resolves to its address');

  // -- mint_to: golden 15 bytes, mint and destination resolved by index --
  const mintKey = await keys.generateKeyPair();
  const mintTx = new Transaction({
    feePayer: alice.publicKey,
    program: TOKEN_PROGRAM_ID,
    header: { fee: 1n, nonce: 8n, startSlot: 0n },
    accounts: { readWriteAccounts: [dstToken.publicKey], readOnlyAccounts: [mintKey.publicKey] },
  });
  const mintIdxResolved = accountIndex(mintTx, mintKey.address);
  const dstIdxResolved = accountIndex(mintTx, dstToken.address);
  const authIdxResolved = accountIndex(mintTx, alice.address);
  const mintToWire = new Uint8Array(15);
  {
    const v = new DataView(mintToWire.buffer);
    mintToWire[0] = 3; // tag
    v.setUint16(1, mintIdxResolved, true);
    v.setUint16(3, dstIdxResolved, true);
    v.setUint16(5, authIdxResolved, true);
    v.setBigUint64(7, 5000000n, true);
  }
  mintTx.instructionData = mintToWire;
  const mintDecoded = decodeHistoryEntry(mintTx, alice.address);
  assert(mintDecoded.kind === 'token-mint', 'a token-program tag-3 entry decodes as token-mint');
  assert(mintDecoded.amount === 5000000n, 'mint_to amount round-trips');
  assert(mintDecoded.tokenMint === mintKey.address, 'mint address resolves by index');
  assert(mintDecoded.tokenDest === dstToken.address, 'mint destination resolves by index');

  // -- initialize_account: hand-crafted 39-byte wire, mint + owner visible without a proof parse --
  const owner = await keys.generateKeyPair();
  const newTokenAcct = await keys.generateKeyPair();
  const initTx = new Transaction({
    feePayer: alice.publicKey,
    program: TOKEN_PROGRAM_ID,
    header: { fee: 1n, nonce: 9n, startSlot: 0n },
    accounts: { readWriteAccounts: [newTokenAcct.publicKey], readOnlyAccounts: [mintKey.publicKey, owner.publicKey] },
  });
  const initWire = new Uint8Array(39);
  {
    const v = new DataView(initWire.buffer);
    initWire[0] = 1; // tag
    v.setUint16(1, accountIndex(initTx, newTokenAcct.address), true); // token account
    v.setUint16(3, accountIndex(initTx, mintKey.address), true); // mint
    v.setUint16(5, accountIndex(initTx, owner.address), true); // owner
    // remaining 32 bytes: the default all-zero derivation seed
  }
  initTx.instructionData = initWire;
  const initDecoded = decodeHistoryEntry(initTx, owner.address);
  assert(initDecoded.kind === 'token-account-init', 'a token-program tag-1 entry decodes as token-account-init');
  assert(initDecoded.tokenMint === mintKey.address, 'init exposes the mint even for someone else\'s account');
  assert(initDecoded.tokenDest === newTokenAcct.address, 'init exposes the account being created');
  assert(initDecoded.counterparty === owner.address, 'init exposes the new account\'s owner');
  assert(initDecoded.amount === null, 'init carries no amount');

  // -- negatives: wrong program id, unknown tag, truncated data must stay undecoded --
  const wrongProgram = new Transaction({
    feePayer: alice.publicKey,
    program: TRANSFER_PROGRAM_ID,
    header: { fee: 1n, nonce: 10n, startSlot: 0n },
    accounts: { readWriteAccounts: [srcToken.publicKey, dstToken.publicKey] },
    instructionData: tokenTx.instructionData,
  });
  assert(decodeHistoryEntry(wrongProgram, alice.address).kind === 'other',
    'token-shaped bytes under the native program are NOT decoded as token ops');

  const junkTx = new Transaction({
    feePayer: alice.publicKey,
    program: TOKEN_PROGRAM_ID,
    header: { fee: 1n, nonce: 11n, startSlot: 0n },
    instructionData: new Uint8Array([99, 1, 2, 3, 4]),
  });
  const junk = decodeHistoryEntry(junkTx, alice.address);
  assert(junk.kind === 'other' && junk.amount === null, 'unknown token tags stay undecoded');
}

console.log('\n[15] formatTokenAmount / parseTokenAmount convert exactly at any decimal scale');
{
  const { formatTokenAmount, parseTokenAmount } = await import('./src/shared/format.js');

  assert(formatTokenAmount(123456789n, 6) === '123.456789', '123456789 @6 -> 123.456789');
  assert(formatTokenAmount(1500000000n, 9) === '1.5', '1.5e9 @9 -> 1.5 (native scale matches formatThru)');
  assert(formatTokenAmount(1000000n, 6) === '1', 'trailing zeros are trimmed');
  assert(formatTokenAmount(5n, 0) === '5', 'a 0-decimal mint formats whole units');
  assert(formatTokenAmount(0n, 8) === '0', 'zero formats as "0" at any scale');

  assert(parseTokenAmount('123.456789', 6) === 123456789n, 'parse @6 round-trips');
  assert(parseTokenAmount('1.5', 9) === 1500000000n, 'parse @9 matches parseThruAmount scale');
  assert(parseTokenAmount('250', 6) === 250000000n, 'whole amounts scale up');
  assert(parseTokenAmount('7', 0) === 7n, '0-decimal amounts pass through');

  const rejects = [
    ['0', 6, 'zero'],
    ['-1', 6, 'negative'],
    ['abc', 6, 'non-numeric'],
    ['1.0000001', 6, 'more precision than the mint allows'],
    ['0.5', 0, 'any fraction at 0 decimals'],
    ['', 6, 'empty'],
  ];
  for (const [input, decimals, why] of rejects) {
    let threw = false;
    try { parseTokenAmount(input, decimals); } catch { threw = true; }
    assert(threw, `parseTokenAmount rejects ${why}`);
  }
}

// ---------------------------------------------------------------------------
// getTransactionDetail (P2, additive to the sacred client)
//
// The network call itself cannot run here (no RPC in the test environment), so what is
// tested is the part that can be wrong WITHOUT a network: the promise this function makes
// about which fields exist and what they mean. A regression that renamed feeDeclaredUnits
// to feeUnits, or that let a missing block time become 0 or Date.now(), would be a fabricated
// value in a wallet — the exact failure this whole design exists to prevent.
{
  console.log('\n[11] getTransactionDetail is additive and names the fee honestly');

  const { getTransactionDetail } = await import('./src/lib/thru-client.js');

  assert(typeof getTransactionDetail === 'function',
    'getTransactionDetail is exported (additive: no existing export changed)');

  let threw = null;
  try { await getTransactionDetail('', 'ta1whoever'); } catch (e) { threw = e; }
  assert(threw instanceof Error, 'an empty signature is refused before any network access');

  // The source is the contract here: these strings are what stop a future edit from
  // quietly turning a header declaration into a claim about what the user was charged.
  const { readFileSync } = await import('node:fs');
  const source = readFileSync('./src/lib/thru-client.js', 'utf8');
  // Bound the slice to THIS function. Reading to end-of-file would drag in every later
  // function's Date.now() and turn a real check into one that can never pass.
  const fnStart = source.indexOf('export async function getTransactionDetail');
  assert(fnStart > 0, 'getTransactionDetail is present in the client source');
  const after = source.indexOf('\nexport ', fnStart + 1);
  const fn = source.slice(fnStart, after > 0 ? after : source.length);

  assert(/entry\.feeDeclaredUnits\s*=/.test(fn),
    'the fee is surfaced as feeDeclaredUnits, not feeUnits');
  assert(!/entry\.feeUnits\s*=/.test(fn),
    'no bare feeUnits field is emitted that a caller could read as an amount charged');
  assert(/entry\.blockTimeMs = null;/.test(fn),
    'blockTimeMs starts null, so an unavailable block time stays unavailable');
  assert(!/Date\.now\(\)/.test(fn),
    'the detail path never substitutes the local clock for a chain timestamp');
  assert(/block\.blockTimeNs > 0n/.test(fn),
    'a zero blockTimeNs is treated as unknown rather than as the epoch');
  assert(/decodeHistoryEntry\(tx, viewerAddress\)/.test(fn),
    'the detail reuses the existing decoder, so it cannot disagree with the list view');
}

console.log('\nAll thru-client.js encoding checks passed.');

