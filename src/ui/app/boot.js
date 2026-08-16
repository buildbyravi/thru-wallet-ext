// Boot gate and route table for the popup.
//
// The equivalent of Rabby's SortHat: one place decides where an opening wallet lands,
// instead of the ad-hoc sequence the legacy popup.js runs (a disclaimer check, then
// hasVault, then isUnlocked, each navigating separately and each able to race the others).

import { Router } from './router.js';
import * as guards from './guards.js';
import * as bridge from './bridge.js';
import { AppShell } from './shell.js';
import { FLAGS } from '../../shared/flags.js';
import { UnlockRoute } from './routes/unlock.js';
import { AccountsRoute } from './routes/accounts.js';
import { AccountDetailRoute } from './routes/account-detail.js';
import { AddAccountRoute } from './routes/add-account.js';
import { ExportRoute } from './routes/export.js';
import { KeyringRoute } from './routes/keyring.js';

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
  {
    path: '/accounts',
    view: AccountsRoute,
    guard: guards.requireUnlocked,
    title: 'Accounts',
  },
  {
    path: '/account',
    view: AccountDetailRoute,
    guard: guards.requireUnlocked,
    title: 'Account',
  },
  {
    path: '/add-account',
    view: AddAccountRoute,
    guard: guards.requireUnlocked,
    title: 'Add account',
  },
  {
    path: '/keyring',
    view: KeyringRoute,
    guard: guards.requireUnlocked,
    title: 'Manage source',
  },
  {
    path: '/export',
    view: ExportRoute,
    guard: guards.requireUnlocked,
    title: 'Export secret',
    // Autofocus is suppressed here: focusing the first control on a screen that is about to
    // display a recovery phrase would scroll the secret into view before the user has read
    // the warning above it.
    autofocus: false,
  },
];

/**
 * Start the new UI.
 *
 * @param {{
 *   root?: HTMLElement,
 *   legacyFallback?: (path: string) => void,
 *   onMigratedRoute?: (path: string) => void
 * }} options
 * @returns {Promise<Router|null>}
 */
export async function boot({ root, legacyFallback, onMigratedRoute } = {}) {
  const mount = root || document.getElementById('app');
  if (!mount) {
    console.error('[boot] no #app mount point; leaving the legacy UI in place.');
    return null;
  }

  const known = new Set(POPUP_ROUTES.map((r) => r.path));

  // Routes that own the whole viewport and must not show the topbar/footer chrome.
  const FULLSCREEN_ROUTES = new Set(['/unlock', '/welcome']);

  // ONE bootstrap call for the whole boot. The previous sequence called
  // wallet.hasVault + wallet.isUnlocked for landingRoute(), then the route guard called both
  // again, on a service worker that may still have been starting. Seeding the guard cache
  // from this response removes those extra round-trips.
  let initial = null;
  try {
    initial = await bridge.bootstrap();
    guards.seed(initial);
  } catch (error) {
    console.warn('[boot] bootstrap failed; guards will query directly.', error);
  }

  const shell = AppShell({
    navigate: (path, options) => router.navigate(path, options),
  });
  mount.appendChild(shell.el);

  const router = new Router({
    routes: POPUP_ROUTES,
    root: shell.outlet,
    fallback: '/unlock',
    onError: (error) => {
      console.error('[boot] route error:', error);
    },
  });

  function applyChrome(path) {
    shell.setChromeVisible(!FULLSCREEN_ROUTES.has(path));
  }

  // Hand unmigrated hashes back to the legacy stack rather than bouncing to the fallback,
  // which would make half the app unreachable while the migration is in progress.
  //
  // Both directions matter: entering a legacy screen must reveal the legacy tree, and
  // returning to a migrated route must hide it again. Without the second half, a single
  // excursion into an unmigrated screen would leave both trees stacked in the document.
  const originalNavigate = router.navigate.bind(router);
  router.navigate = (path, options) => {
    const cleanPath = String(path).split('?')[0];
    if (!known.has(cleanPath)) {
      if (typeof legacyFallback === 'function') {
        legacyFallback(cleanPath);
        return;
      }
      originalNavigate('/unlock', { replace: true });
      return;
    }
    onMigratedRoute?.(cleanPath);
    applyChrome(cleanPath);
    originalNavigate(path, options);
  };

  // A hashchange straight to a migrated route (Back, or an edited URL) bypasses
  // router.navigate, so the tree swap has to happen on resolve as well.
  window.addEventListener('hashchange', () => {
    const { path } = Router.parseHash();
    if (known.has(path)) {
      onMigratedRoute?.(path);
      applyChrome(path);
    }
  });

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
  } else {
    applyChrome(path);
  }

  router.start();

  // Network status is fetched after first paint, never before it.
  shell.refreshNetwork();

  if (FLAGS.DEBUG_ROUTING) {
    console.info('[boot] new UI active. Migrated routes:', [...known].join(', '));
  }

  return router;
}
