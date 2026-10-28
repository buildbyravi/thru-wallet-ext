// Operation kinds: how a typed intent becomes (a) facts, (b) a freshness re-check, and
// (c) the EXISTING signing method that submits it.
//
// This file is the only place that knows which bridge method a review submits through. It
// deliberately names the same methods each feature already used, so every guard that exists
// today (auth policy, signing guard, network/account binding, duplicate detection, live
// re-reads) still runs unchanged. A new operation type adds an entry here plus a decoder in
// src/shared/tx-review/decoders — never a new signing path.
//
// Facts are JSON-safe by contract (they are stored in a review record and re-decoded at
// confirm time): base-unit amounts are strings, never BigInt.

import * as thruClient from '../../../lib/thru-client.js';
import * as registrar from '../../../lib/registrar.js';
import * as customRegistrar from '../../../lib/custom-registrar.js';
import * as txService from '../tx-service.js';
import * as tokenService from '../token-service.js';
import * as registrarService from '../registrar-service.js';
import * as accountService from '../account-service.js';
import * as contactsService from '../contacts-service.js';

function coded(code, message, retryable = false) {
  const err = new Error(message);
  err.code = code;
  err.retryable = retryable;
  return err;
}

function requireAddress(value, field) {
  const address = String(value ?? '').trim();
  if (!thruClient.isValidThruAddress(address)) {
    throw coded('INVALID_INPUT', `${field} must be a valid Thru address`);
  }
  return address;
}

function requireUnits(value, field) {
  const units = String(value ?? '').trim();
  if (!/^\d+$/.test(units) || BigInt(units) <= 0n) {
    throw coded('INVALID_INPUT', `${field} must be a positive whole number of base units`);
  }
  return units;
}

function requireLabel(value, field) {
  const name = String(value ?? '').trim().toLowerCase();
  const problem = customRegistrar.labelProblem(name);
  if (problem) throw coded('INVALID_INPUT', problem);
  return name;
}

function requireYears(value, field = 'years') {
  const years = Number(value);
  const problem = customRegistrar.yearsProblem(years);
  if (problem) throw coded('INVALID_INPUT', problem);
  void field;
  return years;
}

async function labelFor(address) {
  try {
    const accounts = await accountService.listAccounts();
    const own = accounts.find((entry) => entry.address === address);
    if (own) return own.label || own.keyring?.label || null;
  } catch {
    // an unreadable account list only costs a display label
  }
  try {
    const contacts = await contactsService.listContacts();
    return contacts.find((entry) => entry.address === address)?.label ?? null;
  } catch {
    return null;
  }
}

/** Fee quote with its provenance, or an explicit unsupported answer. */
async function feeQuote() {
  try {
    const quote = await txService.estimateFee();
    if (!quote?.supported) {
      return { supported: false, reason: quote?.reason || 'No fee measurement exists on this network.' };
    }
    return {
      supported: true,
      feeUnits: String(quote.feeUnits),
      reserveUnits: quote.reserveUnits == null ? null : String(quote.reserveUnits),
      source: quote.source || 'unknown',
      reason: quote.reason || null,
    };
  } catch (error) {
    return { supported: false, reason: error?.message || 'The fee quote could not be read.' };
  }
}

/** {exists, balanceUnits} where `exists:null` means the read failed, not "absent". */
async function accountState(address) {
  try {
    const info = await txService.getAccountInfo(address);
    return { exists: Boolean(info?.exists), balanceUnits: info?.balance == null ? null : String(info.balance) };
  } catch {
    return { exists: null, balanceUnits: null };
  }
}

/**
 * Token metadata with an explicit trust level. The mint read is chain truth; the local
 * registry row is user-supplied until that read confirms the scale.
 */
async function tokenMetadata(mintAddress) {
  let registryRow = null;
  try {
    const rows = await tokenService.listDeployedTokens();
    registryRow = rows.find((row) => row.mintAddress === mintAddress) ?? null;
  } catch {
    registryRow = null;
  }

  let mintInfo = null;
  let mintReadFailed = false;
  try {
    const read = await tokenService.readMint({ mintAddress });
    mintInfo = read?.exists === false ? { exists: false } : read;
  } catch {
    mintReadFailed = true;
  }

  const mintExists = mintReadFailed ? null : mintInfo?.exists !== false;
  const chainDecimals = mintInfo?.exists && Number.isInteger(mintInfo.decimals) ? mintInfo.decimals : null;
  return {
    mintAddress,
    symbol: (mintInfo?.ticker || registryRow?.symbol || '').toString() || 'TOKEN',
    name: registryRow?.name ?? null,
    decimals: chainDecimals ?? (Number.isInteger(registryRow?.decimals) ? registryRow.decimals : 0),
    metadataVerified: chainDecimals != null,
    mintExists,
    source: chainDecimals != null ? 'mint-account' : (registryRow ? 'local-registry' : 'unknown'),
  };
}

