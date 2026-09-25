// Popup <-> side panel mutual exclusion protocol. Both surfaces run the same
// popup.html/bundle. The manifest gives the side panel a non-secret query
// marker so its identity does not depend on browser window height: a side
// panel can be shorter than the 600px toolbar popup.

/** Action of the UI<->UI broadcast: "a popup just opened; a side panel, close." */
export const CLOSE_SIDE_PANEL_ACTION = 'THRU_CLOSE_SIDE_PANEL';

const PANEL_QUERY_KEY = 'thru_panel';

/** Must match the query on side_panel.default_path in src/manifest.json. */
export const SIDE_PANEL_SEARCH = `?${PANEL_QUERY_KEY}=1`;

/** Identify the panel by its manifest URL, never by viewport dimensions. */
export function isSidePanelPage(win) {
  return new URLSearchParams(win?.location?.search || '').get(PANEL_QUERY_KEY) === '1';
}
