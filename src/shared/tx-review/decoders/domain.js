// Domain (name-service + registrar) decoders.
//
// Four operations, four decoders, ONE review component:
//   domain-register  register a label through the evidence-pinned custom registrar (native fee)
//   domain-purchase  buy a `.thru` lease from the official paid registry (registry token)
//   domain-renew     extend an existing lease the active account owns
//   domain-claim     take over a lease whose end time has passed
//
// Honesty rules specific to names:
//   - Every price shown was read from the chain's config in the same prepare call, with its
//     provenance named. Nothing is inherited from a documentation example.
//   - The FUTURE expiry is not computed: the program decides how a renewal or claim maps to a
//     new end time, and this wallet has not verified that arithmetic on a live node. Showing
//     an invented "new expiry" would be a fabricated on-chain fact.
//   - A chain read that failed produces a blocking warning ("could not verify"), never a
//     default of "available".

import {
  movement, row, warn, feeBlock, instruction, accountRole, executionBlock, displayAmount,
} from './common.js';

const NATIVE = Object.freeze({ symbol: 'THRU', decimals: 9, mintAddress: null, verified: true });

// ---------------------------------------------------------------------------------------
// The custom registrar's price: DECLARED vs ENFORCED.
// The program can run in two modes (config.fee_policy): best effort, where it attempts the
// debit and ignores a refusal — which is what the deployed program does — and strict, where a
// refused debit reverts the instruction. A price is only money that moves in strict mode, so
// every surface that mentions it derives "charged" from this one place.
// ---------------------------------------------------------------------------------------
function registrarCharge(facts) {
  const declared = facts.totalPriceUnits != null ? BigInt(facts.totalPriceUnits) : 0n;
  const enforced = facts.feeEnforced === true;
  return {
    declared,
    enforced,
    charged: enforced && declared > 0n,
    free: declared === 0n,
  };
}

function registrarPriceMovement(facts, charge) {
  return movement({
    symbol: 'THRU',
    name: 'Thru native token',
    decimals: 9,
    mintAddress: null,
    amountUnits: charge.declared.toString(),
    verified: true,
    note: 'Paid to the registrar treasury by the program when this transaction executes.',
  });
}


function paymentMovement(facts) {
  const payment = facts.payment ?? {};
  return movement({
    symbol: payment.symbol || 'TOKEN',
    name: payment.name ?? null,
    mintAddress: payment.mintAddress ?? null,
    decimals: Number.isInteger(payment.decimals) ? payment.decimals : 0,
    amountUnits: facts.totalPriceUnits,
    verified: Boolean(payment.verified),
    note: payment.verified ? null : 'Token scale read from the local registry, not a mint read.',
  });
}

function chainTime(value) {
  if (value == null) return 'unknown';
  try {
    const seconds = BigInt(value);
    // Localize only when the u64 plausibly reads as unix seconds; otherwise print the raw
    // chain value with its unit, exactly like the Domain route does.
    if (seconds >= 1_500_000_000n && seconds < 10_000_000_000n) {
      return new Date(Number(seconds) * 1000)
        .toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    }
    return `${seconds} (chain time, seconds)`;
  } catch {
    return String(value);
  }
}

/** A registrar write declares fee 0n in its header; the program prices in its own unit. */
function registrarFee(facts) {
  return feeBlock({
    supported: true,
    amountUnits: '0',
    reserveUnits: facts.feeReserveUnits ?? null,
    source: 'declared-by-builder',
    note: facts.feeNote
      || 'The registrar transaction declares no network fee of its own.',
  });
}

function availabilityWarning(facts) {
  const state = facts.availability?.state;
  if (state === 'taken') {
    return warn('name-taken', 'danger',
      'This name is already registered',
      `'${facts.name}.${facts.tld}' has an active lease on-chain. Renew it if you own it, or `
      + 'choose another label.', { blocking: true });
  }
  if (state === 'unknown') {
    return warn('availability-unknown', 'danger',
      'Availability could not be verified',
      'The chain did not answer the lease lookup for this name, so the wallet cannot prove the '
      + 'registration would succeed.', { blocking: true });
  }
  return null;
}

