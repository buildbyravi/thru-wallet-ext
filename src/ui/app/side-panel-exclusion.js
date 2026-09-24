// The toolbar popup and the side panel share popup.html, but only one should
// be open at a time. The manifest loads the panel as popup.html?thru_panel=1;
// viewport height is NOT a reliable discriminator (short browser windows can
// give a side panel less than the popup's 600px height).
//
// Register the listener synchronously at the start of boot, before theme
// storage or the background bootstrap. A popup broadcasts THRU_CLOSE_SIDE_PANEL
// so older Chrome versions can tell an already-loaded panel to close itself.
// On Chrome 141+, also close the global panel directly by windowId: this works
// even if its page/listener has not loaded yet or missed the broadcast.

import { broadcastCloseSidePanel } from './bridge.js';
import { CLOSE_SIDE_PANEL_ACTION, isSidePanelPage } from '../../shared/side-panel.js';

function closeSidePanelInCurrentWindow(chromeLike) {
  if (typeof chromeLike?.sidePanel?.close !== 'function'
      || typeof chromeLike?.windows?.getCurrent !== 'function') return;

  try {
    Promise.resolve(chromeLike.windows.getCurrent())
      .then((current) => {
        // Our manifest defines a global panel, so close by windowId, not
        // tabId (which can reject for a global panel in Chrome 145+).
        if (Number.isInteger(current?.id) && current.id >= 0) {
          return chromeLike.sidePanel.close({ windowId: current.id });
        }
      })
      .catch(() => {
        // Older/unsupported browsers still get the broadcast below.
      });
  } catch {
    // Do not let a failure to query the window interrupt the popup boot.
  }
}

/**
 * @param {Window} win the page's window (the side panel closes itself)
 * @param {Object} [chromeLike] injectable chrome for tests
 * @returns {() => void} dispose — removes the message listener
 */
export function installSidePanelExclusion(win = window, chromeLike = globalThis.chrome) {
  const onMessage = (message, sender) => {
    if (message?.action !== CLOSE_SIDE_PANEL_ACTION) return;
    if (sender?.id !== chromeLike?.runtime?.id) return;
    // Re-check at message time. A popup (even one taller than 600px in a
    // browser test) must never close itself on its own broadcast.
    if (!isSidePanelPage(win)) return;
    win.close?.();
  };

  chromeLike?.runtime?.onMessage?.addListener?.(onMessage);

  if (!isSidePanelPage(win)) {
    // The popup is opening. The native API is the reliable path when the
    // side panel has not registered its listener yet; the message is the
    // compatible path for Chrome versions before sidePanel.close existed.
    closeSidePanelInCurrentWindow(chromeLike);
    broadcastCloseSidePanel();
  }

  return () => chromeLike?.runtime?.onMessage?.removeListener?.(onMessage);
}
