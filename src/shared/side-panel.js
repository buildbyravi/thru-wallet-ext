// The wire protocol for popup <-> side panel mutual exclusion.
//
// Both surfaces load the SAME popup.html, so the action token and the viewport
// discriminator must be identical in the UI (bridge broadcast + exclusion
// listener) and in the background (which early-returns the action instead of
// routing it as an API request). src/shared is the only layer both sides may
// import, so the protocol lives here.

/** Action of the UI<->UI broadcast: "a popup just opened; a side panel, close." */
export const CLOSE_SIDE_PANEL_ACTION = 'THRU_CLOSE_SIDE_PANEL';

/**
 * In-page detector for "am I the side panel?".
 *
 * There is no Chrome API for it, so the detector is the viewport: the popup is
 * always exactly --popup-height (600px) tall (tokens.css), while the side panel
 * is the browser window's full height and a user-resizable width. A viewport
 * taller than 600px is therefore the panel. If a user resizes the panel to
 * 600px or less, the worst case is a second open popup also closing on the
 * broadcast — the surfaces are still mutually exclusive, which is the rule.
 */
export function isSidePanelViewport(win) {
  return Number(win?.innerHeight) > 600;
}