// ---------------------------------------------------------------------------------------
// native-send
// ---------------------------------------------------------------------------------------

async function nativeSendFacts(params, { account, network }) {
  const toAddress = requireAddress(params.toAddress, 'toAddress');
  const amountUnits = requireUnits(params.amountUnits, 'amountUnits');

  const [recipient, sender, fee, duplicate] = await Promise.all([
    accountState(toAddress),
    accountState(account.address),
    feeQuote(),
    txService.checkDuplicate({ toAddress, amountUnits, fromAddress: account.address }).catch(() => null),
  ]);

  return {
    fromAddress: account.address,
    fromLabel: account.label ?? null,
    toAddress,
    recipientLabel: await labelFor(toAddress),
    amountUnits,
    recipient: { exists: recipient.exists },
    balanceUnits: sender.balanceUnits,
    fee,
    duplicate: duplicate?.isDuplicate
      ? {
        isDuplicate: true,
        isPending: Boolean(duplicate.isPending),
        elapsedMs: duplicate.elapsedMs ?? null,
      }
      : null,
    selfSend: toAddress === account.address,
    transferProgramId: network.transferProgramId ?? null,
  };
}

async function nativeSendRecheck(record) {
  const fee = await feeQuote();
  const before = record.facts.fee;
  if (Boolean(fee.supported) !== Boolean(before?.supported)
      || (fee.supported && String(fee.feeUnits) !== String(before.feeUnits))) {
    throw coded('REVIEW_FEE_CHANGED',
      'The network fee changed after this review was prepared. Review the transfer again.');
  }
}

// ---------------------------------------------------------------------------------------
// token-transfer
// ---------------------------------------------------------------------------------------

async function tokenTransferFacts(params, { account, network }) {
  const mintAddress = requireAddress(params.mintAddress, 'mintAddress');
  const toAddress = requireAddress(params.toAddress, 'toAddress');
  const amountUnits = requireUnits(params.amountUnits, 'amountUnits');

  const [metadata, source, recipient, duplicate, recipientAccount] = await Promise.all([
    tokenMetadata(mintAddress),
    thruClient.getTokenBalance(account.address, mintAddress).catch(() => null),
    accountState(toAddress),
    txService.checkDuplicate({
      toAddress, amountUnits, mintAddress, fromAddress: account.address,
    }).catch(() => null),
    // The recipient's own token account, derived from the pinned token program. Absent is a
    // real, user-visible consequence (an extra initialization transaction), so it is read.
    (async () => {
      try {
        const address = await tokenService.deriveTokenAccount(toAddress, mintAddress);
        const info = await thruClient.readTokenAccount(address);
        return { address, exists: Boolean(info?.exists) };
      } catch {
        return { address: null, exists: null };
      }
    })(),
  ]);

  return {
    fromAddress: account.address,
    fromLabel: account.label ?? null,
    toAddress,
    recipientLabel: await labelFor(toAddress),
    mintAddress,
    symbol: metadata.symbol,
    name: metadata.name,
    decimals: metadata.decimals,
    metadataVerified: metadata.metadataVerified,
    metadataSource: metadata.source,
    mintExists: metadata.mintExists,
    amountUnits,
    recipient: { exists: recipient.exists },
    sourceTokenAccount: {
      address: source?.tokenAccount ?? null,
      exists: source ? Boolean(source.exists) : null,
    },
    recipientTokenAccount: recipientAccount,
    balanceUnits: source?.exists && source?.amount != null ? String(source.amount) : null,
    fee: {
      supported: false,
      // Measured for native transfers only; there is no measurement for this path, and a
      // borrowed number would be a fabricated fee.
      reason: 'No fee has been measured for token transfers on this chain, so none is quoted. '
        + 'The charge is paid in THRU and reported only after the chain answers.',
    },
    duplicate: duplicate?.isDuplicate
      ? {
        isDuplicate: true,
        isPending: Boolean(duplicate.isPending),
        elapsedMs: duplicate.elapsedMs ?? null,
      }
      : null,
    tokenProgramId: network.tokenProgramId ?? null,
  };
}

