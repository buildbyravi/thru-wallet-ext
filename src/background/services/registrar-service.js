// Registrar service — official `.thru` paid-lease registration (purchase / renew /
// claim-expired) built on first-party formats (provenance in src/lib/registrar.js).
//
// Read path  : name.getRegistry + name.checkLease are honest chain reads (supports-absent
//              reported, never fabricated).
// Write path : name.purchase / name.renewLease / name.claimExpired are auth:'signing'
//              contract methods (v22). Every write is self-signed (fee payer = vault
//              signer), pays from the fee payer's OWN token account of the registry mint,
//              carries fee 0n exactly like the first-party CLI (THRU_REGISTRAR_PROGRAM_FEE
//              = 0 — the registrar program charges its own token price, there is no
//              protocol fee field to fill), and re-reads config fresh at build time so a
//              registry change between quote and submit is caught.
//
// Honest boundaries documented here rather than hidden:
//   - lease end times are raw u64 "chain time"; expiry hints compare them to LOCAL
//     epoch seconds — the program's check is authoritative, ours is a display hint
//     (purchase falls back to claim when the lease account still exists).
//   - the purchase flow needs the registry's config account initialized on the running
//     network; where that is absent the methods answer REGISTRY_ABSENT, never a guess.

import * as vault from '../../lib/vault.js';
import * as thruClient from '../../lib/thru-client.js';
import * as reg from '../../lib/registrar.js';
import * as tcr from '../../lib/custom-registrar.js';
import { domainAccountAddress, registrarConfigAddress, rootRegistrarAddress, NAME_SERVICE_PROGRAM } from '../../lib/name-service.js';
import { getActiveNetworkConfig } from './network-service.js';
import * as pending from './pending-tx-service.js';
import * as balances from './balance-service.js';

function coded(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  if (extra.retryable !== undefined) err.retryable = extra.retryable;
  return err;
}

function assertReviewContext({ expectedNetworkId, expectedAccountAddress, expectedPricePerYear } = {}, network, account, cfg) {
  if (expectedNetworkId && expectedNetworkId !== network?.id) {
    throw coded('REVIEW_NETWORK_CHANGED', 'The active network changed after review. Check the name again before signing.');
  }
  if (expectedAccountAddress && expectedAccountAddress !== account?.address) {
    throw coded('REVIEW_ACCOUNT_CHANGED', 'The active account changed after review. Check the name again before signing.');
  }
  const currentPrice = cfg?.pricePerYear ?? cfg?.feePerYear;
  if (expectedPricePerYear != null && String(expectedPricePerYear) !== String(currentPrice)) {
    throw coded('REVIEW_PRICE_CHANGED', 'The registrar price changed after review. Check the name again for the current price.');
  }
}

async function fetchAccountData(address) {
  const info = await thruClient.getAccountInfo(address);
  if (!info?.exists) return { exists: false, data: null, raw: null };
  const raw = info.raw ?? null;
  const data = raw?.data?.data instanceof Uint8Array ? raw.data.data : (raw?.data instanceof Uint8Array ? raw.data : null);
  return { exists: true, data, raw };
}

function accountOwner(raw) {
  const owner = raw?.meta?.owner ?? raw?.owner ?? null;
  if (!owner) return null;
  try { return String(owner); } catch { return null; }
}

/**
 * name.getRegistry — read the registrar config account (derived, official formula) and
 * parse it. Absence is a supported:false answer, not an error: networks where the `.thru`
 * registry was never initialized simply have no registrar namespace.
 */
