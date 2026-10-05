// Launchpad feature backend (M0 contract-first drop), per docs/MODULE_BOUNDARIES.md.
//
// What this build really contains:
//   - list/read surfaces gated DEFI_READ, answering { supported:false, reason } — the dossier
//     reason NO_INDEXER once flags are on (curated launch lists need an indexer; by-address
//     pages need the verified token path — see the capability snapshot).
//   - ONE working method behind the read flag: validateDraft, which runs the offline draft
//     rules plus the launch-blocking capability strands. Its job is precisely to show why a
//     launch cannot proceed, so it is real and testable even though launching is gated.
//   - Everything that would build or persist (prepare*/uploadImage/drafts) answers
//     FEATURE_DISABLED: no launch code, image proxy, or storage exists at M0, and nothing is
//     faked.
//
// UX rule honoured here (CREATION-04): a launch screen is a launch control, not marketing —
// the first visible thing must be the blocking conditions, which validateDraft derives from
// the dossier rather than hard-coding.

import { gateOrThrow } from '../../services/defi/gating.js';
import { getFeature } from '../../services/defi/capability-snapshot.js';

const GATES = {
  list: { gate: 'DEFI_READ', feature: 'discovery', env: 'result', label: 'Launch discovery' },
  get: { gate: 'DEFI_READ', feature: 'discovery', env: 'result', label: 'Launch detail' },
  templates: { gate: 'DEFI_READ', feature: 'launchMint', env: 'result', label: 'Launch templates' },
  listMine: { gate: 'DEFI_READ', feature: 'launchMint', env: 'error', label: 'Own-launch reads' },
  validateDraft: { gate: 'DEFI_READ', feature: null, env: 'error', label: 'Draft validation' },
  uploadImage: { gate: 'DEFI_LAUNCHPAD', feature: 'launchMint', env: 'error', label: 'Launch image upload' },
  prepareCreate: { gate: 'DEFI_LAUNCHPAD', feature: 'launchMint', env: 'error', label: 'Launch creation' },
  prepareMigrate: { gate: 'DEFI_LAUNCHPAD', feature: 'migrate', env: 'error', label: 'Launch migration' },
  prepareClaim: { gate: 'DEFI_LAUNCHPAD', feature: 'claim', env: 'error', label: 'Creator-fee claim' },
  drafts: { gate: 'DEFI_LAUNCHPAD', feature: null, env: 'error', label: 'Launch drafts' },
};

function readOrUnsupported(def) {
  const { proceed, data } = gateOrThrow(def);
  if (!proceed) return data;
  const err = new Error(`${def.label}: read path is not implemented in this build.`);
  err.code = 'NOT_READY';
  err.retryable = false;
  throw err;
}

// ---- READ ------------------------------------------------------------------

export async function listLaunches() { return readOrUnsupported(GATES.list); }
export async function getLaunch() { return readOrUnsupported(GATES.get); }
export async function listTemplates() { return readOrUnsupported(GATES.templates); }
export async function listMyLaunches() { return readOrUnsupported(GATES.listMine); }

// ---- Draft validation (real, offline) ---------------------------------------

const LAUNCH_MODELS = new Set(['none', 'pool', 'curve']);

function issue(field, message) {
  return { field, message };
}

/**
 * Offline draft validation. `draft` is schema-checked at the router (object); here we validate
 * the fields that compose a launch without ever consulting chain state, then append the
 * blocking capability strands from the dossier. Nothing here authorizes a launch.
 */