/** The instruction was named (and its opcode pinned) by the background, from src/lib. */
function namedInstruction(facts, fallbackName, note) {
  const name = facts.instruction?.name || fallbackName;
  const opcode = facts.instruction?.opcode;
  return instruction(
    typeof opcode === 'number' ? `${name} (registrar opcode ${opcode})` : name,
    { decoded: typeof opcode === 'number', note },
  );
}

function registrarProgram(facts) {
  return {
    name: facts.program?.name || 'Registrar program',
    address: facts.program?.address ?? null,
    verified: Boolean(facts.program?.verified),
  };
}

// ---------------------------------------------------------------------------------------
// The custom registrar (native THRU fee, self-signed)
// ---------------------------------------------------------------------------------------

/**
 * The custom registrar prices its writes in NATIVE THRU, not in the paid registry's payment
 * token. Reading it as a payment-token amount rendered 2,000 base units as "2000 TOKEN"
 * (audit 2026-10-28): the facts carry no `payment` block at all, so `paymentMovement` fell
 * back to symbol 'TOKEN', decimals 0.
 */
/**
 * The custom registrar's price is deliberately NOT shown (owner directive, v1.5.0, Part 2.2).
 *
 * `processor.rs` performs the charge as `let _ = mgr.account_transfer(..)`, so a refused charge
 * does not fail the write — and three live probes of the deployed program found the treasury
 * unchanged afterwards. The card used to print "you pay −0.000002 THRU" next to "decided
 * on-chain", which is both a promise and a retraction in the same card. What is provable is
 * what the card now says: no registration fee, you pay only the network fee. A price comes back
 * when a passing, falsifiable measurement shows the balance actually moved.
 */
function customRegistrarTrustNote() {
  return 'Name registrar run by the Thru Wallet team on this test network. '
    + 'It has not been independently audited.';
}

/** Shown in Details for a custom-registrar write; never a price, never a "best-effort" hedge. */
function customFeeCaveat() {
  return 'The wallet still checks your balance before signing, so a very low balance can be '
    + 'refused even though no registration fee is charged.';
}

// ---------------------------------------------------------------------------------------
// Registration through the custom registrar (native fee, self-signed)
// ---------------------------------------------------------------------------------------

export const DOMAIN_REGISTER_KIND = 'domain-register';