export async function getRegistry() {
  await getActiveNetworkConfig(); // bind SDK to the active network before reading
  const configAddress = registrarConfigAddress();
  const { exists, data, raw } = await fetchAccountData(configAddress).catch((err) => {
    throw coded('REGISTRY_UNREADABLE', `Could not read the registry config: ${err?.message ?? err}`, { retryable: true });
  });
  if (!exists || !data) {
    return { supported: false, reason: 'the .thru registry is not initialized on this network', configAddress };
  }
  let config;
  try {
    config = reg.parseRegistrarConfig(data);
  } catch (err) {
    return { supported: false, reason: `registry config present but unreadable (${err?.message ?? err})`, configAddress };
  }
  const owner = accountOwner(raw);
  if (owner && owner !== reg.THRU_REGISTRAR_PROGRAM) {
    return {
      supported: false,
      reason: `registry config is owned by ${owner.slice(0, 12)}…, not the registrar program — refusing to read it as a registry`,
      configAddress,
    };
  }
  // Cross-check the config's own bookkeeping against the pinned programs (a config whose
  // name-service pointer disagrees with the pin is not something we will build against).
  if (config.nameServiceProgram !== reg.NAME_SERVICE_PROGRAM) {
    return {
      supported: false,
      reason: `registry points at a different name-service program (${config.nameServiceProgram.slice(0, 12)}…) than the pinned build`,
      configAddress,
    };
  }
  return {
    supported: true,
    configAddress,
    registry: {
      nameServiceProgram: config.nameServiceProgram,
      rootRegistrar: config.rootRegistrar,
      treasurer: config.treasurer,
      tokenMint: config.tokenMint,
      tokenProgram: config.tokenProgram,
      rootName: config.rootName,
      pricePerYear: String(config.pricePerYear),
      totalDomainsSold: String(config.totalDomainsSold),
    },
  };
}

/**
 * name.checkLease — derived lease + domain addresses for a base name, with live existence
 * and (when present) parsed lease fields. Expiry is a local-clock HINT only.
 */
export async function checkLease({ name } = {}) {
  const prob = reg.purchaseNameProblem(name);
  if (prob) throw coded('INVALID_NAME', prob);
  const registry = await getRegistry();
  if (!registry.supported) return { supported: false, reason: registry.reason };
  const n = String(name).trim();
  const [leaseAddress, domainAddress] = await Promise.all([
    reg.leaseAccountAddress(n),
    domainAccountAddress(registry.registry.rootRegistrar, n),
  ]);
  const leaseInfo = await fetchAccountData(leaseAddress);
  let lease = null;
  let leaseParseError = null;
  if (leaseInfo.exists && leaseInfo.data) {
    try { lease = reg.parseLease(leaseInfo.data); } catch (err) { leaseParseError = err?.message ?? String(err); }
  } else if (leaseInfo.exists) {
    leaseParseError = 'lease account data is unavailable';
  }
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  const expirationHint = lease ? lease.leaseEndTime <= nowSeconds : null;
  const domainInfo = await fetchAccountData(domainAddress);
  return {
    supported: true,
    name: n,
    leaseAddress,
    domainAddress,
    leaseExists: Boolean(leaseInfo.exists),
    leaseParseError,
    domainExists: domainInfo.exists,
    lease: lease && {
      owner: lease.owner,
      name: lease.name,
      startTime: String(lease.leaseStartTime),
      endTime: String(lease.leaseEndTime),
      expiredHint: expirationHint,
      domainAccount: lease.domainAccount,
    },
    rootRegistrar: registry.registry.rootRegistrar,
  };
}

/**
 * name.getPaymentBalance — the active account's token-account state for the registry's
 * payment mint, for the registration UI's honest price/balance line. Missing account or
 * unreadable balance is reported, never coerced to zero.
 */
export async function getPaymentBalance() {
  await getActiveNetworkConfig();
  const registry = await getRegistry();
  if (!registry.supported) return { supported: false, reason: registry.reason };
  const account = await vault.getActiveAccount();
  if (!account?.address) return { supported: false, reason: 'no active account' };
  const bal = await thruClient.getTokenBalance(account.address, registry.registry.tokenMint);
  return {
    supported: true,
    exists: Boolean(bal?.exists),
    amount: bal?.exists && bal?.amount != null ? String(bal.amount) : null,
    tokenAccount: bal?.tokenAccount ?? null,
    mint: registry.registry.tokenMint,
  };
}

