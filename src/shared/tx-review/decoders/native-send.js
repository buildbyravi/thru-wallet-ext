// Native THRU transfer decoder.
//
// Facts (read by the background before this runs):
//   fromAddress, toAddress, recipientLabel, amountUnits,
//   recipient { exists: true|false|null }, balanceUnits|null,
//   fee { supported, feeUnits, reserveUnits, source, reason },
//   duplicate { isDuplicate, isPending, elapsedMs } | null, transferProgramId
//
// `recipient.exists === null` means the chain could not be read. That is NOT the same as
// `false` ("proven absent"), and the two produce different reviews: one warns that the
// recipient could not be checked, the other blocks signing because the chain will reject it.

import {
  displayAmount, movement, warn, acknowledgement, feeBlock, instruction, accountRole,
  executionBlock,
} from './common.js';

export const NATIVE_SEND_KIND = 'native-send';

export function decodeNativeSend({ facts }) {
  const warnings = [];
  // A pinned program id is what "verified" refers to. No id, no claim — and because the
  // signing builder needs that program, its absence is a proven blocker, not a cosmetic gap.
  const transferProgramId = facts.transferProgramId ?? null;
  if (!transferProgramId) {
    warnings.push(warn('program-unidentified', 'danger',
      'The transfer program is not pinned for this network',
      'The wallet has no verified program address for the active network, so it cannot say '
      + 'which program this transfer calls. Refusing to sign is the only safe answer.',
      { blocking: true }));
  }
  const acknowledgements = [];

  if (facts.selfSend) {
    warnings.push(warn('self-transfer', 'danger',
      'Sender and recipient are the same account',
      'This wallet refuses self-transfers. Edit the recipient before signing.', { blocking: true }));
  }

  if (facts.recipient?.exists === false) {
    warnings.push(warn('recipient-not-activated', 'danger',
      'Recipient is not activated on this network',
      'A Thru account must already exist on-chain before it can receive a transfer. The '
      + 'recipient has to activate it first; this wallet cannot do that for someone else, and '
      + 'the chain reverts the transfer.', { blocking: true }));
  } else if (facts.recipient?.exists == null) {
    warnings.push(warn('recipient-unverified', 'warning',
      'Recipient could not be verified',
      'The chain did not answer the recipient lookup. The wallet re-checks it before signing '
      + 'and refuses a recipient that does not exist.'));
  }

  if (facts.balanceUnits == null) {
    warnings.push(warn('balance-unknown', 'warning',
      'Balance could not be read',
      'The amount is not checked against a live balance here. The send path re-reads the '
      + 'balance and refuses an amount above it.'));
  } else if (BigInt(facts.balanceUnits) < BigInt(facts.amountUnits)) {
    warnings.push(warn('insufficient-balance', 'danger',
      'Amount is higher than the balance',
      'The account holds less than the amount plus the network fee, so the chain would reject '
      + 'this transfer.', { blocking: true }));
  }

  if (!facts.fee?.supported) {
    warnings.push(warn('fee-unmeasured', 'warning',
      'Network fee is not measured on this network',
      facts.fee?.reason || 'No fee measurement exists for this chain, so no number is shown.'));
  }

  if (facts.duplicate?.isDuplicate) {
    const when = facts.duplicate.isPending
      ? 'is still pending on-chain'
      : `was submitted ${facts.duplicate.elapsedMs ? Math.round(facts.duplicate.elapsedMs / 1000) : 'a few'}s ago`;
    warnings.push(warn('duplicate-transfer', 'warning',
      'Repeated transaction',
      `An identical transfer ${when}. Confirm only if you intend to send it twice.`));
    acknowledgements.push(acknowledgement('duplicate-transfer', 'I want to send this duplicate transfer anyway'));
  }

  return {
    operation: {
      id: NATIVE_SEND_KIND,
      // The title carries the verb and the amount (v1.5 card): it is the one line a user reads.
      name: `Send ${displayAmount(facts.amountUnits, 9, 'THRU')}`,
      summary: '',
      confirmLabel: 'Sign & send',
      decode: 'decoded',
    },
    protocol: {
      name: 'Thru transfer program',
      address: transferProgramId,
      verified: Boolean(transferProgramId),
    },
    // The recipient moved out of the table and onto their own line: a name when the wallet has
    // one, otherwise the shortened address (Details carries the whole one).
    counterparty: { address: facts.toAddress, ...(facts.recipientLabel ? { label: facts.recipientLabel } : {}) },
    // Money lives in `assets` only. The old table repeated the same amount three times
    // ("You pay", "Amount", "Total") — the owner's screenshots were right about that.
    summary: [],
    assets: {
      outgoing: [movement({
        symbol: 'THRU',
        name: 'Thru native token',
        decimals: 9,
        amountUnits: facts.amountUnits,
        verified: true,
      })],
      incoming: [],
      fee: feeBlock({
        supported: Boolean(facts.fee?.supported),
        amountUnits: facts.fee?.supported ? facts.fee.feeUnits : null,
        reserveUnits: facts.fee?.supported ? facts.fee.reserveUnits : null,
        source: facts.fee?.supported ? (facts.fee.source ?? 'unknown') : null,
        note: facts.fee?.supported
          ? 'Set by the network. What was actually charged appears in Activity after confirmation.'
          : (facts.fee?.reason || 'No fee measurement is available for this network.'),
      }),
      balanceAfter: null,
      balanceAfterNote: 'This network cannot preview a transaction, so the balance afterwards is not shown.',
    },
    execution: executionBlock({
      program: {
        name: 'Thru transfer program',
        address: transferProgramId,
        verified: Boolean(transferProgramId),
      },
      instructions: [instruction('Transfer funds', {
        note: 'The amount, your account and the recipient are fixed when you sign.',
      })],
      accounts: [
        accountRole('Source', facts.fromAddress),
        accountRole('Destination', facts.toAddress),
      ],
      raw: null,
    }),
    warnings,
    acknowledgements,
  };
}
