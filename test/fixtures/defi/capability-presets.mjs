// Capability presets: four full program.capabilities responses for DeFi renderer states
// (S13). Built FROM the shipped schema + snapshot (test-only imports — never bundled), so a
// preset can never drift from the contract it simulates.
//
//   everythingOff  all flags false — today's real behavior. The M0 test deep-equals the
//                  `everythingOff` capabilities object against the live handler dispatch.
//   readOnly       DEFI + DEFI_READ — discovery/pool reads surface dossier reasons.
//   swapOnly       + DEFI_DEX — swap/pool quotes and prepares surface dossier reasons.
//   full           every DEFI_* flag — STILL mostly unsupported: flags do not fabricate
//                  evidence, so the dossier reasons replace FLAG_OFF everywhere evidence is
//                  missing. The frontend must render exactly this matrix.
//
// `simulated` is true for every preset except everythingOff: they exist to exercise UI states,
// never to claim capabilities the evidence does not back.

import { listMethodNames } from '../../../src/shared/contract/manifest.js';
import { isDefiMethod, getDefiSpec } from '../../../src/shared/contract/defi-schema.js';
import {
  SNAPSHOT_META, FEATURES, LIMITS, programFacts,
} from '../../../src/background/services/defi/capability-snapshot.js';

const ALL_DEFI_FLAGS = ['DEFI_READ', 'DEFI_DEX', 'DEFI_LAUNCHPAD', 'DEFI_MARKET', 'DEFI_RISK', 'DEFI_INTENT', 'DEFI_FEED', 'DEFI_DESKTOP'];

function featureRowEnabled(key) {
  return FEATURES.find((f) => f.key === key)?.state === 'enabled';
}
function featureRowReason(key) {
  return FEATURES.find((f) => f.key === key)?.reason ?? 'UNSUPPORTED';
}

function buildFeatureCapabilities() {
  const caps = {};
  for (const row of FEATURES) {
    caps[row.key] = row.state === 'enabled' ? true : { supported: false, reason: row.reason };
  }
  return caps;
}

function buildMethodCapabilities(flagMap) {
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
    const flagOn = flagMap.DEFI === true && flagMap[spec.gate] === true;
    if (!flagOn) {
      caps[method] = { supported: false, reason: 'FLAG_OFF' };
      continue;
    }
    if (spec.feature && !featureRowEnabled(spec.feature)) {
      caps[method] = { supported: false, reason: featureRowReason(spec.feature) };
      continue;
    }
    caps[method] = true;
  }
  return caps;
}

function buildPreset({ name, simulated, flags, note }) {
  return Object.freeze({
    name,
    simulated,
    note,
    capabilities: Object.freeze({
      networkId: SNAPSHOT_META.networkId,
      registryVersion: SNAPSHOT_META.registryVersion,
      matrixVersion: SNAPSHOT_META.matrixVersion,
      programFacts: programFacts(),
      methodCapabilities: buildMethodCapabilities(flags),
      featureCapabilities: buildFeatureCapabilities(),
      limits: { ...LIMITS },
    }),
  });
}

const OFF = Object.freeze(Object.fromEntries(['DEFI', ...ALL_DEFI_FLAGS].map((f) => [f, false])));

export const CAPABILITY_PRESETS = Object.freeze([
  buildPreset({
    name: 'everythingOff',
    simulated: false,
    flags: OFF,
    note: 'Exactly what this build serves. Pinned by deep equality against live dispatch.',
  }),
  buildPreset({
    name: 'readOnly',
    simulated: true,
    flags: { ...OFF, DEFI: true, DEFI_READ: true },
    note: 'Discovery/pool/launch reads switch from FLAG_OFF to their dossier reasons '
      + '(NO_INDEXER, PROGRAM_NOT_VERIFIED, TOKEN_PATH_UNVERIFIED). risk/validateDraft still '
      + 'need DEFI_RISK; the intent pipeline is entirely off.',
  }),
  buildPreset({
    name: 'swapOnly',
    simulated: true,
    flags: { ...OFF, DEFI: true, DEFI_READ: true, DEFI_DEX: true },
    note: 'Quote/prepare methods surface PROGRAM_NOT_VERIFIED until the AMM program verifies '
      + 'live (Q14-Q19 + R2 exit-before-entry). Launchpad/market surfaces stay FLAG_OFF.',
  }),
  buildPreset({
    name: 'full',
    simulated: true,
    flags: Object.fromEntries(['DEFI', ...ALL_DEFI_FLAGS].map((f) => [f, true])),
    note: 'Every flag on. Flags are not evidence: methods whose dossier row is unsupported '
      + 'still answer with the dossier reason. Only risk.assetAssess, launchpad.validateDraft '
      + '(offline derivations) and the discovery reads answer true until verification lands.',
  }),
]);

export function getPreset(name) {
  return CAPABILITY_PRESETS.find((p) => p.name === name) ?? null;
}
