// Program registry + capability READ surface (M0). Discovery methods — callable while locked,
// in every build, with ZERO network traffic: they answer from the evidence-pinned snapshot so
// the frontend can render capability-honest DeFi screens (S13: discovery reads always work).
//
// Everything here derives from src/background/services/defi/capability-snapshot.js, which is
// pinned to the G0 evidence seeds by test. No guesses: unknown networks answer
// { supported:false, reason:'CUSTOM_NETWORK' }, and unsupported rows carry their S10 reason.

import { listMethodNames } from '../../shared/contract/manifest.js';
import { isDefiMethod, getDefiSpec } from '../../shared/contract/defi-schema.js';
import { isDefiFeatureEnabled } from '../../shared/flags.js';
import {
  SNAPSHOT_META, PROGRAMS, FEATURES, LIMITS, programFacts, getFeature,
} from './defi/capability-snapshot.js';
import { unsupportedResult } from './defi/gating.js';

const REGISTRY_NETWORK = SNAPSHOT_META.networkId;

/**
 * Capabilities.methodCapabilities: EVERY method in the contract, value `true` when callable in
 * this build, or { supported:false, reason } when not. Derived from the live contract + flags +
 * dossier so the matrix can never silently drift from the shipped surface.
 *
 * Wallet-core methods are `true` because their handlers are wired and shipped. DeFi methods
 * derive from the same gate ladder the handlers use, so a quote that answers FLAG_OFF here
 * really answers FLAG_OFF at the router.
 */
function deriveMethodCapabilities() {
  const caps = {};
  for (const method of listMethodNames()) {
    if (!isDefiMethod(method)) {
      caps[method] = true;
      continue;
    }
    const { spec } = getDefiSpec(method);
    if (spec.gate === 'always') {
      caps[method] = true;
      continue;
    }
    if (!isDefiFeatureEnabled(spec.gate)) {
      caps[method] = { supported: false, reason: 'FLAG_OFF' };
      continue;
    }
    if (spec.feature) {
      const dossier = getFeature(spec.feature);
      if (dossier && dossier.state !== 'enabled') {
        caps[method] = { supported: false, reason: dossier.reason };
        continue;
      }
    }
    caps[method] = true;
  }
  return caps;
}

/** Capabilities.featureCapabilities with the same true/Unsupported union as methods. */
function deriveFeatureCapabilities() {
  const caps = {};
  for (const row of FEATURES) {
    caps[row.key] = row.state === 'enabled'
      ? true
      : { supported: false, reason: row.reason };
  }
  return caps;
}

export async function getCapabilities({ networkId } = {}) {
  const target = networkId ?? REGISTRY_NETWORK;
  if (target !== REGISTRY_NETWORK) {
    return unsupportedResult('CUSTOM_NETWORK');
  }
  return {
    networkId: REGISTRY_NETWORK,
    registryVersion: SNAPSHOT_META.registryVersion,
    matrixVersion: SNAPSHOT_META.matrixVersion,
    programFacts: programFacts(),
    methodCapabilities: deriveMethodCapabilities(),
    featureCapabilities: deriveFeatureCapabilities(),
    limits: { ...LIMITS },
  };
}

export async function listPrograms({ networkId } = {}) {
  const target = networkId ?? REGISTRY_NETWORK;
  if (target !== REGISTRY_NETWORK) {
    return unsupportedResult('CUSTOM_NETWORK');
  }
  // evidenceRef stays on the wire: a capability claim without its evidence pointer would be
  // exactly the trust-by-assertion pattern R4/R8 forbid.
  return {
    networkId: REGISTRY_NETWORK,
    programs: PROGRAMS.map((p) => ({ ...p })),
  };
}


