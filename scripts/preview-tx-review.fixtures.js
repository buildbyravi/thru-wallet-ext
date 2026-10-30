// Fixture FACTORIES for the transaction-review preview harness (dev only, never shipped).
//
// These are the same fact shapes the background reads from chain in
// src/background/services/review/kinds.js. They are FIXTURES: no chain is contacted, and the
// preview page says so on screen. Their only job is to let a human look at every review shape
// the real decoders can produce, in the real component, with the real stylesheet.
//
// Every envelope is validated with `assertReview`, so a fixture that drifts from the wire
// contract fails loudly instead of rendering a pretty lie.

import { assertReview, stateFromWarnings, TX_REVIEW_VERSION } from '../src/shared/tx-review/model.js';
import { simulationWarning } from '../src/shared/tx-review/decoders/common.js';
import '../src/shared/tx-review/decoders/index.js';
import { decodeReview } from '../src/shared/tx-review/registry.js';

const ACCOUNT = {
  address: 'ta5XK3J9kZ4vGq7mQpW2nR8sT1uY6bC3dE9fH2jL4nP7qR',
  label: 'Main account',
};
const OTHER = 'ta9zY8xW7vU6tS5rQ4pO3nM2lK1jI0hG9fE8dC7bA6';
const BETANET = { id: 'betanet', label: 'Betanet', environment: 'testnet', isTestnet: true };

const FEE = {
  supported: true,
  feeUnits: '1000',
  reserveUnits: '1000',
  source: 'measured',
  reason: null,
};

const UNMEASURED_FEE = {
  supported: false,
  reason: 'No fee has been measured for token transfers on this chain, so none is quoted. '
    + 'The charge is paid in THRU and reported only after the chain answers.',
};

const NO_SIMULATION = {
  status: 'unavailable',
  reason: 'This network has no dry-run RPC, so the wallet cannot simulate the transaction.',
  provenance: 'tx.simulate (capability stub)',
};

function envelope(kind, facts, { submittable = true, simulation = null } = {}) {
  const createdAt = Date.now();
  const content = decodeReview(kind, {
    network: BETANET,
    account: ACCOUNT,
    facts: { ...facts, networkId: 'betanet', networkLabel: 'Betanet' },
  });

  // Mirrors review-service.buildReview: the node's simulation block is folded in as a warning
  // BEFORE the state is computed, and a blocking warning makes the review unsignable. The
  // preview has to go through the same fold, or it would show a card the wallet cannot emit
  // (a failed simulation that still offers a confirm button).
  const sim = { checkedAt: createdAt, ...(simulation ?? NO_SIMULATION) };
  const simWarning = simulationWarning(sim);
  const warnings = simWarning ? [...content.warnings, simWarning] : [...content.warnings];
  const signable = submittable && stateFromWarnings(warnings) === 'ready';

  return assertReview({
    reviewVersion: TX_REVIEW_VERSION,
    reviewId: `betanet_preview_${kind}`,
    kind,
    state: signable ? 'ready' : 'blocked',
    createdAt,
    expiresAt: createdAt + 120_000,
    bindingHash: 'preview',
    network: BETANET,
    account: ACCOUNT,
    protocol: content.protocol ?? null,
    operation: content.operation,
    summary: content.summary,
    assets: {
      outgoing: content.assets.outgoing,
      incoming: content.assets.incoming,
      fee: content.assets.fee,
      balanceAfter: null,
      balanceAfterNote: content.assets.balanceAfterNote,
    },
    execution: content.execution,
    warnings,
    acknowledgements: content.acknowledgements,
    simulation: sim,
    submitPolicy: signable
      ? { method: 'tx.sendChecked', auth: 'signing', passwordRequired: false }
      : null,
  });
}

/**
 * @returns {Array<{title: string, note: string, review: object}>}
 */
