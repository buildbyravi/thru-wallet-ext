// Signed-feed READ surface (M0 shape, G1-B machinery). No feed publisher is pinned and none
// is verified, so the ONLY honest answers remain an empty feed list and null lookups. The
// verification state machine behind these rows now lives in defi/feed-record.js and the
// registry (verify-at-intake, sync reads); the first evidence-pinned publisher plugs in
// without changing this wire shape (FEEDS spec: a signed feed supplements chain reads, never
// replaces them — R16).

import * as registry from './registry-service.js';
import { unsupportedResult } from './defi/gating.js';

const REGISTRY_NETWORK = 'betanet';

export async function getFeedStatus({ networkId } = {}) {
  const target = networkId ?? REGISTRY_NETWORK;
  const feeds = registry.listFeeds(target);
  if (!feeds) {
    return unsupportedResult('CUSTOM_NETWORK');
  }
  // { feeds: [] } is the full feed registry truth for this network: no publisher keys are
  // pinned anywhere in the repo (evidence: G0 registry seed, feedSummary { feeds: [] }).
  return { feeds };
}

export async function lookupFeeds({ ids }) {
  // ids are schema-validated before this runs. Every id answers null = "unknown feed", which is
  // materially different from a fabricated record and from an error: callers render "no feed".
  const feeds = {};
  for (const id of ids ?? []) feeds[id] = null;
  return { feeds };
}
