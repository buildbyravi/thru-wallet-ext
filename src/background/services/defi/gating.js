// Capability gate resolution for the DeFi backend surface (M0).
//
// ONE place decides why a DeFi method cannot run, with a fixed reason priority:
//
//   1. FLAG_OFF     — a build-time feature flag is off (the M0 state of everything).
//   2. KILL_SWITCH / FEED_MISSING — the R16 signed-feed narrowing. Implemented (G1-B) inside
//                     the registry's getFeature view: a quorum-verified kill vote disables an
//                     enabled feature, and a required feed that isn't LIVE yields FEED_MISSING.
//                     It fires only on enabled rows, only under the current genesis binding,
//                     and never in the shipped build (no publisher pinned, quorum 0).
//   3. Dossier      — the capability matrix says the feature is unsupported (e.g.
//                     PROGRAM_NOT_VERIFIED for swap), itself behind the B3 genesis binding
//                     (NETWORK_RESET under drift). Once flags go on, reads still fail closed
//                     until verification evidence lands.
//
// Two delivery modes (declared per method in src/shared/contract/defi-schema.js):
//   env 'result' — the caller gets data = { supported:false, reason } (union member of the
//                  method's wire shape; quote/page/detail shapes all carry this variant).
//   env 'error'  — the caller gets the error envelope { ok:false, error:{ code:'FEATURE_DISABLED' } }
//                  (shapes that cannot carry an unsupported variant, like Intent).
//
// Handlers MUST route through resolveGate() and never re-implement flag checks, so the gate
// behavior stays uniform and provable (test/test-defi-m0.mjs probes every method).

import { isDefiFeatureEnabled } from '../../../shared/flags.js';
// Registry owns the post-binding dossier view (G1-A): on a genesis mismatch it reports
// NETWORK_RESET here, and every caller inherits the behavior without a code change.
import { getFeature } from '../registry-service.js';

/** Builds the wire value for a declared-unsupported result. */
export function unsupportedResult(reason) {
  return { supported: false, reason };
}

/**
 * Builds the FEATURE_DISABLED error for env:'error' methods. Router error handling carries
 * error.code through to the envelope, so services can throw this like any other failure.
 */
export function featureDisabledError(featureLabel) {
  const err = new Error(`${featureLabel} is not part of this build.`);
  err.code = 'FEATURE_DISABLED';
  err.retryable = false;
  return err;
}

/**
 * Resolve the gate for one DeFi method.
 *
 * @param {{ gate: string, feature: string|null, env: 'result'|'error', label: string }} def
 *   gate    'always' or a DEFI_* flag name (checked with the master switch)
 *   feature capability-matrix key for the dossier rung, or null
 *   env     how a gate-off outcome is delivered
 *   label   short human feature name for messages
 * @returns {null | { mode:'result'|'error', reason?: string, error?: Error }}
 *   null means "clear to proceed"; otherwise the handler must return/throw as instructed.
 */
export function resolveGate({ gate, feature = null, env, label }) {
  if (gate !== 'always' && !isDefiFeatureEnabled(gate)) {
    if (env === 'result') return { mode: 'result', reason: 'FLAG_OFF' };
    return { mode: 'error', error: featureDisabledError(label) };
  }
  // Kill-switch / required-feed rung (G1-B): folded into the registry's getFeature view so
  // handlers, capability derivation, and risk facts all resolve the same row. A verified
  // narrowing surfaces here as the dossier-rung reason (KILL_SWITCH / FEED_MISSING), above
  // the dossier's own reason, without touching callers.
  if (feature) {
    const dossier = getFeature(feature);
    if (dossier && dossier.state !== 'enabled') {
      const reason = dossier.reason ?? 'UNSUPPORTED';
      if (env === 'result') return { mode: 'result', reason };
      const err = new Error(`${label} is unavailable: ${reason}.`);
      err.code = 'UNSUPPORTED';
      err.retryable = false;
      return { mode: 'error', error: err };
    }
  }
  return null;
}

/**
 * Convenience for handlers: run the gate, and short-circuit the common outcomes.
 * Returns { proceed: true } or { proceed: false, data? } — the caller either throws `data`
 * (already an Error) or returns it (already a wire value), depending on the mode.
 */
export function gateOrThrow(def) {
  const outcome = resolveGate(def);
  if (!outcome) return { proceed: true };
  if (outcome.mode === 'error') throw outcome.error;
  return { proceed: false, data: unsupportedResult(outcome.reason) };
}
