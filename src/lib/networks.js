// Typed network configuration map — single source of truth for all Thru networks.
// Adding a new network (testnet, mainnet) = adding one entry here.
// Every RPC call, explorer link, and program address routes through this config.

import { Pubkey } from '@thru/sdk';

/**
 * @typedef {Object} NetworkConfig
 * @property {string} id            - Unique network identifier
 * @property {string} label         - Human-readable display name
 * @property {string} rpcUrl        - JSON-RPC endpoint URL
 * @property {string} explorerUrl   - Block explorer base URL
 * @property {string} faucetProgramId    - Faucet program address (null on mainnet)
 * @property {string} faucetStateAccount - Faucet state account (null on mainnet)
 * @property {bigint} faucetMaxPerClaim  - Max claimable per faucet tx (null on mainnet)
 * @property {string} transferProgramId  - Native transfer program address
 * @property {string} tokenProgramId     - Token program address
 * @property {boolean} isTestnet    - Whether this is a test/dev network
 */

export const NETWORKS = {
  alphanet: {
    id: 'alphanet',
    label: 'Alphanet',
    rpcUrl: 'https://rpc.alphanet.thru.org',
    explorerUrl: 'https://scan.thru.org',
    faucetProgramId: 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPr6',
    faucetStateAccount: 'taxoImSW7q1d_fwrjEq4P8mJwGqx6NNHmTZxXMVi8hQ',
    faucetMaxPerClaim: 10_000n,
    transferProgramId: 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    tokenProgramId: 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKqq',
    isTestnet: true,
  },
  // Future: uncomment when networks launch
  // testnet: {
  //   id: 'testnet',
  //   label: 'Testnet',
  //   rpcUrl: 'https://rpc.testnet.thru.org',
  //   explorerUrl: 'https://scan.testnet.thru.org',
  //   faucetProgramId: null,
  //   faucetStateAccount: null,
  //   faucetMaxPerClaim: null,
  //   transferProgramId: 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  //   tokenProgramId: 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKqq',
  //   isTestnet: true,
  // },
  // mainnet: {
  //   id: 'mainnet',
  //   label: 'Mainnet',
  //   rpcUrl: 'https://rpc.thru.org',
  //   explorerUrl: 'https://scan.thru.org',
  //   faucetProgramId: null,
  //   faucetStateAccount: null,
  //   faucetMaxPerClaim: null,
  //   transferProgramId: 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  //   tokenProgramId: 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKqq',
  //   isTestnet: false,
  // },
};

export const DEFAULT_NETWORK = 'alphanet';

/** Get network config by id, throws if unknown. */
export function getNetworkConfig(networkId) {
  const config = NETWORKS[networkId];
  if (!config) throw new Error(`Unknown network: ${networkId}`);
  return config;
}

/** List all available networks. */
export function listNetworks() {
  return Object.values(NETWORKS);
}

/** Build explorer transaction URL for a given network. */
export function explorerTxUrl(networkConfig, signature) {
  return `${networkConfig.explorerUrl}/tx/${signature}`;
}

/** Build explorer address URL for a given network. */
export function explorerAddressUrl(networkConfig, address) {
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
