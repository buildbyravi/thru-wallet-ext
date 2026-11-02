// One-time consent tokens: the thing a signature must present to prove a review happened.
//
// Why this exists
// `tx.confirmReview` returns the exact submit instructions, and the UI then calls that signing
// method itself. Nothing in that chain forced a caller to have confirmed anything — a page could
// call `tx.sendChecked` directly and the wallet would build, sign and broadcast. The review was a
// UI convention (docs/DEFECT_LOG.md §20). This module makes it a background precondition: confirm
// mints a token bound to what the user actually approved, and the router refuses any signing call
// that cannot present one for the same method, the same params, the same account and network.
//
// What it proves, and what it does not
// It proves the call is the continuation of a prepared review that passed `confirmReview`'s
// revalidation, and that nobody changed a parameter in between. It does NOT prove a human looked
// at the screen: a caller that can call `tx.prepareReview` can also call `tx.confirmReview`. No
// background service can tell a rendered card from a scripted one, and pretending otherwise would
// be the same overstatement this file exists to prevent. See the threat model in
// docs/STATUS_AND_ROADMAP.md.
//
// Storage: memory only, never chrome.storage. A token that outlived the worker would outlive the
// review it points at; MV3 suspension therefore fails closed (the call needs a fresh confirm).

const TOKEN_BYTES = 32;
export const CONSENT_TTL_MS = 60_000;
// A review store holds 40 records; a token table that could grow without bound is a memory leak
// an attacker controls. Oldest-first eviction, same discipline as the review store.
const MAX_TOKENS = 40;

/** token -> { method, paramsHash, accountAddress, networkId, reviewId, expiresAt } */
const tokens = new Map();

function randomToken() {
  const bytes = new Uint8Array(TOKEN_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Canonical JSON: keys sorted at every level, so a value that survives a structured clone with a
 * different key order still hashes the same. Without this, "params changed" would fire on a
 * reordering the caller never made — a false refusal is bad, but a *missing* refusal is worse.
 */
function canonical(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonical);
  if (value instanceof Date) return value.toISOString();
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
  return out;
}

/**
 * The params a token is bound to: everything the user approved, minus the two fields that are
 * deliberately added AFTER the review — the token itself, and the password the signing policy may
 * ask for at submit time. Including either would make a legitimate call refuse itself.
 */
export function hashableParams(params = {}) {
  const { consentToken, password, ...rest } = params || {};
  return rest;
}

async function paramsHashOf(params) {
  const text = JSON.stringify(canonical(hashableParams(params)));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function prune(now = Date.now()) {
  for (const [token, entry] of tokens) {
    if (entry.expiresAt <= now) tokens.delete(token);
  }
}

/**
 * Mint a token for a confirmed review. Called by `confirmReview` and by nothing else in the
 * product; there is no bridge method that reaches this (test-review-consent.mjs asserts it).
 *
 * @param {{ method: string, params: object, accountAddress: string, networkId: string,
 *           reviewId: string }} approved
 * @returns {Promise<string>} 64 hex characters
 */
export async function mintConsent({ method, params, accountAddress, networkId, reviewId } = {}) {
  if (typeof method !== 'string' || !method) throw new Error('mintConsent needs a method');
  const now = Date.now();
  prune(now);
  while (tokens.size >= MAX_TOKENS) {
    tokens.delete(tokens.keys().next().value);
  }
  const token = randomToken();
  tokens.set(token, {
    method,
    paramsHash: await paramsHashOf(params),
    accountAddress: accountAddress ?? null,
    networkId: networkId ?? null,
    reviewId: reviewId ?? null,
    expiresAt: now + CONSENT_TTL_MS,
  });
  return token;
}

/**
 * Spend a token. Single use, and burned on ANY failure: a caller that gets one attempt per mint
 * cannot search parameter space for a request that happens to match.
 *
 * @returns {Promise<{ ok: true, reviewId: string|null } |
 *   { ok: false, reason: 'missing'|'unknown'|'expired'|'method'|'params'|'context' }>}
 */
export async function consumeConsent({ token, method, params, accountAddress, networkId } = {}) {
  if (typeof token !== 'string' || !token) return { ok: false, reason: 'missing' };
  const entry = tokens.get(token);
  if (!entry) return { ok: false, reason: 'unknown' };
  tokens.delete(token);
  if (entry.expiresAt <= Date.now()) return { ok: false, reason: 'expired' };
  if (entry.method !== method) return { ok: false, reason: 'method' };
  if (entry.paramsHash !== await paramsHashOf(params)) return { ok: false, reason: 'params' };
  if (entry.accountAddress !== (accountAddress ?? null) || entry.networkId !== (networkId ?? null)) {
    return { ok: false, reason: 'context' };
  }
  return { ok: true, reviewId: entry.reviewId };
}

/**
 * Drop every live token. Called wherever prepared reviews are dropped — lock, account switch,
 * network switch, reset — because consent for one session state must not survive into another.
 */
export function clearConsents() {
  const count = tokens.size;
  tokens.clear();
  return { cleared: count };
}

/** Diagnostics for tests and the platform, never a bridge surface. */
export function consentStats() {
  prune();
  return { live: tokens.size, cap: MAX_TOKENS, ttlMs: CONSENT_TTL_MS };
}