/**
 * name.purchase — buy a `.thru` lease for the active account (self-signed; fee 0n).
 * Token charge = price_per_year × years, paid from the signer's own token account of the
 * registry mint. Steps mirror the first-party CLI exactly.
 */
export async function purchaseDomain({ name, years, expectedNetworkId, expectedAccountAddress, expectedPricePerYear } = {}) {
  const prob = reg.purchaseNameProblem(name);
  if (prob) throw coded('INVALID_NAME', prob);
  const yp = reg.yearsProblem(years);
  if (yp) throw coded('INVALID_YEARS', yp);
  const n = String(name).trim();
  const y = Number(years);

  const feePayer = await vault.getActiveAccount();
  const network = await getActiveNetworkConfig(); // bind before building/signing
  const registry = await getRegistry();
  if (!registry.supported) throw coded('REGISTRY_ABSENT', registry.reason ?? 'registry not available here');
  const cfg = registry.registry;
  assertReviewContext({ expectedNetworkId, expectedAccountAddress, expectedPricePerYear }, network, feePayer, cfg);
  if (cfg.tokenProgram !== network.tokenProgramId) {
    throw coded('REGISTRY_UNSUPPORTED', `the registry's token program (${cfg.tokenProgram.slice(0, 12)}…) differs from this build's pinned token program — refusing to construct the payment`);
  }

  const leaseAddress = await reg.leaseAccountAddress(n);
  const domainAddress = await domainAccountAddress(cfg.rootRegistrar, n);

  // Existence semantics (purchase CREATES both accounts via creation state proofs):
  //   - domain already exists  → taken; expected path is renew (own) or claim (expired).
  //   - lease already exists   → a creation proof cannot apply to an existing account;
  //     an unexpired lease means taken, an expired one means claimExpiredDomain is the
  //     right instruction, not purchase.
  const domainInfo = await fetchAccountData(domainAddress);
  if (domainInfo.exists) throw coded('NAME_TAKEN', `'${n}' already exists under the ${cfg.rootName} root.`);
  const leaseInfo = await fetchAccountData(leaseAddress);
  if (leaseInfo.exists) {
    let lease = null;
    try { lease = leaseInfo.data ? reg.parseLease(leaseInfo.data) : null; } catch { lease = null; }
    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    if (lease && lease.leaseEndTime <= nowSeconds) {
      throw coded('LEASE_CLAIM_REQUIRED', `'${n}' has an expired lease on-chain — claim it instead of purchasing (the chain keeps its account).`);
    }
    throw coded('NAME_TAKEN', `'${n}' already has an active lease.`);
  }

  // Payment: the signer's own token account of the registry mint, balance ≥ price × years.
  const payerBalance = await thruClient.getTokenBalance(feePayer.address, cfg.tokenMint);
  if (!payerBalance.exists) {
    throw coded('PAYMENT_ACCOUNT_MISSING', `You have no token account for the registry's payment token (${cfg.tokenMint.slice(0, 12)}…).`);
  }
  const pricePerYear = BigInt(cfg.pricePerYear);
  const totalPrice = pricePerYear * BigInt(y);
  const have = payerBalance.amount == null ? null : BigInt(payerBalance.amount);
  if (have === null) throw coded('PAYMENT_ACCOUNT_UNREADABLE', 'Could not verify your payment token balance right now.', { retryable: true });
  if (have < totalPrice) {
    throw coded('INSUFFICIENT_PAYMENT_FUNDS', `This registration costs ${totalPrice} base units of the registry token; your account holds ${have}.`);
  }

  // Creation state proofs (proofType 1 = Creating — the same proof the token account
  // initializer embeds; the purchase instruction carries both proofs inline).
  const client = thruClient.getClient();
  const [leaseProofObj, domainProofObj] = await Promise.all([
    client.proofs.generate({ address: leaseAddress, proofType: 1 }),
    client.proofs.generate({ address: domainAddress, proofType: 1 }),
  ]);

  const { rawTransaction } = await client.transactions.buildAndSign({
    feePayer: { publicKey: feePayer.publicKey, privateKey: feePayer.privateKey },
    program: reg.THRU_REGISTRAR_PROGRAM,
    header: { ...reg.REG_HEADER_PURCHASE },
    accounts: {
      readWrite: [registry.configAddress, leaseAddress, domainAddress, cfg.treasurer, payerBalance.tokenAccount, cfg.rootRegistrar],
      readOnly: [cfg.nameServiceProgram, cfg.tokenMint, cfg.tokenProgram],
    },
    instructionData: ({ getAccountIndex }) => reg.buildPurchaseDomainInstructionData({
      name: n, years: y, indexOf: getAccountIndex,
      configAddress: registry.configAddress, leaseAddress, domainAddress,
      rootRegistrarAddress: cfg.rootRegistrar, treasurerAddress: cfg.treasurer,
      payerTokenAddress: payerBalance.tokenAccount, tokenMintAddress: cfg.tokenMint,
      tokenProgramAddress: cfg.tokenProgram,
      leaseProof: leaseProofObj.proof, domainProof: domainProofObj.proof,
    }),
  });

  await balances.getBalances([feePayer.address]).catch(() => null);
  return submitAndAwait(rawTransaction, {
    kind: 'name-purchase', from: feePayer.address,
    displayAmount: `${totalPrice} payment-token base units — purchase '${n}.${cfg.rootName}' (${y}y)`,
  });
}

