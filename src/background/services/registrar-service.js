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
import { domainAccountAddress, registrarConfigAddress } from '../../lib/name-service.js';
import { getActiveNetworkConfig } from './network-service.js';
import * as pending from './pending-tx-service.js';
import * as balances from './balance-service.js';

function coded(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  if (extra.retryable !== undefined) err.retryable = extra.retryable;
  return err;
}

async function fetchAccountData(address) {
  const info = await thruClient.getAccountInfo(address);
  if (!info?.exists) return { exists: false, data: null, raw: null };
  const raw = info.raw ?? null;
  const data = raw?.data instanceof Uint8Array ? raw.data : null;
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
  if (leaseInfo.exists && leaseInfo.data) {
    try { lease = reg.parseLease(leaseInfo.data); } catch { lease = null; }
  }
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  const expirationHint = lease ? lease.leaseEndTime <= nowSeconds : null;
  const domainInfo = await fetchAccountData(domainAddress);
  return {
    supported: true,
    name: n,
    leaseAddress,
    domainAddress,
    leaseExists: Boolean(lease),
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
export async function purchaseDomain({ name, years } = {}) {
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
export async function renewLease({ name, years } = {}) {
  return renewOrClaim({ name, years, claim: false });
}

/**
 * name.claimExpiredDomain — take over a lease whose end time has passed (owner ≠ signer).
 */
export async function claimExpiredDomain({ name, years } = {}) {
  return renewOrClaim({ name, years, claim: true });
}

async function renewOrClaim({ name, years, claim }) {
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
  if (cfg.tokenProgram !== network.tokenProgramId) {
    throw coded('REGISTRY_UNSUPPORTED', `the registry's token program (${cfg.tokenProgram.slice(0, 12)}…) differs from this build's pinned token program — refusing to construct the payment`);
  }

  const leaseAddress = await reg.leaseAccountAddress(n);
  const leaseInfo = await fetchAccountData(leaseAddress);
  if (!leaseInfo.exists || !leaseInfo.data) throw coded('LEASE_NOT_FOUND', `'${n}' has no lease on-chain to ${claim ? 'claim' : 'renew'}.`);
  let lease;
  try { lease = reg.parseLease(leaseInfo.data); }
  catch { throw coded('LEASE_UNREADABLE', `the lease account for '${n}' is present but unreadable`); }

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
async function submitAndAwait(rawTransaction, { kind, from, displayAmount } = {}) {
  const network = await getActiveNetworkConfig();
  let formatted = null;
  for await (const update of thruClient.getClient().transactions.sendAndTrack(rawTransaction)) {
    if (update?.signature?.value && formatted === null) {
      formatted = reg.formatSignature(update.signature.value);
      await pending.track({ signature: formatted, kind, from, to: from, amountUnits: '0', displayAmount: displayAmount ?? null, networkId: network.id }).catch(() => null);
    }
    if (update?.executionResult) {
      if (update.executionResult.vmError === 0) {
        return { signature: formatted, blockHeight: null };
      }
      const userCode = update.executionResult.userErrorCode ?? 0;
      throw coded('REGISTRAR_TX_REVERTED', `Registration transaction reverted on-chain (vmError=${update.executionResult.vmError}${userCode ? `, registrar error ${userCode}` : ''}).`);
    }
  }
  throw coded('TX_RESULT_MISSING', 'Registration transaction never returned an execution result (timed out?).', { retryable: true });
}
