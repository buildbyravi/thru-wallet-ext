// Boot gate and route table for the popup.
//
// The equivalent of Rabby's SortHat: one place decides where an opening wallet lands,
// instead of the ad-hoc sequence the legacy popup.js runs (a disclaimer check, then
// hasVault, then isUnlocked, each navigating separately and each able to race the others).

import { Router } from './router.js';
import * as guards from './guards.js';
import * as bridge from './bridge.js';
import { AppShell } from './shell.js';
import { installSidePanelExclusion } from './side-panel-exclusion.js';
import { FLAGS } from '../../shared/flags.js';
import { initTheme } from '../../popup/theme.js';
import { UnlockRoute } from './routes/unlock.js';
import { DashboardRoute } from './routes/dashboard.js';
import { AccountsRoute } from './routes/accounts.js';
import { AccountDetailRoute } from './routes/account-detail.js';
import { AddAccountRoute } from './routes/add-account.js';
import { ExportRoute } from './routes/export.js';
import { KeyringRoute } from './routes/keyring.js';
import { SettingsRoute } from './routes/settings.js';
import { ResetRoute } from './routes/reset.js';
import { SendRoute } from './routes/send.js';
import { ReceiveRoute } from './routes/receive.js';
import { FaucetRoute } from './routes/faucet.js';
import { NameRoute } from './routes/name.js';
import { HistoryRoute } from './routes/history.js';
import { WelcomeRoute } from './routes/welcome.js';

/**
 * The wallet's complete route table.
 *
 * A hash this table does not contain is redirected to the router's fallback ('/unlock'), so an
 * unknown or stale URL is never a dead end. The legacy tree this table replaced is deleted;
 * its history lives in Git, not in a compatibility layer.
 */
export const POPUP_ROUTES = [
  {
    path: '/unlock',
    view: UnlockRoute,
    guard: guards.requireVault,
    title: 'Unlock',
  },
  {
    path: '/dashboard',
    view: DashboardRoute,
    guard: guards.requireUnlocked,
    title: 'Wallet',
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
  {
    path: '/send',
    view: SendRoute,
    guard: guards.requireUnlocked,
    title: 'Send',
    // No autofocus: the router's focus helper would land on the recipient field, and on a screen
    // that ends in an irreversible action the first keystroke should not already be going
    // somewhere.
    autofocus: false,
  },
  {
    path: '/receive',
    view: ReceiveRoute,
    guard: guards.requireUnlocked,
    title: 'Receive',
  },
  {
    path: '/faucet',
    view: FaucetRoute,
    guard: guards.requireUnlocked,
    title: 'Faucet',
  },
  {
    path: '/history',
    view: HistoryRoute,
    guard: guards.requireUnlocked,
    title: 'History',
  },
  {
    path: '/name',
    view: NameRoute,
    guard: guards.requireUnlocked,
    title: 'Domain',
  },
  {
    // requireNoWallet: onboarding must bounce to the dashboard if a wallet already exists,
    // otherwise a stray #/welcome would offer to create a second one over the top.
    path: '/welcome',
    view: WelcomeRoute,
    guard: guards.requireNoWallet,
    title: 'Welcome',
    autofocus: false,
  },
  {
    path: '/settings',
    view: SettingsRoute,
    guard: guards.requireUnlocked,
    title: 'Settings',
  },
  {
    // requireVault, not requireUnlocked: reset must be reachable from the unlock screen by
    // someone who has forgotten their password. That is the main reason it exists.
    path: '/reset',
    view: ResetRoute,
    guard: guards.requireVault,
    title: 'Reset wallet',
    autofocus: false,
  },
];

/**
 * Start the UI.
 *
 * @param {{ root?: HTMLElement }} options
 * @returns {Promise<Router|null>}
 */
export async function boot({ root } = {}) {
  const mount = root || document.getElementById('app');
  if (!mount) {
    console.error('[boot] no #app mount point.');
    return null;
  }

  // Register BEFORE the first await (including theme storage), not after the
  // background bootstrap. Otherwise a popup can broadcast while a newly opened
  // panel is still waiting to install its listener, and the close is lost.
  installSidePanelExclusion();

  // Theme before first paint: no light->dark flash on open.
  await initTheme().catch(() => {});

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
    shell.setChromeVisible(!FULLSCREEN_ROUTES.has(path), path);
  }

  // Keep an unknown hash from ever entering the URL: redirect to the fallback before the
  // router resolves it. (The Router would recover through its own fallback anyway, but the
  // stale hash would briefly land in history first.)
  const originalNavigate = router.navigate.bind(router);
  router.navigate = (path, options) => {
    const cleanPath = String(path).split('?')[0];
    if (!known.has(cleanPath)) {
      originalNavigate('/unlock', { replace: true });
      return;
    }
    applyChrome(cleanPath);
    originalNavigate(path, options);
  };

  // A hashchange straight to a known route (Back, or an edited URL) bypasses router.navigate,
  // so chrome visibility has to be applied on resolve as well.
  window.addEventListener('hashchange', () => {
    const { path } = Router.parseHash();
    if (known.has(path)) applyChrome(path);
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
    console.info('[boot] UI active. Routes:', [...known].join(', '));
  }

  return router;
}
