// Network management service running in the background service worker.

import { NETWORKS, DEFAULT_NETWORK, getNetworkConfig, listNetworks } from '../../lib/networks.js';

const ACTIVE_NETWORK_KEY = 'thru_active_network';

/**
 * Get the currently selected network ID.
 * @returns {Promise<string>}
 */
export async function getActiveNetworkId() {
  const result = await chrome.storage.local.get(ACTIVE_NETWORK_KEY);
  return result[ACTIVE_NETWORK_KEY] || DEFAULT_NETWORK;
}

/**
 * Get the currently active network configuration.
 * @returns {Promise<import('../../lib/networks.js').NetworkConfig>}
 */
export async function getActiveNetworkConfig() {
  const networkId = await getActiveNetworkId();
  return getNetworkConfig(networkId);
}

/**
 * Set the active network ID.
 * @param {string} networkId
 */
export async function setActiveNetwork(networkId) {
  const config = getNetworkConfig(networkId);
  await chrome.storage.local.set({ [ACTIVE_NETWORK_KEY]: config.id });
  return config;
}

/**
 * List all available network configurations.
 */
export function getAvailableNetworks() {
  return listNetworks();
}
