// The single hash router.
//
// Replaces src/ui/router.js, which had two mutually destructive behaviours: it cleared
// `#screen-<id>` with innerHTML (destroying popup.html's static markup for welcome,
// unlock and dashboard at startup) while 26 of 28 navigation sites bypassed it entirely
// via a legacy show() that only toggled `.hidden`. The result was screens shadowing each
// other and whole features becoming unreachable.
//
// Design decisions that follow from that failure:
//
//   - ONE mount point (`#app`), never a per-screen container. There is no static markup to
//     destroy, so the class of bug cannot recur.
//   - The URL is the state. `#/send?token=native` is addressable, restorable and
//     back-navigable, and works identically in the popup, the side panel and a tab.
//   - Route params come from the query string, never from an in-memory params object that
//     could carry a secret into history. The old router pushed navigation params verbatim
//     into its history array, which is why the "wipes secret on unmount" comments in
//     backup.js and export-reveal.js were false.
//   - Every route returns { destroy }. The router calls it before mounting the next one,
//     and awaits nothing, so teardown is deterministic.

const APP_ROOT_ID = 'app';

/** @typedef {{ path: string, view: Function, guard?: Function, title?: string }} RouteDef */

export class Router {
  /**
   * @param {{ routes: RouteDef[], root?: HTMLElement, fallback?: string, onError?: Function }} options
   */
  constructor({ routes, root, fallback = '/unlock', onError } = {}) {
    this.routes = new Map();
    for (const route of routes) this.routes.set(route.path, route);
    this.root = root || document.getElementById(APP_ROOT_ID);
    this.fallback = fallback;
    this.onError = onError;
    this.current = null;
    this.currentPath = null;
    this._onHashChange = () => this._resolve();
    this._started = false;
    this._navigating = false;
  }

  start() {
    if (this._started) return;
    this._started = true;
    window.addEventListener('hashchange', this._onHashChange);
    this._resolve();
  }

  stop() {
    window.removeEventListener('hashchange', this._onHashChange);
    this._destroyCurrent();
    this._started = false;
  }

  /**
   * Navigate to a path. `replace` avoids adding a history entry, which matters for
   * redirects — otherwise Back lands on a route the guard will bounce again.
   * @param {string} path e.g. '/accounts' or '/send?token=native'
   * @param {{ replace?: boolean }} [options]
   */
  navigate(path, { replace = false } = {}) {
    const target = `#${path.startsWith('/') ? path : `/${path}`}`;
    if (window.location.hash === target) {
      // Same URL: re-resolve explicitly, since hashchange will not fire.
      this._resolve();
      return;
    }
    if (replace) {
      const url = `${window.location.pathname}${window.location.search}${target}`;
      window.history.replaceState(null, '', url);
      this._resolve();
    } else {
      window.location.hash = target;
    }
  }

  back() {
    // Falls back to the default route when there is no history to pop, so Back can never
    // strand the user on a blank panel.
    if (window.history.length > 1) window.history.back();
    else this.navigate(this.fallback, { replace: true });
  }

  /** Parse the current hash into a path and a params object. */
  static parseHash(hash = window.location.hash) {
    const raw = String(hash || '').replace(/^#/, '');
    if (!raw) return { path: '/', params: {} };
    const [path, query = ''] = raw.split('?');
    const params = {};
    for (const [key, value] of new URLSearchParams(query)) params[key] = value;
    return { path: path || '/', params };
  }

  _destroyCurrent() {
    if (!this.current) return;
    try {
      this.current.destroy?.();
    } catch (error) {
      console.error('[router] destroy threw:', error);
    }
    this.current = null;
    if (this.root) {
      while (this.root.firstChild) this.root.removeChild(this.root.firstChild);
    }
  }

  async _resolve() {
    // Guards can redirect, which triggers another resolve. This flag keeps the second
    // pass from tearing down a mount that is still in progress.
    if (this._navigating) return;
    this._navigating = true;

    try {
      const { path, params } = Router.parseHash();
      const route = this.routes.get(path);

      if (!route) {
        this._navigating = false;
        this.navigate(this.fallback, { replace: true });
        return;
      }

      if (typeof route.guard === 'function') {
        const verdict = await route.guard({ path, params });
        if (verdict && verdict.redirect) {
          this._navigating = false;
          this.navigate(verdict.redirect, { replace: true });
          return;
        }
      }

      this._destroyCurrent();
      this.currentPath = path;

      const instance = await route.view({
        params,
        // The set of paths this router actually knows. Passed in so a view can validate a
        // user-supplied path (e.g. unlock's returnTo) against reality instead of trusting it.
        knownPaths: new Set(this.routes.keys()),
        navigate: (to, options) => this.navigate(to, options),
        back: () => this.back(),
      });

      this.current = instance || null;
      if (instance?.el && this.root) this.root.appendChild(instance.el);
      if (route.title) document.title = `${route.title} — Thru Wallet`;

      // Move focus to the new view so keyboard and screen-reader users are not left
      // where the previous screen's DOM used to be.
      const focusTarget = this.root?.querySelector('[autofocus], input, button, [tabindex]');
      if (focusTarget && route.autofocus !== false) {
        requestAnimationFrame(() => focusTarget.focus?.());
      }
    } catch (error) {
      console.error('[router] failed to mount route:', error);
      this.onError?.(error);
    } finally {
      this._navigating = false;
    }
  }
}