/**
 * name.renewLease — extend an EXISTING lease owned by the active account. No proofs.
 */
export async function renewLease(params = {}) {
  return renewOrClaim({ ...params, claim: false });
}

/**
 * name.claimExpiredDomain — take over a lease whose end time has passed (owner ≠ signer).
 */
export async function claimExpiredDomain(params = {}) {
  return renewOrClaim({ ...params, claim: true });
}

async function renewOrClaim({ name, years, claim, expectedNetworkId, expectedAccountAddress, expectedPricePerYear, expectedLeaseEndTime }) {
  const prob = reg.purchaseNameProblem(name);
  if (prob) throw coded('INVALID_NAME', prob);
  const yp = reg.yearsProblem(years);
  if (yp) throw coded('INVALID_YEARS', yp);
  const n = String(name).trim();
  const y = Number(years);

  const feePayer = await vault.getActiveAccount();
  const network = await getActiveNetworkConfig();
  const registry = await getRegistry();
  if (!registry.supported) throw coded('REGISTRY_ABSENT', registry.reason ?? 'registry not available here');
  const cfg = registry.registry;
  assertReviewContext({ expectedNetworkId, expectedAccountAddress, expectedPricePerYear }, network, feePayer, cfg);
  if (cfg.tokenProgram !== network.tokenProgramId) {
    throw coded('REGISTRY_UNSUPPORTED', `the registry's token program (${cfg.tokenProgram.slice(0, 12)}…) differs from this build's pinned token program — refusing to construct the payment`);
  }

  const leaseAddress = await reg.leaseAccountAddress(n);
  const leaseInfo = await fetchAccountData(leaseAddress);
  if (!leaseInfo.exists || !leaseInfo.data) throw coded('LEASE_NOT_FOUND', `'${n}' has no lease on-chain to ${claim ? 'claim' : 'renew'}.`);
  let lease;
  try { lease = reg.parseLease(leaseInfo.data); }
  catch { throw coded('LEASE_UNREADABLE', `the lease account for '${n}' is present but unreadable`); }
  if (expectedLeaseEndTime != null && String(expectedLeaseEndTime) !== String(lease.leaseEndTime)) {
    throw coded('REVIEW_EXPIRY_CHANGED', 'The lease expiry changed after review. Check the name again before signing.');
  }

  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  if (claim) {
    if (lease.leaseEndTime > nowSeconds) {
      throw coded('LEASE_NOT_EXPIRED', `'${n}' is still leased (chain time ends at ${lease.leaseEndTime}) — only an expired lease can be claimed.`);
    }
  } else if (lease.owner !== feePayer.address) {
    throw coded('NOT_NAME_OWNER', `'${n}' is leased to ${lease.owner.slice(0, 12)}… — only the lease owner can renew it.`);
  }

  const payerBalance = await thruClient.getTokenBalance(feePayer.address, cfg.tokenMint);
  if (!payerBalance.exists) {
    throw coded('PAYMENT_ACCOUNT_MISSING', `You have no token account for the registry's payment token (${cfg.tokenMint.slice(0, 12)}…).`);
  }
  const totalPrice = BigInt(cfg.pricePerYear) * BigInt(y);
  const have = payerBalance.amount == null ? null : BigInt(payerBalance.amount);
  if (have === null) throw coded('PAYMENT_ACCOUNT_UNREADABLE', 'Could not verify your payment token balance right now.', { retryable: true });
  if (have < totalPrice) {
    throw coded('INSUFFICIENT_PAYMENT_FUNDS', `This ${claim ? 'claim' : 'renewal'} costs ${totalPrice} base units of the registry token; your account holds ${have}.`);
  }

  const client = thruClient.getClient();
  const { rawTransaction } = await client.transactions.buildAndSign({
    feePayer: { publicKey: feePayer.publicKey, privateKey: feePayer.privateKey },
    program: reg.THRU_REGISTRAR_PROGRAM,
    header: { ...reg.REG_HEADER_RENEW },
    accounts: {
      readWrite: [leaseAddress, cfg.treasurer, payerBalance.tokenAccount],
      readOnly: [registry.configAddress, cfg.tokenMint, cfg.tokenProgram],
    },
    instructionData: ({ getAccountIndex }) => reg.buildRenewLeaseInstructionData({
      years: y, indexOf: getAccountIndex, claim,
      configAddress: registry.configAddress, leaseAddress, treasurerAddress: cfg.treasurer,
      payerTokenAddress: payerBalance.tokenAccount, tokenMintAddress: cfg.tokenMint,
      tokenProgramAddress: cfg.tokenProgram,
    }),
  });

  await balances.getBalances([feePayer.address]).catch(() => null);
  return submitAndAwait(rawTransaction, {
    kind: claim ? 'name-claim' : 'name-renew', from: feePayer.address,
    displayAmount: `${totalPrice} payment-token base units — ${claim ? 'claim' : 'renew'} '${n}.${cfg.rootName}' (${y}y)`,
  });
}

