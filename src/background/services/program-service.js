// Program registry + capability READ surface. Discovery methods — callable while locked, in
// every build, with ZERO network traffic: they answer from the DeFi registry service (G1-A),
// which derives post-binding state from the evidence-pinned snapshot (B3 genesis binding).
// The frontend renders capability-honest DeFi screens from these (S13: discovery reads
// always work). Unknown networks answer { supported:false, reason:'CUSTOM_NETWORK' }.

import * as registry from './registry-service.js';
import { unsupportedResult } from './defi/gating.js';

const REGISTRY_NETWORK = 'betanet';

export async function getCapabilities({ networkId } = {}) {
  const target = networkId ?? REGISTRY_NETWORK;
  const caps = registry.deriveCapabilities(target);
  if (!caps) {
    return unsupportedResult('CUSTOM_NETWORK');
  }
  return caps;
}

export async function listPrograms({ networkId } = {}) {
  const target = networkId ?? REGISTRY_NETWORK;
  const programs = registry.getProgramRecords(target);
  if (!programs) {
    return unsupportedResult('CUSTOM_NETWORK');
  }
  // evidenceRef stays on the wire: a capability claim without its evidence pointer would be
  // exactly the trust-by-assertion pattern R4/R8 forbid.
  return { networkId: target, programs };
}
