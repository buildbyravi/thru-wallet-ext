// Network management service running in the background service worker.
//
// Built-in networks come from src/lib/networks.js and are immutable. Custom networks live in a
// storage overlay that used to let a user point the wallet at a local devnet node without editing
// source; since contract v7 the overlay is retained only so an existing record can be listed and
// deleted. A custom entry may not shadow a built-in id, so `alphanet` always means alphanet.
//
// CONTRACT v7 SECURITY BREAK — a custom network can be STORED, LISTED and REMOVED, but it can
// never be ACTIVE:
//
//   - `setActiveNetwork()` refuses any id that is not an enabled built-in, with code
//     CUSTOM_NETWORK_DISABLED for a saved custom id. Enforcing it here rather than in Settings
//     means a direct `network.setActive` message fails safely instead of binding the endpoint.
//   - Every read of the active network self-heals: if storage still names something that is not an
//     enabled built-in — a custom network selected before v7, or a network disabled since — the
//     default built-in is written back BEFORE `configureNetwork()` runs, so a fresh service worker
//     cannot bind that endpoint even once.
//
// Why: `configureNetwork()` in src/lib/thru-client.js falls back to the DEFAULT transfer and token
// program ids when a config does not carry verified ones, and a custom record never does. Binding a
// custom endpoint therefore meant constructing and signing transactions against program addresses
// belonging to a different chain. Removing the Settings form alone left the capability in place:
// the saved row was still clickable. Contract v7 removes that capability without deleting records.
//
// Re-enabling custom networks needs all four preconditions in docs/STATUS_AND_ROADMAP.md Step 2b —
// an HTTPS-only policy with an explicit localhost exception, narrow user-granted host permission, a
// verified per-network capability record instead of silent program defaults, and password
// re-authentication before the wallet talks to a user-supplied endpoint.

import { DEFAULT_NETWORK, getNetworkConfig, listNetworks } from '../../lib/networks.js';
import { emitNetworkChanged } from './event-service.js';
import { configureNetwork } from '../../lib/thru-client.js';

const ACTIVE_NETWORK_KEY = 'thru_active_network';
const CUSTOM_NETWORKS_KEY = 'thru_custom_networks';

/** Error code returned when a caller asks to activate a saved custom network. */
export const CUSTOM_NETWORK_DISABLED = 'CUSTOM_NETWORK_DISABLED';

/** Shared by the thrown error and `network.list`, so the service and Settings copy cannot drift. */
export const CUSTOM_NETWORK_REASON = 'Custom networks cannot be selected. The wallet will not build '
  + 'or sign transactions against an endpoint whose chain programs it has not verified.';

function customNetworkDisabledError(networkId) {
  const error = new Error(
    `${CUSTOM_NETWORK_REASON} Remove '${networkId}' in Settings, or switch to a built-in network.`,
  );
  error.code = CUSTOM_NETWORK_DISABLED;
  // This policy refusal is permanent. State it explicitly because the router's generic transient
  // heuristic sees the word "network" in the message and would otherwise offer a pointless retry.
  error.retryable = false;
  return error;
}

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

/** Enabled built-ins are the only selectable network ids. */
function builtInIds() {
  return new Set(listNetworks().map((n) => n.id));
}

/**
 * Read the stored active id, healing it if it is not an enabled built-in.
 *
 * The storage write completes before the caller can bind an RPC client. Per-network balance,
 * pending-transaction and token keys therefore see the same id as the client rather than keeping a
 * stale namespace for a custom endpoint that can no longer be bound.
 *
 * @returns {Promise<{ id: string, healedFrom: string|null }>}
 */
async function readActiveNetworkId() {
  const result = await chrome.storage.local.get(ACTIVE_NETWORK_KEY);
  const stored = result[ACTIVE_NETWORK_KEY] || DEFAULT_NETWORK;
  if (builtInIds().has(stored)) return { id: stored, healedFrom: null };

  await chrome.storage.local.set({ [ACTIVE_NETWORK_KEY]: DEFAULT_NETWORK });
  return { id: DEFAULT_NETWORK, healedFrom: stored };
}

