// Decoder registry — the one place operation types are recognised.
//
// A decoder is a PURE function of already-read facts:
//
//     decode({ network, account, facts }) -> review content (validated by model.js)
//
// It performs no RPC, holds no keys, and cannot sign. The background reads the facts (see
// src/background/services/review/kinds.js) and the shared UI renders whatever comes back, so
// adding an operation type is one registration here plus one facts reader — never a new
// confirmation screen.
//
// Kinds are lowercase kebab-case and stable: they are part of the contract (`tx.prepareReview`
// takes one) and appear in stored review records.
//
// There is deliberately NO fallback decoder. An unregistered kind must produce the explicit
// unsupported answer below, because guessing a friendly description for a transaction the
// wallet does not understand is the exact failure this system exists to prevent.

import { assertReviewContent } from './model.js';

export const KIND_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

const DECODERS = new Map();

/**
 * Register one operation type. Duplicate registration throws: two decoders for one kind would
 * make the rendered review depend on import order.
 *
 * @param {string} kind e.g. 'native-send'
 * @param {(context: {network: object, account: object, facts: object}) => object} decode
 */
export function registerDecoder(kind, decode) {
  if (typeof kind !== 'string' || !KIND_PATTERN.test(kind)) {
    throw new Error(`tx-review: invalid decoder kind '${String(kind)}' (expected lowercase-kebab-case)`);
  }
  if (typeof decode !== 'function') {
    throw new Error(`tx-review: decoder for '${kind}' must be a function`);
  }
  if (DECODERS.has(kind)) {
    throw new Error(`tx-review: a decoder for '${kind}' is already registered`);
  }
  DECODERS.set(kind, decode);
}

/** Every registered kind, sorted — used by tests and by prepareReview's unsupported answer. */
export function listDecoderKinds() {
  return [...DECODERS.keys()].sort();
}

/**
 * Decode one review, validating its shape.
 *
 * @param {string} kind
 * @param {{network: object, account: object, facts: object}} context
 * @throws {Error & {code: 'REVIEW_KIND_UNSUPPORTED'}} for a kind with no decoder
 */
export function decodeReview(kind, context) {
  const decode = DECODERS.get(kind);
  if (!decode) {
    const error = new Error(`tx-review: no decoder is registered for '${String(kind)}'`);
    error.code = 'REVIEW_KIND_UNSUPPORTED';
    throw error;
  }
  // Validate here, once, so every caller (background, tests, a future dApp path) gets the
  // same guarantee: a decoder cannot return a shape the renderer would choke on.
  return assertReviewContent(decode(context), `decode(${kind})`);
}