/**
 * Await the execution stream, tracking the submission for history/notifications as soon
 * as a signature exists — same honesty pattern as sendTransfer/claimFaucet.
 */
async function submitAndAwait(rawTransaction, { kind, from, displayAmount, errorNoun = 'registrar', describeError = null, result = null } = {}) {
  const network = await getActiveNetworkConfig();
  let formatted = null;
  try {
    for await (const update of thruClient.getClient().transactions.sendAndTrack(rawTransaction)) {
      if (update?.signature?.value && formatted === null) {
        formatted = reg.formatSignature(update.signature.value);
        await pending.track({ signature: formatted, kind, from, to: from, amountUnits: '0', displayAmount: displayAmount ?? null, networkId: network.id }).catch(() => null);
      }
      if (update?.executionResult) {
        if (update.executionResult.vmError === 0) {
          return { signature: formatted, blockHeight: null, ...(result ?? {}) };
        }
        const userCode = update.executionResult.userErrorCode ?? 0;
        const decoded = userCode && describeError ? describeError(Number(userCode)) : null;
        throw coded('REGISTRAR_TX_REVERTED', `Registration transaction reverted on-chain (vmError=${update.executionResult.vmError}${userCode ? `, ${errorNoun} error ${userCode}${decoded ? ` — ${decoded}` : ''}` : ''}).`);
      }
    }
  } catch (err) {
    if (err?.code === 'REGISTRAR_TX_REVERTED') throw err;
    throw coded('TX_RESULT_MISSING', `The ${errorNoun} submission could not be resolved${formatted ? ` (signature ${formatted})` : ''}. Check pending transactions and the name before retrying.`, { retryable: true });
  }
  throw coded('TX_RESULT_MISSING', 'Registration transaction never returned an execution result (timed out?).', { retryable: true });
}

