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
  displayAmount, movement, row, warn, feeBlock, instruction, accountRole, executionBlock,
} from './common.js';

const NATIVE = Object.freeze({ symbol: 'THRU', decimals: 9, mintAddress: null, verified: true });

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

function paymentLabel(facts) {
  const payment = facts.payment ?? {};
  return `${payment.symbol || 'TOKEN'}${payment.name ? ` — ${payment.name}` : ''}`;
}

function domainRow(facts) {
  return row('Domain', `${facts.name}.${facts.tld}`, { mono: true });
}

function yearsRow(facts) {
  const years = Number(facts.years);
  return row('Duration', `${years} ${years === 1 ? 'year' : 'years'}`);
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
      || 'The registrar builder declares a 0 network fee; the registrar program charges its own price, shown above.',
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
// Registration through the custom registrar (native fee, self-signed)
// ---------------------------------------------------------------------------------------

export const DOMAIN_REGISTER_KIND = 'domain-register';

export function decodeDomainRegister({ facts }) {
  const warnings = [];
  const unavailable = availabilityWarning(facts);
  if (unavailable) warnings.push(unavailable);

  const feePerYear = facts.pricePerYear == null ? null : String(facts.pricePerYear);
  if (facts.nativeBalanceUnits != null && BigInt(facts.nativeBalanceUnits) < BigInt(facts.totalPriceUnits)) {
    warnings.push(warn('insufficient-native', 'danger',
      'Balance is lower than the registration fee',
      'The registrar charges its fee in THRU from the signing account; the account holds less '
      + 'than the total below, so the program would reject it.', { blocking: true }));
  }
  warnings.push(warn('quote-not-final', 'info',
    'The final charge is decided by the program',
    'The registrar debits its configured fee inside the program. The quote above is the '
    + 'config read at prepare time; a config change before signing is caught by the background '
    + 'review check and by the handler.'));

  return {
    operation: {
      id: DOMAIN_REGISTER_KIND,
      name: 'Register domain',
      summary: `Register '${facts.name}.${facts.tld}' for ${Number(facts.years)} `
        + `${Number(facts.years) === 1 ? 'year' : 'years'} through the custom registrar.`,
      confirmLabel: 'Confirm and sign',
      decode: 'decoded',
    },
    protocol: {
      name: registrarProgram(facts).name,
      address: registrarProgram(facts).address,
      verified: registrarProgram(facts).verified,
      source: facts.program?.source
        || 'Evidence-pinned deployment on the active network (docs/DECISIONS.md D-016)',
    },
    // The owner's 2026-10-28 review called this preview too long. This table carries only the
    // decision — which name, for how long, for how much. The registrar identity is the card's
    // protocol line, the network is its header badge, the root registry address is a technical
    // account (already in `execution.accounts`), and "price per year" is identical to the total
    // for a single year, so it is shown only when more than one year is being bought.
    summary: [
      domainRow(facts),
      yearsRow(facts),
      ...(Number(facts.years) > 1
        ? [row('Price per year', feePerYear == null
          ? 'not readable'
          : displayAmount(feePerYear, NATIVE.decimals, NATIVE.symbol), { mono: true })]
        : []),
      row('Total charge', displayAmount(facts.totalPriceUnits, NATIVE.decimals, NATIVE.symbol), { mono: true }),
    ],
    assets: {
      outgoing: [movement({
        symbol: NATIVE.symbol,
        name: 'Thru native token',
        decimals: NATIVE.decimals,
        amountUnits: facts.totalPriceUnits,
        verified: true,
        note: 'Charged by the registrar program itself, in THRU base units.',
      })],
      incoming: [],
      fee: registrarFee(facts),
      balanceAfter: null,
      balanceAfterNote: 'Thru has no verified dry-run, so no post-transaction balance is shown.',
    },
    execution: executionBlock({
      program: registrarProgram(facts),
      instructions: [namedInstruction(facts, 'Register domain',
        'Creates the lease and the name-service domain account for the label. Irreversible.')],
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
  const warnings = [...extraWarnings];
  const unavailable = availabilityWarning(facts);
  if (unavailable) warnings.push(unavailable);

  if (facts.paymentBalanceUnits != null
      && BigInt(facts.paymentBalanceUnits) < BigInt(facts.totalPriceUnits)) {
    warnings.push(warn('insufficient-payment-funds', 'danger',
      'Payment token balance is too low',
      `This costs ${facts.totalPriceUnits} base units of the registry token; the account holds `
      + `${facts.paymentBalanceUnits}.`, { blocking: true }));
  } else if (facts.paymentBalanceUnits == null) {
    warnings.push(warn('payment-balance-unknown', 'warning',
      'Payment token balance could not be read',
      'The handler re-reads it before signing and refuses an amount above the balance.'));
  }

  return {
    operation,
    protocol: {
      name: 'Thru `.thru` name registrar',
      address: facts.program?.address ?? null,
      verified: Boolean(facts.program?.verified),
      source: facts.program?.source
        || 'Registry config parsed from the on-chain account (src/lib/registrar.js)',
    },
    summary: rows,
    assets: {
      outgoing: [paymentMovement(facts)],
      incoming: [],
      fee: registrarFee(facts),
      balanceAfter: null,
      balanceAfterNote: 'Thru has no verified dry-run, so no post-transaction balance is shown.',
    },
    execution: executionBlock({
      program: {
        name: 'Thru `.thru` name registrar',
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
  if (facts.provider === 'custom') {
    const feePerYear = facts.pricePerYear == null ? null : String(facts.pricePerYear);
    if (facts.nativeBalanceUnits != null && BigInt(facts.nativeBalanceUnits) < BigInt(facts.totalPriceUnits)) {
      warnings.push(warn('insufficient-native', 'danger',
        'Balance is lower than the renewal fee',
        'The registrar charges its fee in THRU from the signing account; the account holds less '
        + 'than the total below.', { blocking: true }));
    }
    return {
      operation: {
        id: DOMAIN_RENEW_KIND,
        name: 'Renew domain lease',
        summary: `Extend '${facts.name}.${facts.tld}' by ${Number(facts.years)} `
          + `${Number(facts.years) === 1 ? 'year' : 'years'} through the custom registrar.`,
        confirmLabel: 'Confirm and sign',
        decode: 'decoded',
      },
      protocol: {
        name: registrarProgram(facts).name,
        address: registrarProgram(facts).address,
        verified: registrarProgram(facts).verified,
        source: facts.program?.source
          || 'Evidence-pinned deployment on the active network (docs/DECISIONS.md D-016)',
      },
      summary: [
        domainRow(facts),
        row('Current expiry', chainTime(facts.lease?.endTime)),
        yearsRow(facts),
        row('Registrar', registrarProgram(facts).name),
        row('Price per year', feePerYear == null
          ? 'not readable'
          : displayAmount(feePerYear, NATIVE.decimals, NATIVE.symbol), { mono: true }),
        row('Total charge', displayAmount(facts.totalPriceUnits, NATIVE.decimals, NATIVE.symbol), { mono: true }),
        row('Network', facts.networkLabel ?? ''),
      ],
      assets: {
        outgoing: [movement({
          symbol: NATIVE.symbol,
          name: 'Thru native token',
          decimals: NATIVE.decimals,
          amountUnits: facts.totalPriceUnits,
          verified: true,
          note: 'Charged by the registrar program itself, in THRU base units.',
        })],
        incoming: [],
        fee: registrarFee(facts),
        balanceAfter: null,
        balanceAfterNote: 'Thru has no verified dry-run, so no post-transaction balance is shown.',
      },
      execution: executionBlock({
        program: registrarProgram(facts),
        instructions: [namedInstruction(facts, 'Renew domain lease',
          'Extends the domain lease period through the custom registrar.')],
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

  return paidRegistryBlock({
    facts,
    operation: {
      id: DOMAIN_PURCHASE_KIND,
      name: 'Purchase domain lease',
      summary: `Buy '${facts.name}.${facts.tld}' for ${Number(facts.years)} `
        + `${Number(facts.years) === 1 ? 'year' : 'years'} from the official registrar.`,
      confirmLabel: 'Confirm and sign',
      decode: 'decoded',
    },
    rows: [
      domainRow(facts),
      yearsRow(facts),
      row('Price per year', facts.pricePerYear == null
        ? 'not readable'
        : displayAmount(String(facts.pricePerYear), facts.payment?.decimals ?? 0,
          facts.payment?.symbol || 'TOKEN'), { mono: true }),
      row('Total price', displayAmount(facts.totalPriceUnits, facts.payment?.decimals ?? 0,
        facts.payment?.symbol || 'TOKEN'), { mono: true }),
      row('Payment token', paymentLabel(facts), { mono: true }),
    ],
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
      'The handler re-reads the lease before signing. Without it, the wallet cannot show the '
      + 'start of the extension window.'));
  }
  return paidRegistryBlock({
    facts,
    extraWarnings: warnings,
    operation: {
      id: DOMAIN_RENEW_KIND,
      name: 'Renew domain lease',
      summary: `Extend '${facts.name}.${facts.tld}' by ${Number(facts.years)} `
        + `${Number(facts.years) === 1 ? 'year' : 'years'}.`,
      confirmLabel: 'Confirm and sign',
      decode: 'decoded',
    },
    rows: [
      domainRow(facts),
      row('Current expiry', chainTime(facts.lease?.endTime)),
      yearsRow(facts),
      // One year makes "price per year" identical to "total price"; show it only when the
      // multiplication is real information.
      ...(Number(facts.years) > 1
        ? [row('Price per year', facts.pricePerYear == null
          ? 'not readable'
          : displayAmount(String(facts.pricePerYear), facts.payment?.decimals ?? 0,
            facts.payment?.symbol || 'TOKEN'), { mono: true })]
        : []),
      row('Total price', displayAmount(facts.totalPriceUnits, facts.payment?.decimals ?? 0,
        facts.payment?.symbol || 'TOKEN'), { mono: true }),
      // Deliberately not computed: the program decides how an extension maps to a new end time.
      row('New expiry', 'Set by the chain — not computed here'),
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
      name: 'Claim expired domain',
      summary: `Take over the expired lease '${facts.name}.${facts.tld}'.`,
      confirmLabel: 'Confirm and sign',
      decode: 'decoded',
    },
    rows: [
      domainRow(facts),
      row('Current expiry', chainTime(facts.lease?.endTime)),
      row('Previous owner', facts.lease?.owner ?? 'unknown', { mono: true }),
      yearsRow(facts),
      row('Total price', displayAmount(facts.totalPriceUnits, facts.payment?.decimals ?? 0,
        facts.payment?.symbol || 'TOKEN'), { mono: true }),
    ],
    instructions: [namedInstruction(facts, 'Claim expired lease',
      'Replaces the expired lease\'s ownership with your account and debits the registry price. '
      + 'The previous owner loses the name. Irreversible.')],
  });
}