async function tokenTransferRecheck(record) {
  const facts = record.facts;
  const metadata = await tokenMetadata(facts.mintAddress);
  if (metadata.mintExists === false) {
    throw coded('REVIEW_TOKEN_CHANGED',
      'The mint no longer exists on this network. Review the transfer again.');
  }
  if (metadata.metadataVerified && metadata.decimals !== facts.decimals) {
    throw coded('REVIEW_TOKEN_CHANGED',
      'The token scale changed after this review was prepared. Review the transfer again.');
  }
}

// ---------------------------------------------------------------------------------------
// Custom-registrar registration (native fee, self-signed)
// ---------------------------------------------------------------------------------------


async function domainRegisterFacts(params, { account, network }) {
  if (params.via !== 'custom') {
    throw coded('INVALID_INPUT',
      'domain-register covers the custom registrar; use domain-purchase for the paid registry.');
  }
  const name = requireLabel(params.name, 'name');
  const years = requireYears(params.years);

  const info = await registrarService.getCustomRegistrar();
  if (!info.supported) {
    throw coded('TCR_ABSENT', info.reason || 'The custom registrar is unavailable on this network.');
  }
  const check = await registrarService.checkCustomLease({ name });
  const availability = check.readError
    ? 'unknown'
    : (check.domainExists || check.leaseExists) ? 'taken' : 'available';

  const [payer, fee] = await Promise.all([accountState(account.address), feeQuote()]);
  const feePerYear = String(info.feePerYear);
  const totalPriceUnits = (BigInt(feePerYear) * BigInt(years)).toString();

  return {
    fromAddress: account.address,
    fromLabel: account.label ?? null,
    name,
    tld: info.rootName,
    years,
    provider: 'custom',
    pricePerYear: feePerYear,
    totalPriceUnits,
    nativeBalanceUnits: payer.balanceUnits,
    availability: { state: availability, readError: check.readError ?? null },
    root: info.root,
    configAddress: info.configAddress,
    treasury: info.treasury,
    program: {
      name: 'Custom `.thru` registrar',
      address: info.program,
      // Verified only because the deployment is pinned in src/lib/networks.js AND the config's
      // own root matches the name-service derivation this build computes.
      verified: Boolean(info.rootMatchesNameService),
      source: info.rootMatchesNameService
        ? 'Evidence-pinned deployment (D-016); config root matches the name-service derivation'
        : 'Config root does NOT match the name-service derivation',
    },
    instruction: { name: 'Register domain', opcode: customRegistrar.TCR_OP_REGISTER },
    feeReserveUnits: fee.supported ? fee.reserveUnits : null,
    feeNote: null,
  };
}

async function domainRegisterRecheck(record) {
  const facts = record.facts;
  const info = await registrarService.getCustomRegistrar();
  if (!info.supported) {
    throw coded('REVIEW_REGISTRAR_CHANGED',
      'The custom registrar is no longer readable on this network. Review the registration again.');
  }
  if (String(info.feePerYear) !== String(facts.pricePerYear)) {
    throw coded('REVIEW_PRICE_CHANGED',
      'The registrar price changed after review. Review the registration again.');
  }
  const check = await registrarService.checkCustomLease({ name: facts.name });
  if (check.readError) {
    throw coded('REVIEW_UNAVAILABLE',
      'Availability could not be re-verified before signing.', true);
  }
  if (check.domainExists || check.leaseExists) {
    throw coded('NAME_TAKEN', `'${facts.name}.${facts.tld}' is no longer available.`);
  }
}