// ============================================================================
// ---- Custom registrar (TCR, contracts/thru-custom-registrar) ----------------
// ============================================================================
//
// The owner's custom `.thru` name registrar — OUR program, deployed on Betanet.
// Live-verified 2026-10-25 (owner host, D-016): register executed vmError 0; the domain,
// the 1-year lease and the treasury fee flow all re-read from chain. Evidence:
//   scripts/defi-evidence/registrar-{deploy,probe}-betanet-*.json
// The ONLY configured fact is the program address (src/lib/networks.js
// customRegistrarProgram, evidence-pinned). Everything else — config address, root,
// fee, treasury — is chain-derived and chain-read on every call; a chain whose config
// is absent or unparseable is a supported:false answer, never a guess.
//
// Write invariants (mirroring the LIVE-VERIFIED probe script 1:1):
//   - self-signed: feePayer (vault signer) is the ONLY authority; target = the signer.
//   - fee 0n on the transaction header; the registrar's own price (config.feePerYear ×
//     years) is charged by the PROGRAM to the treasury — best-effort on Betanet today:
//     ThruVM refuses a contract debiting an unowned native EOA (AccountNotWritable), and
//     the program deliberately treats the debit as non-fatal (processor.rs, D-016), so a
//     registration CAN succeed without the treasury receiving the fee on native-only
//     accounts. The UI quotes the config fee and says exactly this.
//   - creation state proofs: domain first (extract proof slot from its u64 timestamp),
//     lease with targetSlot aligned to that slot; tx header startSlot = same slot.
//     misaligned proofs revert InvalidProofSlot (-33) — proven live.

function tcrCoded(code, message, extra = {}) { return coded(code, message, extra); }

/**
 * name.getCustomRegistrar (v25) — chain truth for the custom registrar on THIS network:
 * { supported:false, reason } when the network has no evidence-pinned program, or the
 * config account is absent/unparseable; otherwise the fully parsed config plus a
 * root-derivation cross-check (config.rootAddress == name-service derivation of rootName;
 * a mismatch is surfaced, never silently armed).
 */
export async function getCustomRegistrar() {
  const network = await getActiveNetworkConfig(); // bind SDK to the active network first
  const program = network.customRegistrarProgram ?? null;
  if (!program) {
    return {
      supported: false,
      reason: 'no custom registrar deployment is pinned for this network (no live evidence)',
      networkId: network.id,
      program: null,
    };
  }
  const configAddress = tcr.tcrConfigAddress(program);
  const read = await fetchAccountData(configAddress).catch((err) => {
    throw tcrCoded('TCR_CONFIG_UNREADABLE', `Could not read the custom registrar config: ${err?.message ?? err}`, { retryable: true });
  });
  if (!read.exists || !read.data) {
    return { supported: false, reason: 'custom registrar config account is absent on this chain', networkId: network.id, program, configAddress };
  }
  let cfg;
  try {
    cfg = tcr.parseTcrConfig(read.data);
  } catch (err) {
    return { supported: false, reason: `custom registrar config is unparseable: ${err?.message ?? err}`, networkId: network.id, program, configAddress };
  }
  const derivedRoot = await rootRegistrarAddress(cfg.rootName);
  const rootMatchesNameService = derivedRoot === cfg.rootAddress;
  return {
    supported: true,
    networkId: network.id,
    program,
    configAddress,
    root: cfg.rootAddress,
    rootName: cfg.rootName,
    rootMatchesNameService,
    feePerYear: cfg.feePerYear.toString(),
    treasury: cfg.treasury,
    admin: cfg.admin,
  };
}

/**
 * name.checkCustomLease (v25) — availability truth for one label under the custom
 * registrar's root. Existence is read directly: lease PDA + name-service domain account.
 * Notes for the UI:
 *   - labelProblem is surfaced as plain text when the label can't even derive.
 *   - lease mine/taken/expired: `expiredHint` compares chain seconds against LOCAL epoch —
 *     a display hint only; the program's own judgement is authoritative at write time.
 *   - domain-existing-without-lease is a distinct truth ("another authority got there").
 */
