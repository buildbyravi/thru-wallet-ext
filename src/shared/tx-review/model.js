// The ONE transaction-review wire model.
//
// Every value-moving wallet feature (native send, token transfer, domain writes, faucet
// claims, and any future swap / launchpad / AMM operation) prepares a typed intent through
// `tx.prepareReview` and receives THIS shape back. The shared review UI renders it
// generically; it never knows what a domain or a swap is, so a new operation type cannot
// ship its own confirmation screen, fee formatter or warning vocabulary.
//
// Design rules that this module encodes:
//
//   1. Money crosses the wire as a base-unit STRING plus an explicit `decimals`. No floats,
//      no pre-formatted "0.5" that a caller could have rounded. The single formatter
//      (`src/shared/format.js`) turns it into display text at the last moment.
//   2. Absence is a declared state, never a zero. `fee.supported === false` carries the
//      honest reason; `balanceAfter` stays null because Thru has no verified simulation.
//   3. `state: 'blocked'` means the wallet has PROVEN the operation would fail or is
//      forbidden (recipient not activated, lease already taken, not the owner). The UI
//      disables signing from this flag — it never re-derives validation itself.
//   4. `decode: 'unknown'` means the wallet cannot explain the transaction. That is a
//      first-class outcome with its own rendering, never a guessed friendly title.
//
// The validator below is used by the background at prepare time and by tests. It is
// deliberately strict: a malformed review is a programming error, and the UI must never be
// handed a shape it cannot render (a missing `assets.outgoing` array used to be a crash).

/** Bumped when the review shape changes in a way that breaks a renderer. */
export const TX_REVIEW_VERSION = 1;

/** How long a prepared review stays valid before it must be prepared again. */
export const TX_REVIEW_TTL_MS = 120_000;

export const REVIEW_STATES = Object.freeze(['ready', 'blocked']);
export const DECODE_STATES = Object.freeze(['decoded', 'unknown']);
export const SEVERITIES = Object.freeze(['info', 'warning', 'danger']);
export const SIMULATION_STATUSES = Object.freeze(['supported', 'unavailable', 'failed', 'pending']);
export const SUBMIT_AUTHS = Object.freeze(['signing', 'unlocked']);

/** First session-only-signing default (D-003) is unchanged; this only names what the UI sees. */
/** Pipeline refusals raised by tx.prepareReview / tx.confirmReview / tx.discardReview. */
export const REVIEW_ERROR_CODES = Object.freeze({
  KIND_UNSUPPORTED: 'KIND_UNSUPPORTED',
  REVIEW_NOT_FOUND: 'REVIEW_NOT_FOUND',
  REVIEW_EXPIRED: 'REVIEW_EXPIRED',
  BINDING_MISMATCH: 'BINDING_MISMATCH',
  REVIEW_CONTEXT_CHANGED: 'REVIEW_CONTEXT_CHANGED',
  ACKNOWLEDGEMENT_REQUIRED: 'ACKNOWLEDGEMENT_REQUIRED',
  NOT_EXECUTABLE: 'NOT_EXECUTABLE',
});

/**
 * Every code the review layer may throw, in one place.
 *
 * The `REVIEW_*_CHANGED` family is raised by a kind's recheck (the chain moved under the
 * review); the domain codes are the registrar's own refusals re-surfaced unchanged. They used to
 * be string literals spread across `review/kinds.js` and enumerated a second time in the UI's
 * `classifyReviewError` — two lists that could silently disagree. `test-tx-review.mjs` now walks
 * the background sources and fails if a code is thrown that is not registered here or in the
 * contract's ERROR_CODES, so the list cannot drift again.
 */
