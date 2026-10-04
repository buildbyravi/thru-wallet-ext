// Theme preference ('light' | 'dark' | 'system'). Persistence belongs to the versioned
// preferences service; the popup reaches it through the same bridge as every other setting.
// The active theme is applied as [data-theme] on <html>.

import { send } from '../ui/app/bridge.js';

const VALID = new Set(['light', 'dark', 'system']);

function mediaQuery() {
  return typeof matchMedia === 'function'
    ? matchMedia('(prefers-color-scheme: dark)')
    : null;
}

export async function getTheme() {
  const prefs = await send('settings.get').catch(() => null);
  return VALID.has(prefs?.theme) ? prefs.theme : 'system';
}

function resolve(value) {
  return value === 'system'
    ? (mediaQuery()?.matches ? 'dark' : 'light')
    : value;
}

/** Apply immediately — safe to call before first paint (no async work). */
export function applyTheme(value) {
  document.documentElement.dataset.theme = resolve(VALID.has(value) ? value : 'system');
}

/** Read the stored preference and apply it. Called once at popup boot. */
export async function initTheme() {
  applyTheme(await getTheme());
  // A 'system' user follows the OS live: dark->light and back while the popup stays open.
  mediaQuery()?.addEventListener?.('change', async () => {
    if ((await getTheme()) === 'system') applyTheme('system');
  });
}

/** Persist and apply a new preference. The Settings surface calls this. */
export async function setTheme(value) {
  const next = VALID.has(value) ? value : 'system';
  await send('settings.set', { patch: { theme: next } });
  applyTheme(next);
}
