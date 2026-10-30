// Faucet claim decoder.
//
// A faucet claim is an incoming credit, but it is still a signed, broadcast, irreversible
// chain transaction with a rate-limit budget attached. It gets the same review as a transfer:
// amount, recipient (the active account), program identity, remaining allowance, and an
// explicit note that this wallet does not present a fee it did not receive.
//
// Facts: amountUnits, capUnits, accountExists, limit { supported, paused, exhausted,
// remainingAmount, window, resetAtUnixSec, reason }, fee { supported, reason }, programAddress.

import {
  displayAmount, movement, row, warn, feeBlock, instruction, accountRole, executionBlock,
} from './common.js';

export const FAUCET_CLAIM_KIND = 'faucet-claim';

function windowLabel(limit) {
  if (!limit?.supported) return null;
  const seconds = limit.window == null ? null : Number(limit.window);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}

export function decodeFaucetClaim({ facts }) {
  const warnings = [];
  const amount = displayAmount(facts.amountUnits, 9, 'THRU');

  if (facts.capUnits != null && BigInt(facts.amountUnits) > BigInt(facts.capUnits)) {
    warnings.push(warn('above-cap', 'danger',
      'Amount is above this faucet\'s per-claim cap',
      `This faucet pays at most ${displayAmount(facts.capUnits, 9, 'THRU')} per claim.`,
      { blocking: true }));
  }

  if (!facts.limit?.supported) {
    warnings.push(warn('limit-unknown', 'warning',
      'Faucet remaining allowance could not be read',
      facts.limit?.reason
        ? `The on-chain rate-limit policy answered: ${facts.limit.reason}.`
        : 'The rate-limit policy is unavailable, so the remaining allowance is unknown. The '
          + 'faucet still enforces it on-chain.'));
  } else {
    if (facts.limit.paused) {
      warnings.push(warn('faucet-paused', 'danger',
        'Faucet is paused by its administrator',
        'The on-chain policy is paused, so a claim would be rejected.', { blocking: true }));
    }
    if (facts.limit.exhausted) {
      const reset = facts.limit.resetAtUnixSec == null
        ? ''
        : ` The window resets at ${new Date(Number(facts.limit.resetAtUnixSec) * 1000)
          .toLocaleTimeString()} your local time.`;
      warnings.push(warn('faucet-exhausted', 'danger',
        'This account has used its faucet allowance',
        `The current rate-limit window is exhausted.${reset}`, { blocking: true }));
    }
  }

  // Tri-state again: only an authoritative "does not exist" may promise an activation step.
  if (facts.accountExists === false) {
    warnings.push(warn('account-activation', 'info',
      'Your account will be activated first',
      'A faucet claim from an account that does not exist on-chain activates it with the '
      + 'network\'s account-creation program first, then claims.'));
  } else if (facts.accountExists == null) {
    warnings.push(warn('account-state-unverified', 'warning',
      'Account state could not be read',
      'The chain did not answer whether this account already exists, so the wallet cannot say '
      + 'whether the claim also activates it. The claim handler re-reads it before signing.'));
  }

  // F-07b: `targetMatchesFaucet:false` means the rate-limit policy this wallet just read
  // belongs to a different faucet program. The recheck already refuses to confirm it, so the
  // review must not present it as a normal claim either.
  if (facts.limit?.supported && facts.limit.targetMatchesFaucet === false) {
    warnings.push(warn('faucet-target-mismatch', 'danger',
      'The faucet policy targets a different program',
      'The rate-limit policy read for this network does not apply to the faucet program that '
      + 'would be called, so the claim cannot be proven safe to sign.', { blocking: true }));
  }

  // Only the rate-limit remainder is a fact about this transaction that is not money; the
  // recipient is the counterparty line and the amount is in the title and the money table.
  const rows = [];
  const window = windowLabel(facts.limit);
  if (facts.limit?.supported && facts.limit.remainingAmount != null) {
    rows.push(row('Remaining this window',
      `${displayAmount(facts.limit.remainingAmount, 9, 'THRU')}${window ? ` / ${window}` : ''}`,
      { mono: true }));
  }

  return {
    operation: {
      id: FAUCET_CLAIM_KIND,
      name: `Claim ${amount} from the faucet`,
      summary: '',
      confirmLabel: 'Claim',
      decode: 'decoded',
    },
    protocol: {
      name: 'Thru faucet program',
      address: facts.programAddress ?? null,
      verified: Boolean(facts.programAddress),
    },
    counterparty: {
      address: facts.fromAddress,
      label: facts.fromLabel || 'your account',
    },
    summary: rows,
    assets: {
      outgoing: [],
      incoming: [movement({
        symbol: 'THRU',
        name: 'Thru native token',
        decimals: 9,
        amountUnits: facts.amountUnits,
        verified: true,
        note: 'Paid by the faucet, subject to its on-chain rate limit.',
      })],
      fee: feeBlock({
        supported: Boolean(facts.fee?.supported),
        amountUnits: facts.fee?.supported ? facts.fee.feeUnits : null,
        reserveUnits: null,
        source: facts.fee?.supported ? (facts.fee.source ?? 'unknown') : null,
        note: facts.fee?.supported
          ? 'Set by the network. What was actually charged appears in Activity after confirmation.'
          : (facts.fee?.reason
            || 'The faucet claim path does not report a fee, so none is shown.'),
      }),
      balanceAfter: null,
      balanceAfterNote: 'This network cannot preview a transaction, so the balance afterwards is not shown.',
    },
    execution: executionBlock({
      program: {
        name: 'Thru faucet program',
        address: facts.programAddress ?? null,
        verified: Boolean(facts.programAddress),
      },
      instructions: [instruction('Faucet payout', {
        note: 'The network pays the amount shown to your account, subject to its rate limit.',
      })],
      accounts: [
        accountRole('Faucet vault', facts.vaultAddress ?? 'pinned program vault'),
        accountRole('Recipient', facts.fromAddress),
      ],
      raw: null,
    }),
    warnings,
    acknowledgements: [],
  };
}
