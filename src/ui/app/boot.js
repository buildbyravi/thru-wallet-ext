// Boot gate and route table for the popup.
//
// The equivalent of Rabby's SortHat: one place decides where an opening wallet lands,
// instead of the ad-hoc sequence the legacy popup.js runs (a disclaimer check, then
// hasVault, then isUnlocked, each navigating separately and each able to race the others).

import { Router } from './router.js';
import * as guards from './guards.js';
import * as bridge from './bridge.js';
import { FLAGS } from '../../shared/flags.js';
import { UnlockRoute } from './routes/unlock.js';

/**
 * Routes migrated to the new stack.
 *
 * A hash this table does not contain falls through to `legacyFallback`, so an unmigrated
 * screen is never a dead end during the migration. Each entry is deleted from the legacy
 * monolith in the same commit that adds it here.
 */
export const POPUP_ROUTES = [
  {
    path: '/unlock',
    view: UnlockRoute,
    guard: guards.requireVault,
    title: 'Unlock',
  },
];

/**
 * Start the new UI.
 *
 * @param {{ root?: HTMLElement, legacyFallback?: (path: string) => void }} options
 * @returns {Promise<Router|null>}
 */
export async function boot({ root, legacyFallback } = {}) {
  const mount = root || document.getElementById('app');
  if (!mount) {
    console.error('[boot] no #app mount point; leaving the legacy UI in place.');
    return null;
  }

  const known = new Set(POPUP_ROUTES.map((r) => r.path));

  const router = new Router({
    routes: POPUP_ROUTES,
    root: mount,
    fallback: '/unlock',
    onError: (error) => {
      console.error('[boot] route error:', error);
    },
  });

  // Hand unmigrated hashes back to the legacy stack rather than bouncing to the fallback,
  // which would make half the app unreachable while the migration is in progress.
  const originalNavigate = router.navigate.bind(router);
  router.navigate = (path, options) => {
    const cleanPath = String(path).split('?')[0];
    if (!known.has(cleanPath) && typeof legacyFallback === 'function') {
      legacyFallback(cleanPath);
      return;
    }
    originalNavigate(path, options);
  };

  // Push events replace polling. The old bridge exposed onEvent() with zero subscribers,
  // so a background lock never reached an open popup and the UI kept showing private data
  // over a locked vault until the next manual action.
  const offEvents = bridge.onEvents({
    lockStateChanged: ({ unlocked } = {}) => {
      guards.invalidate();
      if (!unlocked) router.navigate('/unlock', { replace: true });
    },
    accountsChanged: () => {
      guards.invalidate();
    },
  });
  window.addEventListener('unload', offEvents, { once: true });

  const { path } = Router.parseHash();
  if (!path || path === '/') {
    router.navigate(await guards.landingRoute(), { replace: true });
  }

  router.start();

  if (FLAGS.DEBUG_ROUTING) {
    console.info('[boot] new UI active. Migrated routes:', [...known].join(', '));
  }

  return router;
}
