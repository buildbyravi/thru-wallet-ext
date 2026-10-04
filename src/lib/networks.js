// Typed network configuration map — single source of truth for all Thru networks.
// Every RPC call, explorer link, and program address routes through this config.
//
// Adding a network is intended to be one entry here plus nothing else. That only holds if two
// rules are respected:
//
//   1. Nothing hard-codes an RPC URL, explorer URL or program address anywhere else.
//   2. Anything STORED that is only meaningful on one network must be namespaced by network id.
//      A token mint, a pending transaction and a cached balance are all per-network; keys,
//      account labels and contacts are not. See src/shared/network-scope.js.
//
// Rule 2 is the one that is easy to get wrong, and getting it wrong means switching to mainnet
// shows you devnet's pending transactions and a token list of mints that do not exist there.

import { Pubkey, EOA_PROGRAM_ID, TOKEN_PROGRAM_ADDRESS, NOOP_PROGRAM_ADDRESS } from '@thru/sdk';
import { BOOTSTRAP_PROGRAM_ADDRESSES, BOOTSTRAP_FAUCET_VAULT_ADDRESS } from '@thru/programs/bootstrap-addresses';

/**
 * @typedef {Object} NetworkConfig
 * @property {string} id            - Unique network identifier
 * @property {string} label         - Human-readable display name
 * @property {string} rpcUrl        - JSON-RPC endpoint URL
 * @property {string} explorerUrl   - Block explorer base URL
 * @property {string|null} faucetProgramId    - Faucet program address (null where no faucet)
 * @property {string|null} faucetStateAccount - Faucet state account (null where no faucet)
 * @property {bigint|null} faucetMaxPerClaim  - Max claimable per faucet tx (null where no faucet)
 * @property {string} transferProgramId  - Native transfer program address
 * @property {string} tokenProgramId     - Token program address
 * @property {string} accountCreateProgramId - Program the account-creation (fee-payer activation) transaction targets
 * @property {boolean} isTestnet    - Test/dev network. Drives faucet visibility and the badge.
 * @property {boolean} enabled      - Whether the network is selectable yet
 * @property {'devnet'|'testnet'|'mainnet'|'local'} environment
 * @property {bigint|null} baseFeeUnits    - Observed transfer fee, or null when UNKNOWN
 * @property {bigint|null} feeReserveUnits - What MAX should hold back, or null when unknown
 * @property {'measured'|'assumed'|null} feeSource - Provenance of baseFeeUnits: 'measured' when
 *   observed on this chain's program deployment, 'assumed' when reasoned rather than observed,
 *   null when baseFeeUnits is null. tx.estimateFee reports it verbatim.
 */

// Program addresses come from the official 0.4.x packages — the managed-genesis registry that
// replaced the old reserved "marker byte" system table at the 2026-09-26 managed-genesis
// reset. (The old
// zero-filled addresses with byte 31 = 0x00 transfer / 0x03 account-create / 0xaa token /
// 0xfa faucet no longer exist on-chain.) The packages are the single source of truth: a
// redeployment lands here via a pinned version bump, not by copy-pasting strings.
//
// They are per-network fields on purpose: the transfer program address is not guaranteed to
// survive the move to testnet, and neither is the fee. Anything network-specific belongs in the
// entry, not in a module constant — thru-client already had to be un-hardcoded once for exactly
// this reason.
//
//  - Native transfers are EOA-program transfers (EOA_INSTRUCTION_TRANSFER = 1).
//  - Account creation is a fee-payer activation transaction against the NOOP program — the
//    same program @thru/sdk's own accounts.createAccount defaults to since 0.4.0.
//  - The faucet is a managed program whose vault PDA plays the old "faucet state account"
//    role — confirmed live on the reset chain (2026-09-26): a claim with the wallet's 16-byte
//    layout credited 10,000 units from that vault. The layout is verified, not assumed.
const TRANSFER_PROGRAM_ID = EOA_PROGRAM_ID;
const TOKEN_PROGRAM_ID = TOKEN_PROGRAM_ADDRESS;
const FAUCET_PROGRAM_ID = BOOTSTRAP_PROGRAM_ADDRESSES.faucet;
const FAUCET_STATE_ACCOUNT = BOOTSTRAP_FAUCET_VAULT_ADDRESS;
const ACCOUNT_CREATE_PROGRAM_ID = NOOP_PROGRAM_ADDRESS;

