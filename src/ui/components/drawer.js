// Reusable Rabby-style bottom-sheet slide-up drawer overlay.

import { icons } from '../../popup/icons.js';

export class Drawer {
  /**
   * Open a slide-up drawer overlay.
   * @param {Object} options
   * @param {string} options.title - Header title
   * @param {string} [options.contentHtml=''] - HTML content to place inside the drawer body
   * @param {function(HTMLElement, function): void} [options.onMount] - Callback once mounted
   * @param {function(): void} [options.onClose] - Callback when closed
   * @returns {function(): void} close function
   */
  static open({ title, contentHtml = '', onMount, onClose }) {
    // Remove existing drawer if any
    const existing = document.getElementById('app-drawer-overlay');
    if (existing) {
      existing.remove();
    }

    const overlay = document.createElement('div');
    overlay.id = 'app-drawer-overlay';
    overlay.className = 'drawer-overlay';

    overlay.innerHTML = `
      <div class="drawer-backdrop" id="drawer-backdrop"></div>
      <div class="drawer-panel" role="dialog" aria-modal="true" aria-label="${title}">
        <div class="drawer-handle-bar"></div>
        <div class="drawer-header">
          <h3 class="drawer-title">${title}</h3>
          <button type="button" class="drawer-close-btn" id="drawer-close-btn" title="Close">
            ${icons.x(16)}
          </button>
        </div>
        <div class="drawer-body" id="drawer-body">
          ${contentHtml}
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    let isClosing = false;
    const close = () => {
      if (isClosing) return;
      isClosing = true;
      overlay.classList.remove('drawer-open');
      document.removeEventListener('keydown', handleKeyDown);
      setTimeout(() => {
        overlay.remove();
        if (typeof onClose === 'function') onClose();
      }, 180);
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    overlay.querySelector('#drawer-backdrop')?.addEventListener('click', close);
    overlay.querySelector('#drawer-close-btn')?.addEventListener('click', close);

    // Trigger animation in next frame
    requestAnimationFrame(() => {
      overlay.classList.add('drawer-open');
    });

    const bodyEl = overlay.querySelector('#drawer-body');
    if (typeof onMount === 'function' && bodyEl) {
      onMount(bodyEl, close);
    }

    return close;
  }

  /**
   * Close any currently open drawer.
   */
  static closeAll() {
    const existing = document.getElementById('app-drawer-overlay');
    if (existing) {
      existing.classList.remove('drawer-open');
      setTimeout(() => existing.remove(), 180);
    }
  }
}
