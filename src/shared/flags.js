// Runtime diagnostic flags shared by both bundles. This module stays free of chrome.* and DOM.
// Product/security surfaces are never hidden behind flags: retired code is deleted, and optional
// features return only as isolated modules with explicit contracts and tests.

export const FLAGS = {
  /** Log route transitions and bridge method names. Never logs params; they can hold secrets. */
  DEBUG_ROUTING: false,
};

/** @param {keyof typeof FLAGS} name */
export function isEnabled(name) {
  return Boolean(FLAGS[name]);
}

/**
 * Enable diagnostic routing for this extension page only. Query overrides are not persisted and
 * cannot enable product features or retired code.
 */
export function applyQueryOverrides(search = '') {
  try {
    const params = new URLSearchParams(search);
    if (params.get('debug') === '1') FLAGS.DEBUG_ROUTING = true;
  } catch {
    // An invalid query leaves diagnostics disabled.
  }
}