/**
 * Get the currently selected network ID. Always an enabled built-in id.
 * @returns {Promise<string>}
 */
export async function getActiveNetworkId() {
  const { id } = await readActiveNetworkId();
  return id;
}

/**
 * Get the currently active network configuration.
 *
 * Also BINDS thru-client to it. That binding is the thing that makes network switching real:
 * thru-client memoizes one RPC client and previously hardcoded the alphanet URL, so selecting
 * another network changed the badge and the scoped storage while every RPC call still went to
 * alphanet. Doing it here rather than only in setActiveNetwork means a fresh service worker —
 * which MV3 restarts aggressively — is bound correctly on its first read instead of only after
 * the user happens to switch.
 *
 * configureNetwork is idempotent and only discards the memoized client when the URL actually
 * changes, so calling it on every read is cheap.
 */
export async function getActiveNetworkConfig() {
  const { id, healedFrom } = await readActiveNetworkId();
  // `readActiveNetworkId` guarantees this is an enabled built-in before anything reaches the RPC
  // binding path. A custom record is never passed to configureNetwork(), even once at startup.
  const config = getNetworkConfig(id);
  configureNetwork(config);

  if (healedFrom) {
    // Let an already-open page stop displaying the legacy selection. This emits only on an actual
    // heal; the next read sees the rewritten built-in id and cannot loop.
    console.warn(
      `[network] active network '${healedFrom}' is not selectable (custom, disabled, or unknown); `
      + `self-healed to '${config.id}'.`,
    );
    emitNetworkChanged(toPublicNetwork(config));
  }

  return config;
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
 * Contract v7 accepts enabled built-ins only. Settings is not a security boundary: a stale UI or a
 * direct message-port request for a saved custom id reaches this same refusal.
 *
 * @param {string} networkId
 */
export async function setActiveNetwork(networkId) {
  const id = String(networkId ?? '').trim();

  if (!builtInIds().has(id)) {
    const custom = await readCustom();
    if (custom.some((network) => network.id === id)) throw customNetworkDisabledError(id);
    // Declared-but-disabled built-ins deliberately look unknown: they are not available networks.
    throw new Error(`Unknown network '${id}'.`);
  }

  const config = getNetworkConfig(id);
  await chrome.storage.local.set({ [ACTIVE_NETWORK_KEY]: config.id });
  // Rebind immediately so the next RPC call already targets the new endpoint, rather than
  // waiting for whoever happens to read the config next.
  configureNetwork(config);
  emitNetworkChanged(toPublicNetwork(config));
  return config;
}

/** List built-ins first, then legacy custom records retained for removal. */
export async function getAvailableNetworks() {
  const custom = await readCustom();
  return [
    ...listNetworks().map((network) => ({ ...network, custom: false, selectable: true })),
    ...custom.map((network) => ({
      ...network,
      custom: true,
      selectable: false,
      unselectableReason: CUSTOM_NETWORK_REASON,
      label: network.label || network.name || network.id,
    })),
  ];
}

/**
 * Add or update a custom network.
 *
 * Retained for contract compatibility and legacy-record management. Contract v7 does not permit a
 * record created here to become active.
 *
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
 * Remove a custom network.
 *
 * Since v7 a custom record cannot be active. Reading the active config after deletion also clears a
 * legacy pointer through the one self-healing path, then binds and announces the built-in default.
 *
 * @param {string} networkId
 */
export async function removeCustomNetwork(networkId) {
  const id = String(networkId || '').trim();
  if (builtInIds().has(id)) throw new Error('Built-in networks cannot be removed.');

  const custom = await readCustom();
  const remaining = custom.filter((network) => network.id !== id);
  if (remaining.length === custom.length) throw new Error(`Unknown network '${id}'.`);

  await writeCustom(remaining);
  await getActiveNetworkConfig();
  return { removed: id };
}
