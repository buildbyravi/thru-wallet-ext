#!/usr/bin/env node
// The review card, rendered and read back as text.
//
// `test-tx-review.mjs` asserts the CONTENT a decoder produces. This file asserts what the CARD
// does with it, because the v1.5.0 audit's findings were all about the rendered surface: six
// header badges before the amount, the same amount three times, two totals on a domain card, a
// platform caveat on every transaction, full 46-character addresses in the table, "Decoded" next
// to "(undecoded)", and repository paths in user-visible copy.
//
// It renders the real `TxReviewCard` into a small DOM shim (test/fixtures/dom-shim.mjs) and reads
// the text back. That proves copy, order, counts and wording. It cannot prove layout, wrapping or
// scrolling — no browser engine exists in this sandbox, and nothing here claims a browser pass.

import { installDom, textLines } from './fixtures/dom-shim.mjs';

installDom();

await import('../src/shared/tx-review/decoders/index.js');
const { decodeReview } = await import('../src/shared/tx-review/registry.js');
const { TxReviewCard } = await import('../src/ui/domain/tx-review/review-card.js');
const model = await import('../src/shared/tx-review/model.js');

let pass = 0;
let fail = 0;
function ok(cond, msg, detail = '') {
  if (cond) { pass += 1; console.log(`  ok - ${msg}`); } else {
    fail += 1;
    console.error(`  FAIL - ${msg}${detail ? `\n         ${detail}` : ''}`);
  }
}

const NETWORK = { id: 'betanet', label: 'Betanet', environment: 'testnet', isTestnet: true };
const ACCOUNT = { address: 'taAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEg', label: 'Main account' };
const RECIPIENT = 'ta3vGKMRuvOar_THzkfdEMsYx9Hxm1pU1fT_N3hhCGzLiN';
const THRU_PROGRAM = 'taThruTransferProgramAddress11111111111111111';
const MINT = 'taMintAccountAddressForTheToken11111111111111111';

const reviewFor = (kind, facts) => ({
  reviewId: 'betanet_r_card', kind, networkId: 'betanet', accountAddress: ACCOUNT.address,
  bindingHash: 'binding', state: 'ready', preparedAt: Date.now(), expiresAt: Date.now() + 120_000,
  submitPolicy: { method: 'tx.sendChecked', auth: 'signing', passwordRequired: false },
  simulation: { status: 'unavailable', reason: '', provenance: 'tx.simulate' },
  network: NETWORK,
  account: ACCOUNT,
  ...(() => {
    const content = decodeReview(kind, { network: NETWORK, account: ACCOUNT, facts });
    // The background computes `state` from the warnings; the card only reads it. Reproduce that
    // here rather than hard-coding "ready", or a blocked card would look confirmable in the test.
    return { ...content, state: model.stateFromWarnings(content.warnings) };
  })(),
});

/** Everything a user can read without tapping: hidden subtrees are excluded. */
function visibleLines(node, out = []) {
  if (node.classList?.contains('hidden')) return out;
  if (node._text != null && node._text.trim() !== '') out.push(node._text.trim());
  for (const child of node.childNodes || []) visibleLines(child, out);
  return out;
}

const card = (kind, facts) => TxReviewCard({ review: reviewFor(kind, facts) });
const once = (lines, text) => lines.filter((line) => line === text).length;

const sendFacts = {
  fromAddress: ACCOUNT.address,
  fromLabel: 'Main account',
  toAddress: RECIPIENT,
  recipientLabel: null,
  amountUnits: '1500000',
  recipient: { exists: true },
  balanceUnits: '50000000',
  fee: { supported: true, feeUnits: '1000', reserveUnits: '0', source: 'measured' },
  duplicate: null,
  transferProgramId: THRU_PROGRAM,
};

