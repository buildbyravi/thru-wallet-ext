/**
 * Toast notification system.
 * Shows auto-dismissing slide-down toasts at the top of the popup.
 *
 * Usage:
 *   import { showToast } from './toast.js';
 *   showToast('Sent 0.1 THRU', 'success');
 *   showToast('Transfer failed', 'error');
 *   showToast('Address copied', 'info');
 */

const TOAST_DURATION_MS = 3000;
const TOAST_FADE_MS = 200;

let container = null;

function ensureContainer() {
  if (container) return container;
  container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.prepend(container);
  }
  return container;
}

/**
 * Show a toast notification.
 * @param {string} message — text to display
 * @param {'success'|'error'|'info'} type — visual style
 * @param {number} [duration] — ms before auto-dismiss (default 3000)
 */
export function showToast(message, type = 'info', duration = TOAST_DURATION_MS) {
  const root = ensureContainer();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');

  // Dismiss on click
  toast.addEventListener('click', () => dismiss(toast));

  root.appendChild(toast);

  // Trigger entrance animation on next frame
  requestAnimationFrame(() => toast.classList.add('toast-visible'));

  // Auto-dismiss
  setTimeout(() => dismiss(toast), duration);
}

function dismiss(toast) {
  if (toast.classList.contains('toast-exiting')) return;
  toast.classList.add('toast-exiting');
  toast.classList.remove('toast-visible');
  setTimeout(() => toast.remove(), TOAST_FADE_MS);
}
