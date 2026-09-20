// Theme preference — pure popup-local UI state ('light' | 'dark' | 'system').
// The background and the vault know nothing about it: it is a rendering choice,
// not a network or security decision, so no bridge method carries it. The chosen
// value persists in chrome.storage.local under 'thru_theme'; the active theme is
// applied as [data-theme] on <html>, and all colours resolve through the token
// blocks in styles/tokens.css (light = :root, dark = [data-theme="dark"]).

const KEY = 'thru_theme';
const VALID = new Set(['light', 'dark', 'system']);

function mediaQuery() {
  return typeof matchMedia === 'function'
    ? matchMedia('(prefers-color-scheme: dark)')
    : null;
}

export async function getTheme() {
  const res = await chrome.storage.local.get(KEY).catch(() => ({}));
  const value = res?.[KEY];
  return VALID.has(value) ? value : 'system';
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
  await chrome.storage.local.set({ [KEY]: next });
  applyTheme(next);
}
