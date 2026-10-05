// Intent pipeline surface (M0): R reads, P prepares, and the single X submit.
//
// The pipeline itself (one intent store built on the existing pending-tx tracker, quote/pool
// builders, the atomicity story from Q1) is gated behind DEFI_INTENT, which is false in this
// build. Every method therefore answers the FEATURE_DISABLED envelope — the honest statement
// "this build has no intent pipeline", as opposed to an empty list that would falsely imply a
// working pipeline with nothing in flight.
//
// Shapes, lifecycle (S8), resume/stop semantics and the exact store layout are pinned by
// test/fixtures/defi/intent-scripts.mjs so the frontend can build the whole timeline against
// them before any of this turns on.

import { gateOrThrow } from './defi/gating.js';

const GATE = { gate: 'DEFI_INTENT', feature: null, env: 'error', label: 'Intent pipeline' };

function disabled() {
  gateOrThrow(GATE); // env:'error' — throws FEATURE_DISABLED in this build
  const err = new Error('Intent pipeline is not implemented in this build.');
  err.code = 'NOT_READY';
  err.retryable = false;
  throw err;
}

// READ
export async function listIntents() { disabled(); }
export async function getIntent() { disabled(); }

// PREPARE
export async function prepareSend() { disabled(); }
export async function rePrepareIntent() { disabled(); }
export async function resumeIntent() { disabled(); }
export async function discardIntent() { disabled(); }
export async function stopWaitingIntent() { disabled(); }

// EXECUTE — reaches this handler only after the router has enforced auth:'signing'
// (unlocked + optional password re-verification). The flag gate still refuses the call: a
// password must never make a gated-off pipeline reachable.
export async function submitIntent() { disabled(); }