async function domainCustomRenewFacts(params, { account, network }) {
  const name = requireLabel(params.name, 'name');
  const years = requireYears(params.years);

  const info = await registrarService.getCustomRegistrar();
  if (!info.supported) {
    throw coded('TCR_ABSENT', info.reason || 'The custom registrar is unavailable on this network.');
  }
  const check = await registrarService.checkCustomLease({ name });
  if (check.readError) {
    throw coded('REVIEW_UNAVAILABLE', check.readError);
  }
  if (!check.leaseExists || !check.lease) {
    throw coded('LEASE_NOT_FOUND', `'${name}.${info.rootName}' has no active lease on-chain.`);
  }
  if (check.lease.owner !== account.address) {
    throw coded('NOT_NAME_OWNER', `'${name}.${info.rootName}' belongs to another account.`);
  }

  const [payer, fee] = await Promise.all([accountState(account.address), feeQuote()]);
  const feePerYear = String(info.feePerYear);
  const totalPriceUnits = (BigInt(feePerYear) * BigInt(years)).toString();

  return {
    fromAddress: account.address,
    fromLabel: account.label ?? null,
    name,
    tld: info.rootName,
    years,
    provider: 'custom',
    pricePerYear: feePerYear,
    totalPriceUnits,
    nativeBalanceUnits: payer.balanceUnits,
    availability: { state: 'mine', readError: null },
    lease: {
      owner: check.lease.owner,
      endTime: check.lease.expiresAtSeconds == null ? null : String(check.lease.expiresAtSeconds),
      expiredHint: check.lease.expiredHint ?? false,
      mine: true,
    },
    root: info.root,
    configAddress: info.configAddress,
    treasury: info.treasury,
    program: {
      name: 'Custom `.thru` registrar',
      address: info.program,
      verified: Boolean(info.rootMatchesNameService),
      source: info.rootMatchesNameService
        ? 'Evidence-pinned deployment (D-016); config root matches the name-service derivation'
        : 'Config root does NOT match the name-service derivation',
    },
    instruction: { name: 'Renew domain lease', opcode: customRegistrar.TCR_OP_RENEW },
    feeReserveUnits: fee.supported ? fee.reserveUnits : null,
    feeNote: null,
  };
}

async function domainCustomRenewRecheck(record) {
  const facts = record.facts;
  const info = await registrarService.getCustomRegistrar();
  if (!info.supported) {
    throw coded('REVIEW_REGISTRAR_CHANGED', 'The custom registrar is no longer readable on this network. Review the renewal again.');
  }
  if (String(info.feePerYear) !== String(facts.pricePerYear)) {
    throw coded('REVIEW_PRICE_CHANGED', 'The registrar price changed after review. Review the renewal again.');
  }
  const check = await registrarService.checkCustomLease({ name: facts.name });
  if (check.readError) {
    throw coded('REVIEW_UNAVAILABLE', 'Lease could not be re-verified before signing.', true);
  }
  if (!check.leaseExists || !check.lease) {
    throw coded('LEASE_NOT_FOUND', `'${facts.name}' no longer has a lease.`);
  }
  if (check.lease.owner !== record.accountAddress) {
    throw coded('NOT_NAME_OWNER', `'${facts.name}' is owned by another account now.`);
  }
  if (facts.lease?.endTime != null && String(check.lease.expiresAtSeconds) !== String(facts.lease.endTime)) {
    throw coded('REVIEW_EXPIRY_CHANGED', 'The lease expiry changed after review. Review the renewal again.');
  }
}

// ---------------------------------------------------------------------------------------
// Paid registry writes: purchase / renew / claim
// ---------------------------------------------------------------------------------------

const REGISTRY_PROGRAM = Object.freeze({
  name: 'Thru `.thru` name registrar',
  source: 'First-party registrar program pinned by src/lib/registrar.js',
});

