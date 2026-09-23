// Mutual exclusion between the popup and the side panel: the wallet is visible
// in exactly ONE surface at a time. Both surfaces load the same popup.html, so
// this module self-detects which surface it is running in and enforces the
// rule from the side that just opened:
//
//   - Side panel (viewport taller than the fixed 600px popup): LISTENS for the
//     THRU_CLOSE_SIDE_PANEL broadcast and closes itself.
//   - Popup (exactly 400x600): BROADCASTS THRU_CLOSE_SIDE_PANEL at boot, so
//     clicking the toolbar icon while the panel is open closes the panel.
//
// The broadcast goes through the bridge — the single seam for
// chrome.runtime.sendMessage (scripts/check-layering.mjs). The action token
// and the viewport detector live in src/shared/side-panel.js so the background
// (which early-returns the action instead of routing it as an API request)
// works from the same definition.
//
// The listener stays installed on BOTH surfaces: Chrome never delivers a
// message to the sender, but this test harness and any future refactor might,
// so the isSidePanelViewport re-check at message time is the real guard — a
// popup receiving a stray broadcast must never close itself.

import { broadcastCloseSidePanel } from './bridge.js';
import { CLOSE_SIDE_PANEL_ACTION, isSidePanelViewport } from '../../shared/side-panel.js';

/**
 * @param {Window} win the page's window (the side panel closes itself)
 * @param {Object} [chromeLike] injectable chrome for tests
 * @returns {() => void} dispose — removes the message listener
 */
export function installSidePanelExclusion(win = window, chromeLike = globalThis.chrome) {
  const onMessage = (message) => {
    if (message?.action !== CLOSE_SIDE_PANEL_ACTION) return;
    // Re-check at message time: the viewport can change while the page is
    // open, and a popup-shaped page must never close on this signal.
    if (!isSidePanelViewport(win)) return;
    if (typeof win.close === 'function') win.close();
  };

  chromeLike?.runtime?.onMessage?.addListener?.(onMessage);

  if (!isSidePanelViewport(win)) {
    // We are the popup: a panel that is open right now is stale by definition.
    broadcastCloseSidePanel();
  }

  return () => chromeLike?.runtime?.onMessage?.removeListener?.(onMessage);
}