export function decodeDomainRegister({ facts }) {
  const warnings = [];
  const unavailable = availabilityWarning(facts);
  if (unavailable) warnings.push(unavailable);
  const charge = registrarCharge(facts);

  if (charge.charged) {
    // Enforced fee: the price is money the program takes. An account that cannot cover it
    // reverts on-chain (0xD207), so it blocks here instead of failing later.
    if (facts.nativeBalanceUnits != null && BigInt(facts.nativeBalanceUnits) < charge.declared) {
      warnings.push(warn('registrar-fee-unpayable', 'danger',
        'Not enough THRU for the registrar fee',
        `This registration costs ${displayAmount(charge.declared, 9, 'THRU')} and the account `
        + `holds ${displayAmount(BigInt(facts.nativeBalanceUnits), 9, 'THRU')}.`, { blocking: true }));
    }
  } else if (!charge.free && facts.nativeBalanceUnits != null
      && BigInt(facts.nativeBalanceUnits) < charge.declared) {
    // Declared but unenforced: the program attempts the debit and ignores a refusal, so a low
    // balance is not a failure — it only means the fee will probably not be taken.
    warnings.push(warn('registrar-balance-check', 'info',
      'Your balance is checked before signing',
      customFeeCaveat()));
  }
  if (!charge.enforced && !charge.free) {
    warnings.push(warn('registrar-fee-unenforced', 'warning',
      'Registrar fee is not enforced on-chain',
      `The registrar prices this name at ${displayAmount(charge.declared, 9, 'THRU')}, but its program `
      + 'attempts the charge and ignores a refusal, so the amount may not be debited.'));
  }

  return {
    operation: {
      id: DOMAIN_REGISTER_KIND,
      name: `Register ${facts.name}.${facts.tld} for ${Number(facts.years)} `
        + `${Number(facts.years) === 1 ? 'year' : 'years'}`,
      summary: charge.charged
        ? `The registrar program collects ${displayAmount(charge.declared, 9, 'THRU')} for this term.`
        : charge.free
          ? 'No registration fee on this registrar. You pay only the network fee.'
          : '',
      confirmLabel: 'Confirm and sign',
      decode: 'decoded',
    },
    protocol: {
      name: registrarProgram(facts).name,
      address: registrarProgram(facts).address,
      verified: registrarProgram(facts).verified,
      trustNote: customRegistrarTrustNote(),
    },
    // The owner's 2026-10-28 review called this preview too long. This table carries only the
    // decision — which name, for how long, for how much. The registrar identity is the card's
    // protocol line, the network is its header badge, the root registry address is a technical
    // account (already in `execution.accounts`), and "price per year" is identical to the total
    // for a single year, so it is shown only when more than one year is being bought.
    // The title already says which name and how long, so the table does not say it twice.
    summary: [],
    assets: {
      // An outgoing row appears ONLY when the program enforces collection; otherwise nothing
      // is provably charged and nothing is promised.
      outgoing: charge.charged ? [registrarPriceMovement(facts, charge)] : [],
      incoming: [],
      fee: registrarFee(facts),
      balanceAfter: null,
      balanceAfterNote: 'This network cannot preview a transaction, so the balance afterwards is not shown.',
    },
    execution: executionBlock({
      program: registrarProgram(facts),
      instructions: [namedInstruction(facts, 'Register domain',
        'Creates the lease and the name-service account for this name. Reversing it needs another '
        + 'transaction.')],
      accounts: [
        accountRole('Signer / owner', facts.fromAddress),
        accountRole('Registrar config', facts.configAddress ?? 'derived from the program id'),
        accountRole('Treasury', facts.treasury ?? 'unknown'),
        accountRole('Root', facts.root ?? 'unknown'),
      ],
      raw: null,
    }),
    warnings,
    acknowledgements: [],
  };
}

// ---------------------------------------------------------------------------------------
// Paid registry: purchase / renew / claim
// ---------------------------------------------------------------------------------------