async function registryWriteFacts(params, { account, mode }) {
  const name = requireLabel(params.name, 'name');
  const years = requireYears(params.years);

  const registry = await registrarService.getRegistry();
  if (!registry.supported) {
    throw coded('REGISTRY_ABSENT',
      registry.reason || 'The `.thru` registry is not initialized on this network.');
  }
  const cfg = registry.registry;
  const lease = await registrarService.checkLease({ name });
  if (!lease.supported) {
    throw coded('REGISTRY_ABSENT',
      lease.reason || 'The `.thru` registry is not initialized on this network.');
  }

  const [payment, balance, fee] = await Promise.all([
    tokenMetadata(cfg.tokenMint),
    thruClient.getTokenBalance(account.address, cfg.tokenMint).catch(() => null),
    feeQuote(),
  ]);

  let availability;
  let leaseFacts = null;
  if (mode === 'purchase') {
    availability = (lease.leaseExists || lease.domainExists) ? 'taken' : 'available';
    if (lease.lease) {
      leaseFacts = {
        owner: lease.lease.owner,
        endTime: lease.lease.endTime == null ? null : String(lease.lease.endTime),
        expiredHint: lease.lease.expiredHint,
        mine: lease.lease.owner === account.address,
      };
    }
  } else {
    if (!lease.leaseExists) {
      availability = 'missing';
    } else if (mode === 'renew') {
      availability = lease.lease?.owner === account.address ? 'mine' : 'taken';
    } else {
      availability = 'expired';
    }
    if (lease.lease) {
      leaseFacts = {
        owner: lease.lease.owner,
        endTime: lease.lease.endTime == null ? null : String(lease.lease.endTime),
        expiredHint: lease.lease.expiredHint,
        mine: lease.lease.owner === account.address,
      };
    }
  }

  return {
    fromAddress: account.address,
    fromLabel: account.label ?? null,
    name,
    tld: cfg.rootName,
    years,
    provider: 'registry',
    pricePerYear: String(cfg.pricePerYear),
    totalPriceUnits: (BigInt(cfg.pricePerYear) * BigInt(years)).toString(),
    paymentBalanceUnits: balance?.exists && balance?.amount != null ? String(balance.amount) : null,
    payment: {
      mintAddress: cfg.tokenMint,
      symbol: payment.symbol,
      name: payment.name,
      decimals: payment.decimals,
      verified: payment.metadataVerified,
    },
    availability: { state: availability, readError: null },
    lease: leaseFacts,
    leaseExists: Boolean(lease.leaseExists),
    domainExists: Boolean(lease.domainExists),
    configAddress: registry.configAddress,
    // The decoder and the execution account table call this `treasury`; emitting `treasurer`
    // here silently rendered the real address as 'unknown' (audit F-10, 2026-10-28).
    treasury: cfg.treasurer ?? null,
    nameServiceProgram: cfg.nameServiceProgram,
    program: {
      ...REGISTRY_PROGRAM,
      address: registrar.THRU_REGISTRAR_PROGRAM,
      verified: true,
    },
    instruction: {
      name: mode === 'purchase' ? 'Purchase domain'
        : mode === 'renew' ? 'Renew lease' : 'Claim expired lease',
      opcode: mode === 'purchase' ? registrar.REG_OP_PURCHASE_DOMAIN
        : mode === 'renew' ? registrar.REG_OP_RENEW_LEASE : registrar.REG_OP_CLAIM_EXPIRED_DOMAIN,
    },
    feeReserveUnits: fee.supported ? fee.reserveUnits : null,
    feeNote: null,
  };
}

async function registryWriteRecheck(record) {
  const facts = record.facts;
  const registry = await registrarService.getRegistry();
  if (!registry.supported) {
    throw coded('REVIEW_REGISTRAR_CHANGED',
      'The `.thru` registry is no longer readable on this network. Review again.');
  }
  if (String(registry.registry.pricePerYear) !== String(facts.pricePerYear)) {
    throw coded('REVIEW_PRICE_CHANGED',
      'The registrar price changed after review. Review the name again.');
  }
  const lease = await registrarService.checkLease({ name: facts.name });
  if (!lease.supported) {
    throw coded('REVIEW_REGISTRAR_CHANGED', 'The lease could not be re-read before signing.');
  }

  if (record.kind === 'domain-purchase') {
    if (lease.leaseExists || lease.domainExists) {
      throw coded('NAME_TAKEN', `'${facts.name}.${facts.tld}' is no longer available.`);
    }
    return;
  }
  if (record.kind === 'domain-renew') {
    if (!lease.lease) throw coded('LEASE_NOT_FOUND', `'${facts.name}' no longer has a lease.`);
    if (lease.lease.owner !== record.accountAddress) {
      throw coded('NOT_NAME_OWNER', `'${facts.name}' is owned by another account now.`);
    }
    if (facts.lease?.endTime != null && String(lease.lease.endTime) !== String(facts.lease.endTime)) {
      throw coded('REVIEW_EXPIRY_CHANGED',
        'The lease expiry changed after review. Review the renewal again.');
    }
    return;
  }
  if (record.kind === 'domain-claim') {
    if (!lease.lease) throw coded('LEASE_NOT_FOUND', `'${facts.name}' no longer has a lease.`);
    if (lease.lease.expiredHint === false) {
      throw coded('LEASE_NOT_EXPIRED', `'${facts.name}' is still leased.`);
    }
  }
}

// ---------------------------------------------------------------------------------------
// faucet-claim
// ---------------------------------------------------------------------------------------

