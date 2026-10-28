// Token transfer decoder (Token program, SPL-shaped accounts).
//
// Facts (read by the background before this runs):
//   mintAddress, symbol, name, decimals, metadataVerified, amountUnits,
//   fromAddress, toAddress, recipientLabel,
//   recipientTokenAccount { exists: true|false|null, address|null },
//   sourceTokenAccount { exists: true|false|null },
//   balanceUnits|null, fee { supported, reason }, duplicate|null,
//   tokenProgramId, mintExists
//
// Two consequences this review must never hide:
//   1. A token send to a first-time holder is TWO chain transactions (the wallet initializes
//      the recipient's token account, then transfers). That is an extra fee and an extra
//      irreversible on-chain effect.
//   2. Imported-token metadata is user-supplied until the mint is read. `metadataVerified`
//      false means the symbol/decimals shown are not chain truth.

import {
  displayAmount, movement, row, warn, acknowledgement, feeBlock, instruction, accountRole,
  executionBlock,
} from './common.js';

export const TOKEN_TRANSFER_KIND = 'token-transfer';

export function decodeTokenTransfer({ facts }) {
  const warnings = [];
  const acknowledgements = [];
  const symbol = facts.symbol || 'TOKEN';
  const decimals = Number.isInteger(facts.decimals) ? facts.decimals : 0;

  if (!facts.mintExists) {
    warnings.push(warn('mint-absent', 'danger',
      'This mint does not exist on this network',
      'The token program has no account at the mint address, so a transfer cannot be built '
      + 'against it.', { blocking: true }));
  }

  if (!facts.metadataVerified) {
    warnings.push(warn('metadata-unverified', 'warning',
      'Token metadata is not verified on-chain',
      'The symbol and decimals shown come from this wallet\'s local registry, not from a mint '
      + 'read. Base-unit amounts are still exact, but the display scale may be wrong.'));
  }

  if (facts.recipient?.exists === false) {
    warnings.push(warn('recipient-not-activated', 'danger',
      'Recipient is not activated on this network',
      'The recipient account must exist on-chain before a token account can be created for it.',
      { blocking: true }));
  } else if (facts.recipient?.exists == null) {
    warnings.push(warn('recipient-unverified', 'warning',
      'Recipient could not be verified',
      'The chain did not answer the recipient lookup. The token path re-checks it before signing.'));
  }

  if (facts.sourceTokenAccount?.exists === false) {
    warnings.push(warn('source-token-account-missing', 'danger',
      'You have no token account for this mint',
      'There is no balance to send from, and the token program transfer would revert.',
      { blocking: true }));
  }

  if (facts.balanceUnits == null) {
    warnings.push(warn('balance-unknown', 'warning',
      'Token balance could not be read',
      'The amount is not checked against a live balance here; the token path re-reads it and '
      + 'refuses an amount above the balance.'));
  } else if (BigInt(facts.balanceUnits) < BigInt(facts.amountUnits)) {
    warnings.push(warn('insufficient-balance', 'danger',
      'Amount is higher than your balance',
      `The account holds ${displayAmount(facts.balanceUnits, decimals, symbol)}, which is less `
      + 'than the amount.', { blocking: true }));
  }

  const createsRecipientAccount = facts.recipientTokenAccount?.exists === false;
  if (createsRecipientAccount) {
    warnings.push(warn('recipient-token-account-created', 'warning',
      'This recipient has no token account yet',
      `The wallet will first initialize a ${symbol} token account for the recipient, then `
      + 'transfer. That is a separate, irreversible on-chain transaction with its own fee.'));
    acknowledgements.push(acknowledgement('recipient-token-account-created',
      'I understand two transactions are submitted and the account creation cannot be undone'));
  }

  if (!facts.fee?.supported) {
    warnings.push(warn('fee-unmeasured', 'warning',
      'Network fee is not measured for this path',
      facts.fee?.reason || 'No measured fee exists for token transfers on this network.'));
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

  const summary = [
    row('From', facts.fromAddress, { above: facts.fromLabel ?? null, mono: true }),
    row('To', facts.toAddress, { above: facts.recipientLabel ?? null, mono: true }),
    row('Amount', displayAmount(facts.amountUnits, decimals, symbol), { mono: true }),
    // No "Token" row: the title says "Send SMK" and the value box already names the asset. The
    // mint address stays because it is the only unambiguous identity of a token on Thru.
    row('Mint', facts.mintAddress, { mono: true }),
  ];
  if (createsRecipientAccount) {
    summary.push(row('Recipient token account', 'Created by this send (extra fee)'));
  }

  const accounts = [
    accountRole('Source owner', facts.fromAddress),
    accountRole('Destination owner', facts.toAddress),
  ];
  if (facts.sourceTokenAccount?.address) {
    accounts.push(accountRole('Source token account', facts.sourceTokenAccount.address));
  }
  if (facts.recipientTokenAccount?.address) {
    accounts.push(accountRole(
      createsRecipientAccount ? 'Recipient token account (to create)' : 'Recipient token account',
      facts.recipientTokenAccount.address,
    ));
  }

  return {
    operation: {
      id: TOKEN_TRANSFER_KIND,
      name: `Send ${symbol}`,
      summary: `Send ${displayAmount(facts.amountUnits, decimals, symbol)} to the recipient below.`,
      confirmLabel: 'Sign & send',
      decode: 'decoded',
    },
    protocol: {
      name: 'Thru token program',
      address: facts.tokenProgramId ?? null,
      verified: true,
      source: 'Pinned program address for the active network (src/lib/networks.js)',
    },
    summary,
    assets: {
      outgoing: [movement({
        symbol,
        name: facts.name ?? null,
        mintAddress: facts.mintAddress,
        decimals,
        amountUnits: facts.amountUnits,
        verified: Boolean(facts.metadataVerified),
        note: facts.metadataVerified
          ? null
          : 'Symbol and decimals are not verified against the mint account.',
      })],
      incoming: [],
      fee: feeBlock({
        supported: Boolean(facts.fee?.supported),
        amountUnits: facts.fee?.supported ? facts.fee.feeUnits : null,
        reserveUnits: facts.fee?.supported ? facts.fee.reserveUnits : null,
        source: facts.fee?.supported ? (facts.fee.source ?? 'unknown') : null,
        note: facts.fee?.supported
          ? 'Declared network fee for this chain; the charge is reported only after the chain answers.'
          : (facts.fee?.reason || 'No measured fee exists for token transfers on this network.'),
      }),
      balanceAfter: null,
      balanceAfterNote: 'Thru has no verified dry-run, so no post-transaction balance is shown.',
    },
    execution: executionBlock({
      program: {
        name: 'Thru token program',
        address: facts.tokenProgramId ?? null,
        verified: true,
      },
      instructions: [
        ...(createsRecipientAccount
          ? [instruction('Initialize recipient token account', {
            note: 'Creates the recipient\'s token account for this mint. Irreversible.',
          })]
          : []),
        instruction('Transfer tokens', {
          note: 'Moves exact base units from your token account to the recipient\'s.',
        }),
      ],
      accounts,
      raw: null,
    }),
    warnings,
    acknowledgements,
  };
}