export const REVIEW_RECHECK_CODES = Object.freeze({
  REVIEW_FEE_CHANGED: 'REVIEW_FEE_CHANGED',
  REVIEW_TOKEN_CHANGED: 'REVIEW_TOKEN_CHANGED',
  REVIEW_REGISTRAR_CHANGED: 'REVIEW_REGISTRAR_CHANGED',
  REVIEW_PRICE_CHANGED: 'REVIEW_PRICE_CHANGED',
  REVIEW_EXPIRY_CHANGED: 'REVIEW_EXPIRY_CHANGED',
  REVIEW_FAUCET_CHANGED: 'REVIEW_FAUCET_CHANGED',
  REVIEW_UNAVAILABLE: 'REVIEW_UNAVAILABLE',
  REVIEW_INTERNAL: 'REVIEW_INTERNAL',
  // Registrar refusals that mean "the thing you reviewed is not there any more".
  NAME_TAKEN: 'NAME_TAKEN',
  LEASE_NOT_FOUND: 'LEASE_NOT_FOUND',
  LEASE_NOT_EXPIRED: 'LEASE_NOT_EXPIRED',
  NOT_NAME_OWNER: 'NOT_NAME_OWNER',
});

/** The full set, for callers that need to branch on any review code. */
export const REVIEW_CODE = Object.freeze({ ...REVIEW_ERROR_CODES, ...REVIEW_RECHECK_CODES });

/**
 * Codes that mean "the review you are looking at is no longer the transaction". The only correct
 * response is to prepare and READ a fresh review; never to retry the same signature.
 */
export const STALE_REVIEW_CODES = Object.freeze([
  REVIEW_ERROR_CODES.REVIEW_NOT_FOUND,
  REVIEW_ERROR_CODES.REVIEW_EXPIRED,
  REVIEW_ERROR_CODES.BINDING_MISMATCH,
  REVIEW_ERROR_CODES.REVIEW_CONTEXT_CHANGED,
  REVIEW_RECHECK_CODES.REVIEW_PRICE_CHANGED,
  REVIEW_RECHECK_CODES.REVIEW_EXPIRY_CHANGED,
  REVIEW_RECHECK_CODES.REVIEW_FEE_CHANGED,
  REVIEW_RECHECK_CODES.REVIEW_TOKEN_CHANGED,
  REVIEW_RECHECK_CODES.REVIEW_REGISTRAR_CHANGED,
  REVIEW_RECHECK_CODES.REVIEW_FAUCET_CHANGED,
  REVIEW_RECHECK_CODES.REVIEW_UNAVAILABLE,
  REVIEW_RECHECK_CODES.NAME_TAKEN,
  REVIEW_RECHECK_CODES.LEASE_NOT_FOUND,
  REVIEW_RECHECK_CODES.LEASE_NOT_EXPIRED,
  REVIEW_RECHECK_CODES.NOT_NAME_OWNER,
]);

const MAX_TEXT = 400;