console.log('[1] a decoded send: title, context, counterparty, then three money rows');
{
  const lines = visibleLines(card('native-send', sendFacts).el);
  ok(lines[0] === 'Send 0.0015 THRU', 'the title is the verb and the amount', lines[0]);
  ok(lines[1] === 'Betanet', 'the network badge displays the active network in a box', lines[1]);
  ok(lines[2] === 'From Main account · Betanet test network',
    'the context line names the SENDING account and network', lines[2]);
  ok(!lines.some((line) => /^(Testnet|Decoded|Verified program)$/.test(line)),
    'no Testnet / Decoded / Verified-program badges');
  // Owner decision (2026-10-30): the recipient is named AND shown in full on the open card.
  // A label alone cannot be checked against the other wallet, so the address is not hidden
  // behind a tap any more.
  ok(lines.includes('To') || lines.some((line) => line.startsWith('To ')),
    'the counterparty gets its own line');
  ok(lines.includes(RECIPIENT), 'the whole recipient address is on the open card', JSON.stringify(lines));
  ok(!lines.includes('Transaction'), 'the word "Transaction" is not a heading');
  ok(!lines.some((line) => line === 'From'), 'no From row repeating the signing account');
  ok(lines.includes('You pay') && lines.includes('Network fee') && lines.includes('Total'),
    'money rows are You pay / Network fee / Total');
  ok(once(lines, 'Total') === 1, 'exactly one total', `${once(lines, 'Total')}`);
  ok(lines.includes('about 0.000001 THRU'), 'the fee is hedged with "about"', JSON.stringify(lines));
  ok(!lines.some((line) => /estimated/i.test(line)), 'no "(estimated)" suffix');
  ok(!lines.includes('You receive'), 'an outgoing-only send shows no incoming row');
  // The amount appears in the title and in "You pay"; a third copy is the defect.
  ok(once(lines, '−0.0015 THRU') === 1, 'the outgoing amount appears exactly once as an amount');
}

console.log('[1b] zero network fee omits the duplicate Total row');
{
  const zeroFeeCard = card('native-send', {
    ...sendFacts,
    fee: { ...sendFacts.fee, amountUnits: '0', feeUnits: '0' },
  });
  const lines = visibleLines(zeroFeeCard.el);
  ok(lines.includes('You pay') && lines.includes('Network fee'), 'has You pay and Network fee');
  ok(lines.includes('none'), 'fee row displays none');
  ok(!lines.includes('Total'), 'duplicate Total row is omitted when fee is zero', JSON.stringify(lines));
}

console.log('[2] the recipient address is evidence, so it is never shortened or hidden');
{
  const c = card('native-send', sendFacts);
  const visible = visibleLines(c.el);
  ok(visible.includes(RECIPIENT), 'the full address is printed on the open card');
  // A shortened stand-in next to the label was the previous shape; with the whole address
  // present it would be a second, weaker copy of the same fact.
  ok(!visible.some((line) => line.includes('…') && !line.startsWith('Send ')),
    'no ellipsised copy of the address sits beside it', JSON.stringify(visible));
  ok(c.el.querySelector('.tx-review-counterparty-main') === null,
    'there is no tap-to-reveal control, because nothing is hidden');
  // A label is the headline when the wallet has one; without it the line still reads "To".
  const named = card('native-send', { ...sendFacts, recipientLabel: 'Account 5' });
  ok(visibleLines(named.el).includes('To Account 5'),
    'a known recipient is named above the address', JSON.stringify(visibleLines(named.el)));
}

