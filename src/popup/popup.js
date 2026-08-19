// Popup entry point.
//
// This file was a 1,100-line monolith holding a legacy show()-based navigator, a 28-case
// handleAction switch, duplicated send/dashboard/history logic, and module-scope variables that
// held secrets across screens. All of it is gone: every screen is now a route under
// src/ui/app/routes/, mounted by the single hash router.
//
// What remains is a boot stub. If it ever grows a screen again, that screen belongs in a route.
//
// The legacy tree is recoverable from git history and from legacy-ui-backup-*.zip in the repo
// root.

import { boot } from '../ui/app/boot.js';
import { applyQueryOverrides } from '../shared/flags.js';

async function init() {
  // Query overrides are dev-only and one-way: they can turn a flag ON, never off, and are never
  // persisted. See src/shared/flags.js.
  applyQueryOverrides(window.location.search);

  // No form in an extension page may ever perform a native submit, which would navigate the
  // document and blank the UI. Capture phase, so this wins regardless of what a route does with
  // its own listener.
  //
  // The legacy screens relied on `onsubmit="return false;"` in markup injected via innerHTML.
  // Inline handlers are blocked by the extension CSP, so those attributes never ran and the
  // forms were unprotected the whole time.
  document.addEventListener('submit', (event) => {
    event.preventDefault();
  }, true);

  const router = await boot({ root: document.getElementById('app') });
  if (!router) {
    // boot() only returns null when the mount point is missing, which is a build problem rather
    // than a runtime one. Say so instead of showing a blank panel.
    const app = document.getElementById('app');
    if (app) {
      app.textContent = 'Wallet failed to start: missing #app mount point.';
    }
    return;
  }

  document.getElementById('app')?.classList.remove('hidden');
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch((error) => {
    console.error('[popup] failed to start:', error);
  });
});
