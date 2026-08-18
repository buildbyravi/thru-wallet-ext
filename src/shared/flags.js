// Build-time / runtime feature flags.
//
// Imported by both bundles, so it must stay free of chrome.* and DOM access.
//
// NEXT_UI gates the rebuilt frontend. While it is off, popup.js behaves exactly as before
// and the new stack is inert. That is what makes the migration safe to land in small
// commits: each route can be built, reviewed and shipped without any user seeing a
// half-migrated app, and a regression is one flag flip away from being reverted.
//
// The flag is removed once every route has migrated and the legacy monolith is deleted.

export const FLAGS = {
  /**
   * Mount the new hash-router UI instead of the legacy show()/screen-id UI.
   *
   * Routes live under src/ui/app/routes/. Any hash the new router does not recognise
   * falls through to the legacy stack while this is a partial migration, so an
   * unmigrated screen is never a dead end.
   */
  NEXT_UI: false,

  /**
   * Token launchpad and DEX (src/launchpad/**).
   *
   * OFF while the core wallet is finished. The wallet must do the things a wallet is for —
   * accounts, send, receive, history, settings, networks — before it grows a trading surface.
   * Shipping both half-done means neither gets verified.
   *
   * This is a flag rather than a deletion so the code stays in the tree, keeps building, and
   * keeps being covered by the layering and contract checks. It comes back when its own
   * testing pass happens, not before.
   *
   * When off: the dashboard banner and the topbar expand button are hidden. launchpad.html
   * is still built and still reachable by direct URL — it is not a security boundary, it is a
   * product decision about what the UI advertises.
   */
  FEATURE_LAUNCHPAD: false,

  /**
   * Token deployment inside the launchpad. Separate from FEATURE_LAUNCHPAD so the launchpad
   * can be shown read-only (browse/inspect) before write operations are trusted.
   */
  FEATURE_TOKEN_DEPLOY: false,

  /** Log route transitions and bridge calls. Never logs params — they can hold secrets. */
  DEBUG_ROUTING: false,
};

/** @param {keyof typeof FLAGS} name */
export function isEnabled(name) {
  return Boolean(FLAGS[name]);
}

/**
 * Allow a flag to be forced on for a single session from the URL, e.g.
 * `popup.html?next=1#/unlock`. Query flags are dev conveniences only: they can turn a
 * flag ON but never off, and they are never persisted.
 * @param {string} search
 */
export function applyQueryOverrides(search = '') {
  try {
    const params = new URLSearchParams(search);
    if (params.get('next') === '1') FLAGS.NEXT_UI = true;
    if (params.get('debug') === '1') FLAGS.DEBUG_ROUTING = true;
    if (params.get('launchpad') === '1') FLAGS.FEATURE_LAUNCHPAD = true;
  } catch {
    // ignore
  }
}
