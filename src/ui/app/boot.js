// Boot gate and route table for the popup.
//
// The equivalent of Rabby's SortHat: one place decides where an opening wallet lands,
// without holding the UI behind an intermediate "Checking wallet…" screen (Hard Rule 15).

import { Router } from './router.js';
import * as guards from './guards.js';
import * as bridge from './bridge.js';
import { AppShell } from './shell.js';
import { installSidePanelExclusion } from './side-panel-exclusion.js';
import { FLAGS } from '../../shared/flags.js';
import { applyTheme, initTheme } from '../../popup/theme.js';
import { UnlockRoute } from './routes/unlock.js';
import { dismissAllToasts } from '../kit/toast.js';
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
    autofocus: false,
  },
  {
    path: '/send',
    view: SendRoute,
    guard: guards.requireUnlocked,
    title: 'Send',
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

  let alive = true;
  // Register BEFORE the first await so a newly opened panel never misses a close broadcast.
  const offSidePanelExclusion = installSidePanelExclusion();

  // Apply OS theme synchronously before first paint (zero light->dark flash), then hydrate
  // stored preference non-blockingly so a slow settings read never holds the UI (Rule 15).
  if (!document.documentElement.dataset.theme) {
    applyTheme('system');
  }
  void initTheme().catch(() => {});

  const known = new Set(POPUP_ROUTES.map((r) => r.path));
  const FULLSCREEN_ROUTES = new Set(['/unlock', '/welcome']);

  const shell = AppShell({
    navigate: (path, options) => router.navigate(path, options),
  });
  shell.setChromeVisible(false);
  mount.appendChild(shell.el);
  mount.classList.remove('hidden');

  const router = new Router({
    routes: POPUP_ROUTES,
    root: shell.outlet,
    fallback: '/unlock',
  });

  function applyChrome(path) {
    shell.setChromeVisible(!FULLSCREEN_ROUTES.has(path), path);
  }

  const originalNavigate = router.navigate.bind(router);
  router.navigate = (path, options) => {
    // A user action supersedes an outstanding bootstrap response.
    run++;
    const cleanPath = String(path).split('?')[0];
    if (!known.has(cleanPath)) {
      applyChrome('/unlock');
      originalNavigate('/unlock', { replace: true });
      if (!router._started) router.start();
      return;
    }
    applyChrome(cleanPath);
    originalNavigate(path, options);
    if (!router._started) router.start();
  };

  const onHashChange = () => {
    if (!alive) return;
    const { path } = Router.parseHash();
    if (known.has(path)) applyChrome(path);
  };
  window.addEventListener('hashchange', onHashChange);

  const offEvents = bridge.onEvents({
    lockStateChanged: ({ unlocked, hasVault } = {}) => {
      run++;
      if (!unlocked) {
        guards.seed({ hasVault, unlocked: false });
        router.stop();
        dismissAllToasts();
        router.navigate(hasVault === false ? '/welcome' : '/unlock', { replace: true });
        router.start();
      } else {
        guards.seed({ hasVault: true, unlocked: true });
        // Keep the mounted public form (including an in-flight local unlock) intact,
        // but enable navigation when another page unlocks before bootstrap completes.
        if (!router._started) router.start({ resolve: false });
      }
    },
    accountsChanged: () => {
      dismissAllToasts();
    },
    networkChanged: () => {
      dismissAllToasts();
    },
  });

  let run = 0;
  const stop = router.stop.bind(router);
  router.stop = () => { run++; stop(); };

  function onUnload() {
    if (!alive) return;
    alive = false;
    router.stop();
    offEvents();
    offSidePanelExclusion();
    window.removeEventListener('hashchange', onHashChange);
    window.removeEventListener('unload', onUnload);
    shell.destroy();
  }
  window.addEventListener('unload', onUnload, { once: true });

  async function initialize() {
    if (!alive) return;
    router.stop();
    const generation = ++run;
    const current = () => alive && generation === run;
    guards.invalidate();
    const authRevision = guards.stateRevision();
    const requested = Router.parseHash();
    const hint = guards.getAuthHint();
    const isUnlockedHint = hint === 'unlocked';
    // Only public UI is mounted before authentication is known. Background auth still
    // protects every action; this surface remains usable while bootstrap hydrates.
    // When the wallet is known to be unlocked from the active session, skip mounting
    // /unlock to avoid a momentary flash of the lock screen before dashboard paints.
    const safePath = requested.path === '/welcome' || hint === 'no_vault'
      ? '/welcome'
      : (requested.path === '/unlock' || !isUnlockedHint ? '/unlock' : null);
    if (safePath) {
      applyChrome(safePath);
      router.mountImmediate(safePath, requested.path === '/unlock' ? requested.params : {
        returnTo: requested.path === '/' ? '/dashboard' : window.location.hash.slice(1),
      });
    } else {
      applyChrome(requested.path === '/' || !known.has(requested.path) ? '/dashboard' : requested.path);
    }
    try {
      const initial = await bridge.bootstrap();
      if (!current()) return;
      if (authRevision !== guards.stateRevision()) {
        if (!router._started) router.start({ resolve: false });
        return;
      }
      if (typeof initial?.hasVault !== 'boolean' || typeof initial?.unlocked !== 'boolean') {
        throw new Error('Wallet state unavailable.');
      }
      guards.seed(initial);
      const { path, params } = Router.parseHash();
      let destination;
      if (!path || path === '/' || !known.has(path)) {
        destination = await guards.landingRoute();
      } else if (!initial.hasVault) {
        destination = '/welcome';
      } else if (!initial.unlocked && path !== '/unlock' && path !== '/reset') {
        const query = new URLSearchParams(params || {}).toString();
        const rawTarget = query ? `${path}?${query}` : path;
        destination = path === '/welcome' ? '/unlock' : `/unlock?returnTo=${encodeURIComponent(rawTarget)}`;
      } else if (path === '/welcome' && initial.hasVault) {
        destination = initial.unlocked ? '/dashboard' : '/unlock';
      } else {
        const query = new URLSearchParams(params || {}).toString();
        destination = query ? `${path}?${query}` : path;
      }
      if (!current()) return;
      // router.navigate(..., { replace: true }) sets the URL hash without firing _resolve()
      // while _started is false, so router.start() resolves once cleanly.
      const preserveInput = Boolean(safePath) && destination.split('?')[0] === safePath;
      applyChrome(destination.split('?')[0]);
      originalNavigate(destination, { replace: true });
      router.start({ resolve: !preserveInput });
      shell.refreshNetwork();
    } catch {
      if (!current()) return;
      router.showStatus({
        message: 'The wallet could not be loaded. Reload to try again.',
        onReload: () => { void initialize(); },
      });
    }
  }
  void initialize();

  if (FLAGS.DEBUG_ROUTING) {
    console.info('[boot] UI active. Routes:', [...known].join(', '));
  }

  return router;
}