function bad(path, message) {
  throw new Error(`tx-review: ${path} ${message}`);
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireObject(value, path) {
  if (!isObject(value)) bad(path, `must be an object (got ${value === null ? 'null' : typeof value})`);
  return value;
}

function requireString(value, path, { allowEmpty = false, max = MAX_TEXT } = {}) {
  if (typeof value !== 'string') bad(path, `must be a string (got ${typeof value})`);
  if (!allowEmpty && value.trim() === '') bad(path, 'must not be empty');
  if (value.length > max) bad(path, `must be at most ${max} characters`);
  return value;
}

function optionalString(value, path, options) {
  if (value == null) return null;
  return requireString(value, path, options);
}

function requireArray(value, path) {
  if (!Array.isArray(value)) bad(path, `must be an array (got ${value === null ? 'null' : typeof value})`);
  return value;
}

function requireEnum(value, allowed, path) {
  if (!allowed.includes(value)) bad(path, `must be one of ${allowed.join('|')} (got ${String(value)})`);
  return value;
}

/** Base units are an unsigned integer string; nothing else is accepted. */
function requireUnits(value, path) {
  requireString(value, path, { max: 80 });
  if (!/^\d+$/.test(value)) bad(path, 'must be an unsigned base-unit integer string');
  return value;
}

function optionalUnits(value, path) {
  if (value == null) return null;
  return requireUnits(value, path);
}

function requireDecimals(value, path) {
  if (!Number.isInteger(value) || value < 0 || value > 18) bad(path, 'must be an integer 0–18');
  return value;
}

/** One asset side of the balance change. `verified:false` means metadata is user-provided. */
export function assertAsset(asset, path = 'asset') {
  requireObject(asset, path);
  requireString(asset.symbol, `${path}.symbol`, { max: 32 });
  optionalString(asset.name, `${path}.name`, { max: 64 });
  requireUnits(asset.amountUnits, `${path}.amountUnits`);
  requireDecimals(asset.decimals, `${path}.decimals`);
  if (typeof asset.verified !== 'boolean') bad(`${path}.verified`, 'must be a boolean');
  if (asset.mintAddress != null) requireString(asset.mintAddress, `${path}.mintAddress`, { max: 128 });
  optionalString(asset.note, `${path}.note`, { max: MAX_TEXT });
  return asset;
}

/**
 * Validate the CONTENT a decoder produced (everything derived from the operation's facts).
 * The background adds the envelope (ids, network, account, simulation, submit policy).
 */
export function assertReviewContent(content, path = 'content') {
  requireObject(content, path);

  const operation = requireObject(content.operation, `${path}.operation`);
  requireString(operation.id, `${path}.operation.id`, { max: 64 });
  requireString(operation.name, `${path}.operation.name`, { max: 96 });
  requireString(operation.summary, `${path}.operation.summary`, { max: MAX_TEXT, allowEmpty: true });
  optionalString(operation.confirmLabel, `${path}.operation.confirmLabel`, { max: 48 });
  requireEnum(operation.decode, DECODE_STATES, `${path}.operation.decode`);

  if (content.protocol != null) {
    const protocol = requireObject(content.protocol, `${path}.protocol`);
    requireString(protocol.name, `${path}.protocol.name`, { max: 96 });
    optionalString(protocol.address, `${path}.protocol.address`, { max: 128 });
    if (typeof protocol.verified !== 'boolean') bad(`${path}.protocol.verified`, 'must be a boolean');
    // "Verified" is a claim about a specific pinned address. Without the address there is
    // nothing to have verified, so the pair is refused rather than rendered as trust.
    if (protocol.verified === true && !protocol.address) {
      bad(`${path}.protocol.address`, 'must be present when protocol.verified is true');
    }
    optionalString(protocol.source, `${path}.protocol.source`, { max: MAX_TEXT });
  }

  requireArray(content.summary, `${path}.summary`).forEach((row, index) => {
    requireObject(row, `${path}.summary[${index}]`);
    requireString(row.label, `${path}.summary[${index}].label`, { max: 64 });
    requireString(row.value, `${path}.summary[${index}].value`, { max: MAX_TEXT, allowEmpty: true });
    optionalString(row.above, `${path}.summary[${index}].above`, { max: MAX_TEXT });
    if (row.mono != null && typeof row.mono !== 'boolean') bad(`${path}.summary[${index}].mono`, 'must be a boolean');
    if (row.tone != null) requireEnum(row.tone, ['default', 'positive', 'negative'], `${path}.summary[${index}].tone`);
  });

  const assets = requireObject(content.assets, `${path}.assets`);
  requireArray(assets.outgoing, `${path}.assets.outgoing`).forEach((asset, index) => assertAsset(asset, `${path}.assets.outgoing[${index}]`));
  requireArray(assets.incoming, `${path}.assets.incoming`).forEach((asset, index) => assertAsset(asset, `${path}.assets.incoming[${index}]`));

  const fee = requireObject(assets.fee, `${path}.assets.fee`);
  if (typeof fee.supported !== 'boolean') bad(`${path}.assets.fee.supported`, 'must be a boolean');
  requireString(fee.symbol, `${path}.assets.fee.symbol`, { max: 32 });
  requireDecimals(fee.decimals, `${path}.assets.fee.decimals`);
  if (fee.supported) {
    requireUnits(fee.amountUnits, `${path}.assets.fee.amountUnits`);
  } else {
    optionalUnits(fee.amountUnits, `${path}.assets.fee.amountUnits`);
  }
  optionalUnits(fee.reserveUnits, `${path}.assets.fee.reserveUnits`);
  optionalString(fee.source, `${path}.assets.fee.source`, { max: 64 });
  requireString(fee.note, `${path}.assets.fee.note`, { max: MAX_TEXT, allowEmpty: true });

  // Never a fabricated post-transaction balance: Thru has no verified dry-run.
  if (assets.balanceAfter != null) bad(`${path}.assets.balanceAfter`, 'must be null — the wallet has no verified simulation');
  requireString(assets.balanceAfterNote, `${path}.assets.balanceAfterNote`, { max: MAX_TEXT, allowEmpty: false });

  const execution = requireObject(content.execution, `${path}.execution`);
  if (execution.program != null) {
    const program = requireObject(execution.program, `${path}.execution.program`);
    requireString(program.name, `${path}.execution.program.name`, { max: 96 });
    optionalString(program.address, `${path}.execution.program.address`, { max: 128 });
    if (typeof program.verified !== 'boolean') bad(`${path}.execution.program.verified`, 'must be a boolean');
    if (program.verified === true && !program.address) {
      bad(`${path}.execution.program.address`, 'must be present when execution.program.verified is true');
    }
  }
  requireArray(execution.instructions, `${path}.execution.instructions`).forEach((instruction, index) => {
    requireObject(instruction, `${path}.execution.instructions[${index}]`);
    requireString(instruction.name, `${path}.execution.instructions[${index}].name`, { max: 96 });
    if (typeof instruction.decoded !== 'boolean') bad(`${path}.execution.instructions[${index}].decoded`, 'must be a boolean');
    optionalString(instruction.note, `${path}.execution.instructions[${index}].note`, { max: MAX_TEXT });
  });
  requireArray(execution.accounts, `${path}.execution.accounts`).forEach((entry, index) => {
    requireObject(entry, `${path}.execution.accounts[${index}]`);
    requireString(entry.role, `${path}.execution.accounts[${index}].role`, { max: 48 });
    requireString(entry.address, `${path}.execution.accounts[${index}].address`, { max: 128 });
  });
  if (execution.raw != null) {
    const raw = requireObject(execution.raw, `${path}.execution.raw`);
    requireEnum(raw.format, ['json', 'hex'], `${path}.execution.raw.format`);
    requireString(raw.data, `${path}.execution.raw.data`, { max: 8000, allowEmpty: true });
    optionalString(raw.note, `${path}.execution.raw.note`, { max: MAX_TEXT });
  }

  requireArray(content.warnings, `${path}.warnings`).forEach((warning, index) => {
    requireObject(warning, `${path}.warnings[${index}]`);
    requireString(warning.id, `${path}.warnings[${index}].id`, { max: 64 });
    requireEnum(warning.severity, SEVERITIES, `${path}.warnings[${index}].severity`);
    requireString(warning.title, `${path}.warnings[${index}].title`, { max: 96 });
    requireString(warning.detail, `${path}.warnings[${index}].detail`, { max: MAX_TEXT, allowEmpty: true });
    if (warning.blocking != null && typeof warning.blocking !== 'boolean') bad(`${path}.warnings[${index}].blocking`, 'must be a boolean');
  });

  requireArray(content.acknowledgements, `${path}.acknowledgements`).forEach((ack, index) => {
    requireObject(ack, `${path}.acknowledgements[${index}]`);
    requireString(ack.id, `${path}.acknowledgements[${index}].id`, { max: 64 });
    requireString(ack.label, `${path}.acknowledgements[${index}].label`, { max: 140 });
  });

  return content;
}

/** The ONE rule for "can this be signed": a blocking warning blocks it. */
export function stateFromWarnings(warnings = []) {
  return warnings.some((warning) => warning?.blocking === true) ? 'blocked' : 'ready';
}

/**
 * Validate a full review envelope. Returns it unchanged so callers can `return assertReview(x)`.
 */
export function assertReview(review, path = 'review') {
  requireObject(review, path);
  if (review.reviewVersion !== TX_REVIEW_VERSION) {
    bad(`${path}.reviewVersion`, `must be ${TX_REVIEW_VERSION} (got ${String(review.reviewVersion)})`);
  }
  requireString(review.reviewId, `${path}.reviewId`, { max: 96 });
  requireString(review.kind, `${path}.kind`, { max: 64 });
  requireEnum(review.state, REVIEW_STATES, `${path}.state`);
  requireString(review.bindingHash, `${path}.bindingHash`, { max: 128 });
  if (!Number.isFinite(review.createdAt) || !Number.isFinite(review.expiresAt)) {
    bad(`${path}.expiresAt`, 'createdAt/expiresAt must be numbers');
  }
  if (review.expiresAt <= review.createdAt) bad(`${path}.expiresAt`, 'must be after createdAt');

  const network = requireObject(review.network, `${path}.network`);
  requireString(network.id, `${path}.network.id`, { max: 64 });
  requireString(network.label, `${path}.network.label`, { max: 64 });
  if (typeof network.isTestnet !== 'boolean') bad(`${path}.network.isTestnet`, 'must be a boolean');

  const account = requireObject(review.account, `${path}.account`);
  requireString(account.address, `${path}.account.address`, { max: 128 });
  optionalString(account.label, `${path}.account.label`, { max: 64 });

  assertReviewContent(review, path);

  const simulation = requireObject(review.simulation, `${path}.simulation`);
  requireEnum(simulation.status, SIMULATION_STATUSES, `${path}.simulation.status`);
  requireString(simulation.reason, `${path}.simulation.reason`, { max: MAX_TEXT, allowEmpty: true });
  requireString(simulation.provenance, `${path}.simulation.provenance`, { max: 160 });
  if (!Number.isFinite(simulation.checkedAt)) bad(`${path}.simulation.checkedAt`, 'must be a number');
  // A "successful" simulation must carry actual results; there is no other way to claim one.
  if (simulation.status === 'supported' && simulation.changes == null) {
    bad(`${path}.simulation.changes`, 'must be present when status is supported');
  }

  // State and warnings must agree in BOTH directions: "blocked" is only ever the result of a
  // proven blocking warning, and a "ready" review may not silently carry one.
  const hasBlocking = review.warnings.some((warning) => warning?.blocking === true);
  if (review.state === 'blocked' && !hasBlocking) {
    bad(`${path}.state`, 'a blocked review must carry at least one blocking warning');
  }
  if (review.state === 'ready' && hasBlocking) {
    bad(`${path}.state`, 'a ready review may not carry a blocking warning');
  }

  if (review.submitPolicy == null) {
    if (review.state !== 'blocked') bad(`${path}.submitPolicy`, 'may only be null for a blocked review');
  } else {
    const submit = requireObject(review.submitPolicy, `${path}.submitPolicy`);
    requireString(submit.method, `${path}.submitPolicy.method`, { max: 64 });
    requireEnum(submit.auth, SUBMIT_AUTHS, `${path}.submitPolicy.auth`);
    if (typeof submit.passwordRequired !== 'boolean') bad(`${path}.submitPolicy.passwordRequired`, 'must be a boolean');
  }
  return review;
}

/** True when every acknowledgement the review demands has been accepted. */
export function acknowledgementsSatisfied(review, accepted = []) {
  const required = (review?.acknowledgements ?? []).map((ack) => ack.id);
  if (required.length === 0) return true;
  const set = new Set(accepted);
  return required.every((id) => set.has(id));
}

/**
 * The set of facts a review is bound to. Used by the background to detect a review that no
 * longer matches the transaction the user actually read.
 */
export function bindingPayload({ kind, facts, accountAddress, networkId }) {
  return { v: TX_REVIEW_VERSION, kind, facts, accountAddress, networkId };
}