export async function checkCustomLease({ name } = {}) {
  const info = await getCustomRegistrar();
  if (!info.supported) return info;
  const n = String(name ?? '').trim().toLowerCase();
  const prob = tcr.labelProblem(n);
  if (prob) return { ...info, name: n, labelProblem: prob };

  const leaseAddress = tcr.tcrLeaseAddress(info.program, n);
  const domainAddress = await domainAccountAddress(info.root, n);
  const [leaseRead, domainRead] = await Promise.all([
    fetchAccountData(leaseAddress).catch((e) => ({ readError: String(e?.message ?? e) })),
    fetchAccountData(domainAddress).catch((e) => ({ readError: String(e?.message ?? e) })),
  ]);
  const out = { ...info, name: n, leaseAddress, domainAddress };

  if (leaseRead.readError || domainRead.readError) {
    out.readError = leaseRead.readError || domainRead.readError;
    return out; // honest: chain unreadable — the UI must not pretend a verdict
  }

  out.domainExists = Boolean(domainRead.exists);
  out.leaseExists = Boolean(leaseRead.exists);
  out.lease = null;
  out.leaseParseError = null;
  out.expiredHint = null;
  if (out.leaseExists && leaseRead.data) {
    try {
      const lease = tcr.parseTcrLease(leaseRead.data);
      const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
      out.lease = {
        owner: lease.owner,
        resolver: lease.resolver,
        label: lease.label,
        expiresAtSeconds: String(lease.expiresAtSeconds),
        registeredAtSeconds: String(lease.registeredAtSeconds),
      };
      out.expiredHint = lease.expiresAtSeconds <= nowSeconds;
    } catch (err) {
      out.leaseParseError = err?.message ?? String(err);
    }
  }
  return out;
}

/**
 * name.register with `via: 'custom'` — self-signed registration through the custom
 * registrar program. Mirrors the live-verified probe 1:1 (scripts/registrar/
 * probe-live-registrar.mjs, evidence 2026-10-25). Non-goals today: RENEW and
 * CLAIM_EXPIRED are not wired here — only Register is live-verified; an existing lease
 * (active or expired) is reported, never silently overwritten.
 */
