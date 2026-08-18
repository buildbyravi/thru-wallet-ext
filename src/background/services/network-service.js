// Network management service running in the background service worker.
//
// Built-in networks come from src/lib/networks.js and are immutable. Custom networks live in a
// storage overlay so a user can point the wallet at a local devnet node without editing source.
// A custom entry may not shadow a built-in id, so `alphanet` always means alphanet.

import { DEFAULT_NETWORK, getNetworkConfig, listNetworks } from '../../lib/networks.js';
import { emitNetworkChanged } from './event-service.js';

const ACTIVE_NETWORK_KEY = 'thru_active_network';
const CUSTOM_NETWORKS_KEY = 'thru_custom_networks';

/**
 * Make a network config safe to send to the UI.
 *
 * chrome.runtime.sendMessage serializes with JSON, and JSON.stringify THROWS on a BigInt
 * ("Do not know how to serialize a BigInt"), which Chrome surfaces as the opaque
 * "Could not serialize message." networks.js carries `faucetMaxPerClaim: 10_000n`, so every
 * method that returned a raw NetworkConfig — network.getActive, network.setActive,
 * network.list, and system.bootstrap, which embeds one — failed at the port.
 *
 * The legacy UI hid this: popup.js wrapped its bootstrap call in a try/catch that quietly
 * fell back to individual queries, so the symptom was a slow start and a blank balance
 * rather than a visible error.
 *
 * The BigInt is NOT dropped — tx-service needs the real value for faucet clamping, so the
 * internal getters keep returning it and only the UI-facing shape is converted. The string
 * form is suffixed `Units` to make it obvious it is base units and must be re-widened with
 * BigInt() before arithmetic.
 */
function toPublicNetwork(config) {
  if (!config || typeof config !== 'object') return config;
  const out = {};
  for (const [key, value] of Object.entries(config)) {
    out[key] = typeof value === 'bigint' ? value.toString() : value;
  }
  return out;
}

export { toPublicNetwork };

async function readCustom() {
  try {
    const res = await chrome.storage.local.get(CUSTOM_NETWORKS_KEY);
    const list = res?.[CUSTOM_NETWORKS_KEY];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function writeCustom(list) {
  await chrome.storage.local.set({ [CUSTOM_NETWORKS_KEY]: list });
}

function builtInIds() {
  return new Set(listNetworks().map((n) => n.id));
}

/** Look up a network by id across built-ins and custom entries. */
async function resolveNetwork(networkId) {
  try {
    return getNetworkConfig(networkId);
  } catch {
    const custom = await readCustom();
    const found = custom.find((n) => n.id === networkId);
    if (!found) throw new Error(`Unknown network '${networkId}'.`);
    return found;
  }
}

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
 * Falls back to the default if the stored id refers to a deleted custom network.
 */
export async function getActiveNetworkConfig() {
  const networkId = await getActiveNetworkId();
  try {
    return await resolveNetwork(networkId);
  } catch {
    return getNetworkConfig(DEFAULT_NETWORK);
  }
}

/**
 * Set the active network.
 *
 * Deliberately does NOT clear the balance cache any more. Per-network data is namespaced by
 * network id (see src/shared/network-scope.js), so each network already reads its own cache,
 * pending transactions and token registry. Switching therefore needs no wiping, switching back
 * preserves each side's last-known values, and staleness is decided by age rather than by
 * whether someone remembered to clear. Removing that call also removed this module's dependency
 * on balance-service.
 *
 * @param {string} networkId
 */
export async function setActiveNetwork(networkId) {
  const config = await resolveNetwork(networkId);
  await chrome.storage.local.set({ [ACTIVE_NETWORK_KEY]: config.id });
  emitNetworkChanged(toPublicNetwork(config));
  return config;
}

/**
 * List all networks — built-ins first, then custom entries.
 */
export async function getAvailableNetworks() {
  const custom = await readCustom();
  return [
    ...listNetworks().map((n) => ({ ...n, custom: false })),
    ...custom.map((n) => ({ ...n, custom: true })),
  ];
}

/**
 * Add or update a custom network.
 * @param {{ id: string, name: string, rpcUrl: string, explorerUrl?: string, environment?: string }} config
 */
export async function upsertCustomNetwork(config) {
  const id = String(config?.id || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!id) throw new Error('A network id is required (letters, numbers and dashes).');
  if (builtInIds().has(id)) throw new Error(`'${id}' is a built-in network and cannot be replaced.`);

  const rpcUrl = String(config?.rpcUrl || '').trim();
  if (!/^https?:\/\/\S+$/i.test(rpcUrl)) throw new Error('RPC URL must be a valid http(s) URL.');

  const explorerUrl = String(config?.explorerUrl || '').trim();
  if (explorerUrl && !/^https?:\/\/\S+$/i.test(explorerUrl)) {
    throw new Error('Explorer URL must be a valid http(s) URL.');
  }

  const record = {
    id,
    name: String(config?.name || id).trim().slice(0, 32),
    rpcUrl,
    explorerUrl,
    environment: config?.environment === 'mainnet' ? 'mainnet' : 'devnet',
    nativeAsset: 'THRU',
  };

  const custom = await readCustom();
  await writeCustom([record, ...custom.filter((n) => n.id !== id)]);
  return record;
}

/**
 * Remove a custom network. Switches back to the default if it was active.
 * @param {string} networkId
 */
export async function removeCustomNetwork(networkId) {
  const id = String(networkId || '').trim();
  if (builtInIds().has(id)) throw new Error('Built-in networks cannot be removed.');
  const custom = await readCustom();
  await writeCustom(custom.filter((n) => n.id !== id));
  if ((await getActiveNetworkId()) === id) {
    await setActiveNetwork(DEFAULT_NETWORK);
  }
  return { removed: id };
}