export const NETWORKS = {
  betanet: {
    id: 'betanet',
    label: 'Betanet',
    rpcUrl: 'https://rpc.betanet.thru.org',
    explorerUrl: 'https://scan.thru.org',
    faucetProgramId: FAUCET_PROGRAM_ID,
    faucetStateAccount: FAUCET_STATE_ACCOUNT,
    faucetMaxPerClaim: 10_000n,
    transferProgramId: TRANSFER_PROGRAM_ID,
    tokenProgramId: TOKEN_PROGRAM_ID,
    accountCreateProgramId: ACCOUNT_CREATE_PROGRAM_ID,
    isTestnet: true,
    enabled: true,
    // Betanet is Thru's testnet stage — its LAST one before mainnet (10 nodes, announced at
    // TOKEN2049). The previous single-node alphanet is gone.
    environment: 'testnet',
    // MEASURED on the managed-genesis chain 2026-09-26 (same 0.4.0 program deployment betanet
    // runs): a transfer between registered accounts cost exactly 1 base unit (10000 − 1234 −
    // 1 = 8765). Only one amount and one size were sampled, so the reserve sits well above it
    // rather than at it. Re-verify on betanet with scripts/measure-fee.mjs.
    baseFeeUnits: 1n,
    feeReserveUnits: 1000n,
    // Provenance of the fee above: measured on this chain's program deployment (see the
    // measurement comment). The Send review quotes this label, so a fee that was measured must
    // never be presented to the user as "not measured on this network".
    feeSource: 'measured',
  },

  // Local node support is NOT offered in the shipped wallet — selecting it bound the
  // extension to a localhost endpoint the user may not control, and proper local/development
  // chains will arrive later as custom-chain support (see network-service.js CONTRACT v7 and
  // docs/STATUS_AND_ROADMAP.md Step 2b). The entry stays DECLARED, like testnet/mainnet below,
  // so the storage-scoping machinery keeps a second network id to exercise against: tests
  // re-enable it in-process (`NETWORKS.localnet.enabled = true`) as their second selectable
  // network. `scripts/check-csp.mjs` enforces that a disabled network stays out of connect-src.
  localnet: {
    id: 'localnet',
    label: 'Localnet',
    rpcUrl: 'http://127.0.0.1:8899',
    // A local node usually has no explorer. Links are suppressed when this is empty rather
    // than producing a dead URL.
    explorerUrl: '',
    faucetProgramId: FAUCET_PROGRAM_ID,
    faucetStateAccount: FAUCET_STATE_ACCOUNT,
    faucetMaxPerClaim: 10_000n,
    transferProgramId: TRANSFER_PROGRAM_ID,
    tokenProgramId: TOKEN_PROGRAM_ID,
    accountCreateProgramId: ACCOUNT_CREATE_PROGRAM_ID,
    isTestnet: true,
    enabled: false,
    environment: 'local',
    // A local node normally runs the same programs as devnet, but it is still a different
    // deployment, so this is an assumption rather than a measurement.
    baseFeeUnits: 1n,
    feeReserveUnits: 1000n,
    feeSource: 'assumed',
  },

  // Declared but NOT enabled. This is the reserved slot for a future Thru-declared 'testnet'
  // endpoint — Betanet (above) is the live testnet today. Present so the shape, storage scoping
  // and UI paths exist and are exercised. Enabling it requires two deliberate edits: set
  // `enabled: true` here and add its verified RPC origin to manifest.json connect-src.
  //
  // Left disabled deliberately: the RPC host, the faucet situation and whether program addresses
  // stay identical are all unverified. Shipping a selectable network whose endpoint is a guess
  // would let someone believe they had switched when they had not. scripts/check-csp.mjs fails if
  // the network and CSP are out of agreement in either direction.
  testnet: {
    id: 'testnet',
    label: 'Testnet',
    rpcUrl: 'https://rpc.testnet.thru.org',
    explorerUrl: 'https://scan.testnet.thru.org',
    faucetProgramId: null,
    faucetStateAccount: null,
    faucetMaxPerClaim: null,
    transferProgramId: TRANSFER_PROGRAM_ID,
    tokenProgramId: TOKEN_PROGRAM_ID,
    accountCreateProgramId: ACCOUNT_CREATE_PROGRAM_ID,
    isTestnet: true,
    enabled: false,
    environment: 'testnet',
    // UNKNOWN. Not inherited from devnet: the transfer program and its fee schedule may both
    // change at testnet. null makes tx.estimateFee report unsupported instead of quoting a
    // devnet number as if it applied here.
    baseFeeUnits: null,
    feeReserveUnits: null,
    feeSource: null,
  },

  mainnet: {
    id: 'mainnet',
    label: 'Mainnet',
    rpcUrl: 'https://rpc.thru.org',
    explorerUrl: 'https://scan.thru.org',
    faucetProgramId: null,
    faucetStateAccount: null,
    faucetMaxPerClaim: null,
    transferProgramId: TRANSFER_PROGRAM_ID,
    tokenProgramId: TOKEN_PROGRAM_ID,
    accountCreateProgramId: ACCOUNT_CREATE_PROGRAM_ID,
    isTestnet: false,
    enabled: false,
    environment: 'mainnet',
    // UNKNOWN, and on a live network a guessed fee is the most expensive kind of guess.
    baseFeeUnits: null,
    feeReserveUnits: null,
    feeSource: null,
  },
};