function validateDraftOffline(draft = {}) {
  const identityIssues = [];

  const name = draft.name;
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 32) {
    identityIssues.push(issue('name', 'Name must be 1-32 characters.'));
  }
  const symbol = draft.symbol;
  if (typeof symbol !== 'string' || !/^[A-Z0-9]{1,10}$/.test(symbol)) {
    identityIssues.push(issue('symbol', 'Symbol must be 1-10 characters, A-Z and 0-9 only.'));
  }
  if (draft.description !== undefined
    && (typeof draft.description !== 'string' || draft.description.length > 280)) {
    identityIssues.push(issue('description', 'Description must be at most 280 characters.'));
  }
  if (typeof draft.supply !== 'string' || !/^[0-9]+$/.test(draft.supply) || BigInt(draft.supply) <= 0n) {
    identityIssues.push(issue('supply', 'Supply must be a positive whole amount in base units (never a float).'));
  }
  if (!Number.isInteger(draft.decimals) || draft.decimals < 0 || draft.decimals > 9) {
    identityIssues.push(issue('decimals', 'Decimals must be an integer between 0 and 9.'));
  }
  // Upload-first image rule (CREATION-05): only a previously uploaded, content-pinned image is
  // valid. Anything else (data URLs, remote URLs typed by hand) is rejected here, offline.
  if (draft.image !== undefined) {
    const img = draft.image;
    if (!img || typeof img !== 'object'
      || typeof img.url !== 'string' || img.url.length === 0
      || typeof img.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(img.sha256)) {
      identityIssues.push(issue('image', 'Image must come from launchpad.uploadImage: { url, sha256 }.'));
    }
  }

  const launchModel = draft.launchModel === undefined ? 'none' : draft.launchModel;
  let curve = null;
  if (!LAUNCH_MODELS.has(launchModel)) {
    identityIssues.push(issue('launchModel', "Launch model must be 'none', 'pool', or 'curve'."));
  } else if (launchModel !== 'none') {
    // Offline shape checks only; the model itself is a blocking strand below.
    const cfg = draft.curve && typeof draft.curve === 'object' ? draft.curve : {};
    const curveIssues = [];
    if (launchModel === 'curve' && (typeof cfg.initialBuy !== 'string' || !/^[0-9]+$/.test(cfg.initialBuy))) {
      curveIssues.push(issue('curve.initialBuy', 'Initial buy must be a whole amount in base units.'));
    }
    curve = { valid: curveIssues.length === 0, issues: curveIssues };
  }

  // Blocking capability strands, derived from the dossier (never hard-coded): whatever the
  // draft looks like, these say why a launch cannot proceed today — and update automatically
  // the day evidence lands.
  const strands = [];
  const addStrand = (featureKey, capability, how) => {
    const row = getFeature(featureKey);
    if (row && row.state !== 'enabled') {
      strands.push({ capability, blocking: true, how: how ?? `${featureKey}: ${row.reason}`, reason: row.reason });
    }
  };
  addStrand('launchMint', 'token.create+transfer', 'Mint and token-account path unverified (P3/Q13 prerequisite).');
  if (launchModel === 'pool') addStrand('launchDirectPool', 'launch.pool', 'Direct-pool model waits on mint path + verified pools.');
  if (launchModel === 'curve') addStrand('launchCurve', 'launch.curve', 'No curve program exists to deploy against (package-side negative; live search open).');

  const warnings = [
    'Offline validation only: no chain state, registry freshness, or fee estimate was consulted.',
  ];
  const sim = getFeature('simulation');
  if (sim?.state !== 'enabled') {
    warnings.push(`Reviews will ship unsimulated (${sim?.reason ?? 'NO_SIMULATION'}): cost and effect displays stay declaration-level until simulation exists.`);
  }

  return {
    identity: { valid: identityIssues.length === 0, issues: identityIssues },
    curve,
    strands,
    errors: [],
    warnings,
  };
}

export async function validateDraft({ networkId, draft } = {}) {
  gateOrThrow(GATES.validateDraft); // env:'error' — FEATURE_DISABLED while DEFI_READ is off
  return validateDraftOffline(draft);
}

// ---- PREPARE / LOCAL (all gated off at M0) -----------------------------------

export async function uploadImage() {
  gateOrThrow(GATES.uploadImage);
}
export async function prepareCreate() {
  gateOrThrow(GATES.prepareCreate);
}
export async function prepareMigrate() {
  gateOrThrow(GATES.prepareMigrate);
}
export async function prepareClaim() {
  gateOrThrow(GATES.prepareClaim);
}
export async function draftList() {
  gateOrThrow(GATES.drafts);
}
export async function draftGet() {
  gateOrThrow(GATES.drafts);
}
export async function draftSave() {
  gateOrThrow(GATES.drafts);
}
export async function draftDelete() {
  gateOrThrow(GATES.drafts);
}
