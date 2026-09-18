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
   * Mount the rebuilt hash-router UI.
   *
   * ON as of the full migration: all 14 routes exist on the new stack, so there is nothing left
   * for the legacy fallback to serve. scripts/check-routes.mjs enforces that every navigated
   * route is registered and every registered route is reachable, so a missing screen fails the
   * build rather than silently falling through.
   *
   * The legacy tree is deleted in the same commit. It remains recoverable from git history and
   * from legacy-ui-backup-*.zip in the repo root.
   */
  NEXT_UI: true,

  /** Log route transitions and bridge calls. Never logs params — they can hold secrets. */
  DEBUG_ROUTING: false,
};

// There is deliberately no FEATURE_LAUNCHPAD / FEATURE_TOKEN_DEPLOY here any more.
//
// They gated src/launchpad/**, which was a flag rather than a deletion — so the page kept
// building, kept shipping inside dist/, and stayed reachable by direct URL, with a query
// override (`popup.html?launchpad=1`) that could turn the whole surface on for any user who
// typed it. A flag is a product decision about what the UI advertises; it is not a security
// boundary, and the legacy page under it interpolated token metadata into innerHTML and
// quoted swaps from a hard-coded rate. The tree is deleted instead.
//
// When a launchpad returns it comes back as an isolated `src/features/launchpad/**` module
// with its own namespace, its own flag and its own tests, per docs/MODULE_BOUNDARIES.md.
// test-launchpad-quarantine.mjs fails the build if the legacy surface reappears.

/** @param {keyof typeof FLAGS} name */
export function isEnabled(name) {
  return Boolean(FLAGS[name]);
}

/**
 * Allow a flag to be forced on for a single session from the URL, e.g.
 * `popup.html?next=1#/unlock`. Query flags are dev conveniences only: they can turn a
 * flag ON but never off, and they are never persisted.
 *
 * Only the parameters handled below mean anything. An unknown one — including the retired
 * `launchpad` — is ignored rather than mapped onto a flag that no longer exists.
 * @param {string} search
 */
export function applyQueryOverrides(search = '') {
  try {
    const params = new URLSearchParams(search);
    if (params.get('next') === '1') FLAGS.NEXT_UI = true;
    if (params.get('debug') === '1') FLAGS.DEBUG_ROUTING = true;
  } catch {
    // ignore
  }
}