export function previewFixtures() {
  return [
    {
      // The owner's own send (2026-10-30 review): Account 1 → Account 5 on Betanet, a second
      // wallet account as the recipient. This is the shape the review asked about — the
      // recipient's name and full address must both be readable without opening Details.
      title: 'Native send · to another account of this wallet',
      note: 'Recipient is named AND shown in full; Details repeats neither address.',
      review: envelope('native-send', {
        fromAddress: ACCOUNT.address,
        fromLabel: ACCOUNT.label,
        toAddress: OTHER,
        recipientLabel: 'Account 5',
        amountUnits: '48980',
        selfSend: false,
        balanceUnits: '4200000000',
        recipient: { exists: true },
        fee: FEE,
        duplicate: null,
        transferProgramId: 'taTRANSFERprogramaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
    },
    {
      title: 'Native send · everything readable',
      note: 'Ready to sign. Fee is measured; no post-transaction balance is claimed.',
      review: envelope('native-send', {
        fromAddress: ACCOUNT.address,
        fromLabel: ACCOUNT.label,
        toAddress: OTHER,
        recipientLabel: null,
        amountUnits: '1500000',
        selfSend: false,
        balanceUnits: '4200000000',
        recipient: { exists: true },
        fee: FEE,
        duplicate: null,
        transferProgramId: 'taTRANSFERprogramaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
    },
    {
      title: 'Native send · recipient not activated (blocked)',
      note: 'The wallet proved the chain will reject this. Confirm must be disabled.',
      review: envelope('native-send', {
        fromAddress: ACCOUNT.address,
        fromLabel: ACCOUNT.label,
        toAddress: OTHER,
        recipientLabel: 'New laptop',
        amountUnits: '250000000',
        selfSend: false,
        balanceUnits: '4200000000',
        recipient: { exists: false },
        fee: FEE,
        duplicate: null,
        transferProgramId: 'taTRANSFERprogramaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
    },
    {
      title: 'Token transfer · unverified metadata + duplicate acknowledgement',
      note: 'Token scale comes from the local registry; a repeat inside 30s needs a tick.',
      review: envelope('token-transfer', {
        fromAddress: ACCOUNT.address,
        fromLabel: ACCOUNT.label,
        toAddress: OTHER,
        recipientLabel: 'Coffee shop',
        mintAddress: 'taMINTaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        symbol: 'LAB',
        name: 'Lab token',
        decimals: 6,
        metadataVerified: false,
        subscriptionMint: undefined,
        mintExists: true,
        amountUnits: '25000000',
        sourceTokenAccount: { address: 'taSRCtokenaccountaaaaaaaaaaaaaaaaaaaaaaaaaaaa', exists: true },
        recipientTokenAccount: { exists: true },
        recipient: { exists: true },
        balanceUnits: '250000000',
        fee: UNMEASURED_FEE,
        duplicate: { isDuplicate: true, isPending: true, elapsedMs: 1200 },
        tokenProgramId: 'taTOKENprogramaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
    },
    {
      title: 'Domain register · custom registrar',
      note: 'Price per year and total are chain reads. Resulting expiry is not invented.',
      review: envelope('domain-register', {
        fromAddress: ACCOUNT.address,
        fromLabel: ACCOUNT.label,
        name: 'vault',
        tld: 'thru',
        years: 2,
        provider: 'custom',
        pricePerYear: '1000',
        totalPriceUnits: '2000',
        nativeBalanceUnits: '4200000000',
        availability: { state: 'available', readError: null },
        root: 'taROOTaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        configAddress: 'taCONFIGaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        program: 'ta2vDCBzzptN2qVZgz6PXsCp5cNB7Nef4yeQ3W-OqzZcfF',
        treasury: 'taTREASURYaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        feeReserveUnits: '1000',
        feeNote: null,
        lease: null,
        nameServiceProgram: 'taNAMEqRNEDeMWp0cDYmMVdZyTZiF5NyGDR9zTwH42rWQG',
      }),
    },
    {
      title: 'Domain renew · lease owned, expiry known',
      note: 'Current expiry is shown; the NEW expiry is deliberately not computed.',
      review: envelope('domain-renew', {
        fromAddress: ACCOUNT.address,
        fromLabel: ACCOUNT.label,
        name: 'vault',
        tld: 'thru',
        years: 1,
        provider: 'custom',
        pricePerYear: '1000',
        totalPriceUnits: '1000',
        nativeBalanceUnits: '4200000000',
        availability: { state: 'mine', readError: null },
        root: 'taROOTaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        configAddress: 'taCONFIGaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        program: 'ta2vDCBzzptN2qVZgz6PXsCp5cNB7Nef4yeQ3W-OqzZcfF',
        treasury: 'taTREASURYaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        feeReserveUnits: '1000',
        feeNote: null,
        lease: { owner: ACCOUNT.address, endTime: '1795000000', mine: true, expiredHint: false },
        nameServiceProgram: 'taNAMEqRNEDeMWp0cDYmMVdZyTZiF5NyGDR9zTwH42rWQG',
      }),
    },
    {
      title: 'Faucet claim · window usage read',
      note: 'Remaining allowance is a chain read; a stale one is only a warning.',
      review: envelope('faucet-claim', {
        fromAddress: ACCOUNT.address,
        fromLabel: ACCOUNT.label,
        amountUnits: '500000000',
        capUnits: '10000000000',
        accountExists: true,
        limit: {
          supported: true,
          paused: false,
          exhausted: false,
          targetMatchesFaucet: true,
          remainingAmount: '9500000000',
          window: 'daily',
          resetAtUnixSec: '1795100000',
          maxAmountPerCall: '10000000000',
          reason: null,
        },
        fee: { supported: false, reason: 'The faucet claim path does not report a charged fee, so none is shown.' },
        programAddress: 'taFAUCETprogramaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        vaultAddress: 'taFAUCETvaultaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
    },
    {
      title: 'Native send · simulation rejected (blocked)',
      note: 'SYNTHETIC: Thru exposes no dry-run RPC, so no node can return this today. It is here '
        + 'to prove the card and the state agree when one does — the same blocking warning the '
        + 'service folds in, a disabled confirm, and the word "Failed" instead of "Not available".',
      review: envelope('native-send', {
        fromAddress: ACCOUNT.address,
        fromLabel: ACCOUNT.label,
        toAddress: OTHER,
        recipientLabel: null,
        amountUnits: '1500000',
        selfSend: false,
        balanceUnits: '4200000000',
        recipient: { exists: true },
        fee: FEE,
        duplicate: null,
        transferProgramId: 'taTRANSFERprogramaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }, {
        simulation: {
          status: 'failed',
          reason: 'The node rejected the dry run: program error 0x12 (account not found).',
          provenance: 'tx.simulate',
        },
      }),
    },
    {
      title: 'Unknown instruction · display only',
      note: 'No guessed name, no submit policy: there is no path from here to a signature.',
      review: envelope('raw', {
        programAddress: 'taUNKNOWNprogramaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        programName: null,
        programVerified: false,
        programNote: null,
        dataHex: '0b1f4c9d2a7e5033',
        note: 'This wallet has no decoder for this instruction, so it cannot describe the effect.',
        accounts: [
          { role: 'Fee payer', address: ACCOUNT.address },
          { role: 'Program', address: 'taUNKNOWNprogramaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
        ],
      }, { submittable: false }),
    },
  ];
}
