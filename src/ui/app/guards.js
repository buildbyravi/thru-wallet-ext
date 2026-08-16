// Route guards.
//
// Replaces the scattered `if (!isUnlocked)` checks in the old handleAction switch, and is
// modelled on Rabby's PrivateRoute: whether a route is reachable is declared next to the
// route, not re-derived inside each screen.
//
// Guards return either nothing (allow) or { redirect: '/path' }. They ask the BACKGROUND
// for lock state rather than reading a cached store value, because the wallet can lock
// underneath an open popup — the inactivity alarm fires in the service worker, not here.
// Trusting a stale store flag would render a private screen over a locked vault.

import * as bridge from './bridge.js';

/** Cheap cache so a burst of navigations does not cause a burst of round-trips. */
let cache = { hasVault: null, unlocked: null, at: 0 };
const CACHE_MS = 400;

async function readState({ force = false } = {}) {
  if (!force && cache.at && Date.now() - cache.at < CACHE_MS) return cache;
  const [hasVault, unlocked] = await Promise.all([
    bridge.send('wallet.hasVault'),
    bridge.send('wallet.isUnlocked'),
  ]);
  cache = { hasVault: Boolean(hasVault), unlocked: Boolean(unlocked), at: Date.now() };
  return cache;
}

/** Call after any lock/unlock/reset so the next guard check is not answered from cache. */
export function invalidate() {
  cache = { hasVault: null, unlocked: null, at: 0 };
}

/** Requires an existing, unlocked vault. */
export async function requireUnlocked() {
  const { hasVault, unlocked } = await readState();
  if (!hasVault) return { redirect: '/welcome' };
  if (!unlocked) return { redirect: '/unlock' };
  return null;
}

/** Requires that a vault exists, locked or not. */
export async function requireVault() {
  const { hasVault } = await readState();
  if (!hasVault) return { redirect: '/welcome' };
  return null;
}

/** Onboarding routes: bounce to the dashboard if a wallet already exists and is open. */
export async function requireNoWallet() {
  const { hasVault, unlocked } = await readState();
  if (hasVault && unlocked) return { redirect: '/dashboard' };
  if (hasVault) return { redirect: '/unlock' };
  return null;
}

/**
 * Where the app should land on open — the equivalent of Rabby's SortHat.
 * @returns {Promise<string>}
 */
export async function landingRoute() {
  const { hasVault, unlocked } = await readState({ force: true });
  if (!hasVault) return '/welcome';
  if (!unlocked) return '/unlock';
  return '/dashboard';
}