function paidRegistryBlock({ facts, operation, rows, instructions, extraWarnings = [] }) {
  // Two registrars with the same shape and different money: the paid registry charges in its
  // payment token, the custom registrar charges in native THRU from the signer.
  const native = facts.provider === 'custom';
  const warnings = [...extraWarnings];
  const unavailable = availabilityWarning(facts);
  if (unavailable) warnings.push(unavailable);

  const charge = native ? registrarCharge(facts) : null;
  if (native) {
    if (charge.charged) {
      if (facts.nativeBalanceUnits != null && BigInt(facts.nativeBalanceUnits) < charge.declared) {
        warnings.push(warn('registrar-fee-unpayable', 'danger',
          'Not enough THRU for the registrar fee',
          `This renewal costs ${displayAmount(charge.declared, 9, 'THRU')} and the account holds `
          + `${displayAmount(BigInt(facts.nativeBalanceUnits), 9, 'THRU')}.`, { blocking: true }));
      }
    } else if (!charge.free && facts.nativeBalanceUnits != null
        && BigInt(facts.nativeBalanceUnits) < charge.declared) {
      warnings.push(warn('registrar-balance-check', 'info',
        'Your balance is checked before signing',
        customFeeCaveat()));
    }
    if (!charge.enforced && !charge.free) {
      warnings.push(warn('registrar-fee-unenforced', 'warning',
        'Registrar fee is not enforced on-chain',
        `The registrar prices this renewal at ${displayAmount(charge.declared, 9, 'THRU')}, but `
        + 'its program attempts the charge and ignores a refusal, so the amount may not be debited.'));
    }
  } else if (facts.paymentBalanceUnits != null
      && BigInt(facts.paymentBalanceUnits) < BigInt(facts.totalPriceUnits)) {
    warnings.push(warn('insufficient-payment-funds', 'danger',
      'Payment token balance is too low',
      `This costs ${facts.totalPriceUnits} base units of the registry token; the account holds `
      + `${facts.paymentBalanceUnits}.`, { blocking: true }));
  } else if (facts.paymentBalanceUnits == null) {
    warnings.push(warn('payment-balance-unknown', 'warning',
      'Payment token balance could not be read',
      'The wallet checks the balance again before signing.'));
  }

  return {
    operation,
    protocol: {
      // The registry facts and the custom facts both name their program; hardcoding the
      // registry's title here labelled a custom-registrar renewal as the official one.
      name: registrarProgram(facts).name,
      address: facts.program?.address ?? null,
      verified: Boolean(facts.program?.verified),
      trustNote: facts.program?.verified
        ? 'Registrar program the wallet has pinned for this network. Its price comes from its own '
          + 'on-chain configuration, not from this wallet.'
        : null,
    },
    summary: rows,
    assets: {
      // A custom-registrar write has an outgoing amount ONLY when the program enforces the
      // charge; the paid registry moves its own payment token, which the user really spends.
      outgoing: native
        ? (charge.charged ? [registrarPriceMovement(facts, charge)] : [])
        : [paymentMovement(facts)],
      incoming: [],
      fee: registrarFee(facts),
      balanceAfter: null,
      balanceAfterNote: 'This network cannot preview a transaction, so the balance afterwards is not shown.',
    },
    execution: executionBlock({
      program: {
        name: registrarProgram(facts).name,
        address: facts.program?.address ?? null,
        verified: Boolean(facts.program?.verified),
      },
      instructions,
      accounts: [
        accountRole('Signer / payer', facts.fromAddress),
        accountRole('Registry config', facts.configAddress ?? 'unknown'),
        accountRole('Treasury', facts.treasury ?? 'unknown'),
        accountRole('Name service program', facts.nameServiceProgram ?? 'pinned program'),
      ],
      raw: null,
    }),
    warnings,
    acknowledgements: [],
  };
}

export const DOMAIN_PURCHASE_KIND = 'domain-purchase';

export function decodeDomainPurchase({ facts }) {
  return paidRegistryBlock({
    facts,
    operation: {
      id: DOMAIN_PURCHASE_KIND,
      name: `Register ${facts.name}.${facts.tld} for ${Number(facts.years)} `
        + `${Number(facts.years) === 1 ? 'year' : 'years'}`,
      summary: `You pay the registry's price in ${facts.payment?.symbol || 'its payment token'}, plus the network fee.`,
      confirmLabel: 'Confirm and sign',
      decode: 'decoded',
    },
    rows: [],
    instructions: [namedInstruction(facts, 'Purchase domain',
      'Creates the lease and the domain account, and debits the registry price from your '
      + 'payment token account. Irreversible.')],
  });
}

export const DOMAIN_RENEW_KIND = 'domain-renew';