export async function registerCustom({ name, years, expectedNetworkId, expectedAccountAddress, expectedPricePerYear } = {}) {
  const n = String(name ?? '').trim().toLowerCase();
  const prob = tcr.labelProblem(n);
  if (prob) throw tcrCoded('INVALID_NAME', prob);
  const yp = tcr.yearsProblem(years);
  if (yp) throw tcrCoded('INVALID_YEARS', yp);
  const y = Number(years);

  const feePayer = await vault.getActiveAccount();
  const network = await getActiveNetworkConfig(); // bind before building/signing
  const info = await getCustomRegistrar();
  if (!info.supported) throw tcrCoded('TCR_ABSENT', info.reason ?? 'custom registrar unavailable on this network');
  if (!info.rootMatchesNameService) {
    throw tcrCoded('TCR_ROOT_MISMATCH', 'the registrar config root does not match the name-service derivation — refusing to construct a registration against a mismatched root');
  }
  assertReviewContext({ expectedNetworkId, expectedAccountAddress, expectedPricePerYear }, network, feePayer, info);

  // Existence pre-verification (creation proofs only apply to NON-existing accounts):
  // lease exists (any state) or domain exists ⇒ the register instruction cannot apply.
  const check = await checkCustomLease({ name: n });
  if (check.readError) throw tcrCoded('TCR_READ_ERROR', `Could not verify '${n}' on-chain right now: ${check.readError}`, { retryable: true });
  if (check.domainExists) throw tcrCoded('NAME_TAKEN', `'${n}.${info.rootName}' already exists as a name-service domain.`);
  if (check.leaseExists) {
    const state = check.leaseParseError
      ? `lease exists but is unparseable (${check.leaseParseError})`
      : check.expiredHint
        ? `an expired lease exists (owner ${check.lease.owner})`
        : `an active lease exists (owner ${check.lease.owner})`;
    throw tcrCoded('TCR_LEASE_EXISTS',
      `'${n}.${info.rootName}' cannot be registered: ${state}. Renew/claim through the custom registrar is not yet wired into the wallet — only Register was live-verified (2026-10-25). Nothing was broadcast.`);
  }

  // Fee quote from the chain-read config (best-effort note: on unowned EOAs ThruVM skips
  // the in-program debit — see the section comment; the quote is still what the program
  // INTENDS to charge, and a native balance shortfall elsewhere reverts honestly).
  const feePerYear = BigInt(info.feePerYear);
  const totalFee = feePerYear * BigInt(y);

  // The signer must exist on-chain (same reason claimFaucet JIT-activates).
  const payerInfo = await thruClient.getAccountInfo(feePayer.address);
  if (!payerInfo.exists) {
    await thruClient.createOnChainAccount(feePayer);
  } else if (payerInfo.balance != null && payerInfo.balance < totalFee) {
    throw tcrCoded('INSUFFICIENT_FUNDS',
      `The registrar charges ${totalFee} base units (${feePerYear}/yr × ${y}y); your account holds ${payerInfo.balance}.`);
  }

  const domainAddress = await domainAccountAddress(info.root, n);
  const leaseAddress = tcr.tcrLeaseAddress(info.program, n);

  // Creation proofs with ALIGNED slots (InvalidProofSlot -33 lesson — live, dfd7316):
  // generate the domain proof, read its embedded u64le timestamp, mask off the proof-type
  // bits to get the proof slot, then generate the lease proof at the SAME targetSlot and
  // pin startSlot in the tx header.
  const client = thruClient.getClient();
  const domainProofObj = await client.proofs.generate({ address: domainAddress, proofType: 1 });
  const dv = new DataView(domainProofObj.proof.buffer, domainProofObj.proof.byteOffset);
  const slot = dv.getBigUint64(0, true) & ((1n << 62n) - 1n);
  const leaseProofObj = await client.proofs.generate({ address: leaseAddress, proofType: 1, targetSlot: slot });

  // Header: the exact values of the live-verified probe (vmError 0; consumedComputeUnits
  // measured 92 128 of a 2 000 000 ceiling — comfortable headroom, calibrated later from
  // accumulated evidence if it ever drifts).
  const { rawTransaction } = await client.transactions.buildAndSign({
    feePayer: { publicKey: feePayer.publicKey, privateKey: feePayer.privateKey },
    program: info.program,
    header: {
      computeUnits: 2_000_000,
      memoryUnits: 32_768,
      stateUnits: 6,
      fee: 0n,
      startSlot: slot,
      expiryAfter: 10_000,
    },
    accounts: {
      readWrite: [info.treasury, info.root, domainAddress, leaseAddress],
      readOnly: [info.configAddress, NAME_SERVICE_PROGRAM],
    },
    instructionData: ({ getAccountIndex }) => tcr.buildTcrRegisterInstructionData({
      label: n,
      durationYears: y,
      targetAddress: feePayer.address,
      domainProof: domainProofObj.proof,
      leaseProof: leaseProofObj.proof,
      indexOf: getAccountIndex,
      treasuryAddress: info.treasury,
      rootAddress: info.root,
      domainAddress,
      leaseAddress,
      configAddress: info.configAddress,
      nameServiceProgram: NAME_SERVICE_PROGRAM,
    }),
  });

  await balances.getBalances([feePayer.address]).catch(() => null);
  return submitAndAwait(rawTransaction, {
    kind: 'name-custom-register',
    from: feePayer.address,
    displayAmount: `${totalFee} base units (program fee, best-effort — see docs) — register '${n}.${info.rootName}' (${y}y) via the custom registrar`,
    errorNoun: 'custom registrar',
    describeError: (code) => tcr.describeTcrError(code),
    result: { domainAddress },
  });
}
