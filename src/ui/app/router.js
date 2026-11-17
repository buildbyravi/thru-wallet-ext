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
//     could carry a secret into history.
//   - Every route returns { destroy }. The router calls it before mounting the next one,
//     and awaits nothing, so teardown is deterministic.
//   - Never replace an active screen with an intermediate "Checking wallet…" gate during
//     normal navigation (Hard Rule 15). Each route paints immediately from local/cached
//     state; `showStatus` is reserved strictly for genuine mount/bootstrap failures.

import { h, disposer } from '../kit/dom.js';

const APP_ROOT_ID = 'app';

/** @typedef {{ path: string, view: Function, guard?: Function, title?: string, autofocus?: boolean }} RouteDef */

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
    this._resolveSeq = 0;
  }

  start({ resolve = true } = {}) {
    if (this._started) return;
    this._started = true;
    window.addEventListener('hashchange', this._onHashChange);
    if (resolve) this._resolve();
  }

  stop() {
    this._resolveSeq++;
    window.removeEventListener('hashchange', this._onHashChange);
    this._destroyCurrent();
    this.currentPath = null;
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
      if (this._started) this._resolve();
      return;
    }
    // Teardown happens when navigation is accepted, before any guard/RPC await. This keeps
    // exported secrets and route-owned signing work from surviving behind a slow guard.
    if (this._started) {
      this._resolveSeq++;
      this._destroyCurrent();
      this.currentPath = null;
    }
    if (replace) {
      const url = `${window.location.pathname}${window.location.search}${target}`;
      window.history.replaceState(null, '', url);
      if (this._started) this._resolve();
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
    try {
      this.current?.destroy?.();
    } catch (error) {
      console.error('[router] destroy failed.');
    }
    this.current = null;
    if (this.root) {
      while (this.root.firstChild) this.root.removeChild(this.root.firstChild);
    }
  }

  /** Mount a safe local route before bootstrap/guards resolve. */
  mountImmediate(path, params = {}) {
    if (path !== '/unlock' && path !== '/welcome' && path !== '/dashboard') return false;
    const route = this.routes.get(path);
    if (!route) return false;
    try {
      const instance = route.view({
        params,
        knownPaths: new Set(this.routes.keys()),
        navigate: (to, options) => this.navigate(to, options),
        back: () => this.back(),
      });
      if (!instance || typeof instance.then === 'function') return false;
      this._destroyCurrent();
      this.currentPath = path;
      this.current = instance;
      if (instance.el && this.root) this.root.appendChild(instance.el);
      if (route.title) document.title = `${route.title} — Thru Wallet`;
      return true;
    } catch (error) {
      console.error('[router] immediate mount failed.');
      return false;
    }
  }

  showStatus({ message = 'This screen could not be opened. Reload to try again.', onReload = () => this._resolve() } = {}) {
    this._destroyCurrent();
    this.currentPath = null;
    const d = disposer();
    const reload = h('button', { type: 'button', class: 'btn secondary', text: 'Reload' });
    const el = h('section', { class: 'screen' }, [
      h('h1', { text: 'Wallet' }),
      h('p', { class: 'hint', role: 'alert', text: message }),
      reload,
    ]);
    d.on(reload, 'click', () => onReload());
    this.current = { el, update() {}, destroy() { d.dispose(); el.remove(); } };
    this.root?.appendChild(el);
  }

  async _resolve() {
    const generation = ++this._resolveSeq;
    this._destroyCurrent();
    this.currentPath = null;

    try {
      const { path, params } = Router.parseHash();
      const route = this.routes.get(path);

      if (!route) {
        this.navigate(this.fallback, { replace: true });
        return;
      }

      if (typeof route.guard === 'function') {
        const verdict = await route.guard({ path, params });
        if (generation !== this._resolveSeq) return;
        if (verdict && verdict.redirect) {
          this.navigate(verdict.redirect, { replace: true });
          return;
        }
      }

      const instance = await route.view({
        params,
        knownPaths: new Set(this.routes.keys()),
        navigate: (to, options) => this.navigate(to, options),
        back: () => this.back(),
      });

      if (generation !== this._resolveSeq) {
        instance?.destroy?.();
        return;
      }
      this._destroyCurrent();
      this.currentPath = path;
      this.current = instance || null;
      if (instance?.el && this.root) this.root.appendChild(instance.el);
      if (route.title) document.title = `${route.title} — Thru Wallet`;

      const explicit = this.root?.querySelector('[autofocus]');
      if (explicit && route.autofocus !== false) {
        requestAnimationFrame(() => { if (generation === this._resolveSeq) explicit.focus?.(); });
      } else if (instance?.el && route.autofocus !== false) {
        instance.el.setAttribute('tabindex', '-1');
        requestAnimationFrame(() => { if (generation === this._resolveSeq) instance.el.focus?.({ preventScroll: true }); });
      }
    } catch (error) {
      if (generation !== this._resolveSeq) return;
      this.showStatus({ message: 'This screen could not be opened. Reload to try again.' });
      console.error('[router] failed to mount route.');
      this.onError?.();
    }
  }
}
