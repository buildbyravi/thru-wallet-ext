// Market read layer scaffolding (G1-C): per-slice resolution for the market.* wire shapes.
//
// Every market answer is ASSEMBLED from independent slices (header/facts/price/charts/
// trades/holders/risk/launch) — so when evidence flips one capability (an indexer feed
// arrives, the USD oracle verifies), only that slice changes; the rest keep their honest
// states. Each slice resolves ONE of:
//
//   - a data payload (only when its source is verified — none today),
//   - an S10 honest state { supported:false, reason } — from the feature dossier,
//   - a NOT_READY signal the handler turns into a loud error, when even the honest state
//     isn't specifiable yet.
//
// Ordering rule (chain-before-index): a slice consults the CHAIN-read seam before the
// index-read seam, so a signed/indexed supplement can never outrank an on-chain truth (R16).
// Both seams are FUTURE_FETCHER today — documented inert, wired so tests can drive them.
//
// This module receives its environment (dossier view, feed state, asset facts) from the
// caller (market-service), never imports the registry itself: services/defi stays the
// leaf-on-purpose the layering rule enforces, and tests build the env by hand.

import { unsupportedResult } from './gating.js';

/**
 * The inert read seams. A slice calls these slots; the market-service provides them.
 * Return values: { ok: true, data } | { ok: false, reason } — ok:false feeds the honest
 * state, never a fabricated value.
 */
function missingSource(slice, seam) {
  return { ok: false, reason: 'NO_INDEXER', slice, seam };
}
const mkNoSource = (slice, seam) => () => Promise.resolve(missingSource(slice, seam));

/** Coalescing helper used by every future fetcher: cache key = method + env + params. */
export function sliceCacheKey(method, { networkId, fingerprint }, sliceKey) {
  return `${method}|${networkId}|${fingerprint}|${sliceKey}`;
}

/**
 * Resolve one slice by walking its source ladder: chain first, index second, honest state
 * last. `sources` entries are { seam: 'chain'|'index', read: () => Promise<result> }.
 */
async function resolveSlice(name, { env, sources, fallbackReason, ttlMs, cache, cacheKey }) {
  for (const source of sources) {
    const read = () => source.read();
    const result = cache && cacheKey && ttlMs !== undefined
      ? await cache.getOrFetch(`${cacheKey}|${source.seam}`, ttlMs, read)
      : await read();
    if (result?.ok === true) return { supported: true, data: result.data, source: source.seam };
    // ok:false keeps walking — a missing chain read does not end the search, an index may
    // still know; the reason of the LAST failed source is discarded for the fallback below.
  }
  return unsupportedResult(fallbackReason);
}

/**
 * Assemble one market.assetGet payload from slices. env:
 * {
 *   networkId, fingerprint, now,
 *   dossier: { discovery, charts, usd, launchMint }   // post-binding getFeature views
 *   facts:   program facts from the registry (recorded evidence statements),
 *   risk:    () => Promise<risk slice>                // risk-service derivation, already honest
 *   chainReads?: { [slice]: (params) => result }, indexReads?: { [slice]: (params) => result },
 *   cache?:   read-cache instance, ttlMs?: { [slice]: number },
 * }
 */
export async function assembleAssetGet(assetId, env) {
  const t = env.ttlMs ?? {};
  const keyPrefix = (slice) => sliceCacheKey('market.assetGet', env, `${slice}|${assetId}`);

  // header: the identity of the asset. No listing feed is verified, so unless a chain read
  // proves the asset, the header is honestly absent (not fabricated from the query).
  const header = await resolveSlice('header', {
    env,
    sources: [
      { seam: 'chain', read: () => (env.chainReads?.header ?? mkNoSource('header', 'chain'))(assetId) },
      { seam: 'index', read: () => (env.indexReads?.header ?? mkNoSource('header', 'index'))(assetId) },
    ],
    fallbackReason: 'NO_INDEXER',
    ttlMs: t.header ?? 60_000,
    cache: env.cache,
    cacheKey: keyPrefix('header'),
  });

  const facts = {
    supported: true,
    data: { networkId: env.networkId, fingerprint: env.fingerprint, programs: env.facts },
  };

  const slices = { header, facts };

  const ladder = [
    ['price', 'usd', 'DEPENDENCY_UNVERIFIED'],
    ['charts', 'charts', 'NO_INDEXER'],
    ['trades', 'discovery', 'NO_INDEXER'],
    ['holders', 'discovery', 'NO_INDEXER'],
  ];
  for (const [slice, feature, fallback] of ladder) {
    const dossier = env.dossier?.[feature];
    if (!dossier || dossier.state !== 'enabled') {
      slices[slice] = unsupportedResult(dossier?.reason ?? fallback);
      continue;
    }
    slices[slice] = await resolveSlice(slice, {
      env,
      sources: [
        { seam: 'chain', read: () => (env.chainReads?.[slice] ?? mkNoSource(slice, 'chain'))(assetId) },
        { seam: 'index', read: () => (env.indexReads?.[slice] ?? mkNoSource(slice, 'index'))(assetId) },
      ],
      fallbackReason: fallback,
      ttlMs: t[slice] ?? 15_000,
      cache: env.cache,
      cacheKey: keyPrefix(slice),
    });
  }

  // risk derives offline from the same dossier; launch mirrors the launchMint dossier state.
  slices.risk = typeof env.risk === 'function' ? await env.risk(assetId) : unsupportedResult('DEPENDENCY_UNVERIFIED');
  const launch = env.dossier?.launchMint;
  slices.launch = launch?.state === 'enabled'
    ? { supported: true, data: null }
    : unsupportedResult(launch?.reason ?? 'TOKEN_PATH_UNVERIFIED');

  return slices;
}

/**
 * Assemble market.snapshot payloads: one honest entry per requested asset. Same ladder,
 * compressed: identity + price only; every reason is derived, never invented.
 */
export async function assembleSnapshots(assetIds, env) {
  const snapshots = {};
  for (const assetId of assetIds) {
    const usd = env.dossier?.usd;
    snapshots[assetId] = {
      assetId,
      price: usd?.state === 'enabled'
        ? await resolveSlice('price', {
          env,
          sources: [
            { seam: 'chain', read: () => (env.chainReads?.price ?? mkNoSource('price', 'chain'))(assetId) },
            { seam: 'index', read: () => (env.indexReads?.price ?? mkNoSource('price', 'index'))(assetId) },
          ],
          fallbackReason: 'DEPENDENCY_UNVERIFIED',
          ttlMs: env.ttlMs?.price ?? 15_000,
          cache: env.cache,
          cacheKey: sliceCacheKey('market.snapshot', env, `price|${assetId}`),
        })
        : unsupportedResult(usd?.reason ?? 'DEPENDENCY_UNVERIFIED'),
    };
  }
  return snapshots;
}
