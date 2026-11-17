// Faucet claim decoder.
//
// A native faucet claim is an incoming credit, but it is still a signed, broadcast, irreversible
// chain transaction. Review the amount, recipient (the active account), program identity, and
// fee provenance. The native THRU faucet has no per-account rate-limit policy; THRUSD limits
// are separate and do not apply here.
//
// Facts: amountUnits, capUnits, accountExists, fee { supported, reason }, programAddress.

import {
  displayAmount, movement, warn, feeBlock, instruction, accountRole, executionBlock,
} from './common.js';

export const FAUCET_CLAIM_KIND = 'faucet-claim';

export function decodeFaucetClaim({ facts }) {
  const warnings = [];
  const amount = displayAmount(facts.amountUnits, 9, 'THRU');

  if (facts.capUnits != null && BigInt(facts.amountUnits) > BigInt(facts.capUnits)) {
    warnings.push(warn('above-cap', 'danger',
      'Amount is above this faucet\'s per-claim cap',
      `This faucet pays at most ${displayAmount(facts.capUnits, 9, 'THRU')} per claim.`,
      { blocking: true }));
  }


  // Tri-state again: only an authoritative "does not exist" may promise an activation step.
  if (facts.accountExists === false) {
    warnings.push(warn('account-activation', 'info',
      'Your account will be activated first',
      'This account is new on this network, so the claim also creates it.'));
  } else if (facts.accountExists == null) {
    warnings.push(warn('account-state-unverified', 'warning',
      'Account state could not be read',
      'The wallet could not tell whether this account already exists, so it may also create it.'));
  }

  // There are no native-faucet rate-limit facts to render.
  const rows = [];

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
        note: 'Paid by the native faucet.',
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
        note: 'The network pays the amount shown to your account.',
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
