// Runtime flags shared by both bundles. This module stays free of chrome.* and DOM.
// Product/security surfaces are never hidden behind flags: retired code is deleted, and optional
// features return only as isolated modules with explicit contracts and tests.

// DeFi feature flags (M0, 2026-10-05 — docs/defi/, docs/DECISIONS.md D-012). These gate the
// contract-first DeFi backend declared at contract v17 (READ) and v18 (EXEC). Every DEFI_* flag
// is a build-time constant false with NO query-parameter and NO storage override, by design
// (DEFI-02): turning one on is a ship decision made by editing this file in a reviewed commit,
// never something a URL, a message, or a stored value can do at runtime. The launchpad-
// quarantine test proves the override surface stays inert, and test/test-defi-m0.mjs proves
// every gated handler honours the flags.

export const FLAGS = {
  /** Log route transitions and bridge method names. Never logs params; they can hold secrets. */
  DEBUG_ROUTING: false,

  // Master switch for the DeFi backend surface. Product logic must use isDefiFeatureEnabled(),
  // which treats every feature as off while this is false, regardless of any other value.
  DEFI: false,
  DEFI_READ: false,       // read-only discovery/detail surfaces behind the capability gates
  DEFI_DEX: false,        // swap/liquidity quotes and prepared intents
  DEFI_LAUNCHPAD: false,  // token create/migrate/claim flows and launch drafts
  DEFI_MARKET: false,     // market data reads (assets, snapshots, candles, trades, holders)
  DEFI_RISK: false,       // risk assessment reads derived from registry facts
  DEFI_INTENT: false,     // intent prepare/submit/resume pipeline
  DEFI_FEED: false,       // signed feed consumption (no publisher verified today)
  DEFI_DESKTOP: false,    // Desktop tab surface (no page exists in this build)
};

/** @param {keyof typeof FLAGS} name */
export function isEnabled(name) {
  return Boolean(FLAGS[name]);
}

/**
 * The one supported way for product code to read a DeFi feature flag: the master switch and the
 * named feature flag must both be on. With DEFI false this is false for every input, which is
 * exactly the M0 shipping state.
 * @param {keyof typeof FLAGS} flag - one of the DEFI_* feature flags (not the master switch)
 */
export function isDefiFeatureEnabled(flag) {
  return FLAGS.DEFI === true && FLAGS[flag] === true;
}

/**
 * Enable diagnostic routing for this extension page only. Query overrides are not persisted and
 * cannot enable product features or retired code. DeFi product flags are build-time only and
 * must never gain an entry here (DEFI-02); the launchpad-quarantine test enforces this.
 */
export function applyQueryOverrides(search = '') {
  try {
    const params = new URLSearchParams(search);
    if (params.get('debug') === '1') FLAGS.DEBUG_ROUTING = true;
  } catch {
    // An invalid query leaves diagnostics disabled.
  }
}
