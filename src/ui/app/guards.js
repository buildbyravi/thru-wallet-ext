// Route guards.
//
// Replaces the scattered `if (!isUnlocked)` checks in the old handleAction switch, and is
// modelled on Rabby's PrivateRoute: whether a route is reachable is declared next to the
// route, not re-derived inside each screen.
//
// Guards use session state seeded by bootstrap and authenticated actions. Lock events
// invalidate private UI immediately; the background independently authorizes every call.
// Navigation itself must not wait for repeated backend reads.

/** UI session snapshot; never used as signing authorization. */
let cache = { hasVault: null, unlocked: null, at: 0 };
let revision = 0;
export function stateRevision() { return revision; }

/** Clear the UI snapshot at boot; unknown auth can only show public screens. */
export function invalidate() {
  revision++;
  cache = { hasVault: null, unlocked: null, at: 0 };
}

/**
 * Seed the cache from a system.bootstrap response.
 *
 * Boot previously called landingRoute() (two round-trips) and then the route's guard ran
 * readState() again, on a service worker that may still have been spinning up. Seeding from
 * the single bootstrap call the UI already makes removes that redundancy — it was a
 * meaningful part of the "loading wallet" delay.
 *
 * @param {{ hasVault?: boolean, unlocked?: boolean }} state
 */
export function seed(state) {
  if (!state || typeof state !== 'object') return;
  revision++;
  cache = {
    hasVault: typeof state.hasVault === 'boolean' ? state.hasVault : null,
    unlocked: state.unlocked === true,
    at: Date.now(),
  };
}

/**
 * Build an /unlock redirect that remembers where the user was going.
 *
 * Without this, opening `#/send` while locked sent you to /unlock and then to /dashboard,
 * silently discarding the destination. The path is carried as a query param and validated on the
 * way back out (see resolveReturnTo), so it can only ever name a real route.
 */
function unlockRedirect(path, params) {
  if (!path || path === '/unlock' || path === '/welcome') return { redirect: '/unlock' };
  const query = new URLSearchParams(params || {}).toString();
  const target = query ? `${path}?${query}` : path;
  return { redirect: `/unlock?returnTo=${encodeURIComponent(target)}` };
}

/** Requires an existing, unlocked vault. */
export function requireUnlocked({ path, params } = {}) {
  const { hasVault, unlocked } = cache;
  if (hasVault === false) return { redirect: '/welcome' };
  if (!unlocked) return unlockRedirect(path, params);
  return null;
}

/** Requires that a vault exists, locked or not. */
export function requireVault() {
  if (cache.hasVault === false) return { redirect: '/welcome' };
  return null;
}

/** Onboarding routes: bounce to the dashboard if a wallet already exists and is open. */
export function requireNoWallet() {
  const { hasVault, unlocked } = cache;
  if (hasVault && unlocked) return { redirect: '/dashboard' };
  if (hasVault) return { redirect: '/unlock' };
  return null;
}

/**
 * Where the app should land on open — the equivalent of Rabby's SortHat.
 *
 * Uses only the UI snapshot; unknown state chooses the safe unlock surface.
 * @returns {string}
 */
export function landingRoute() {
  const { hasVault, unlocked } = cache;
  if (hasVault === false) return '/welcome';
  if (!unlocked) return '/unlock';
  return '/dashboard';
}

/**
 * Validate a `returnTo` value against the real route table before navigating to it.
 *
 * The hash is user-editable, so this must not be trusted. Only a path that the router actually
 * knows is allowed; anything else falls back to the dashboard. `knownPaths` is injected rather
 * than imported to avoid a cycle with boot.js.
 *
 * @param {string} returnTo raw param value
 * @param {Set<string>|string[]} knownPaths
 * @returns {string} a safe path to navigate to
 */
export function resolveReturnTo(returnTo, knownPaths) {
  const fallback = '/dashboard';
  if (!returnTo) return fallback;

  let decoded;
  try {
    decoded = decodeURIComponent(String(returnTo));
  } catch {
    return fallback;
  }

  // Must be a local absolute path. Rejects protocol-relative (//evil), absolute URLs, and
  // anything with a scheme — an open redirect is pointless inside an extension page but it costs
  // nothing to refuse.
  if (!decoded.startsWith('/') || decoded.startsWith('//')) return fallback;
  if (/[:\\]/.test(decoded)) return fallback;

  const [path] = decoded.split('?');
  const known = knownPaths instanceof Set ? knownPaths : new Set(knownPaths || []);
  if (!known.has(path)) return fallback;
  // Never bounce back to the screen we just came from.
  if (path === '/unlock' || path === '/welcome') return fallback;

  return decoded;
}