export const DEFAULT_NETWORK = 'betanet';

/** Get network config by id, throws if unknown. */
export function getNetworkConfig(networkId) {
  const config = NETWORKS[networkId];
  if (!config) throw new Error(`Unknown network: ${networkId}`);
  return config;
}

/**
 * List selectable networks. Disabled entries are omitted, so an unfinished network cannot be
 * chosen from the UI while still being defined and testable in code.
 */
export function listNetworks() {
  return Object.values(NETWORKS).filter((n) => n.enabled !== false);
}

/** Every declared network, including disabled ones. For tests and diagnostics. */
export function listAllNetworks() {
  return Object.values(NETWORKS);
}

/** Whether this network offers a faucet at all. */
export function hasFaucet(networkConfig) {
  return Boolean(networkConfig?.faucetProgramId && networkConfig?.faucetStateAccount);
}

/**
 * Build explorer transaction URL, or '' when the network has no explorer.
 * Callers must treat '' as "hide the link" rather than rendering a dead URL.
 */
export function explorerTxUrl(networkConfig, signature) {
  if (!networkConfig?.explorerUrl) return '';
  return `${networkConfig.explorerUrl}/tx/${signature}?network=${networkConfig.id}`;
}

/** Build explorer address URL, or '' when the network has no explorer. */
export function explorerAddressUrl(networkConfig, address) {
  if (!networkConfig?.explorerUrl) return '';
  // scan.thru.org routes addresses under /address/ (not /account/) and scopes pages by an
  // explicit ?network= id — verified against the live explorer 2026-09-27.
  return `${networkConfig.explorerUrl}/address/${address}?network=${networkConfig.id}`;
}

/** Validate a Thru address using the SDK's checksum logic. */
export function isValidThruAddress(address) {
  try {
    Pubkey.from(address);
    return true;
  } catch {
    return false;
  }
}
