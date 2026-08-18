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

import { Pubkey } from '@thru/sdk';

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
 * @property {boolean} isTestnet    - Test/dev network. Drives faucet visibility and the badge.
 * @property {boolean} enabled      - Whether the network is selectable yet
 * @property {'devnet'|'testnet'|'mainnet'|'local'} environment
 */

// Program addresses are identical across Thru networks today. Declared once so a change lands
// in one place rather than being copy-pasted per entry.
const TRANSFER_PROGRAM_ID = 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const TOKEN_PROGRAM_ID = 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKqq';

export const NETWORKS = {
  alphanet: {
    id: 'alphanet',
    label: 'Alphanet',
    rpcUrl: 'https://rpc.alphanet.thru.org',
    explorerUrl: 'https://scan.thru.org',
    faucetProgramId: 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPr6',
    faucetStateAccount: 'taxoImSW7q1d_fwrjEq4P8mJwGqx6NNHmTZxXMVi8hQ',
    faucetMaxPerClaim: 10_000n,
    transferProgramId: TRANSFER_PROGRAM_ID,
    tokenProgramId: TOKEN_PROGRAM_ID,
    isTestnet: true,
    enabled: true,
    environment: 'devnet',
  },

  // Local node for development. Enabled because it costs nothing to offer and is the fastest
  // way to test without a public network. Selecting it when nothing is listening simply
  // reports the network as offline, which is honest.
  localnet: {
    id: 'localnet',
    label: 'Localnet',
    rpcUrl: 'http://127.0.0.1:8899',
    // A local node usually has no explorer. Links are suppressed when this is empty rather
    // than producing a dead URL.
    explorerUrl: '',
    faucetProgramId: 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPr6',
    faucetStateAccount: 'taxoImSW7q1d_fwrjEq4P8mJwGqx6NNHmTZxXMVi8hQ',
    faucetMaxPerClaim: 10_000n,
    transferProgramId: TRANSFER_PROGRAM_ID,
    tokenProgramId: TOKEN_PROGRAM_ID,
    isTestnet: true,
    enabled: true,
    environment: 'local',
  },

  // Declared but NOT enabled. Present so the shape, storage scoping and UI paths exist and are
  // exercised before either network is real. Flipping `enabled` is the entire change needed.
  //
  // Left disabled deliberately: the RPC hosts, the faucet situation and whether program
  // addresses stay identical are all unverified. Shipping a selectable network whose endpoint
  // is a guess would let someone believe they had switched when they had not.
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
    isTestnet: true,
    enabled: false,
    environment: 'testnet',
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
    isTestnet: false,
    enabled: false,
    environment: 'mainnet',
  },
};

export const DEFAULT_NETWORK = 'alphanet';

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
  return `${networkConfig.explorerUrl}/tx/${signature}`;
}

/** Build explorer address URL, or '' when the network has no explorer. */
export function explorerAddressUrl(networkConfig, address) {
  if (!networkConfig?.explorerUrl) return '';
  return `${networkConfig.explorerUrl}/account/${address}`;
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
