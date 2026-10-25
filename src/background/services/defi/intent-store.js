// Network-scoped intent store (G2-S0, 2026-10-09).
//
// One record per intent; bound to `defi_intents::<networkId>` so a second chain can never
// surface another chain's prepared intents (the network-scoping rule from
// src/shared/network-scope.js). The pending-tx tracker remains the single CHAIN-lifecycle
// store (scripts/fixtures/defi/intent-scripts.mjs S13 note): chain settlement flows through
// the pending tracker keyed by the signature this store records — the store is concerned
// with the pipeline state (prepared → submitted/failed/cancelled), not with block status.
//
// Every status transition is an explicit write and an `intentChanged` event, never a silent
// side effect (S8). Expiry is evaluated on READ (deterministic; a sweep timer that moved
// state unseen would be a phantom change the UI could never see happen).
import { scopedKey } from '../../../shared/network-scope.js';
import { emitIntentChanged } from '../event-service.js';

export const INTENT_BASE_KEY = 'defi_intents';
export const INTENT_TTL_MS = 120_000; // the same seconds capability limits (preparedTtlMs)
const MAX_RECORDS = 200; // pruned oldest-first past this; a pruned intent is never submitted

async function readAll(networkId) {
  const key = scopedKey(INTENT_BASE_KEY, networkId);
  const out = await chrome.storage.local.get(key);
  return Array.isArray(out[key]) ? out[key] : [];
}

async function writeAll(networkId, records) {
  const key = scopedKey(INTENT_BASE_KEY, networkId);
  await chrome.storage.local.set({ [key]: records });
}

function emitTransition(record) {
  try { emitIntentChanged({ intentId: record.intentId, status: record.status, networkId: record.plan?.networkId ?? null }); } catch { /* event channel is fire-and-forget */ }
}

/** Load records and evaluate TTL expiry; any transition is written + emitted. */
export async function loadAndTick(networkId) {
  const now = Date.now();
  const records = await readAll(networkId);
  let dirty = false;
  for (const r of records) {
    if ((r.status === 'prepared' || r.status === 'waitingUser') && now > r.expiresAt) {
      r.status = 'expired';
      r.updatedAt = now;
      dirty = true;
      emitTransition(r);
    }
  }
  if (dirty) await writeAll(networkId, records);
  return records;
}

export async function getIntent(networkId, intentId) {
  const records = await loadAndTick(networkId);
  return records.find((r) => r.intentId === intentId) ?? null;
}

export async function listIntents(networkId, { status } = {}) {
  const records = await loadAndTick(networkId);
  const filtered = status ? records.filter((r) => r.status === status) : records;
  return filtered.slice().sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

/**
 * Upsert a record. `mutate` runs inside the read-modify-write so the call site never races
 * another transition; returns the version that landed. Emits on any status change.
 */
export async function upsert(networkId, intentId, mutate) {
  const records = await loadAndTick(networkId);
  const idx = records.findIndex((r) => r.intentId === intentId);
  const record = idx >= 0 ? records[idx] : null;
  const before = record ? record.status : null;
  const next = mutate(record);
  if (!next) return null; // a discarded/missing intent stays out of the store
  if (idx >= 0) records[idx] = next; // mutate may return a NEW object (spread) — the slot must follow
  else records.push(next);
  if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
  await writeAll(networkId, records);
  if (next.status !== before) emitTransition(next);
  return next;
}

/** Deterministic binding hash over the user-reviewable facts (stable stringify, SHA-256). */
export async function bindingHashOf(plan, preparedAt, nonce) {
  const canonical = JSON.stringify({ ...plan, preparedAt, nonce });
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}