console.log('[2b] Details states each address once');
{
  // Owner review (2026-10-30): the expanded panel had become a wall of repeated addresses —
  // the instruction's Source and Destination rows printed the signer and the recipient that
  // the card already shows. Each address belongs on the card once.
  const c = card('native-send', sendFacts);
  const toggle = [...c.el.querySelectorAll('button')].find((b) => /details/i.test(b.textContent));
  toggle.click();
  const text = c.el.textContent;
  const count = (needle) => text.split(needle).length - 1;
  ok(count(RECIPIENT) === 1, 'the recipient address is printed once, not also as a Source/Destination row',
    `${count(RECIPIENT)} occurrences`);
  ok(count(ACCOUNT.address) === 1, 'the signing address is printed once',
    `${count(ACCOUNT.address)} occurrences`);
  ok(text.includes('From · Main account'), 'the signing row names the account as well as the address');
  ok(!/\bSource\b|\bDestination\b/.test(text), 'no instruction-account rows repeat them');
}

console.log('[3] a token send: the fee is named in the right currency');
{
  const lines = visibleLines(card('token-transfer', {
    fromAddress: ACCOUNT.address,
    toAddress: RECIPIENT,
    amountUnits: '25000000000',
    symbol: 'LAB',
    decimals: 9,
    name: 'Lab token',
    mintAddress: MINT,
    metadataVerified: true,
    recipient: { exists: true },
    sourceTokenAccount: { address: 'taSourceTokenAccount11111111111111111111111111', exists: true },
    recipientTokenAccount: { address: 'taDestTokenAccount11111111111111111111111111111', exists: true },
    balanceUnits: '90000000000',
    fee: { supported: false, reason: 'No fee measurement exists for token transfers.' },
    duplicate: null,
    tokenProgramId: 'taTokenProgram1111111111111111111111111111111',
  }).el);
  ok(lines[0] === 'Send 25 LAB', 'the title carries the token amount', lines[0]);
  ok(lines.includes('You pay') && lines.includes('−25 LAB'), 'the exact token amount leaves');
  ok(lines.includes('not confirmed (paid in THRU)'),
    'an unmeasured token fee says which currency it is paid in', JSON.stringify(lines));
  ok(!lines.includes('Total'), 'no total is invented from a fee that was never quoted');
}

console.log('[4] a faucet claim: what arrives, and the rate limit');
{
  const lines = visibleLines(card('faucet-claim', {
    fromAddress: ACCOUNT.address,
    fromLabel: 'Main account',
    amountUnits: '500000000',
    capUnits: '500000000',
    fee: { supported: true, feeUnits: '1000', reserveUnits: '0', source: 'measured' },
    programAddress: 'taFaucetProgram111111111111111111111111111111',
    networkLabel: 'Betanet',
    accountExists: true,
    limit: { supported: true, remainingAmount: '500000000', rule: { windowLabel: '24h' } },
  }).el);
  ok(lines[0] === 'Claim 0.5 THRU from the faucet', 'the title says what arrives', lines[0]);
  ok(lines.includes('You receive') && lines.includes('+0.5 THRU'), 'the incoming amount is signed');
  ok(!lines.includes('You pay'), 'a faucet claim has nothing to pay');
}

console.log('[5] domain cards: no invented price, one total at most');
{
  const register = visibleLines(card('domain-register', {
    fromAddress: ACCOUNT.address,
    name: 'vault',
    tld: 'thru',
    years: 2,
    pricePerYear: '1000',
    totalPriceUnits: '2000',
    configAddress: 'taRegistrarConfig111111111111111111111111111111',
    treasury: 'taTreasury11111111111111111111111111111111111',
    nativeBalanceUnits: '5000000',
    availability: { state: 'available' },
    feeReserveUnits: '0',
    instruction: { name: 'Register domain', opcode: 7 },
    program: { name: 'Thru custom registrar', address: 'taRegistrarProgram1111111111111111111111111111', verified: true },
  }).el);
  ok(register[0] === 'Register vault.thru for 2 years', 'the title carries the name and duration', register[0]);
  // The deployed registrar declares a price but does not enforce collection, so the card says
  // exactly that — it does not call the registration free, because a price is declared.
  ok(register.some((line) => /Registrar fee is not enforced on-chain/.test(line)),
    'the card states the fee rule in one sentence',
    JSON.stringify(register));
  ok(!register.some((line) => /^(Total charge|Total price|Price per year)$/.test(line)),
    'no registrar price and no second total');
  ok(register.includes('Network fee') && register.includes('none'),
    'the only money row is the network fee, and it is declared zero');
  ok(!register.some((line) => /best-effort|base units|declared/i.test(line)),
    'no "best-effort" / "base units" / "declared" in the card', JSON.stringify(register));
}

