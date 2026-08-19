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

console.log('\n[10] INITIALIZE_MINT instruction encoding and seed generator work correctly');
import {
  encodeInitializeMintInstructionData,
  generateMintSeed,
  TOKEN_PROGRAM_ID,
} from './src/lib/thru-client.js';

  const mockSeed = generateMintSeed();
  // This previously asserted 32 characters, which ENCODED THE BUG: generateMintSeed produced 32
  // base-62 characters, while @thru/programs/token deriveMintAddress does hexToBytes(seed) and
  // throws "Seed must be 32 bytes (64 hex characters)". The test was protecting the wrong
  // behaviour, so a real mint seed was never generated. Corrected to the SDK's actual contract.
  assert(mockSeed.length === 64, 'generateMintSeed produces 64 characters (32 bytes)');
  assert(/^[0-9a-f]{64}$/.test(mockSeed), 'generateMintSeed produces lowercase hex, as hexToBytes requires');
  assert(generateMintSeed() !== mockSeed, 'generateMintSeed is random, not fixed');
const mockAuthority = (await keys.generateKeyPair()).publicKey;
const mockProof = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const initMintData = encodeInitializeMintInstructionData(2, mockSeed, mockProof.length, mockAuthority, 6, mockProof);

const mintView = new DataView(initMintData.buffer, initMintData.byteOffset, initMintData.byteLength);
assert(mintView.getUint32(0, true) === 0, 'tag is 0 (INITIALIZE_MINT)');
assert(mintView.getUint16(4, true) === 2, 'mint account index is 2');
assert(mintView.getUint32(38, true) === mockProof.length, 'proof size is encoded correctly at offset 38');
assert(initMintData[74] === 6, 'decimals is 6 at offset 74');
assert(initMintData.length === 75 + mockProof.length, 'total payload length includes header and proof data');

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

console.log('\nAll thru-client.js encoding checks passed.');