async function faucetClaimFacts(params, { account, network }) {
  const amountUnits = requireUnits(params.amountUnits, 'amountUnits');
  if (!network.faucetProgramId) {
    throw coded('UNSUPPORTED', `${network.label} has no faucet.`);
  }
  const capUnits = network.faucetMaxPerClaim == null ? null : String(network.faucetMaxPerClaim);
  if (capUnits != null && BigInt(amountUnits) > BigInt(capUnits)) {
    throw coded('INVALID_INPUT', `This faucet pays at most ${capUnits} base units per claim.`);
  }

  const [limit, state] = await Promise.all([
    txService.getFaucetLimit().catch((error) => ({
      supported: false,
      reason: error?.message || 'The faucet policy could not be read.',
    })),
    accountState(account.address),
  ]);

  const rule = Array.isArray(limit?.rules) ? limit.rules[0] : null;
  const summary = rule?.summary ?? null;
  const paused = Boolean(limit?.paused);
  const exhausted = summary?.exhausted === true;
  const targetMismatch = limit?.supported === true && limit.targetMatchesFaucet === false;

  return {
    fromAddress: account.address,
    fromLabel: account.label ?? null,
    amountUnits,
    capUnits,
    accountExists: state.exists === true,
    limit: limit?.supported
      ? {
        supported: true,
        paused,
        exhausted,
        targetMatchesFaucet: limit.targetMatchesFaucet !== false,
        remainingAmount: summary?.remainingAmount == null ? null : String(summary.remainingAmount),
        window: summary?.window == null ? null : String(summary.window),
        resetAtUnixSec: summary?.resetAtUnixSec == null ? null : String(summary.resetAtUnixSec),
        maxAmountPerCall: limit.maxAmountPerCall == null ? null : String(limit.maxAmountPerCall),
        reason: targetMismatch ? 'the policy targets a different faucet program' : null,
      }
      : { supported: false, reason: limit?.reason ?? 'The faucet policy could not be read.' },
    fee: {
      supported: false,
      reason: 'The faucet claim path does not report a charged fee, so none is shown.',
    },
    programAddress: network.faucetProgramId,
    vaultAddress: network.faucetStateAccount ?? null,
  };
}

async function faucetClaimRecheck(record) {
  const limit = await txService.getFaucetLimit().catch(() => null);
  if (!limit?.supported) return; // unknown now; the handler still enforces on-chain
  if (limit.paused) {
    throw coded('REVIEW_FAUCET_CHANGED', 'The faucet was paused after this review.');
  }
  if (limit.targetMatchesFaucet === false) {
    throw coded('REVIEW_FAUCET_CHANGED',
      'The faucet policy no longer targets this network\'s faucet program.');
  }
  const summary = Array.isArray(limit.rules) ? limit.rules[0]?.summary : null;
  if (summary?.exhausted) {
    throw coded('REVIEW_FAUCET_CHANGED',
      'This account used its faucet allowance after this review.');
  }
  void record;
}

// ---------------------------------------------------------------------------------------
// raw (display-only; never executable)
// ---------------------------------------------------------------------------------------

async function rawFacts(params) {
  const programAddress = params.programAddress == null
    ? null
    : requireAddress(params.programAddress, 'programAddress');
  const dataHex = params.dataHex == null ? null : String(params.dataHex).trim();
  if (dataHex != null && (dataHex.length > 4096 || !/^[0-9a-fA-F]*$/.test(dataHex))) {
    throw coded('INVALID_INPUT', 'dataHex must be hexadecimal and at most 4096 characters.');
  }
  const accounts = Array.isArray(params.accounts) ? params.accounts.slice(0, 32) : [];
  if (params.accounts != null && !Array.isArray(params.accounts)) {
    throw coded('INVALID_INPUT', 'accounts must be an array.');
  }
  for (const entry of accounts) {
    requireAddress(entry?.address, 'accounts[].address');
  }
  return {
    programAddress,
    programName: params.programName == null ? null : String(params.programName).slice(0, 96),
    programVerified: params.programVerified === true,
    programNote: params.programNote == null ? null : String(params.programNote).slice(0, 200),
    dataHex: dataHex || null,
    note: params.note == null ? null : String(params.note).slice(0, 200),
    accounts: accounts.map((entry) => ({
      role: entry.role == null ? 'Account' : String(entry.role).slice(0, 48),
      address: String(entry.address),
    })),
  };
}

// ---------------------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------------------

const KINDS = new Map();