console.log('[6] an unrecognised transaction is explicit, and cannot be signed');
{
  const c = TxReviewCard({
    review: {
      ...reviewFor('raw', { programAddress: 'taUnknownProgram1111111111111111111111111111111', dataHex: 'deadbeef' }),
      submitPolicy: null,
    },
  });
  const lines = visibleLines(c.el);
  ok(lines[0] === 'Unrecognised transaction', 'the title says it is unrecognised', lines[0]);
  // The copy states the wallet's LIMIT, never a condition under which a user may approve an
  // unknown transaction anyway. "Only sign if you started it yourself" reads as permission.
  ok(lines.some((line) => /cannot explain this transaction/.test(line)),
    'the card says it cannot explain the transaction');
  ok(lines.some((line) => /Signing is unavailable/.test(line)),
    'the blocking warning states that signing is unavailable, not when it is acceptable');
  ok(!lines.some((line) => /you started it|approve it unless/i.test(line)),
    'no line invites a user to approve an unknown transaction');
  // One card, one statement: the operation summary states the limit, the blocking warning states
  // the consequence. The same sentence twice reads as shouting, not as emphasis.
  ok(new Set(lines.filter((line) => /cannot explain this transaction|Signing is unavailable/.test(line))).size === 2
    && lines.filter((line) => /cannot explain this transaction/.test(line)).length === 1,
    'the limit and the consequence are each stated once, not repeated');
  ok(!lines.includes('Total') && !lines.includes('You pay'), 'no money rows are invented');
  ok(c.canConfirm() === false, 'confirming is impossible');
}

console.log('[6b] a third blocking warning is never folded away');
{
  // The card caps ADVISORY notes at two. A blocking warning is the reason Confirm is disabled,
  // so it must stay readable without a disclosure. Regex on the source is not enough here —
  // this renders a review with three blocking warnings and counts what is actually visible.
  const base = reviewFor('raw', {
    programAddress: 'taUnknownProgram1111111111111111111111111111111',
    dataHex: 'deadbeef',
  });
  const blocked = {
    ...base,
    warnings: [
      { code: 'a', severity: 'danger', title: 'First blocker', detail: 'one', blocking: true },
      { code: 'b', severity: 'danger', title: 'Second blocker', detail: 'two', blocking: true },
      { code: 'c', severity: 'danger', title: 'Third blocker', detail: 'three', blocking: true },
      { code: 'd', severity: 'warning', title: 'Advisory one', detail: 'four' },
      { code: 'e', severity: 'warning', title: 'Advisory two', detail: 'five' },
      { code: 'f', severity: 'warning', title: 'Advisory three', detail: 'six' },
    ],
  };
  const c = TxReviewCard({ review: blocked });
  const lines = visibleLines(c.el);
  ok(['First blocker', 'Second blocker', 'Third blocker'].every((t) => lines.includes(t)),
    'every blocking warning is on the card',
    JSON.stringify(lines.slice(0, 12)));
  ok(lines.includes('Advisory one') && lines.includes('Advisory two'),
    'the first two advisories are on the card');
  ok(!lines.includes('Advisory three'),
    'a third advisory is the one that folds, never a blocker');
  ok(c.canConfirm() === false, 'and the review is still unconfirmable');
}

