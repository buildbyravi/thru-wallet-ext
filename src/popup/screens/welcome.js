// Welcome screen module — first screen for new users (no vault exists).
//
// Three entry points: create, import seed, import key.
// No sensitive data on this screen — purely navigational.

import { icons } from '../icons.js';

/**
 * Mount the welcome screen.
 * @param {HTMLElement} container
 */
export function mount(container) {
  container.innerHTML = `
    <h1>Set up your wallet</h1>
    <p class="muted">This is an experimental, community-built wallet for Thru's alphanet. Not audited. Alphanet funds only.</p>
    <button class="btn primary" data-action="go-create">Create a new wallet</button>
    <button class="btn secondary" data-action="go-import">I already have a recovery phrase</button>
    <button class="btn text" data-action="go-import-key">Import from a private key instead</button>
  `;
}

/**
 * Cleanup — nothing to clean up on this screen.
 */
export function cleanup() {
  // No event listeners, no sensitive fields
}