/**
 * @param {string} kind
 * @param {{facts: Function, recheck: Function|null, submit: Function|null}} spec
 */
function register(kind, spec) {
  if (KINDS.has(kind)) throw new Error(`review: duplicate kind '${kind}'`);
  KINDS.set(kind, { id: kind, recheck: null, submit: null, ...spec });
}

register('native-send', {
  facts: nativeSendFacts,
  recheck: nativeSendRecheck,
  submit: (facts, { acknowledgements = [] } = {}) => ({
    method: 'tx.sendChecked',
    params: {
      toAddress: facts.toAddress,
      amountUnits: facts.amountUnits,
      fromAddress: facts.fromAddress,
      networkId: facts.networkId,
      // The handler's own duplicate guard stays authoritative; this only forwards the
      // acknowledgement the user actually gave on the review screen.
      ...(acknowledgements.includes('duplicate-transfer') ? { allowDuplicate: true } : {}),
    },
  }),
});

register('token-transfer', {
  facts: tokenTransferFacts,
  recheck: tokenTransferRecheck,
  submit: (facts, { acknowledgements = [] } = {}) => ({
    method: 'token.transferChecked',
    params: {
      mintAddress: facts.mintAddress,
      toAddress: facts.toAddress,
      amountUnits: facts.amountUnits,
      fromAddress: facts.fromAddress,
      networkId: facts.networkId,
      ...(acknowledgements.includes('duplicate-transfer') ? { allowDuplicate: true } : {}),
    },
  }),
});

register('domain-register', {
  facts: domainRegisterFacts,
  recheck: domainRegisterRecheck,
  submit: (facts) => ({
    method: 'name.register',
    params: {
      name: facts.name,
      years: facts.years,
      via: 'custom',
      expectedAccountAddress: facts.fromAddress,
      expectedNetworkId: facts.networkId,
      expectedPricePerYear: facts.pricePerYear,
    },
  }),
});

register('domain-purchase', {
  facts: (params, ctx) => registryWriteFacts(params, { ...ctx, mode: 'purchase' }),
  recheck: registryWriteRecheck,
  submit: (facts) => ({
    method: 'name.purchase',
    params: {
      name: facts.name,
      years: facts.years,
      expectedAccountAddress: facts.fromAddress,
      expectedNetworkId: facts.networkId,
      expectedPricePerYear: facts.pricePerYear,
    },
  }),
});

register('domain-renew', {
  facts: (params, ctx) => params.via === 'custom'
    ? domainCustomRenewFacts(params, ctx)
    : registryWriteFacts(params, { ...ctx, mode: 'renew' }),
  recheck: (record) => record.facts.provider === 'custom'
    ? domainCustomRenewRecheck(record)
    : registryWriteRecheck(record),
  submit: (facts) => ({
    method: 'name.renewLease',
    params: {
      name: facts.name,
      years: facts.years,
      ...(facts.provider === 'custom' ? { via: 'custom' } : {}),
      expectedAccountAddress: facts.fromAddress,
      expectedNetworkId: facts.networkId,
      expectedPricePerYear: facts.pricePerYear,
      ...(facts.lease?.endTime != null ? { expectedLeaseEndTime: String(facts.lease.endTime) } : {}),
    },
  }),
});

register('domain-claim', {
  facts: (params, ctx) => registryWriteFacts(params, { ...ctx, mode: 'claim' }),
  recheck: registryWriteRecheck,
  submit: (facts) => ({
    method: 'name.claimExpired',
    params: {
      name: facts.name,
      years: facts.years,
      expectedAccountAddress: facts.fromAddress,
      expectedNetworkId: facts.networkId,
      expectedPricePerYear: facts.pricePerYear,
      ...(facts.lease?.endTime != null ? { expectedLeaseEndTime: String(facts.lease.endTime) } : {}),
    },
  }),
});

register('faucet-claim', {
  facts: faucetClaimFacts,
  recheck: faucetClaimRecheck,
  submit: (facts) => ({
    method: 'tx.claimFaucet',
    params: { amountUnits: facts.amountUnits },
  }),
});

register('raw', {
  facts: rawFacts,
  recheck: null,
  // Display-only by construction: no submit policy, so no path from this screen to a signature.
  submit: null,
});

export function getKind(kind) {
  return KINDS.get(kind) ?? null;
}

export function listKinds() {
  return [...KINDS.keys()].sort();
}