console.log('[7] the forbidden vocabulary, scanned over every rendered card');
{
  // The rule from the directive: no file path, file name, decision-record id, and none of the
  // internal words that made the old card read like a debug dump. Scanned over RENDERED text for
  // every kind, so a decoder that grows a new string is covered automatically.
  const FORBIDDEN = [
    /src\//, /docs\//, /DECISIONS/, /\.md\b/, /\.js\b/,
    /provenance/i, /\bdecoded\b/i, /undecoded/i, /\bEOA\b/, /instruction tag/i,
    /base units/i, /\breserve\b/i, /\bdeclared\b/i, /best-effort/i, /\bbinding\b/i,
  ];
  const cards = {
    'native-send': sendFacts,
    'domain-register': {
      fromAddress: ACCOUNT.address, name: 'vault', tld: 'thru', years: 1, pricePerYear: '1000',
      totalPriceUnits: '1000', nativeBalanceUnits: '5000000', availability: { state: 'available' },
      feeReserveUnits: '0', program: { name: 'Thru custom registrar', address: 'taReg', verified: true },
    },
    'faucet-claim': {
      fromAddress: ACCOUNT.address, amountUnits: '1000', programAddress: 'taFaucet',
      fee: { supported: true, feeUnits: '0' }, networkLabel: 'Betanet', accountExists: true,
    },
    raw: { programAddress: 'taUnknown', dataHex: '00' },
  };
  for (const [kind, facts] of Object.entries(cards)) {
    const text = visibleLines(card(kind, facts).el).join('\n');
    const hits = FORBIDDEN.filter((re) => re.test(text)).map(String);
    ok(hits.length === 0, `${kind}: no forbidden word or path reaches the user`, hits.join(' '));
  }
  // The same rule applied to the whole card including Details, minus the program address that
  // legitimately starts with "ta".
  const whole = card('native-send', sendFacts).el.textContent;
  ok(!/src\/|docs\/|DECISIONS/.test(whole), 'no repository path anywhere, including Details');
}

console.log('[8] the card stays short enough to read on one screen');
{
  // The budget is on visible top-level blocks, not on text length: title, context, counterparty,
  // one money table, warnings (max 2), and the Details toggle.
  for (const [kind, facts] of Object.entries({
    'native-send': sendFacts,
    'domain-register': {
      fromAddress: ACCOUNT.address, name: 'vault', tld: 'thru', years: 1, totalPriceUnits: '1000',
      nativeBalanceUnits: '5000000', availability: { state: 'available' }, feeReserveUnits: '0',
      program: { name: 'Thru custom registrar', address: 'taReg', verified: true },
    },
    'faucet-claim': {
      fromAddress: ACCOUNT.address, amountUnits: '1000', programAddress: 'taFaucet',
      fee: { supported: true, feeUnits: '0' }, networkLabel: 'Betanet', accountExists: true,
    },
  })) {
    const c = card(kind, facts);
    const blocks = c.el.children.filter((child) => !child.classList.contains('hidden'));
    ok(blocks.length <= 10, `${kind}: the open card has at most ten blocks`, `${blocks.length}`);
    const warnings = c.review.warnings;
    const shown = blocks.filter((block) => block.querySelector('.risk-copy') !== null).length;
    ok(shown <= 2, `${kind}: at most two warnings on the card`, `${shown} of ${warnings.length}`);
  }
}

console.log('[9] no disclaimer essays in Details');
{
  const c = card('native-send', sendFacts);
  const text = c.el.textContent;
  ok(!text.includes('This network cannot preview a transaction'),
    'balance-after disclaimer essay is removed from Details');
  ok(!text.includes('Transaction simulation requires a dry-run RPC'),
    'simulation disclaimer essay is removed from Details');
  ok(!text.includes('The amount, your account and the recipient are fixed'),
    'instruction disclaimer essay is removed from Details');
  ok(!text.includes('Set by the network. What was actually charged'),
    'fee disclaimer essay is removed from Details');
}

console.log(`\ncard render checks: ${pass} passed, ${fail} failed.`);
process.exit(fail === 0 ? 0 : 1);