export function decodeDomainRenew({ facts }) {
  const warnings = [];
  if (!facts.lease) {
    warnings.push(warn('lease-not-found', 'danger',
      'No lease exists for this name',
      `'${facts.name}.${facts.tld}' has no lease on-chain, so there is nothing to renew.`,
      { blocking: true }));
  } else if (!facts.lease.mine) {
    warnings.push(warn('not-lease-owner', 'danger',
      'This lease belongs to another account',
      `The lease owner is ${facts.lease.owner ?? 'unknown'}. Only the owner can renew it.`,
      { blocking: true }));
  }
  if (facts.lease?.endTime == null) {
    warnings.push(warn('expiry-unknown', 'warning',
      'Current expiry could not be read',
      'The wallet checks the lease again before signing.'));
  }
  // A custom-registrar renewal is the same intent through a different program: native THRU
  // instead of the registry token, and a registrar the wallet can name. Until 2026-10-28 this
  // fell through to the registry rows and printed "2000 TOKEN" for 2,000 base units of THRU
  // (audit D-1); asking the purchase decoder for it crashed outright.
  if (facts.provider === 'custom') {
    const charge = registrarCharge(facts);
    const summary = charge.charged
      ? `The registrar program collects ${displayAmount(charge.declared, 9, 'THRU')} for this term.`
      : charge.free
        ? 'No renewal fee on this registrar. You pay only the network fee.'
        : '';
    return paidRegistryBlock({
      facts,
      extraWarnings: warnings,
      operation: {
        id: DOMAIN_RENEW_KIND,
        name: `Renew ${facts.name}.${facts.tld} for ${Number(facts.years)} `
          + `${Number(facts.years) === 1 ? 'year' : 'years'}`,
        summary,
        confirmLabel: 'Confirm and sign',
        decode: 'decoded',
      },
      rows: [
        row('Current expiry', chainTime(facts.lease?.endTime)),
        row('New expiry', 'shown after the network confirms'),
      ],
      instructions: [namedInstruction(facts, 'Renew lease',
        'Extends the existing lease through the custom registrar and debits its configured fee. '
        + 'Irreversible.')],
    });
  }
  return paidRegistryBlock({
    facts,
    extraWarnings: warnings,
    operation: {
      id: DOMAIN_RENEW_KIND,
      name: `Renew ${facts.name}.${facts.tld} for ${Number(facts.years)} `
        + `${Number(facts.years) === 1 ? 'year' : 'years'}`,
      summary: `You pay the registry's price in ${facts.payment?.symbol || 'its payment token'}, plus the network fee.`,
      confirmLabel: 'Confirm and sign',
      decode: 'decoded',
    },
    rows: [
      row('Current expiry', chainTime(facts.lease?.endTime)),
      // Deliberately not computed: the program decides how an extension maps to a new end time.
      row('New expiry', 'shown after the network confirms'),
    ],
    instructions: [namedInstruction(facts, 'Renew lease',
      'Extends the existing lease and debits the registry price. Irreversible.')],
  });
}

export const DOMAIN_CLAIM_KIND = 'domain-claim';

export function decodeDomainClaim({ facts }) {
  const warnings = [];
  if (!facts.lease) {
    warnings.push(warn('lease-not-found', 'danger',
      'No lease exists for this name',
      `'${facts.name}.${facts.tld}' has no lease on-chain, so there is nothing to claim.`,
      { blocking: true }));
  } else if (facts.lease.expiredHint === false) {
    warnings.push(warn('lease-still-active', 'danger',
      'This lease has not expired',
      'Only a lease whose end time has passed can be claimed. Renew it instead if you own it.',
      { blocking: true }));
  }
  return paidRegistryBlock({
    facts,
    extraWarnings: warnings,
    operation: {
      id: DOMAIN_CLAIM_KIND,
      name: `Claim expired name ${facts.name}.${facts.tld}`,
      summary: 'The previous owner loses this name when the claim confirms. This cannot be undone.',
      confirmLabel: 'Confirm and sign',
      decode: 'decoded',
    },
    rows: [
      row('Current expiry', chainTime(facts.lease?.endTime)),
      row('Previous owner', facts.lease?.owner ?? 'unknown', { mono: true }),
    ],
    instructions: [namedInstruction(facts, 'Claim expired lease',
      'Replaces the expired lease\'s ownership with your account and debits the registry price. '
      + 'The previous owner loses the name. Irreversible.')],
  });
}
